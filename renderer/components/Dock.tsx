'use client'

import { ReactNode } from 'react'

interface DockItemConfig {
  icon: ReactNode
  label: string
  onClick?: () => void
  active?: boolean
}

interface DockProps {
  items: DockItemConfig[]
}

export default function Dock({ items }: DockProps) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      width: '100%',
      background: '#fff',
      borderTop: '1px solid rgba(17,17,17,0.1)',
      padding: '8px 20px 24px',
      zIndex: 50,
    }}>
      <div style={{
        maxWidth: 390,
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-around',
      }}>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.onClick}
            aria-label={item.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '8px 12px',
              borderRadius: 14,
              border: 'none',
              background: item.active ? '#111' : 'transparent',
              cursor: 'pointer',
              color: item.active ? '#fff' : '#5a5a5a',
              transition: 'background 150ms, color 150ms',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.icon}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
