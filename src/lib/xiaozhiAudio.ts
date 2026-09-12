/* Browser-only raw Opus transport for Xiaozhi protocol v1. */

type AudioEncoderLike = {
  configure(config: Record<string, unknown>): void
  encode(data: { close(): void }): void
  flush(): Promise<void>
  close(): void
}
type AudioDecoderLike = {
  configure(config: Record<string, unknown>): void
  decode(chunk: unknown): void
  close(): void
  reset(): void
}

const workletSource = `
class MotionBuddyMicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      const copy = channel.slice(0)
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}
registerProcessor('motion-buddy-mic', MotionBuddyMicProcessor)
`

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const length = Math.max(1, Math.round(input.length * toRate / fromRate))
  const output = new Float32Array(length)
  const ratio = fromRate / toRate
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(input.length - 1, left + 1)
    const mix = position - left
    output[index] = input[left] * (1 - mix) + input[right] * mix
  }
  return output
}

export class XiaozhiAudio {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private encoder: AudioEncoderLike | null = null
  private decoder: AudioDecoderLike | null = null
  private pendingSamples: number[] = []
  private encoderTimestamp = 0
  private decoderTimestamp = 0
  private scheduledSources = new Set<AudioBufferSourceNode>()
  private nextPlayAt = 0
  private objectUrl = ''
  private sending = true

  constructor(private readonly sendPacket: (packet: ArrayBuffer) => void, private readonly onPlaybackEnd: () => void) {}

  static supported(): boolean {
    const scope = window as unknown as { AudioEncoder?: unknown; AudioDecoder?: unknown; AudioData?: unknown; EncodedAudioChunk?: unknown }
    return Boolean(scope.AudioEncoder && scope.AudioDecoder && scope.AudioData && scope.EncodedAudioChunk && window.AudioWorkletNode)
  }

  async startCapture(): Promise<void> {
    if (this.node) return
    if (!XiaozhiAudio.supported()) throw new Error('当前浏览器缺少 WebCodecs Opus 或 AudioWorklet')
    this.context ||= new AudioContext({ latencyHint: 'interactive' })
    if (this.context.state === 'suspended') await this.context.resume()
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    this.objectUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }))
    await this.context.audioWorklet.addModule(this.objectUrl)
    this.source = this.context.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.context, 'motion-buddy-mic')
    const Encoder = (window as unknown as { AudioEncoder: new (init: { output: (chunk: { byteLength: number; copyTo(target: ArrayBuffer): void }) => void; error: (error: DOMException) => void }) => AudioEncoderLike }).AudioEncoder
    const AudioDataCtor = (window as unknown as { AudioData: new (init: Record<string, unknown>) => { close(): void } }).AudioData
    this.encoder = new Encoder({
      output: chunk => {
        const bytes = new ArrayBuffer(chunk.byteLength)
        chunk.copyTo(bytes)
        if (this.sending) this.sendPacket(bytes)
      },
      error: error => console.warn('[动伴] Opus 编码失败', error.message),
    })
    this.encoder.configure({ codec: 'opus', sampleRate: 16_000, numberOfChannels: 1, bitrate: 24_000 })
    this.node.port.onmessage = event => {
      const samples = resample(event.data as Float32Array, this.context?.sampleRate || 48_000, 16_000)
      this.pendingSamples.push(...samples)
      while (this.pendingSamples.length >= 960) {
        const frame = new Float32Array(this.pendingSamples.splice(0, 960))
        const data = new AudioDataCtor({
          format: 'f32-planar', sampleRate: 16_000, numberOfFrames: 960, numberOfChannels: 1,
          timestamp: this.encoderTimestamp, data: frame,
        })
        this.encoderTimestamp += 60_000
        this.encoder?.encode(data)
        data.close()
      }
    }
    this.source.connect(this.node)
    // Worklet must stay connected, but a zero-gain node prevents mic sidetone.
    const mute = this.context.createGain()
    mute.gain.value = 0
    this.node.connect(mute).connect(this.context.destination)
  }

  configureDecoder(sampleRate = 24_000): void {
    if (!XiaozhiAudio.supported()) return
    this.context ||= new AudioContext({ latencyHint: 'interactive' })
    this.decoder?.close()
    const Decoder = (window as unknown as { AudioDecoder: new (init: { output: (data: any) => void; error: (error: DOMException) => void }) => AudioDecoderLike }).AudioDecoder
    this.decoder = new Decoder({
      output: data => {
        if (!this.context) return data.close()
        const samples = new Float32Array(data.numberOfFrames)
        data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' })
        const buffer = this.context.createBuffer(1, samples.length, data.sampleRate)
        buffer.copyToChannel(samples, 0)
        const source = this.context.createBufferSource()
        source.buffer = buffer
        source.connect(this.context.destination)
        const startAt = Math.max(this.context.currentTime + .015, this.nextPlayAt)
        this.nextPlayAt = startAt + buffer.duration
        this.scheduledSources.add(source)
        source.onended = () => {
          this.scheduledSources.delete(source)
          if (!this.scheduledSources.size) this.onPlaybackEnd()
        }
        source.start(startAt)
        data.close()
      },
      error: error => console.warn('[动伴] Opus 解码失败', error.message),
    })
    this.decoder.configure({ codec: 'opus', sampleRate, numberOfChannels: 1 })
  }

  decode(packet: ArrayBuffer): void {
    if (!this.decoder) this.configureDecoder()
    const Chunk = (window as unknown as { EncodedAudioChunk: new (init: Record<string, unknown>) => unknown }).EncodedAudioChunk
    this.decoder?.decode(new Chunk({ type: 'key', timestamp: this.decoderTimestamp, duration: 60_000, data: packet }))
    this.decoderTimestamp += 60_000
  }

  setSending(value: boolean): void {
    this.sending = value
  }

  clearPlayback(): void {
    for (const source of this.scheduledSources) {
      try { source.onended = null; source.stop() } catch { /* already stopped */ }
    }
    this.scheduledSources.clear()
    this.nextPlayAt = this.context?.currentTime || 0
    try { this.decoder?.reset() } catch { /* decoder may not be configured */ }
  }

  async stopCapture(): Promise<void> {
    this.node?.disconnect()
    this.source?.disconnect()
    this.node = null
    this.source = null
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (this.encoder) {
      try { await this.encoder.flush() } catch { /* ignore */ }
      try { this.encoder.close() } catch { /* ignore */ }
    }
    this.encoder = null
    this.pendingSamples = []
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = ''
  }

  async dispose(): Promise<void> {
    this.clearPlayback()
    await this.stopCapture()
    try { this.decoder?.close() } catch { /* ignore */ }
    this.decoder = null
    if (this.context) await this.context.close()
    this.context = null
  }
}
