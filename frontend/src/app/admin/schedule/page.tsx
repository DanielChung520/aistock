'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, CheckCircle, XCircle, AlertCircle, Loader2, Play, Save, ExternalLink, Gauge } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'

const AIRFLOW_URL = process.env.NEXT_PUBLIC_AIRFLOW_URL || 'http://airflow.k84.org'
const AIRFLOW_USER = process.env.NEXT_PUBLIC_AIRFLOW_USER || 'admin'
const AIRFLOW_PASSWORD = process.env.NEXT_PUBLIC_AIRFLOW_PASSWORD || 'admin'
const DAG_ID = 'ohlcv_daily_update'

interface ScheduleSettings {
  _key: string
  enabled: boolean
  hour: number
  minute: number
  timezone: string
  lastRun: string | null
  lastStatus: 'completed' | 'partial' | 'failed' | null
  lastRunDaily: string | null
  lastStatusDaily: 'completed' | 'partial' | 'failed' | null
  lastRunMinute: string | null
  lastStatusMinute: 'completed' | 'partial' | 'failed' | null
  createdAt: string
  updatedAt: string
}

interface DagRun {
  dag_id: string
  run_id: string
  state: 'queued' | 'running' | 'success' | 'failed' | null
  start_date: string | null
  end_date: string | null
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '-'
  const date = new Date(isoString)
  return date.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: 'completed' | 'partial' | 'failed' | null }) {
  if (status === 'completed') {
    return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" /> 完成</Badge>
  }
  if (status === 'partial') {
    return <Badge className="bg-yellow-500"><AlertCircle className="w-3 h-3 mr-1" /> 部分</Badge>
  }
  if (status === 'failed') {
    return <Badge className="bg-red-500"><XCircle className="w-3 h-3 mr-1" /> 失敗</Badge>
  }
  return <Badge variant="outline">-</Badge>
}

function getProgressValue(state: string | null): number {
  switch (state) {
    case 'queued': return 10
    case 'running': return 50
    case 'success': return 100
    case 'failed': return 100
    default: return 0
  }
}

function getProgressColor(state: string | null): string {
  switch (state) {
    case 'queued': return 'bg-blue-500'
    case 'running': return 'bg-yellow-500'
    case 'success': return 'bg-green-500'
    case 'failed': return 'bg-red-500'
    default: return 'bg-gray-300'
  }
}

export default function ScheduleAdminPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [settings, setSettings] = useState<ScheduleSettings | null>(null)
  const [dagRuns, setDagRuns] = useState<DagRun[]>([])
  const [isAirflowConnected, setIsAirflowConnected] = useState(false)
  const [formData, setFormData] = useState({
    enabled: true,
    hour: 15,
    minute: 0,
    timezone: 'Asia/Taipei',
  })

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/schedule')
      if (!res.ok) throw new Error('Failed to fetch settings')
      const data = await res.json()
      setSettings(data)
      setFormData({
        enabled: data.enabled ?? true,
        hour: data.hour ?? 15,
        minute: data.minute ?? 0,
        timezone: data.timezone ?? 'Asia/Taipei',
      })
    } catch (error) {
      toast.error('Error fetching schedule settings')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchDagRuns = async () => {
    try {
      const token = btoa(`${AIRFLOW_USER}:${AIRFLOW_PASSWORD}`)
      const res = await fetch(`${AIRFLOW_URL}/api/v1/dags/${DAG_ID}/dagRuns?order_by=-start_date&limit=5`, {
        headers: {
          'Authorization': `Basic ${token}`,
        },
      })
      
      if (res.ok) {
        const data = await res.json()
        setDagRuns(data.dag_runs || [])
        setIsAirflowConnected(true)
      } else {
        setIsAirflowConnected(false)
      }
    } catch {
      setIsAirflowConnected(false)
    }
  }

  useEffect(() => {
    fetchSettings()
    fetchDagRuns()
    
    const interval = setInterval(fetchDagRuns, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) throw new Error('Failed to save settings')

      toast.success('排程設置已儲存')
      fetchSettings()
    } catch (error) {
      toast.error('Error saving settings')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  const handleTriggerDag = async () => {
    if (!window.confirm('觸發 Airflow DAG 執行？')) return

    setTriggering(true)
    try {
      const token = btoa(`${AIRFLOW_USER}:${AIRFLOW_PASSWORD}`)
      const res = await fetch(`${AIRFLOW_URL}/api/v1/dags/${DAG_ID}/dagRuns`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      if (!res.ok) throw new Error('Failed to trigger DAG')

      toast.success('DAG 已觸發，請查看 Airflow 監控進度')
      setTimeout(fetchDagRuns, 2000)
    } catch (error) {
      toast.error('Error triggering DAG')
      console.error(error)
    } finally {
      setTriggering(false)
    }
  }

  if (loading && !settings) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto py-10 space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">排程設置</h1>
          {!isAirflowConnected && (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500">
              Airflow 未連線
            </Badge>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <Button 
            variant="outline" 
            onClick={handleTriggerDag} 
            disabled={triggering || !isAirflowConnected}
          >
            <Play className="mr-2 h-4 w-4" />
            {triggering ? '觸發中...' : '手動觸發'}
          </Button>
          <Button 
            variant="secondary"
            onClick={() => window.open(AIRFLOW_URL, '_blank')}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {isAirflowConnected ? '開啟 Airflow' : '開啟登入頁面'}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? '儲存中...' : '儲存設置'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Clock className="mr-2 h-5 w-5" />
            下載時間
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Label>啟用排程</Label>
              <p className="text-sm text-muted-foreground">關閉後不會自動執行下載</p>
            </div>
            <Switch
              checked={formData.enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hour">小時 (0-23)</Label>
              <Input
                id="hour"
                type="number"
                min={0}
                max={23}
                value={formData.hour}
                onChange={(e) => setFormData({ ...formData, hour: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minute">分鐘 (0-59)</Label>
              <Input
                id="minute"
                type="number"
                min={0}
                max={59}
                value={formData.minute}
                onChange={(e) => setFormData({ ...formData, minute: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">
              排程將於每天 <strong>{String(formData.hour).padStart(2, '0')}:{String(formData.minute).padStart(2, '0')}</strong> 自動執行
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              透過 Airflow 排程 (DAG: {DAG_ID})
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Gauge className="mr-2 h-5 w-5" />
            執行進度
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {dagRuns.length > 0 ? (
            <div className="space-y-4">
              {dagRuns.slice(0, 3).map((run) => (
                <div key={run.run_id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{run.run_id}</span>
                      {run.state === 'running' && <Loader2 className="h-4 w-4 animate-spin" />}
                      {run.state === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {run.state === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {run.start_date ? formatDateTime(run.start_date) : '-'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress 
                      value={getProgressValue(run.state)} 
                      className="flex-1"
                    />
                    <span className={`text-xs px-2 py-1 rounded ${getProgressColor(run.state)} text-white`}>
                      {run.state || 'unknown'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              {isAirflowConnected ? '尚無執行記錄' : '無法連線至 Airflow'}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近執行狀態</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <h3 className="font-medium">整體</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">最近執行</span>
                  <span>{formatDateTime(settings?.lastRun || null)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">狀態</span>
                  <StatusBadge status={settings?.lastStatus || null} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">日K線 (Daily)</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">最近執行</span>
                  <span>{formatDateTime(settings?.lastRunDaily || null)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">狀態</span>
                  <StatusBadge status={settings?.lastStatusDaily || null} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-medium">分K線 (Minute)</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">最近執行</span>
                  <span>{formatDateTime(settings?.lastRunMinute || null)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">狀態</span>
                  <StatusBadge status={settings?.lastStatusMinute || null} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>說明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <h4 className="font-medium text-foreground mb-2">排程工具</h4>
            <p>使用 <strong>Apache Airflow</strong> 進行排程管理，可透過「手動觸發」按鈕立即執行，或點擊「開啟 Airflow」查看詳細監控畫面。</p>
            <p className="mt-2 text-xs">💡 首次點擊會跳轉到登入頁面，請輸入帳號 <code>admin</code> 密碼 <code>admin</code>，瀏覽器會記住登入狀態。</p>
          </div>
          <div>
            <h4 className="font-medium text-foreground mb-2">資料保留期限</h4>
            <ul className="list-disc list-inside space-y-1">
              <li>日K線 (Daily): 10年移動窗口</li>
              <li>1分K、5分K: 7天</li>
              <li>10分K、15分K、30分K、60分K: 30天</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-foreground mb-2">資料來源</h4>
            <ul className="list-disc list-inside space-y-1">
              <li>日K線: TWSE (台灣證券交易所)</li>
              <li>分K線: yfinance (Yahoo Finance)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-foreground mb-2">狀態說明</h4>
            <ul className="list-disc list-inside space-y-1">
              <li><span className="text-green-500">完成</span>: 所有股票都成功更新</li>
              <li><span className="text-yellow-500">部分</span>: 部分股票成功，部分失敗</li>
              <li><span className="text-red-500">失敗</span>: 所有股票都更新失敗</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
