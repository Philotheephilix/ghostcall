'use client'

import { useState, useEffect, useRef } from 'react'
import Logo from '../../components/Logo'
import DialPad from '../../components/DialPad'
import CallHistory from '../../components/CallHistory'
import PaymentModal from '../../components/PaymentModal'
import PaymentsPage from '../../components/PaymentsPage'
import Dock from '../../components/Dock'
import { useTorStatus } from '../../hooks/useTorStatus'
import { appendCallLog, markCallPaid } from '../../lib/app-state'

export default function Home() {
  const torStatus = useTorStatus()
  const [isOnline, setIsOnline] = useState(false)
  const [onionAddr, setOnionAddr] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [pendingPayment, setPendingPayment] = useState<{ callId: string; peer: string } | null>(null)
  const [historyKey, setHistoryKey] = useState(0)
  const [activeTab, setActiveTab] = useState<'dial' | 'payments'>('dial')
  // Offer callIds we've already acted on — a relay may redeliver the same
  // kind-1059 event, and we must not dial back twice.
  const seenOffers = useRef<Set<string>>(new Set())

  useEffect(() => {
    const gc = (window as any).ghostcall
    if (!gc) return
    // Recover a 'call:connected' push that may have fired before this page
    // mounted (e.g. inbound call landing during startup) — the push is
    // fire-and-forget and unbuffered, so pull the current state once on mount.
    gc.getCallState?.().then((s: { direction: string } | null) => {
      if (s) window.location.href = '/call'
    }).catch(() => { /* no active call */ })
    const c1 = gc.onCallConnected?.(() => { window.location.href = '/call' })
    const c2 = gc.onCallError?.((err: { message: string }) => setStatusMsg(err.message))
    const c3 = gc.onCallEnded?.((info: { callId: string; peer: string; duration: number }) => {
      appendCallLog({ id: info.callId, peer: info.peer, duration: info.duration, ts: Date.now(), committed: false })
      setHistoryKey(k => k + 1)
      if (info.peer && !info.peer.includes('.onion')) {
        setPendingPayment({ callId: info.callId, peer: info.peer })
      }
    })
    // Incoming call-by-handle offer: the caller published a gift-wrapped Nostr
    // event carrying their onion. Decrypt it, then dial back (roles inverted —
    // the caller is listening as responder). Auto-answer: there is no ring UI yet.
    const c4 = gc.onIncomingSignal?.(async (raw: string) => {
      // Outer catch: silently drop events that are malformed or not addressed to
      // us (bad crypto, wrong key, unparseable JSON). These are expected noise.
      let payload: { onionAddr: string; callId: string } | null = null
      try {
        payload = await gc.parseCallOffer?.(raw)
      } catch { return }
      if (!payload?.onionAddr || !payload.callId) return

      // Claim the callId synchronously (before any further await) so two
      // rapid redeliveries of the same event can't both pass this guard and
      // dial back twice. Cap the set so it can't grow unbounded across
      // re-subscribes (each goOnline replays relay history).
      if (seenOffers.current.has(payload.callId)) return
      seenOffers.current.add(payload.callId)
      if (seenOffers.current.size > 500) {
        seenOffers.current.delete(seenOffers.current.values().next().value!)
      }

      // Ignore offers that arrive while we're already on a call.
      const active = await gc.getCallState?.().catch(() => null)
      if (active) return

      try {
        await gc.initiateCall(payload.onionAddr)
        window.location.href = '/call'
      } catch (e) {
        // Dial-back failed (Tor circuit error, Noise handshake timeout, etc.)
        // Release the claim so a relay re-delivery can retry, and surface the
        // error — this is a real transport failure, not a malformed event.
        seenOffers.current.delete(payload.callId)
        setStatusMsg(`Incoming call failed: ${(e as Error).message}`)
      }
    })
    return () => { c1?.(); c2?.(); c3?.(); c4?.() }
  }, [])

  async function goOnline() {
    const gc = (window as any).ghostcall
    try {
      const result = await gc?.goOnline?.()
      const addr = typeof result === 'string' ? result : result?.onionAddr ?? ''
      setOnionAddr(addr)
      setIsOnline(true)
      setStatusMsg('')
      // Subscribe to incoming call offers addressed to our full Nostr pubkey so
      // others can reach us by handle while we're online. If identity hasn't
      // loaded yet, getMyNostrPubkey returns '' — surface that instead of
      // silently leaving the user online-but-unreachable-by-handle.
      const myPub = await gc?.getMyNostrPubkey?.().catch(() => '')
      if (myPub) {
        // Relay errors are non-fatal — direct onion calls still work.
        await gc?.subscribeSignals?.(myPub).catch(() => { /* signaling optional */ })
      } else {
        setStatusMsg('Online, but not yet reachable by handle — identity still loading. Try Go online again in a moment.')
      }
    } catch (e) {
      setStatusMsg((e as Error).message)
    }
  }

  const torOk = torStatus?.running === true

  return (
    <main className="page" style={{ gap: 0, paddingBottom: 88 }}>
      {torOk && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 320, height: 220,
          background: 'radial-gradient(ellipse at 50% 0%, rgba(48,209,88,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 44 }}>
        <Logo size={56} glowColor={torOk ? 'rgba(48,209,88,0.85)' : 'rgba(255,255,255,0.15)'} />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
            GhostCall
          </h1>
        </div>

        <div className={`status-pill ${torOk ? 'status-pill--connected' : torStatus === null ? 'status-pill--offline' : 'status-pill--error'}`}>
          <span className="dot" />
          <span>
            {torOk
              ? isOnline ? onionAddr.slice(0, 14) + '…' : 'Private'
              : torStatus === null ? 'Connecting…' : 'Tor unavailable'}
          </span>
        </div>
      </div>

      {activeTab === 'dial' && (
        <div className="glass-card" style={{ width: '100%', maxWidth: 360, padding: 0, overflow: 'hidden' }}>
          <DialPad
            onionAddr={onionAddr}
            isOnline={isOnline}
            torReady={torOk}
            onGoOnline={goOnline}
          />
        </div>
      )}

      {statusMsg && (
        <p style={{
          marginTop: 14, fontSize: 12, color: 'var(--system-red)',
          fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 320,
        }}>
          {statusMsg}
        </p>
      )}

      {activeTab === 'payments' && <PaymentsPage />}

      {pendingPayment && (
        <PaymentModal
          peer={pendingPayment.peer}
          onDismiss={() => setPendingPayment(null)}
          onPaid={(txHash) => {
            markCallPaid(pendingPayment.callId, txHash)
            setHistoryKey(k => k + 1)
            setPendingPayment(null)
          }}
        />
      )}

      <Dock
        items={[
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6.53 6.53l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            ),
            label: 'Dial',
            active: activeTab === 'dial',
            onClick: () => setActiveTab('dial'),
          },
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <path d="M2 10h20"/>
                <path d="M7 15h.01M11 15h2"/>
              </svg>
            ),
            label: 'Payments',
            active: activeTab === 'payments',
            onClick: () => setActiveTab('payments'),
          },
          {
            icon: (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ),
            label: 'Settings',
            onClick: () => { window.location.href = '/settings' },
          },
        ]}
      />
    </main>
  )
}
