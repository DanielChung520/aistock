'use client'

import type { FooterConfig, ThemeConfig } from '../types'

export interface FooterProps {
  config: FooterConfig
  theme: ThemeConfig
}

export function Footer({ config, theme }: FooterProps) {
  return (
    <footer className={theme.classes.footer}>
      {config.items.map((item, idx) => (
        <span key={item.id} className={idx > 0 ? 'ml-4' : ''}>
          {item.text}
        </span>
      ))}
    </footer>
  )
}
