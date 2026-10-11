'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Building2, AlertCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface CompanyInfo {
  stock_code: string
  company_name: string
  industry: string
  chairman: string
  ceo: string
  spokesperson: string
  address: string
  phone: string
  website: string
  business_description: string
  established_date: string
  paid_in_capital: string
  listing_date: string
  shares_issued: string
}

interface CompanyInfoModalProps {
  isOpen: boolean
  onClose: () => void
  stockId: string
  stockName?: string
}

export function CompanyInfoModal({ isOpen, onClose, stockId, stockName }: CompanyInfoModalProps) {
  const [data, setData] = useState<CompanyInfo | null>(null)
  const [dataStatus, setDataStatus] = useState<{ daily: any; minute: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !stockId) return
    setLoading(true)
    setError(null)
    setData(null)

    Promise.all([
      fetch(`/api/basics/company/${stockId}`).then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? '查無此公司資料' : '載入失敗')
        return r.json()
      }),
      fetch(`/api/stocks/${stockId}/data-status`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([company, status]) => {
        setData(company)
        setDataStatus(status)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isOpen, stockId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl border border-border w-[520px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">
              {stockId} {stockName || ''}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive font-medium">{error}</p>
            </div>
          )}

          {data && (
            <div className="space-y-3 text-sm">
              <FieldRow label="公司名稱" value={data.company_name} />
              <FieldRow label="產業類別" value={data.industry} />
              <FieldRow label="董事長" value={data.chairman} />
              <FieldRow label="總經理" value={data.ceo} />
              <FieldRow label="發言人" value={data.spokesperson} />
              <FieldRow label="成立日期" value={data.established_date} />
              <FieldRow label="上市日期" value={data.listing_date} />
              <FieldRow label="資本額" value={data.paid_in_capital} />
              <FieldRow label="發行股數" value={data.shares_issued} />
              <FieldRow label="地址" value={data.address} />
              <FieldRow label="電話" value={data.phone} />
              {data.website && (
                <FieldRow label="網站" value={data.website} linkUrl={data.website} linkType="url" />
              )}
              {dataStatus && (
                <div className="pt-3 border-t border-border space-y-2">
                  <span className="text-xs text-muted-foreground font-medium">資料庫狀態</span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted/30 rounded p-2">
                      <div className="text-muted-foreground">日K</div>
                      <div className="font-medium mt-0.5">
                        {dataStatus.daily.cnt > 0
                          ? `${dataStatus.daily.first} ~ ${dataStatus.daily.last} (${dataStatus.daily.cnt}筆)`
                          : '無資料'}
                      </div>
                    </div>
                    <div className="bg-muted/30 rounded p-2">
                      <div className="text-muted-foreground">分K</div>
                      <div className="font-medium mt-0.5">
                        {dataStatus.minute.cnt > 0
                          ? `${dataStatus.minute.first} ~ ${dataStatus.minute.last} (${dataStatus.minute.cnt}筆)`
                          : '無資料'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {data.business_description && (
                <div className="pt-3 border-t border-border">
                  <span className="text-xs text-muted-foreground block mb-1">主要業務</span>
                  <p className="text-sm leading-relaxed">{data.business_description}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function FieldRow({ label, value, linkUrl, linkType }: { label: string; value?: string | null; linkUrl?: string | null; linkType?: 'email' | 'url' }) {
  const displayValue = value?.trim() || '—'

  let content = <span className="text-sm">{displayValue}</span>
  if (linkUrl && displayValue !== '—') {
    const href = linkType === 'email' ? `mailto:${linkUrl}` : linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`
    content = (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
        {displayValue}
      </a>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 shrink-0 text-xs">{label}</span>
      <span className="text-foreground">{content}</span>
    </div>
  )
}
