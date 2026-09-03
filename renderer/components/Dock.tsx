'use client'

import { Children, cloneElement, useEffect, useMemo, useRef, useState, ReactNode, ReactElement } from 'react'
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'motion/react'

interface DockItemConfig {
  icon: ReactNode
  label: string
  onClick?: () => void
  active?: boolean
}

interface DockItemProps {
  children: ReactNode
  onClick?: () => void
  mouseX: ReturnType<typeof useMotionValue<number>>
  spring: { mass: number; stiffness: number; damping: number }
  distance: number
  magnification: number
  baseItemSize: number
  label: string
  active?: boolean
}

function DockItem({ children, onClick, mouseX, spring, distance, magnification, baseItemSize, label, active }: DockItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isHovered = useMotionValue(0)

  const mouseDistance = useTransform(mouseX, (val: number) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: baseItemSize }
    return val - rect.x - baseItemSize / 2
  })

  const targetSize = useTransform(mouseDistance, [-distance, 0, distance], [baseItemSize, magnification, baseItemSize])
  const size = useSpring(targetSize, spring)

  return (
    <motion.div
      ref={ref}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={label}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        background: active ? '#C6F135' : 'var(--glass-regular)',
        border: active ? '0.5px solid #C6F135' : '0.5px solid var(--glass-border-sub)',
        cursor: 'pointer',
        outline: 'none',
        color: active ? '#000000' : 'var(--label-secondary)',
      }}
    >
      {Children.map(children, child => cloneElement(child as ReactElement<{ isHovered?: ReturnType<typeof useMotionValue<number>> }>, { isHovered }))}
    </motion.div>
  )
}

function DockLabel({ children, isHovered }: { children: ReactNode; isHovered?: ReturnType<typeof useMotionValue<number>> }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isHovered) return
    return isHovered.on('change', v => setVisible(v === 1))
  }, [isHovered])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: 1, y: -10 }}
          exit={{ opacity: 0, y: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'absolute',
            top: '-1.8rem',
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'pre',
            borderRadius: 'var(--radius-sm)',
            border: '0.5px solid var(--glass-border-sub)',
            background: 'var(--system-gray-3)',
            padding: '2px 8px',
            fontSize: 11,
            color: 'var(--label-primary)',
            pointerEvents: 'none',
          }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DockIcon({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}

interface DockProps {
  items: DockItemConfig[]
  magnification?: number
  distance?: number
  panelHeight?: number
  baseItemSize?: number
}

export default function Dock({
  items,
  magnification = 58,
  distance = 180,
  panelHeight = 60,
  baseItemSize = 44,
}: DockProps) {
  const mouseX = useMotionValue(Infinity)
  const isHovered = useMotionValue(0)

  const spring = { mass: 0.1, stiffness: 150, damping: 12 }

  const maxHeight = useMemo(
    () => Math.max(panelHeight + 40, magnification + magnification / 2 + 4),
    [magnification, panelHeight]
  )
  const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight])
  const height = useSpring(heightRow, spring)

  return (
    <motion.div
      style={{
        height,
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 50,
        overflow: 'visible',
      }}
    >
      <motion.div
        onMouseMove={({ pageX }) => { isHovered.set(1); mouseX.set(pageX) }}
        onMouseLeave={() => { isHovered.set(0); mouseX.set(Infinity) }}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--space-2)',
          padding: '0 var(--space-2) var(--space-2)',
          height: panelHeight,
          borderRadius: 'var(--radius-xl)',
          background: 'var(--dock-bg)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, i) => (
          <DockItem
            key={i}
            onClick={item.onClick}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
            label={item.label}
            active={item.active}
          >
            <DockIcon>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  )
}
