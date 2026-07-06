'use client'

import { useActions } from '../lib/actions'
import type { ThemeConfig } from '../types'
import { X } from 'lucide-react'

export interface ModalProps {
  theme: ThemeConfig
}

export function Modal({ theme }: ModalProps) {
  const { activeModal, closeModal } = useActions()

  if (!activeModal) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeModal}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl max-w-2xl w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="font-semibold">{activeModal.title}</span>
          <button
            onClick={closeModal}
            className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            title="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 text-sm text-muted-foreground">
          Modal 內容：{activeModal.component} ({activeModal.id})
        </div>
      </div>
    </div>
  )
}
