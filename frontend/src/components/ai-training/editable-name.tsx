'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onSave: (newName: string) => Promise<void>
  className?: string
}

export function EditableName({ value, onSave, className }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 防止 onBlur 與 Enter 重複觸發
  const savingRef = useRef(false)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = () => {
    if (savingRef.current) return
    setDraft(value)
    setEditing(true)
  }

  const cancel = () => {
    if (savingRef.current) return
    setDraft(value)
    setEditing(false)
  }

  const save = async () => {
    if (savingRef.current) return
    const trimmed = draft.trim()
    if (!trimmed) {
      toast.error('名稱不可為空')
      cancel()
      return
    }
    if (trimmed === value) {
      setEditing(false)
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      await onSave(trimmed)
      setEditing(false)
    } catch (e) {
      toast.error('更新失敗', { description: e instanceof Error ? e.message : String(e) })
      setDraft(value)
      setEditing(false)
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
        disabled={saving}
        className={cn(
          'h-8 px-2 text-base font-semibold rounded border border-primary bg-background outline-none focus:ring-2 focus:ring-primary/30 min-w-[200px] max-w-md',
          saving && 'opacity-60',
          className,
        )}
        title="Enter 儲存、Esc 取消"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className={cn(
        'group inline-flex items-center gap-1.5 h-8 px-2 rounded hover:bg-muted transition-colors truncate max-w-md text-left',
        className,
      )}
      title="點擊編輯訓練名稱"
    >
      <span className="text-base font-semibold truncate">{value}</span>
      <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}
