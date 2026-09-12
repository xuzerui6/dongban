import { useCallback, useEffect, useRef, useState } from 'react'
import { askCoach, probeCoach, type ChatMessage } from '../lib/coachClient'
import { applyPolicy, buildSystemPrompt, localReply, type CoachContext } from '../lib/coachPolicy'
import { cancelSpeech, neuralStatus, prewarm, speakText, unlockAudio } from '../lib/tts'
import { matchesWakeWord, stripWakeWord } from '../lib/wakeWord'

/**
 * 训练中的自动语音对话。
 *
 * 关键约束与设计：
 *
 * 1. 回声：麦克风会听到扬声器放出的动伴声音，形成自问自答的死循环。
 *    所以「听」和「说」必须互斥——说话前停识别，说完再开。这不是优化，
 *    是让功能能用的前提。
 *
 * 2. 无手动输入：不做按住说话。进入训练页就常听，用户随时开口即可。
 *    唤醒词「你好动伴」用于从常听态进入对话态。
 *
 * 3. 10 分钟无对话自动断开麦克风省电，但**不动摄像头**——姿态计数继续跑。
 *    注意一个物理限制：麦克风一旦关闭就无法再听见唤醒词，所以唤回需要点一下
 *    状态条。这是关麦省电的必然代价，不是设计疏漏。
 *
 * 4. Web Speech API 在 iOS Safari 上不可用（播放音频会终止识别器，属结构性冲突）。
 *    因此 `supported` 为 false 时整条链路静默降级，训练闭环不受影响。
 */

export type VoiceState =
  | 'off'        // 未启用
  | 'idle'       // 常听，等唤醒词
  | 'active'     // 对话中，用户说话直接进模型
  | 'thinking'   // 等模型回复
  | 'speaking'   // 动伴正在说
  | 'sleeping'   // 10 分钟无对话，已关麦省电
  | 'unsupported'
  | 'failed'     // 识别器持续报错，已停止重试

/** 把识别器的错误码翻译成用户看得懂、且能据此行动的说明 */
const ERROR_MESSAGE: Record<string, string> = {
  // Chrome 的语音识别是云端服务，要连 Google，国内网络通常不通
  network: '语音识别连不上服务器（Chrome 的识别需要访问 Google），请挂代理后刷新，或改用手动按钮',
  'not-allowed': '麦克风权限被拒绝，请在地址栏左侧的图标里允许麦克风，然后刷新',
  'service-not-allowed': '浏览器拒绝了语音服务，请确认使用 https 或 localhost 访问',
  'audio-capture': '找不到麦克风，请检查设备是否插好',
  'language-not-supported': '当前浏览器不支持中文识别，建议用电脑版 Chrome',
}

/** 无对话多久后关麦省电 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000

/** 进入对话态后，多久没有新的用户输入就退回常听态（只等唤醒词） */
const CONVERSATION_WINDOW_MS = 25 * 1000

/** 保留多少轮上下文。训练场景不需要长记忆，省 token 也降延迟。 */
const MAX_HISTORY = 6

const getRecognizer = () => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: { new (): MBRecognition }
    webkitSpeechRecognition?: { new (): MBRecognition }
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function useCoachVoice(enabled: boolean, context: CoachContext) {
  const [state, setState] = useState<VoiceState>('off')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [muted, setMuted] = useState(false)
  const [hasModel, setHasModel] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  /** 当前用的是神经 TTS 还是浏览器合成。null = 尚未确定 */
  const [neural, setNeural] = useState<boolean | null>(null)

  // 用 ref 持有随时变化的值，避免把它们塞进 effect 依赖导致识别器反复重建
  const contextRef = useRef(context)
  const stateRef = useRef<VoiceState>('off')
  const mutedRef = useRef(false)
  const hasModelRef = useRef(false)
  const historyRef = useRef<ChatMessage[]>([])

  const recognitionRef = useRef<MBRecognition | null>(null)
  const runningRef = useRef(false)          // 识别器当前是否在跑
  const wantListeningRef = useRef(false)    // 是否「应该」在听（说话时置 false）
  const speakingRef = useRef(false)
  const speechGenerationRef = useRef(0)   // 隔离被 cancel() 打断的旧播报回调
  const failureCountRef = useRef(0)       // 连续识别失败次数，用于止损
  const greetedRef = useRef(false)        // 开场问候只说一次
  const recentRef = useRef<string[]>([])  // 最近几段转写，用于拼接被拆开的唤醒词
  const recentAtRef = useRef(0)           // 上一段的时间，用于丢弃过期碎片
  const lastTalkRef = useRef(Date.now())    // 最后一次有效对话时间
  const conversationUntilRef = useRef(0)    // 对话窗口截止时间
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const disposedRef = useRef(false)

  useEffect(() => { contextRef.current = context }, [context])
  useEffect(() => { mutedRef.current = muted }, [muted])

  const setVoiceState = useCallback((next: VoiceState) => {
    stateRef.current = next
    setState(next)
  }, [])

  // ── 选一个中文发音 ────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const pick = () => {
      const voices = speechSynthesis.getVoices()
      voiceRef.current =
        voices.find(v => /zh[-_]CN/i.test(v.lang) && /female|婉|晓|Xiaoxiao|Huihui/i.test(v.name)) ||
        voices.find(v => /zh[-_]CN/i.test(v.lang)) ||
        voices.find(v => /zh/i.test(v.lang)) ||
        null
    }
    pick()
    speechSynthesis.addEventListener('voiceschanged', pick)
    return () => speechSynthesis.removeEventListener('voiceschanged', pick)
  }, [])

  // ── 探测中转站是否配置 ────────────────────────────────────────
  // 不受 enabled 限制：开练之前就要能告诉用户 key 配没配对。
  useEffect(() => {
    let alive = true
    probeCoach().then(ok => {
      if (!alive) return
      hasModelRef.current = ok
      setHasModel(ok)
    })
    return () => { alive = false }
  }, [])

  // ── 预热常用短语 ──────────────────────────────────────────────
  // 报数是最高频的播报，如果每次都等一趟网络往返，「即时报数」就没了。
  // 开练时先把数字和常用鼓励语合成好缓存住，之后播放是零延迟。
  useEffect(() => {
    if (!enabled) return
    unlockAudio()
    const numbers = Array.from({ length: 30 }, (_, i) => String(i + 1))
    prewarm(['我在，你说。', '第一个，开始了', '不着急，准备好了再来', ...numbers])
    // 预热完成后才知道中转站到底支不支持 TTS，轮询几次拿结果
    let ticks = 0
    const timer = window.setInterval(() => {
      const status = neuralStatus()
      if (status !== null || ticks > 20) {
        setNeural(status)
        clearInterval(timer)
      }
      ticks += 1
    }, 700)
    return () => clearInterval(timer)
  }, [enabled])

  // ── 识别器启停 ────────────────────────────────────────────────
  const startRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition || runningRef.current || disposedRef.current) return
    try {
      recognition.start()
      runningRef.current = true
    } catch {
      // start() 在已运行时会抛 InvalidStateError，忽略即可
      runningRef.current = true
    }
  }, [])

  const stopRecognition = useCallback(() => {
    const recognition = recognitionRef.current
    if (!recognition || !runningRef.current) return
    try { recognition.stop() } catch { /* 已停止 */ }
    runningRef.current = false
  }, [])

  // ── 说话：说之前必须停识别，说完再恢复 ───────────────────────
  const say = useCallback((text: string) => {
    if (!text) return

    // 静音时不播报，但**必须**保证监听继续。
    // 否则一旦走到这里就再也不会调 startRecognition()，麦克风永远起不来。
    if (mutedRef.current || typeof window === 'undefined') {
      setReply(text)
      if (!disposedRef.current && stateRef.current !== 'sleeping' && stateRef.current !== 'off' && stateRef.current !== 'failed') {
        wantListeningRef.current = true
        startRecognition()
      }
      return
    }

    // 代次计数：cancel() 会触发上一条 utterance 的 onend，若不隔离，
    // 旧的 resume() 会在新播报进行中重开识别器，导致麦克风听到动伴自己的声音。
    speechGenerationRef.current += 1
    const generation = speechGenerationRef.current

    // 省电休眠中仍然要能报数和鼓励，只是说完不重开麦克风。
    // 必须在覆盖状态之前记下来——否则 resume() 里读到的已经是 'speaking'，
    // 那道 sleeping 判断永远不会命中，每报一次数就把麦克风唤回来，省电失效。
    const wasSleeping = stateRef.current === 'sleeping'
    setReply(text)

    // 注意：这里**不能**立刻关麦克风。
    // 取音频要走一趟网络（TTS 上游饱和时还要轮几个模型，可能好几秒），
    // 如果一进来就关麦，而报数又很频繁，麦克风会被饿死——用户全程插不上话。
    // 所以关麦推迟到音频真正要出声的那一刻（onBeforePlay）。
    const beforePlay = () => {
      if (generation !== speechGenerationRef.current) return
      wantListeningRef.current = false
      stopRecognition()
      speakingRef.current = true
      setVoiceState('speaking')
    }

    const resume = () => {
      // 已被更新的播报取代，交给那一条去恢复监听
      if (generation !== speechGenerationRef.current) return
      speakingRef.current = false
      if (disposedRef.current) return

      // 休眠中只播报、不重开麦克风，把状态还原回 sleeping
      if (wasSleeping) {
        setVoiceState('sleeping')
        return
      }
      if (stateRef.current === 'off' || stateRef.current === 'failed') return

      // 说完回到对话态还是常听态，取决于对话窗口是否还开着
      const inConversation = Date.now() < conversationUntilRef.current
      setVoiceState(inConversation ? 'active' : 'idle')
      wantListeningRef.current = true
      // 给音频输出留一点尾巴，避免立刻把自己的余音听进去
      window.setTimeout(() => {
        if (generation === speechGenerationRef.current && wantListeningRef.current) startRecognition()
      }, 350)
    }
    // 走中转站的神经 TTS，失败时 tts.ts 内部自动退回浏览器合成。
    // stillCurrent 让等待网络期间被新播报取代的旧请求安静退出，
    // 不去恢复监听——那本该由新的那一条负责。
    void speakText(text, {
      fallbackVoice: voiceRef.current,
      stillCurrent: () => generation === speechGenerationRef.current,
      onBeforePlay: beforePlay,
    }).then(resume, resume)
  }, [setVoiceState, startRecognition, stopRecognition])

  // ── 处理一句用户说完的话 ─────────────────────────────────────
  const handleUtterance = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || speakingRef.current) return

    const inConversation = Date.now() < conversationUntilRef.current
    let payload = text

    if (!inConversation) {
      // Chrome 常把一句话拆成多段 final 返回（例如「你好」和「动伴」分两次），
      // 单独看任何一段都不含完整唤醒词。所以把最近几段拼起来再匹配。
      // 超过 6 秒的碎片要丢掉，否则几分钟前的「你好」会和现在的「动伴」
      // 拼成一次误唤醒。
      const now = Date.now()
      if (now - recentAtRef.current > 6000) recentRef.current = []
      recentAtRef.current = now
      recentRef.current = [...recentRef.current, text].slice(-4)
      const joined = recentRef.current.join('')

      console.log('[动伴] 听到：', text, '｜合并：', joined, '｜唤醒：', matchesWakeWord(joined))

      if (!matchesWakeWord(joined)) return

      // 「你好动伴，我想练深蹲」——同句里的正文直接接着处理，不用说第二遍
      payload = stripWakeWord(joined)
      recentRef.current = []
      conversationUntilRef.current = Date.now() + CONVERSATION_WINDOW_MS
      lastTalkRef.current = Date.now()
      if (!payload) {
        say('我在，你说。')
        return
      }
    } else {
      recentRef.current = []
    }

    conversationUntilRef.current = Date.now() + CONVERSATION_WINDOW_MS
    lastTalkRef.current = Date.now()
    setTranscript(payload)
    setVoiceState('thinking')

    const currentContext = contextRef.current
    let answer = ''

    if (hasModelRef.current) {
      const history = historyRef.current.slice(-MAX_HISTORY)
      const result = await askCoach([
        { role: 'system', content: buildSystemPrompt(currentContext) },
        ...history,
        { role: 'user', content: payload },
      ])
      if (result.ok) {
        answer = result.text
      } else {
        // 模型不可用不能让对话断掉，退到本地话术
        if (import.meta.env.DEV) console.warn('[动伴] 模型调用失败，使用本地话术：', result.error)
        answer = localReply(payload, currentContext)
      }
    } else {
      answer = localReply(payload, currentContext)
    }

    const checked = applyPolicy(answer, currentContext)
    if (import.meta.env.DEV && checked.blocked) console.warn('[动伴] 策略拦截：', checked.reason, answer)

    historyRef.current = [
      ...historyRef.current.slice(-MAX_HISTORY),
      { role: 'user', content: payload },
      { role: 'assistant', content: checked.text },
    ]
    say(checked.text)
  }, [say, setVoiceState])

  // ── 建识别器 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setVoiceState('off')
      return
    }
    const Recognizer = getRecognizer()
    if (!Recognizer) {
      setVoiceState('unsupported')
      return
    }
    // 非安全上下文（如用 http://192.168.x.x 打开）浏览器会直接禁用麦克风，
    // 表现就是「喊了完全没反应」。这里提前拦住并说清原因。
    if (!window.isSecureContext) {
      setErrorMessage('当前用非 https 地址打开，浏览器禁用了麦克风。请改用 http://localhost:5173 访问')
      setVoiceState('failed')
      return
    }

    disposedRef.current = false
    const recognition = new Recognizer()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'zh-CN'
    recognition.maxAlternatives = 1

    recognition.onresult = event => {
      // 能拿到结果说明识别链路通了，清掉之前累计的失败计数
      failureCountRef.current = 0
      // 只处理已定稿的片段，中间结果只用于界面回显
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript || ''
        if (!result.isFinal) {
          // 常听态也回显，让用户看到「确实听见了」，便于判断是否听错了唤醒词
          setTranscript(text)
          continue
        }
        void handleUtterance(text)
      }
    }

    recognition.onerror = event => {
      // no-speech / aborted 是常态（用户没说话、或我们主动停的），不算故障
      if (event.error === 'no-speech' || event.error === 'aborted') return

      console.warn('[动伴] 语音识别错误：', event.error, event.message || '')

      // 权限和服务类错误重试没有意义，直接停并告知用户怎么处理
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture' || event.error === 'language-not-supported') {
        wantListeningRef.current = false
        setErrorMessage(ERROR_MESSAGE[event.error] || `语音识别不可用（${event.error}）`)
        setVoiceState('failed')
        return
      }

      // network 等可能是暂时的，但不能无限重试——Chrome 的识别依赖 Google 服务器，
      // 国内网络下会一直失败，无限重试只会刷屏并耗电。连续 3 次就停。
      failureCountRef.current += 1
      if (failureCountRef.current >= 3) {
        wantListeningRef.current = false
        setErrorMessage(ERROR_MESSAGE[event.error] || `语音识别反复失败（${event.error}），已暂停`)
        setVoiceState('failed')
      }
    }

    // Chrome 会在静音一段时间后自行结束，需要自动续上
    recognition.onend = () => {
      runningRef.current = false
      if (disposedRef.current || !wantListeningRef.current || speakingRef.current) return
      window.setTimeout(() => {
        if (wantListeningRef.current && !speakingRef.current) startRecognition()
      }, 250)
    }

    recognitionRef.current = recognition
    wantListeningRef.current = true
    lastTalkRef.current = Date.now()
    conversationUntilRef.current = 0
    failureCountRef.current = 0
    setVoiceState('idle')

    // 开场问候：让用户立刻听到声音。
    // 这也是一个诊断手段——如果这句能听到但喊唤醒词没反应，说明「说」正常、
    // 是「听」出了问题（多半是识别服务连不上）；如果连这句都没有，是播放被浏览器挡了。
    if (!greetedRef.current) {
      greetedRef.current = true
      window.setTimeout(() => {
        if (!disposedRef.current) say('我在，说「你好动伴」随时叫我。')
      }, 600)
    } else {
      startRecognition()
    }

    return () => {
      disposedRef.current = true
      wantListeningRef.current = false
      try { recognition.abort() } catch { /* ignore */ }
      runningRef.current = false
      recognitionRef.current = null
      // 同上：离开训练页要把两种引擎都停掉，否则语音会继续播
      cancelSpeech()
    }
  }, [enabled, handleUtterance, setVoiceState, startRecognition])

  // ── 对话窗口过期 & 10 分钟无对话关麦省电（摄像头不动）───────
  useEffect(() => {
    if (!enabled || state === 'unsupported' || state === 'sleeping' || state === 'off') return
    const timer = window.setInterval(() => {
      const now = Date.now()
      // 对话窗口静默过期后退回常听态，让界面提示与实际行为一致
      if (state === 'active' && now > conversationUntilRef.current && !speakingRef.current) {
        setVoiceState('idle')
      }
      if (now - lastTalkRef.current < IDLE_TIMEOUT_MS) return
      wantListeningRef.current = false
      stopRecognition()
      conversationUntilRef.current = 0
      setVoiceState('sleeping')
    }, 5_000)
    return () => clearInterval(timer)
  }, [enabled, state, setVoiceState, stopRecognition])

  /**
   * 唤回麦克风。两种场景都用它：
   * - 10 分钟省电休眠后（关麦后听不见唤醒词，只能点一下）
   * - 识别失败后手动重试
   */
  const rearm = useCallback(() => {
    if (!enabled || stateRef.current === 'unsupported') return
    // 非安全上下文重试也没用，别让用户白点
    if (typeof window !== 'undefined' && !window.isSecureContext) return
    lastTalkRef.current = Date.now()
    conversationUntilRef.current = 0
    wantListeningRef.current = true
    failureCountRef.current = 0   // 不清零的话，重试会立刻再次触顶
    setErrorMessage('')
    setVoiceState('idle')
    startRecognition()
  }, [enabled, setVoiceState, startRecognition])

  /** 浏览器是否支持语音识别。独立于 enabled，便于开练前就如实告知用户。 */
  const supported = getRecognizer() !== null

  /**
   * 安全上下文检查。
   *
   * 麦克风与语音识别只在 https 或 localhost 下可用。
   * 本项目的 dev 脚本带了 --host 0.0.0.0，如果你用 http://192.168.x.x:5173
   * 这种局域网地址打开（比如在手机上试），浏览器会直接禁掉麦克风，
   * 表现就是「喊了没反应」。这种情况必须用 localhost 打开。
   */
  const secure = typeof window === 'undefined' ? true : window.isSecureContext

  /**
   * 不经唤醒词直接进入对话态。
   *
   * 唤醒词的前提是 ASR 能把「动伴」听对，而中文识别对这个生僻词错误率不低，
   * 穷举同音字也不可能全覆盖。这条路径不依赖识别准确度，是唤不醒时的兜底。
   * 它不是「手动输入」——用户仍然只用说话，只是换个方式开启对话。
   */
  const openConversation = useCallback(() => {
    if (!enabled) return
    const current = stateRef.current
    if (current === 'unsupported' || current === 'failed' || current === 'off') return
    recentRef.current = []
    lastTalkRef.current = Date.now()
    conversationUntilRef.current = Date.now() + CONVERSATION_WINDOW_MS
    // 正在播报时不抢识别器，说完 resume() 会自动回到对话态
    if (speakingRef.current) return
    setVoiceState('active')
    wantListeningRef.current = true
    startRecognition()
  }, [enabled, setVoiceState, startRecognition])

  const toggleMute = useCallback(() => {
    setMuted(current => {
      const next = !current
      // 必须用 cancelSpeech()——它同时停 Web Audio 和 speechSynthesis。
      // 只停后者的话，神经 TTS 的音频会继续播完，静音按钮形同虚设。
      if (next) cancelSpeech()
      return next
    })
  }, [])

  return {
    state,
    transcript,
    reply,
    muted,
    hasModel,
    supported,
    secure,
    errorMessage,
    neural,
    openConversation,
    /** 供外部触发的播报（如整组报数），会正确避让识别器 */
    say,
    rearm,
    toggleMute,
    inConversation: state === 'active' || state === 'thinking' || state === 'speaking',
  }
}
