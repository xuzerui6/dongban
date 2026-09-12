// 语音合成。优先走中转站的神经 TTS，失败才退回浏览器自带的 speechSynthesis。
//
// 为什么必须换掉 speechSynthesis：
// Windows 上它调用的是微软慧慧/云扬那套老引擎，机械感是引擎决定的，
// 调措辞、调语速都救不回来。神经 TTS 才有自然的语调和停顿。
//
// 三个工程要点：
// 1. 缓存。报数「1」「2」「3」会重复成百上千次，缓存后第二次起零延迟。
// 2. Web Audio 而非 <audio>。解码后播放延迟更低，且能瞬间打断（barge-in）。
// 3. 预热。开练前把数字和常用鼓励语预先合成好，报数时才不会有网络延迟。

/**
 * 中转站不一定代理 TTS 端点，探测结果缓存在这里。
 * null = 还没试过；false = 确认不可用（鉴权失败等永久原因）
 */
let neuralAvailable: boolean | null = null

/** 首次成功的模型名会锁定下来，避免每次都重试不支持的模型 */
let lockedModel: string | null = null

/**
 * 上游饱和（HTTP 429）时的冷却截止时间。
 * 429 是临时的，不能像鉴权失败那样永久关掉 TTS——否则中转站恢复了也用不上。
 * 冷却期内直接走浏览器语音，不再打请求，避免刷屏和浪费配额。
 */
let rateLimitedUntil = 0
const RATE_LIMIT_COOLDOWN_MS = 60_000

let audioContext: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null

/** 已合成的音频缓存。键是文本，值是解码后的 AudioBuffer。 */
const cache = new Map<string, AudioBuffer>()
/** 正在合成中的请求，避免同一句话并发请求两次 */
const inflight = new Map<string, Promise<AudioBuffer | null>>()
const CACHE_LIMIT = 80

const VOICE = (import.meta.env.VITE_TTS_VOICE as string | undefined)?.trim() || 'nova'

/**
 * 模型候选链。第一个成功的会被锁定。
 * gpt-4o-mini-tts 支持 instructions 参数（可以指定「别用播音腔」），
 * 这是去掉 AI 味最有效的一个开关，所以优先。tts-1 兼容性最好，兜底。
 */
// 顺序按「实测存在」排：tts-1 在中转站的模型列表里，gpt-4o-mini-tts 返回 503
// 说明上游没有。把不存在的排前面会让每次冷启动都白等一次往返。
const MODEL_CANDIDATES = (() => {
  const configured = (import.meta.env.VITE_TTS_MODEL as string | undefined)?.trim()
  const chain = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']
  return configured ? [configured, ...chain.filter(m => m !== configured)] : chain
})()

/** 交给支持 instructions 的模型，用来压掉播音腔 */
const TONE_INSTRUCTIONS = [
  '你是用户身边的健身搭子，不是播音员也不是客服。',
  '用轻松自然的中文口语说话，语气温和、带一点笑意，像朋友在旁边陪着。',
  '语速自然偏快一点，短句不要拖长音，句尾不要上扬。',
  '绝对不要播音腔、不要字正腔圆、不要刻意加重语气。',
].join('')

/**
 * 解锁音频输出。
 * 浏览器的自动播放策略要求 AudioContext 在用户手势里创建或 resume，
 * 否则创建出来是 suspended 状态，播放没有声音。开练按钮里调一次即可。
 */
export function unlockAudio(): void {
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      audioContext = new Ctor()
    }
    if (audioContext.state === 'suspended') void audioContext.resume()
  } catch {
    // 拿不到 AudioContext 就退回 speechSynthesis，不影响主流程
  }
}

function putCache(text: string, buffer: AudioBuffer): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(text, buffer)
}

/** 请求一次合成并解码。失败返回 null。 */
async function fetchAudio(text: string): Promise<AudioBuffer | null> {
  if (neuralAvailable === false) return null
  // 上游饱和的冷却期内不再打请求，直接走浏览器语音，避免刷屏和浪费配额
  if (Date.now() < rateLimitedUntil) return null
  unlockAudio()
  if (!audioContext) return null

  const models = lockedModel ? [lockedModel] : MODEL_CANDIDATES
  for (const model of models) {
    try {
      const body: Record<string, unknown> = {
        model,
        input: text,
        voice: VOICE,
        response_format: 'mp3',
        speed: 1.05,
      }
      // 只有 4o 系列的 TTS 认这个参数，tts-1 会忽略（多传无害）
      if (model.includes('4o')) body.instructions = TONE_INSTRUCTIONS

      const response = await fetch('/ai/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        // 401/403 是密钥问题，换模型也没用，直接放弃
        if (response.status === 401 || response.status === 403) {
          console.warn('[动伴] TTS 鉴权失败，改用浏览器语音')
          neuralAvailable = false
          return null
        }
        // 其余全部当作「这个模型不行，试下一个」：
        // 404/400 = 模型不存在，503 = 上游异常，429 = 上游饱和。
        // 之前把 503 当永久失败，导致第一个候选失败后根本没试 tts-1，这是个 bug。
        if (response.status === 429) rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
        console.warn(`[动伴] TTS 模型 ${model} 不可用（HTTP ${response.status}）`)
        continue
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength < 256) continue   // 明显不是音频
      const buffer = await audioContext.decodeAudioData(bytes)
      lockedModel = model
      neuralAvailable = true
      return buffer
    } catch {
      // 网络异常或解码失败，换下一个候选
    }
  }
  // 所有候选都失败。必须区分两种情况，否则临时故障会被当成永久不支持：
  // - 上游饱和（429）：只冷却一分钟，中转站恢复后自动重新启用
  // - 其余（模型都不存在等）：判定为不支持，不再重试
  if (Date.now() < rateLimitedUntil) return null
  neuralAvailable = false
  return null
}

/** 取一句话的音频，优先缓存 */
function getAudio(text: string): Promise<AudioBuffer | null> {
  const cached = cache.get(text)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(text)
  if (pending) return pending
  const task = fetchAudio(text).then(buffer => {
    inflight.delete(text)
    if (buffer) putCache(text, buffer)
    return buffer
  })
  inflight.set(text, task)
  return task
}

/** 立刻停掉正在播放的语音 */
export function cancelSpeech(): void {
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop() } catch { /* 已停 */ }
    currentSource = null
  }
  currentUtterance = null
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try { speechSynthesis.cancel() } catch { /* ignore */ }
  }
}

/** 浏览器自带合成兜底 */
function speakFallback(text: string, voice: SpeechSynthesisVoice | null): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve()
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) utterance.voice = voice
    utterance.lang = 'zh-CN'
    utterance.rate = 1.08
    utterance.pitch = 1.05
    currentUtterance = utterance
    const finish = () => { if (currentUtterance === utterance) currentUtterance = null; resolve() }
    utterance.onend = finish
    utterance.onerror = finish
    speechSynthesis.speak(utterance)
  })
}

/**
 * 说一句话。Promise 在播完（或被打断）时 resolve。
 * `stillCurrent` 用于判断这次播报是否已被更新的播报取代。
 */
export async function speakText(
  text: string,
  options: {
    fallbackVoice?: SpeechSynthesisVoice | null
    stillCurrent?: () => boolean
    /**
     * 在真正出声之前回调一次。
     * 调用方用它来关闭麦克风——关键在于「取音频」和「关麦克风」必须分开：
     * 取音频要走网络，可能几秒，期间麦克风应当保持开启，否则频繁报数会把
     * 麦克风饿死，用户根本插不上话。
     */
    onBeforePlay?: () => void
  } = {},
): Promise<void> {
  const { fallbackVoice = null, stillCurrent, onBeforePlay } = options

  const buffer = await getAudio(text)
  // 等待期间可能已经被新的播报取代
  if (stillCurrent && !stillCurrent()) return

  // 音频就绪（或确定要用浏览器合成），现在才关麦克风并停掉上一句
  onBeforePlay?.()
  cancelSpeech()

  if (!buffer || !audioContext) {
    await speakFallback(text, fallbackVoice)
    return
  }

  if (audioContext.state === 'suspended') {
    try { await audioContext.resume() } catch { /* ignore */ }
  }

  await new Promise<void>(resolve => {
    if (!audioContext) return resolve()
    const source = audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(audioContext.destination)
    currentSource = source
    source.onended = () => {
      if (currentSource === source) currentSource = null
      resolve()
    }
    try {
      source.start()
    } catch {
      resolve()
    }
  })
}

/**
 * 预热：后台把常用短语先合成好，报数时零延迟。
 * 串行执行并留间隔，避免一次打十几个并发请求。
 */
export function prewarm(texts: string[]): void {
  if (neuralStatus() === false) return
  void (async () => {
    for (const text of texts) {
      // 这里通过 neuralStatus() 读取，而不是直接读模块变量。
      // 循环是异步的，中途某次请求失败会把 neuralAvailable 置成 false，
      // 所以这个检查在运行时是有意义的——但 TS 的控制流分析看不到闭包的延迟执行，
      // 它以为外层检查已经把类型收窄成 true|null，直接比较会被判成「不可能的比较」。
      if (neuralStatus() === false) return
      if (cache.has(text)) continue
      await getAudio(text)
      await new Promise(r => setTimeout(r, 120))
    }
  })()
}

/** 供界面显示当前用的是哪种引擎。null 表示还没确定。 */
export function neuralStatus(): boolean | null {
  return neuralAvailable
}
