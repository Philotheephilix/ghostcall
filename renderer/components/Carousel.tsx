'use client'

import { useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { motion, useMotionValue, useTransform } from 'motion/react'

export interface CarouselItem {
  id: number
  title: string
  description: string
  icon?: ReactNode
}

const DRAG_BUFFER = 0
const VELOCITY_THRESHOLD = 500
const GAP = 16
const SPRING_OPTIONS = { type: 'spring' as const, stiffness: 300, damping: 30 }

interface CarouselItemProps {
  item: CarouselItem
  index: number
  itemWidth: number
  trackItemOffset: number
  x: ReturnType<typeof useMotionValue<number>>
  transition: object
}

function CarouselItemCard({ item, index, itemWidth, trackItemOffset, x, transition }: CarouselItemProps) {
  const range = [-(index + 1) * trackItemOffset, -index * trackItemOffset, -(index - 1) * trackItemOffset]
  const rotateY = useTransform(x, range, [90, 0, -90], { clamp: false })

  return (
    <motion.div
      style={{
        width: itemWidth,
        height: '100%',
        rotateY,
        position: 'relative',
        display: 'flex',
        flexShrink: 0,
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        border: '0.5px solid var(--glass-border-sub)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--glass-thin)',
        overflow: 'hidden',
        cursor: 'grab',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      transition={transition}
    >
      {item.icon && (
        <div style={{ padding: '18px 18px 0' }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(10,132,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--system-blue)',
          }}>
            {item.icon}
          </div>
        </div>
      )}
      <div style={{ padding: '16px 18px 20px' }}>
        <p style={{ fontSize: 'var(--text-subhead, 15px)', fontWeight: 700, color: 'var(--label-primary)', marginBottom: 4 }}>
          {item.title}
        </p>
        <p style={{ fontSize: 'var(--text-caption1, 12px)', color: 'var(--label-tertiary)', lineHeight: 1.4 }}>
          {item.description}
        </p>
      </div>
    </motion.div>
  )
}

interface CarouselProps {
  items: CarouselItem[]
  baseWidth?: number
  autoplay?: boolean
  autoplayDelay?: number
  loop?: boolean
}

export default function Carousel({
  items,
  baseWidth = 300,
  autoplay = true,
  autoplayDelay = 3000,
  loop = true,
}: CarouselProps) {
  const containerPadding = 16
  const itemWidth = baseWidth - containerPadding * 2
  const trackItemOffset = itemWidth + GAP

  const itemsForRender = useMemo(() => {
    if (!loop || items.length === 0) return items
    return [items[items.length - 1], ...items, items[0]]
  }, [items, loop])

  const [position, setPosition] = useState(loop ? 1 : 0)
  const x = useMotionValue(0)
  const [isJumping, setIsJumping] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const enter = () => setIsHovered(true)
    const leave = () => setIsHovered(false)
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => { el.removeEventListener('mouseenter', enter); el.removeEventListener('mouseleave', leave) }
  }, [])

  useEffect(() => {
    if (!autoplay || itemsForRender.length <= 1 || isHovered) return
    const t = setInterval(() => {
      setPosition(p => Math.min(p + 1, itemsForRender.length - 1))
    }, autoplayDelay)
    return () => clearInterval(t)
  }, [autoplay, autoplayDelay, isHovered, itemsForRender.length])

  useEffect(() => {
    const start = loop ? 1 : 0
    setPosition(start)
    x.set(-start * trackItemOffset)
  }, [items.length, loop, trackItemOffset, x])

  const effectiveTransition = isJumping ? { duration: 0 } : SPRING_OPTIONS

  function handleAnimationComplete() {
    if (!loop || itemsForRender.length <= 1) { setIsAnimating(false); return }
    const last = itemsForRender.length - 1
    if (position === last) {
      setIsJumping(true); setPosition(1); x.set(-trackItemOffset)
      requestAnimationFrame(() => { setIsJumping(false); setIsAnimating(false) })
    } else if (position === 0) {
      setIsJumping(true); const t = items.length; setPosition(t); x.set(-t * trackItemOffset)
      requestAnimationFrame(() => { setIsJumping(false); setIsAnimating(false) })
    } else { setIsAnimating(false) }
  }

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const dir = info.offset.x < -DRAG_BUFFER || info.velocity.x < -VELOCITY_THRESHOLD ? 1
      : info.offset.x > DRAG_BUFFER || info.velocity.x > VELOCITY_THRESHOLD ? -1 : 0
    if (!dir) return
    setPosition(p => Math.max(0, Math.min(p + dir, itemsForRender.length - 1)))
  }

  const dragProps = loop ? {} : {
    dragConstraints: { left: -trackItemOffset * Math.max(itemsForRender.length - 1, 0), right: 0 },
  }

  const activeIndex = items.length === 0 ? 0
    : loop ? (position - 1 + items.length) % items.length
    : Math.min(position, items.length - 1)

  return (
    <div
      ref={containerRef}
      style={{
        width: baseWidth,
        position: 'relative',
        overflow: 'hidden',
        border: '0.5px solid var(--glass-border-sub)',
        borderRadius: 'var(--radius-xl)',
        padding: containerPadding,
        background: 'var(--glass-chrome)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <motion.div
        drag={isAnimating ? false : 'x'}
        {...dragProps}
        style={{
          display: 'flex',
          width: itemWidth,
          gap: GAP,
          perspective: 1000,
          perspectiveOrigin: `${position * trackItemOffset + itemWidth / 2}px 50%`,
          x,
        }}
        onDragEnd={handleDragEnd}
        animate={{ x: -(position * trackItemOffset) }}
        transition={effectiveTransition}
        onAnimationStart={() => setIsAnimating(true)}
        onAnimationComplete={handleAnimationComplete}
      >
        {itemsForRender.map((item, i) => (
          <CarouselItemCard
            key={`${item?.id ?? i}-${i}`}
            item={item}
            index={i}
            itemWidth={itemWidth}
            trackItemOffset={trackItemOffset}
            x={x}
            transition={effectiveTransition}
          />
        ))}
      </motion.div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {items.map((_, i) => (
            <motion.button
              key={i}
              aria-label={`Slide ${i + 1}`}
              animate={{ scale: activeIndex === i ? 1.2 : 1 }}
              transition={{ duration: 0.15 }}
              onClick={() => setPosition(loop ? i + 1 : i)}
              style={{
                width: 6, height: 6, borderRadius: '50%', border: 'none', padding: 0,
                cursor: 'pointer',
                background: activeIndex === i ? 'var(--label-primary)' : 'var(--glass-border)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
