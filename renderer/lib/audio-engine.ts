// Runs in Electron renderer process (browser context)
// opusscript provides Opus WASM encoder/decoder
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpusScript = require('opusscript') as typeof import('opusscript')

const SAMPLE_RATE = 16000  // 16kHz — good quality for voice, lower bandwidth
const FRAME_SIZE = 320     // 20ms at 16kHz
const CHANNELS = 1

let encoder: InstanceType<typeof OpusScript> | null = null
let decoder: InstanceType<typeof OpusScript> | null = null
let audioContext: AudioContext | null = null
let micStream: MediaStream | null = null
let scriptProcessor: ScriptProcessorNode | null = null
let muted = false

export async function startCapture(): Promise<void> {
  encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.VOIP)
  decoder = new OpusScript(SAMPLE_RATE, CHANNELS)

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: SAMPLE_RATE,
      channelCount: CHANNELS,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  })

  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
  const source = audioContext.createMediaStreamSource(micStream)

  // ScriptProcessorNode collects PCM frames and encodes them
  scriptProcessor = audioContext.createScriptProcessor(FRAME_SIZE, CHANNELS, CHANNELS)
  scriptProcessor.onaudioprocess = (e) => {
    if (muted) return
    const pcm = e.inputBuffer.getChannelData(0)
    const pcm16 = float32ToInt16(pcm)
    const encoded: Buffer = encoder!.encode(pcm16 as unknown as Buffer, FRAME_SIZE)
    // Send to main process for Noise encryption + Tor transmission
    ;(window as any).ghostcall.sendAudioFrame(Buffer.from(encoded))
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
  encoder = null
  decoder = null
  muted = false
}

export function setMuted(value: boolean): void {
  muted = value
}

// Called when inbound Opus frame arrives from main process
export function playInboundFrame(opusFrameBuffer: ArrayBuffer): void {
  if (!decoder || !audioContext) return
  const frame = Buffer.from(opusFrameBuffer)
  const pcm16: Buffer = decoder.decode(frame)
  const pcmFloat = int16ToFloat32(new Int16Array(pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength)))
  const audioBuffer = audioContext.createBuffer(CHANNELS, FRAME_SIZE, SAMPLE_RATE)
  audioBuffer.copyToChannel(pcmFloat as Float32Array<ArrayBuffer>, 0)
  const bufferSource = audioContext.createBufferSource()
  bufferSource.buffer = audioBuffer
  bufferSource.connect(audioContext.destination)
  bufferSource.start()
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
  for (let i = 0; i < i16.length; i++) {
    f32[i] = i16[i] / 32767
  }
  return f32
}
