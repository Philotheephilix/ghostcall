/**
 * Tests for renderer/lib/audio-engine.ts
 *
 * All Web Audio API + getUserMedia are mocked — no browser context needed.
 */

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Mock opusscript before importing the module under test
const mockEncode = jest.fn()
const mockDecode = jest.fn()
const MockOpusScript = jest.fn().mockImplementation(() => ({
  encode: mockEncode,
  decode: mockDecode,
})) as any
MockOpusScript.Application = { VOIP: 2048 }

jest.mock('opusscript', () => MockOpusScript)

// AudioBufferSourceNode mock
const mockSourceStart = jest.fn()
const mockSourceConnect = jest.fn()
const mockBufferSource = {
  buffer: null as AudioBuffer | null,
  connect: mockSourceConnect,
  start: mockSourceStart,
}

// AudioContext mock
const mockCreateScriptProcessor = jest.fn()
const mockCreateMediaStreamSource = jest.fn()
const mockCreateBufferSource = jest.fn().mockReturnValue(mockBufferSource)
const mockCreateBuffer = jest.fn()
const mockClose = jest.fn().mockResolvedValue(undefined)
const mockDestination = {}

class MockAudioContext {
  sampleRate: number
  destination = mockDestination
  constructor(opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 44100
  }
  createScriptProcessor = mockCreateScriptProcessor
  createMediaStreamSource = mockCreateMediaStreamSource
  createBufferSource = mockCreateBufferSource
  createBuffer = mockCreateBuffer
  close = mockClose
}

// ScriptProcessorNode mock
const mockScriptProcessorConnect = jest.fn()
const mockScriptProcessorDisconnect = jest.fn()
const mockScriptProcessor = {
  connect: mockScriptProcessorConnect,
  disconnect: mockScriptProcessorDisconnect,
  onaudioprocess: null as ((e: AudioProcessingEvent) => void) | null,
}
mockCreateScriptProcessor.mockReturnValue(mockScriptProcessor)

// MediaStreamSource mock
const mockSourceNodeConnect = jest.fn()
const mockMediaStreamSource = { connect: mockSourceNodeConnect }
mockCreateMediaStreamSource.mockReturnValue(mockMediaStreamSource)

// AudioBuffer mock
const mockCopyToChannel = jest.fn()
const mockAudioBuffer = { copyToChannel: mockCopyToChannel }
mockCreateBuffer.mockReturnValue(mockAudioBuffer)

// MediaStream track mock
const mockStopTrack = jest.fn()
const mockMediaStream = {
  getTracks: jest.fn().mockReturnValue([{ stop: mockStopTrack }]),
}

// getUserMedia mock
const mockGetUserMedia = jest.fn().mockResolvedValue(mockMediaStream)
Object.defineProperty(global, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
    },
  },
  writable: true,
  configurable: true,
})

// AudioContext on global
Object.defineProperty(global, 'AudioContext', {
  value: MockAudioContext,
  writable: true,
  configurable: true,
})

// window.ghostcall mock
const mockSendAudioFrame = jest.fn()
Object.defineProperty(global, 'window', {
  value: {
    ghostcall: {
      sendAudioFrame: mockSendAudioFrame,
    },
  },
  writable: true,
  configurable: true,
})

// ─── Import after mocks ─────────────────────────────────────────────────────

import { startCapture, stopCapture, setMuted, playInboundFrame } from '../audio-engine'

// ─── Constants ─────────────────────────────────────────────────────────────
const FRAME_SIZE = 320
const CHANNELS = 1
const SAMPLE_RATE = 16000

// ─── Helpers ───────────────────────────────────────────────────────────────
function makePcmEvent(samples: number): AudioProcessingEvent {
  const data = new Float32Array(samples).fill(0.5)
  return {
    inputBuffer: {
      getChannelData: jest.fn().mockReturnValue(data),
    },
  } as unknown as AudioProcessingEvent
}

// ─── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // Re-setup default return values after clearAllMocks
  mockCreateScriptProcessor.mockReturnValue(mockScriptProcessor)
  mockCreateMediaStreamSource.mockReturnValue(mockMediaStreamSource)
  mockCreateBufferSource.mockReturnValue(mockBufferSource)
  mockCreateBuffer.mockReturnValue(mockAudioBuffer)
  mockGetUserMedia.mockResolvedValue(mockMediaStream)
  mockMediaStream.getTracks.mockReturnValue([{ stop: mockStopTrack }])
  MockOpusScript.mockImplementation(() => ({
    encode: mockEncode,
    decode: mockDecode,
  }))
})

describe('audio-engine', () => {
  test('1. startCapture initializes AudioContext and calls getUserMedia', async () => {
    await startCapture()

    // getUserMedia called with correct constraints
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
    const constraints = mockGetUserMedia.mock.calls[0][0]
    expect(constraints.audio).toMatchObject({
      sampleRate: SAMPLE_RATE,
      channelCount: CHANNELS,
      echoCancellation: true,
      noiseSuppression: true,
    })
    expect(constraints.video).toBe(false)

    // AudioContext created
    expect(MockOpusScript).toHaveBeenCalled()
    expect(mockCreateScriptProcessor).toHaveBeenCalledWith(FRAME_SIZE, CHANNELS, CHANNELS)
    expect(mockCreateMediaStreamSource).toHaveBeenCalledWith(mockMediaStream)
    expect(mockSourceNodeConnect).toHaveBeenCalledWith(mockScriptProcessor)
    expect(mockScriptProcessorConnect).toHaveBeenCalledWith(mockDestination)

    stopCapture()
  })

  test('2. Opus encoder invoked with correct FRAME_SIZE and CHANNELS', async () => {
    const encodedBuf = Buffer.alloc(40, 0xaa)
    mockEncode.mockReturnValue(encodedBuf)

    await startCapture()

    // Simulate an audio process event
    const event = makePcmEvent(FRAME_SIZE)
    mockScriptProcessor.onaudioprocess!(event)

    expect(mockEncode).toHaveBeenCalledTimes(1)
    const [pcmArg, frameSizeArg] = mockEncode.mock.calls[0]
    expect(frameSizeArg).toBe(FRAME_SIZE)
    // pcmArg is Int16Array of length FRAME_SIZE
    expect(pcmArg.length).toBe(FRAME_SIZE)
    expect(mockSendAudioFrame).toHaveBeenCalledTimes(1)

    stopCapture()
  })

  test('3. setMuted(true) prevents outbound frames from being sent', async () => {
    const encodedBuf = Buffer.alloc(40, 0xbb)
    mockEncode.mockReturnValue(encodedBuf)

    await startCapture()
    setMuted(true)

    const event = makePcmEvent(FRAME_SIZE)
    mockScriptProcessor.onaudioprocess!(event)

    expect(mockEncode).not.toHaveBeenCalled()
    expect(mockSendAudioFrame).not.toHaveBeenCalled()

    stopCapture()
  })

  test('4. playInboundFrame decodes Opus and creates AudioBufferSourceNode', async () => {
    // Start capture to initialize audioContext and decoder
    await startCapture()

    // Mock decode to return an Int16Array
    const pcm16 = new Int16Array(FRAME_SIZE).fill(100)
    const pcm16Buffer = Buffer.from(pcm16.buffer)
    mockDecode.mockReturnValue(pcm16Buffer)

    const testOpusFrame = new ArrayBuffer(80)
    playInboundFrame(testOpusFrame)

    expect(mockDecode).toHaveBeenCalledTimes(1)
    expect(mockCreateBuffer).toHaveBeenCalledWith(CHANNELS, FRAME_SIZE, SAMPLE_RATE)
    expect(mockCopyToChannel).toHaveBeenCalledTimes(1)
    expect(mockCreateBufferSource).toHaveBeenCalledTimes(1)
    expect(mockSourceConnect).toHaveBeenCalledWith(mockDestination)
    expect(mockSourceStart).toHaveBeenCalledTimes(1)

    stopCapture()
  })
})
