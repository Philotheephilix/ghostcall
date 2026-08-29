/**
 * Tests for renderer/lib/audio-engine.ts
 *
 * Opus encoding/decoding now happens in the main process.
 * Renderer sends raw PCM Int16 and receives PCM Int16 for playback.
 */

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockSourceStart = jest.fn()
const mockSourceConnect = jest.fn()
const mockBufferSource = { buffer: null, connect: mockSourceConnect, start: mockSourceStart }

const mockCreateScriptProcessor = jest.fn()
const mockCreateMediaStreamSource = jest.fn()
const mockCreateBufferSource = jest.fn().mockReturnValue(mockBufferSource)
const mockCreateBuffer = jest.fn()
const mockClose = jest.fn().mockResolvedValue(undefined)
const mockDestination = {}

class MockAudioContext {
  sampleRate: number
  destination = mockDestination
  constructor(opts?: { sampleRate?: number }) { this.sampleRate = opts?.sampleRate ?? 44100 }
  createScriptProcessor = mockCreateScriptProcessor
  createMediaStreamSource = mockCreateMediaStreamSource
  createBufferSource = mockCreateBufferSource
  createBuffer = mockCreateBuffer
  close = mockClose
}

const mockScriptProcessorConnect = jest.fn()
const mockScriptProcessorDisconnect = jest.fn()
const mockScriptProcessor = {
  connect: mockScriptProcessorConnect,
  disconnect: mockScriptProcessorDisconnect,
  onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
}
mockCreateScriptProcessor.mockReturnValue(mockScriptProcessor)

const mockSourceNodeConnect = jest.fn()
mockCreateMediaStreamSource.mockReturnValue({ connect: mockSourceNodeConnect })

const mockCopyToChannel = jest.fn()
mockCreateBuffer.mockReturnValue({ copyToChannel: mockCopyToChannel })

const mockStopTrack = jest.fn()
const mockMediaStream = { getTracks: jest.fn().mockReturnValue([{ stop: mockStopTrack }]) }
const mockGetUserMedia = jest.fn().mockResolvedValue(mockMediaStream)

Object.defineProperty(global, 'navigator', {
  value: { mediaDevices: { getUserMedia: mockGetUserMedia } },
  writable: true, configurable: true,
})
Object.defineProperty(global, 'AudioContext', { value: MockAudioContext, writable: true, configurable: true })

const mockSendAudioFrame = jest.fn()
Object.defineProperty(global, 'window', {
  value: { ghostcall: { sendAudioFrame: mockSendAudioFrame } },
  writable: true, configurable: true,
})

// ─── Import after mocks ─────────────────────────────────────────────────────

import { startCapture, stopCapture, setMuted, playInboundFrame } from '../audio-engine'

const FRAME_SIZE = 320
const CHANNELS = 1
const SAMPLE_RATE = 16000

function makePcmEvent(samples: number): AudioProcessingEvent {
  return {
    inputBuffer: { getChannelData: jest.fn().mockReturnValue(new Float32Array(samples).fill(0.5)) },
  } as unknown as AudioProcessingEvent
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateScriptProcessor.mockReturnValue(mockScriptProcessor)
  mockCreateMediaStreamSource.mockReturnValue({ connect: mockSourceNodeConnect })
  mockCreateBufferSource.mockReturnValue(mockBufferSource)
  mockCreateBuffer.mockReturnValue({ copyToChannel: mockCopyToChannel })
  mockGetUserMedia.mockResolvedValue(mockMediaStream)
  mockMediaStream.getTracks.mockReturnValue([{ stop: mockStopTrack }])
})

describe('audio-engine', () => {
  test('1. startCapture calls getUserMedia with correct constraints', async () => {
    await startCapture()

    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
    const constraints = mockGetUserMedia.mock.calls[0][0]
    expect(constraints.audio).toMatchObject({
      sampleRate: SAMPLE_RATE, channelCount: CHANNELS,
      echoCancellation: true, noiseSuppression: true,
    })
    expect(constraints.video).toBe(false)
    expect(mockCreateScriptProcessor).toHaveBeenCalledWith(FRAME_SIZE, CHANNELS, CHANNELS)

    stopCapture()
  })

  test('2. onaudioprocess sends raw PCM Int16 to main process (no Opus in renderer)', async () => {
    await startCapture()

    const event = makePcmEvent(FRAME_SIZE)
    mockScriptProcessor.onaudioprocess!(event)

    // Renderer sends PCM Int16 buffer — Opus encoding happens in main process
    expect(mockSendAudioFrame).toHaveBeenCalledTimes(1)
    const sentBuf: Buffer = mockSendAudioFrame.mock.calls[0][0]
    // PCM Int16 = 2 bytes per sample
    expect(sentBuf.byteLength).toBe(FRAME_SIZE * 2)

    stopCapture()
  })

  test('3. setMuted(true) prevents outbound frames', async () => {
    await startCapture()
    setMuted(true)
    mockScriptProcessor.onaudioprocess!(makePcmEvent(FRAME_SIZE))
    expect(mockSendAudioFrame).not.toHaveBeenCalled()
    stopCapture()
  })

  test('4. playInboundFrame creates AudioBufferSourceNode and plays PCM Int16', async () => {
    await startCapture()

    // Inbound is now raw PCM Int16 (decoded by main process)
    const pcm16 = new Int16Array(FRAME_SIZE).fill(100)
    playInboundFrame(pcm16.buffer)

    expect(mockCreateBuffer).toHaveBeenCalledWith(CHANNELS, FRAME_SIZE, SAMPLE_RATE)
    expect(mockCopyToChannel).toHaveBeenCalledTimes(1)
    expect(mockCreateBufferSource).toHaveBeenCalledTimes(1)
    expect(mockSourceConnect).toHaveBeenCalledWith(mockDestination)
    expect(mockSourceStart).toHaveBeenCalledTimes(1)

    stopCapture()
  })
})
