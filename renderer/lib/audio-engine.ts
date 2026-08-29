// Runs in Electron renderer (Chromium context)
//
// Audio architecture:
//   Renderer:  getUserMedia → raw Float32 PCM → IPC → main process
//   Main:      Float32 PCM → Opus encode → Noise encrypt → Tor → (reverse on recv)
//   Renderer:  ← IPC ← Float32 PCM ← Opus decode ← Noise decrypt ← Tor
//
// opusscript WASM runs in the main process (Node.js) — no WASM sync-fetch issues.

const SAMPLE_RATE = 16000
const FRAME_SIZE = 256    // ScriptProcessor buffer — must be power-of-2; bridge accumulates into 320-sample Opus frames
const CHANNELS = 1

let audioContext: AudioContext | null = null
let micStream: MediaStream | null = null
let scriptProcessor: ScriptProcessorNode | null = null
let muted = false

export async function startCapture(): Promise<void> {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: SAMPLE_RATE, channelCount: CHANNELS, echoCancellation: true, noiseSuppression: true },
    video: false,
  })

  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
  // AudioContext starts suspended in Chromium — must resume after user gesture
  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }
  const source = audioContext.createMediaStreamSource(micStream)

  scriptProcessor = audioContext.createScriptProcessor(FRAME_SIZE, CHANNELS, CHANNELS)
  scriptProcessor.onaudioprocess = (e) => {
    if (muted) return
    // Send raw PCM Int16 to main process — Opus encoding happens in Node
    const pcm = e.inputBuffer.getChannelData(0)
    const pcm16 = float32ToInt16(pcm)
    ;(window as any).ghostcall?.sendAudioFrame(Buffer.from(pcm16.buffer))
  }

  source.connect(scriptProcessor)
  scriptProcessor.connect(audioContext.destination)
}

export function stopCapture(): void {
  scriptProcessor?.disconnect()
  micStream?.getTracks().forEach(t => t.stop())
  audioContext?.close()
  scriptProcessor = null
  micStream = null
  audioContext = null
  muted = false
  playHead = 0
  scheduled = []
}

export function setMuted(value: boolean): void {
  muted = value
}

// Inbound: receives decoded PCM Int16 from main process, plays via Web Audio.
// Uses a scheduled playback clock so frames play gapless instead of overlapping.
let playHead = 0   // next scheduled start time (audioContext time)
let scheduled: AudioBufferSourceNode[] = []   // sources scheduled but not yet finished

export function playInboundFrame(pcmBuffer: ArrayBuffer): void {
  if (!audioContext) { console.warn('[Audio] No audioContext for inbound frame'); return }

  const samples = new Int16Array(pcmBuffer)
  if (samples.length === 0) return
  const pcmFloat = int16ToFloat32(samples)
  const audioBuffer = audioContext.createBuffer(CHANNELS, samples.length, SAMPLE_RATE)
  audioBuffer.copyToChannel(pcmFloat as Float32Array<ArrayBuffer>, 0)

  const src = audioContext.createBufferSource()
  src.buffer = audioBuffer
  src.connect(audioContext.destination)

  // Schedule gapless with a BOUNDED jitter buffer.
  // Tor delivers frames in bursts; if we only ever push playHead forward, a burst
  // parks playback seconds into the future and it never recovers → runaway latency.
  // So: floor playHead to now+PREROLL when behind, and CAP it at now+MAX_BUFFER when
  // it has drifted too far ahead (drop the backlog — a tiny skip beats seconds of lag).
  const now = audioContext.currentTime
  const frameDur = samples.length / SAMPLE_RATE
  const PREROLL = 0.02    // 20ms initial jitter cushion
  const MAX_BUFFER = 0.12 // never let playback sit more than 120ms ahead of realtime
  if (playHead < now + PREROLL) {
    playHead = now + PREROLL
  } else if (playHead > now + MAX_BUFFER) {
    // Burst backlog too deep: cancel the frames already queued into the future,
    // otherwise they'd play *after* this resynced frame and glitch. Then resync.
    for (const s of scheduled) { try { s.stop() } catch { /* already ended */ } }
    scheduled = []
    playHead = now + PREROLL
  }

  // Track this source so a later resync can cancel it; drop it once it finishes.
  scheduled.push(src)
  src.onended = () => { scheduled = scheduled.filter(s => s !== src) }

  src.start(playHead)
  playHead += frameDur
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)))
  }
  return i16
}

function int16ToFloat32(i16: Int16Array): Float32Array {
  const f32 = new Float32Array(i16.length)
  for (let i = 0; i < i16.length; i++) { f32[i] = i16[i] / 32767 }
  return f32
}
