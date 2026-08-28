'use client'

interface LogoProps {
  size?: number
  variant?: 'dark' | 'light' | 'accent'
}

// Inline SVG so CSS custom properties control stroke colors per variant
const SHELL_COLOR: Record<string, string> = {
  dark:   'var(--logo-shell, #1C1917)',
  light:  'var(--ink-inverse, #F5F2EE)',
  accent: 'var(--accent, #4A7C59)',
}
const MID_COLOR: Record<string, string> = {
  dark:   'var(--logo-mid, #A8A29E)',
  light:  'rgba(245,242,238,0.5)',
  accent: 'var(--accent-light, #6B9E78)',
}
const CORE_COLOR: Record<string, string> = {
  dark:   'var(--accent, #4A7C59)',
  light:  'var(--ink-inverse, #F5F2EE)',
  accent: 'var(--ink-inverse, #F5F2EE)',
}

export default function Logo({ size = 80, variant = 'dark' }: LogoProps) {
  const shell = SHELL_COLOR[variant]
  const mid   = MID_COLOR[variant]
  const core  = CORE_COLOR[variant]

  return (
    <svg
      viewBox="0 0 400 400"
      width={size}
      height={size}
      aria-label="GhostCall"
      style={{ flexShrink: 0, display: 'block' }}
    >
      <g strokeWidth="12" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <g stroke={shell}>
          <path d="M 90 280 V 240 C 90 170, 120 110, 200 70 C 280 110, 310 170, 310 240 V 280" />
          <line x1="90"  y1="298" x2="90"  y2="308" />
          <line x1="310" y1="298" x2="310" y2="308" />
        </g>
        <g stroke={mid}>
          <path d="M 125 310 V 240 C 125 185, 145 140, 200 105 C 255 140, 275 185, 275 240 V 310" />
        </g>
        <g stroke={core}>
          <path d="M 160 270 V 240 C 160 205, 170 170, 200 140 C 230 170, 240 205, 240 240 V 270" />
          <line x1="160" y1="288" x2="160" y2="298" />
          <line x1="240" y1="288" x2="240" y2="298" />
        </g>
      </g>
      <g>
        <line x1="182" y1="220" x2="218" y2="220" stroke={core} strokeWidth="3" strokeDasharray="5 4" strokeLinecap="round" />
        <circle cx="182" cy="220" r="6" fill={core} />
        <circle cx="218" cy="220" r="6" fill={core} />
      </g>
    </svg>
  )
}
