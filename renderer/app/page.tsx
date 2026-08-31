'use client'

import { useEffect } from 'react'

export default function Root() {
  useEffect(() => {
    window.location.replace('/home')
  }, [])

  return (
    <div style={{
      minHeight: '100vh', background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'rgba(255,255,255,0.2)',
        animation: 'pulse 1.2s ease-in-out infinite',
      }} />
      <style>{`@keyframes pulse { 0%,100%{opacity:.2} 50%{opacity:.7} }`}</style>
    </div>
  )
}
