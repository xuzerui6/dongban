import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCoachVoice } from './useCoachVoice'
import { cancelSpeech } from '../lib/tts'
import { matchesWakeWord } from '../lib/wakeWord'
import { XiaozhiAudio } from '../lib/xiaozhiAudio'
import { abortMessage, helloMessage, listenMessage, mapXiaozhiEmotion, mcpError, mcpResult } from '../lib/xiaozhiProtocol'
import type { CoachEmotion, PoseIssue, VisionInsight, WorkoutContext, XiaozhiState } from '../types'

type CoachSource = 'xiaozhi' | 'compatible' | 'local'
type CuePriority = 'low' | 'normal' | 'high'
const PRIORITY: Record<CuePriority, number> = { low: 1, normal: 2, high: 3 }
const RECONNECT_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000]
const XIAOZHI_ENABLED = (import.meta.env.VITE_XIAOZHI_ENABLED as string | undefined) !== 'false'

interface Options {
  enabled: boolean
  context: WorkoutContext
  videoRef: React.RefObject<HTMLVideoElement>
  visionConsent: boolean
}

const recognizerCtor = () => {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as { SpeechRecognition?: { new (): MBRecognition }; webkitSpeechRecognition?: { new (): MBRecognition } }
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null
}

function frameDataUrl(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) return null
  const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.translate(canvas.width, 0)
  context.scale(-1, 1)
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', .78)
}

const resultText = (result: unknown): string => {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const data = result as { text?: unknown; message?: unknown; result?: unknown }
    if (typeof data.text === 'string') return data.text
    if (typeof data.message === 'string') return data.message
    if (typeof data.result === 'string') return data.result
  }
  return '视觉复核已完成，实时计数仍以本地姿态模型为准。'
}

export function useXiaozhiCoach({ enabled, context, videoRef, visionConsent }: Options) {
  const [state, setState] = useState<XiaozhiState>('off')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [emotion, setEmotion] = useState<CoachEmotion>('neutral')
  const [activationCode, setActivationCode] = useState('')
  const [activationMessage, setActivationMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [muted, setMuted] = useState(false)
  const [fallbackMode, setFallbackMode] = useState(!XIAOZHI_ENABLED)
  const [retryNonce, setRetryNonce] = useState(0)
  const [conversationTurnCount, setConversationTurnCount] = useState(0)
  const [visionInsights, setVisionInsights] = useState<VisionInsight[]>([])
  const [visionAvailable, setVisionAvailable] = useState(false)
  const [xiaozhiVoiceReady, setXiaozhiVoiceReady] = useState(false)

  const contextRef = useRef(context)
  const stateRef = useRef(state)
  const mutedRef = useRef(muted)
  const consentRef = useRef(visionConsent)
  const socketRef = useRef<WebSocket | null>(null)
  const audioRef = useRef<XiaozhiAudio | null>(null)
  const wakeRecognitionRef = useRef<MBRecognition | null>(null)
  const wakeRunningRef = useRef(false)
  const conversationUntilRef = useRef(0)
  const queuedCueRef = useRef<{ text: string; priority: CuePriority } | null>(null)
  const visionPendingRef = useRef(new Map<string, { trigger: 'user' | 'repeated_issue'; issue: PoseIssue | null }>())
  const autoVisionRef = useRef({ lastAt: 0, count: 0 })

  useEffect(() => { contextRef.current = context }, [context])
  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => { consentRef.current = visionConsent }, [visionConsent])

  const fallbackContext = useMemo(() => ({
    reps: context.reps, targetReps: context.targetReps, phase: context.phase,
    durationSeconds: context.durationSeconds, bpm: context.bpm, active: context.active,
  }), [context])
  const fallback = useCoachVoice(enabled && fallbackMode, fallbackContext, { audible: false })
  const source: CoachSource = fallbackMode ? (fallback.hasModel ? 'compatible' : 'local') : 'xiaozhi'

  const sendJson = useCallback((message: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message))
  }, [])

  const stopWakeRecognition = useCallback(() => {
    try { wakeRecognitionRef.current?.stop() } catch { /* already stopped */ }
    wakeRunningRef.current = false
  }, [])

  const wake = useCallback(async () => {
    if (fallbackMode) return fallback.openConversation()
    if (socketRef.current?.readyState !== WebSocket.OPEN || stateRef.current === 'activating') return
    stopWakeRecognition()
    try {
      if (!audioRef.current) {
        audioRef.current = new XiaozhiAudio(
          packet => { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(packet) },
          () => undefined,
        )
      }
      await audioRef.current.startCapture()
      setXiaozhiVoiceReady(true)
      audioRef.current.setSending(true)
      conversationUntilRef.current = Date.now() + 25_000
      setEmotion('listening')
      setState('listening')
      sendJson(listenMessage('start'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '麦克风或 Opus 初始化失败')
      setFallbackMode(true)
      setState('fallback')
    }
  }, [fallbackMode, fallback.openConversation, sendJson, stopWakeRecognition])

  const handleMcp = useCallback(async (payload: { id?: string | number; method?: string; params?: Record<string, unknown> }) => {
    if (payload.id === undefined || !payload.method) return
    if (payload.method === 'initialize') {
      sendJson(mcpResult(payload.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'motion-buddy-web', version: '1.0.0' } }))
      return
    }
    if (payload.method === 'tools/list') {
      sendJson(mcpResult(payload.id, { tools: [
        {
          name: 'self.camera.take_photo',
          description: '用户明确要求看动作或画面时，获取当前关键帧并进行低频视觉解释。',
          inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
        },
        {
          name: 'self.motion.get_workout_status',
          description: '读取当前训练的真实次数、阶段、时长、心率、姿势问题和评分。只读。',
          inputSchema: { type: 'object', properties: {} },
        },
      ] }))
      return
    }
    if (payload.method !== 'tools/call') return sendJson(mcpError(payload.id, `不支持的方法：${payload.method}`))
    const params = payload.params as { name?: string; arguments?: { question?: string } } | undefined
    if (params?.name === 'self.motion.get_workout_status') {
      return sendJson(mcpResult(payload.id, { success: true, ...contextRef.current }))
    }
    if (params?.name !== 'self.camera.take_photo') return sendJson(mcpError(payload.id, '只允许读取训练状态和当前关键帧'))
    if (!consentRef.current) return sendJson(mcpError(payload.id, '用户未授权云端关键帧复核；本地矫姿仍在运行'))
    const image = videoRef.current ? frameDataUrl(videoRef.current) : null
    if (!image) return sendJson(mcpError(payload.id, '当前摄像头画面不可用'))
    const requestId = crypto.randomUUID()
    visionPendingRef.current.set(requestId, { trigger: 'user', issue: contextRef.current.poseIssues[0] || null })
    sendJson({ bridge: 'vision_frame', requestId, mcpId: payload.id, image, question: params.arguments?.question || '请看看我的动作，并只说最值得调整的一点。' })
  }, [sendJson, videoRef])

  useEffect(() => {
    if (!enabled || fallbackMode || !XIAOZHI_ENABLED) {
      if (!enabled) setState('off')
      return
    }
    let disposed = false
    let reconnectIndex = 0
    let reconnectTimer = 0
    let activationTimer = 0

    const connect = () => {
      if (disposed) return
      setState(reconnectIndex ? 'reconnecting' : 'connecting')
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/api/xiaozhi/socket`)
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket
      socket.onmessage = event => {
        if (event.data instanceof ArrayBuffer) {
          if (!mutedRef.current) audioRef.current?.decode(event.data)
          return
        }
        let message: any
        try { message = JSON.parse(String(event.data)) } catch { return }
        if (message.bridge === 'ready') {
          reconnectIndex = 0
          sendJson(helloMessage())
          return
        }
        if (message.bridge === 'vision_available') return setVisionAvailable(true)
        if (message.bridge === 'error') return setErrorMessage(message.message || '小智桥接异常')
        if (message.bridge === 'vision_result') {
          const meta = visionPendingRef.current.get(message.requestId)
          if (!meta) return
          visionPendingRef.current.delete(message.requestId)
          if (message.error) return setErrorMessage(message.error)
          const insight: VisionInsight = {
            id: message.requestId, createdAt: new Date().toISOString(), trigger: meta.trigger, issue: meta.issue,
            summary: resultText(message.result).slice(0, 180),
          }
          setVisionInsights(current => [...current, insight].slice(-6))
          return
        }
        if (message.type === 'hello') {
          const sampleRate = Number(message.audio_params?.sample_rate) || 24_000
          audioRef.current ||= new XiaozhiAudio(packet => socketRef.current?.send(packet), () => undefined)
          audioRef.current.configureDecoder(sampleRate)
          setState('idle')
          setEmotion('neutral')
          return
        }
        if (message.type === 'stt') {
          setTranscript(message.text || '')
          setState('thinking')
          setEmotion('thinking')
          setConversationTurnCount(count => count + 1)
          conversationUntilRef.current = Date.now() + 25_000
          return
        }
        if (message.type === 'llm') return setEmotion(mapXiaozhiEmotion(message.emotion))
        if (message.type === 'tts') {
          if (message.state === 'sentence_start' && message.text) setReply(message.text)
          if (message.state === 'start') {
            audioRef.current?.setSending(false)
            void audioRef.current?.ensurePlaybackReady().then(
              () => setXiaozhiVoiceReady(true),
              () => setXiaozhiVoiceReady(false),
            )
            setState('speaking')
          }
          if (message.state === 'stop') {
            audioRef.current?.setSending(true)
            setState('listening')
            setEmotion('listening')
            conversationUntilRef.current = Date.now() + 25_000
            sendJson(listenMessage('start'))
          }
          return
        }
        if (message.type === 'mcp' && message.payload) void handleMcp(message.payload)
      }
      socket.onclose = event => {
        if (disposed) return
        socketRef.current = null
        if (event.code === 4401) {
          setFallbackMode(true)
          setState('fallback')
          setErrorMessage('小智设备尚未激活，已切换到文字反馈')
          return
        }
        setState('reconnecting')
        const delay = RECONNECT_DELAYS[Math.min(reconnectIndex, RECONNECT_DELAYS.length - 1)]
        reconnectIndex += 1
        reconnectTimer = window.setTimeout(connect, delay)
      }
      socket.onerror = () => setErrorMessage('小智连接中断，正在尝试恢复')
    }

    const initialize = async () => {
      setState('connecting')
      try {
        const response = await fetch('/api/xiaozhi/device', { method: 'POST', credentials: 'include' })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        if (body.status === 'activating') {
          setActivationCode(body.code || '')
          setActivationMessage(body.message || '请在 xiaozhi.me 输入激活码')
          setState('activating')
          const poll = async () => {
            if (disposed || Date.now() >= Number(body.expiresAt || 0)) {
              setErrorMessage('激活码已过期，请重试')
              return setState('failed')
            }
            try {
              const result = await fetch('/api/xiaozhi/activate', { method: 'POST', credentials: 'include' })
              if (result.status === 200) {
                setActivationCode('')
                return connect()
              }
              if (result.status !== 202) throw new Error((await result.json()).error || '激活失败')
            } catch (error) {
              setErrorMessage(error instanceof Error ? error.message : '激活轮询失败')
            }
            activationTimer = window.setTimeout(poll, 5_000)
          }
          activationTimer = window.setTimeout(poll, 5_000)
          return
        }
        connect()
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '小智服务不可用')
        setFallbackMode(true)
        setState('fallback')
      }
    }
    void initialize()
    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      clearTimeout(activationTimer)
      socketRef.current?.close(1000, 'workout ended')
      socketRef.current = null
    }
  }, [enabled, fallbackMode, retryNonce, handleMcp, sendJson])

  // 小智空闲时沿用轻量模糊唤醒词；识别服务不可用时，状态条仍可点击启动。
  useEffect(() => {
    if (!enabled || fallbackMode || state !== 'idle') return
    const Recognizer = recognizerCtor()
    if (!Recognizer) return
    const recognition = new Recognizer()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'zh-CN'
    recognition.onresult = event => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0]?.transcript || ''
        setTranscript(text)
        if (event.results[index].isFinal && matchesWakeWord(text)) void wake()
      }
    }
    recognition.onerror = () => { wakeRunningRef.current = false }
    recognition.onend = () => {
      wakeRunningRef.current = false
      if (stateRef.current === 'idle') window.setTimeout(() => { try { recognition.start(); wakeRunningRef.current = true } catch { /* ignore */ } }, 300)
    }
    wakeRecognitionRef.current = recognition
    try { recognition.start(); wakeRunningRef.current = true } catch { /* permission can be requested by click */ }
    return () => {
      try { recognition.abort() } catch { /* ignore */ }
      wakeRunningRef.current = false
      if (wakeRecognitionRef.current === recognition) wakeRecognitionRef.current = null
    }
  }, [enabled, fallbackMode, state, wake])

  useEffect(() => {
    if (fallbackMode || (state !== 'listening' && state !== 'thinking')) return
    const timer = window.setInterval(() => {
      if (Date.now() < conversationUntilRef.current) return
      sendJson(listenMessage('stop'))
      void audioRef.current?.stopCapture()
      setState('idle')
      setEmotion('neutral')
    }, 1_000)
    return () => clearInterval(timer)
  }, [fallbackMode, state, sendJson])

  useEffect(() => () => {
    cancelSpeech()
    void audioRef.current?.dispose()
    audioRef.current = null
  }, [])

  const say = useCallback((text: string, priority: CuePriority = 'normal') => {
    if (!text || mutedRef.current) return
    if (fallbackMode) {
      setReply(text)
      return
    }
    if (stateRef.current === 'listening' || stateRef.current === 'thinking' || stateRef.current === 'speaking') {
      const queued = queuedCueRef.current
      if (!queued || PRIORITY[priority] > PRIORITY[queued.priority]) queuedCueRef.current = { text, priority }
      return
    }
    // 小智协议只把服务端下发的裸 Opus 作为官方音色。自动报数与矫姿先显示
    // 为实时字幕，不再混用浏览器或兼容 TTS；对话回复仍由小智有声播放。
    setReply(text)
    queuedCueRef.current = null
  }, [fallbackMode])

  useEffect(() => {
    if (fallbackMode || state !== 'idle' || !queuedCueRef.current) return
    const cue = queuedCueRef.current
    queuedCueRef.current = null
    say(cue.text, cue.priority)
  }, [fallbackMode, state, say])

  const interrupt = useCallback(() => {
    if (fallbackMode) return cancelSpeech()
    audioRef.current?.clearPlayback()
    audioRef.current?.setSending(true)
    sendJson(abortMessage())
    sendJson(listenMessage('start'))
    conversationUntilRef.current = Date.now() + 25_000
    setState('listening')
    setEmotion('listening')
  }, [fallbackMode, sendJson])

  const requestVision = useCallback((question: string, trigger: 'user' | 'repeated_issue', issue: PoseIssue | null) => {
    if (fallbackMode || !visionAvailable || !consentRef.current || !videoRef.current) return false
    if (trigger === 'repeated_issue') {
      if (autoVisionRef.current.count >= 3 || Date.now() - autoVisionRef.current.lastAt < 30_000) return false
      autoVisionRef.current = { count: autoVisionRef.current.count + 1, lastAt: Date.now() }
    }
    const image = frameDataUrl(videoRef.current)
    if (!image) return false
    const requestId = crypto.randomUUID()
    visionPendingRef.current.set(requestId, { trigger, issue })
    sendJson({ bridge: 'vision_frame', requestId, image, question })
    return true
  }, [fallbackMode, sendJson, videoRef, visionAvailable])

  const retry = useCallback(() => {
    setErrorMessage('')
    setFallbackMode(!XIAOZHI_ENABLED)
    setRetryNonce(value => value + 1)
  }, [])

  const prepareAudio = useCallback(() => {
    if (fallbackMode || !XIAOZHI_ENABLED) return
    audioRef.current ||= new XiaozhiAudio(
      packet => { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(packet) },
      () => undefined,
    )
    void audioRef.current.ensurePlaybackReady().then(
      () => setXiaozhiVoiceReady(true),
      error => {
        setXiaozhiVoiceReady(false)
        setErrorMessage(error instanceof Error ? error.message : '小智音频初始化失败')
      },
    )
  }, [fallbackMode])

  const toggleMute = useCallback(() => {
    setMuted(current => {
      if (!current) {
        cancelSpeech()
        audioRef.current?.clearPlayback()
      }
      return !current
    })
  }, [])

  const publicState: XiaozhiState = fallbackMode
    ? (fallback.state === 'thinking' ? 'thinking' : fallback.state === 'speaking' ? 'speaking' : fallback.state === 'active' ? 'listening' : fallback.state === 'failed' ? 'failed' : 'fallback')
    : state

  return {
    state: publicState,
    transcript: fallbackMode ? fallback.transcript : transcript,
    reply: fallbackMode ? fallback.reply : reply,
    emotion: fallbackMode ? (fallback.state === 'thinking' ? 'thinking' : fallback.state === 'speaking' ? 'happy' : 'neutral') as CoachEmotion : emotion,
    source, wake, interrupt, retry, prepareAudio,
    sendWorkoutContext: (next: WorkoutContext) => { contextRef.current = next },
    say, requestVision, activationCode, activationMessage, errorMessage: errorMessage || fallback.errorMessage,
    muted, toggleMute, supported: fallbackMode ? fallback.supported : Boolean(recognizerCtor()),
    inConversation: publicState === 'listening' || publicState === 'thinking' || publicState === 'speaking',
    hasModel: source !== 'local', neural: source === 'xiaozhi', xiaozhiVoiceReady: source === 'xiaozhi' && xiaozhiVoiceReady,
    visionAvailable, visionInsights, conversationTurnCount,
  }
}
