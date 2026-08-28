'use client'

interface LogoProps {
  size?: number
  variant?: 'dark' | 'light' | 'accent'
}

export default function Logo({ size = 80, variant = 'dark' }: LogoProps) {
  return (
    <div data-variant={variant} style={{ width: size, height: size, flexShrink: 0 }}>
      <img
        src="/assets/logo.svg"
        alt="GhostCall"
        width={size}
        height={size}
        style={{ display: 'block', width: size, height: size }}
      />
    </div>
  )
}
