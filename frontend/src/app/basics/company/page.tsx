'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, AlertCircle } from 'lucide-react'

type CompanyInfo = {
  stock_code: string
  company_name: string
  industry: string
  foreign_registration: string
  chairman: string
  ceo: string
  spokesperson: string
  spokesperson_title: string
  spokesperson_phone: string
  deputy_spokesperson: string
  address: string
  phone: string
  fax: string
  email: string
  website: string
  business_description: string
  established_date: string
  tax_id: string
  paid_in_capital: string
  listing_date: string
  otc_date: string
  emerging_date: string
  public_offering_date: string
  par_value: string
  shares_issued: string
  preferred_shares: string
  dividend_frequency: string
  transfer_agent: string
  transfer_agent_phone: string
  transfer_agent_address: string
  auditor_firm: string
  auditor_1: string
  auditor_2: string
  english_name: string
  english_address_street: string
  english_address_city: string
  investor_relations_contact: string
  investor_relations_title: string
  investor_relations_phone: string
  investor_relations_email: string
  updated_at: string
}

const FieldRow = ({ label, value, linkUrl, linkType }: { label: string; value?: string | null; linkUrl?: string | null; linkType?: 'email' | 'url' }) => {
  const displayValue = value && value.trim() ? value : '—'

  let content = <span className="text-sm break-all">{displayValue}</span>

  if (linkUrl && displayValue !== '—') {
    if (linkType === 'email') {
      content = (
        <a href={`mailto:${linkUrl}`} className="text-sm text-primary hover:underline break-all">
          {displayValue}
        </a>
      )
    } else if (linkType === 'url') {
      const formattedUrl = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
      content = (
        <a href={formattedUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
          {displayValue}
        </a>
      )
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-0 py-2 sm:py-1">
      <span className="text-sm text-muted-foreground sm:w-40 shrink-0">{label}</span>
      {content}
    </div>
  )
}

function CompanyBasicInfoContent() {
  const searchParams = useSearchParams()
  const symbol = searchParams.get('symbol') ?? ''

  const [data, setData] = useState<CompanyInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchCompanyInfo() {
      if (!symbol) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`/api/basics/company/${symbol}`)
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('查無此公司資料')
          }
          throw new Error(`載入失敗 (${res.status})`)
        }
        const json = await res.json() as CompanyInfo
        setData(json)
      } catch (err: unknown) {
        console.error('Failed to fetch company info:', err)
        setError(err instanceof Error ? err.message : '載入資料時發生未知錯誤')
      } finally {
        setLoading(false)
      }
    }

    fetchCompanyInfo()
  }, [symbol])

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4 md:space-y-6">
        <div className="flex flex-col gap-4 mb-2 md:mb-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="h-8 px-2 -ml-2 text-muted-foreground hover:text-foreground">
              <Link href="/basics/stock-codes">
                <ArrowLeft className="h-4 w-4 mr-1" />
                返回列表
              </Link>
            </Button>
          </div>

          <div>
            {loading ? (
              <Skeleton className="h-9 w-64" />
            ) : data ? (
              <h1 className="text-2xl md:text-3xl font-bold">
                <span className="font-mono mr-2">{data.stock_code}</span>
                {data.company_name} 基本資料
              </h1>
            ) : (
              <h1 className="text-2xl md:text-3xl font-bold">公司基本資料</h1>
            )}
          </div>
        </div>

        {loading && (
          <div className="space-y-4 md:space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="p-4 md:p-6 pt-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Skeleton key={j} className="h-5 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {error && !loading && (
          <Card className="border-destructive">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle className="h-12 w-12 text-destructive/80 mb-4" />
              <p className="text-lg font-medium text-destructive">{error}</p>
              <Button onClick={() => window.location.reload()} variant="outline" className="mt-4">
                重試
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && data && (
          <div className="space-y-4 md:space-y-6">
            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">公司概況</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="股票代號" value={data.stock_code} />
                  <FieldRow label="公司名稱" value={data.company_name} />
                  <FieldRow label="產業類別" value={data.industry} />
                  <FieldRow label="外國企業註冊地國" value={data.foreign_registration} />
                  <FieldRow label="公司成立日期" value={data.established_date} />
                  <FieldRow label="營利事業統一編號" value={data.tax_id} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">經營團隊</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="董事長" value={data.chairman} />
                  <FieldRow label="總經理" value={data.ceo} />
                  <FieldRow label="發言人" value={data.spokesperson} />
                  <FieldRow label="發言人職稱" value={data.spokesperson_title} />
                  <FieldRow label="發言人電話" value={data.spokesperson_phone} />
                  <FieldRow label="代理發言人" value={data.deputy_spokesperson} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">主要經營業務</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="whitespace-pre-line text-sm leading-relaxed">
                  {data.business_description || '—'}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">資本與股份</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="實收資本額" value={data.paid_in_capital} />
                  <FieldRow label="普通股每股面額" value={data.par_value} />
                  <FieldRow label="已發行普通股數" value={data.shares_issued} />
                  <FieldRow label="特別股" value={data.preferred_shares} />
                  <FieldRow label="普通股盈餘分派頻率" value={data.dividend_frequency} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">上市資訊</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="上市日期" value={data.listing_date} />
                  <FieldRow label="上櫃日期" value={data.otc_date} />
                  <FieldRow label="興櫃日期" value={data.emerging_date} />
                  <FieldRow label="公開發行日期" value={data.public_offering_date} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">聯絡資訊</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="地址" value={data.address} />
                  <FieldRow label="總機" value={data.phone} />
                  <FieldRow label="傳真" value={data.fax} />
                  <FieldRow label="電子郵件" value={data.email} linkUrl={data.email} linkType="email" />
                  <FieldRow label="公司網址" value={data.website} linkUrl={data.website} linkType="url" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">股務與會計</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="股票過戶機構" value={data.transfer_agent} />
                  <FieldRow label="過戶電話" value={data.transfer_agent_phone} />
                  <FieldRow label="過戶地址" value={data.transfer_agent_address} />
                  <FieldRow label="簽證會計師事務所" value={data.auditor_firm} />
                  <FieldRow label="簽證會計師1" value={data.auditor_1} />
                  <FieldRow label="簽證會計師2" value={data.auditor_2} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 md:p-6 pb-2 md:pb-4">
                <CardTitle className="text-lg">英文資訊</CardTitle>
              </CardHeader>
              <CardContent className="p-4 md:p-6 pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  <FieldRow label="英文全名" value={data.english_name} />
                  <FieldRow label="英文通訊地址" value={`${data.english_address_street || ''} ${data.english_address_city || ''}`.trim()} />
                  <FieldRow label="投資人關係聯絡人" value={data.investor_relations_contact} />
                  <FieldRow label="職稱" value={data.investor_relations_title} />
                  <FieldRow label="電話" value={data.investor_relations_phone} />
                  <FieldRow label="電子郵件" value={data.investor_relations_email} linkUrl={data.investor_relations_email} linkType="email" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function CompanyBasicInfoPage() {
  return (
    <Suspense fallback={null}>
      <CompanyBasicInfoContent />
    </Suspense>
  )
}
