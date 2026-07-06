'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { iconMap, ICON_LIST } from '@/lib/icon-map'

interface IconPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (icon: string) => void
  currentIcon?: string | null
}

export function IconPicker({
  open,
  onOpenChange,
  onSelect,
  currentIcon,
}: IconPickerProps) {
  const [searchText, setSearchText] = useState('')

  const filteredIcons = ICON_LIST.filter(
    (icon) =>
      icon.label.toLowerCase().includes(searchText.toLowerCase()) ||
      icon.value.toLowerCase().includes(searchText.toLowerCase()),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>選擇圖標</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜尋圖標..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="grid grid-cols-6 gap-1.5">
            {filteredIcons.map((iconDef) => {
              const IconComp = iconMap[iconDef.value]
              const isSelected = currentIcon === iconDef.value
              return (
                <Button
                  key={iconDef.value}
                  variant={isSelected ? 'default' : 'ghost'}
                  size="sm"
                  className="flex flex-col items-center justify-center h-16 gap-1 px-1"
                  onClick={() => {
                    onSelect(iconDef.value)
                    onOpenChange(false)
                    setSearchText('')
                  }}
                >
                  {IconComp && <IconComp className="h-5 w-5" />}
                  <span className="text-[10px] leading-tight text-center truncate w-full">
                    {iconDef.label}
                  </span>
                </Button>
              )
            })}
          </div>
          {filteredIcons.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              無符合的圖標
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
