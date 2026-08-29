// Runs in Electron renderer (Chromium context)
//
// Audio architecture:
//   Renderer:  getUserMedia → raw Float32 PCM → IPC → main process
//   Main:      Float32 PCM → Opus encode → Noise encrypt → Tor → (reverse on recv)
//   Renderer:  ← IPC ← Float32 PCM ← Opus decode ← Noise decrypt ← Tor
//
// opusscript WASM runs in the main process (Node.js) — no WASM sync-fetch issues.

const SAMPLE_RATE = 16000
const FRAME_SIZE = 320     // 20ms at 16kHz
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
  const source = audioContext.createMediaStreamSource(micStream)

  scriptProcessor = audioContext.createScriptProcessor(FRAME_SIZE, CHANNELS, CHANNELS)
  scriptProcessor.onaudioprocess = (e) => {
    if (muted) return
    // Send raw Float32 PCM to main process — Opus encoding happens in Node
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
}

export function setMuted(value: boolean): void {
  muted = value
}

// Inbound: receives decoded PCM Int16 from main process, plays via Web Audio
export function playInboundFrame(pcmBuffer: ArrayBuffer): void {
  if (!audioContext) return
  const samples = new Int16Array(pcmBuffer)
  const pcmFloat = int16ToFloat32(samples)
  const audioBuffer = audioContext.createBuffer(CHANNELS, samples.length, SAMPLE_RATE)
  audioBuffer.copyToChannel(pcmFloat as Float32Array<ArrayBuffer>, 0)
  const src = audioContext.createBufferSource()
  src.buffer = audioBuffer
  src.connect(audioContext.destination)
  src.start()
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
