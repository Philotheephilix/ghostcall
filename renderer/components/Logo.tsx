'use client'

import { useId } from 'react'

interface LogoProps {
  size?: number
  glowColor?: string
}

export default function Logo({ size = 64, glowColor = 'rgba(48,209,88,0.6)' }: LogoProps) {
  const uid = useId().replace(/:/g, '')
  const filterId = `glow-${uid}`

  return (
    <svg viewBox="0 0 400 400" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <filter id={filterId}>
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <g strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke="rgba(255,255,255,0.9)">
          <path d="M 90 280 V 240 C 90 170, 120 110, 200 70 C 280 110, 310 170, 310 240 V 280" />
          <line x1="90"  y1="298" x2="90"  y2="308" />
          <line x1="310" y1="298" x2="310" y2="308" />
        </g>
        <g stroke="rgba(255,255,255,0.25)">
          <path d="M 125 310 V 240 C 125 185, 145 140, 200 105 C 255 140, 275 185, 275 240 V 310" />
        </g>
        <g stroke={glowColor} filter={`url(#${filterId})`}>
          <path d="M 160 270 V 240 C 160 205, 170 170, 200 140 C 230 170, 240 205, 240 240 V 270" />
          <line x1="160" y1="288" x2="160" y2="298" />
          <line x1="240" y1="288" x2="240" y2="298" />
        </g>
      </g>
      <g filter={`url(#${filterId})`}>
        <line x1="182" y1="220" x2="218" y2="220" stroke={glowColor} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />
        <circle cx="182" cy="220" r="5.5" fill={glowColor} />
        <circle cx="218" cy="220" r="5.5" fill={glowColor} />
      </g>
    </svg>
  )
}
