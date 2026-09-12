import { useEffect, useMemo, useRef, useState } from 'react'
import { Header } from '../components/Header'
import { Icon } from '../components/Icons'
import { PoseCanvas } from '../components/PoseCanvas'
import { useCoachVoice } from '../hooks/useCoachVoice'
import { createCueState, pickCue } from '../lib/coachCues'
import { unlockAudio } from '../lib/tts'
import { useHeartRateMonitor } from '../hooks/useHeartRateMonitor'
import { usePose } from '../hooks/usePose'
import { useSquatMetrics } from '../hooks/useSquatMetrics'
import { useWorkoutSession } from '../hooks/useWorkoutSession'
import { useStore } from '../lib/store'
import type { WorkoutSession } from '../types'

const format = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

const VOICE_LABEL: Record<string, string> = {
  idle: '说「你好动伴」或点这里开始说话',
  active: '动伴在听…',
  thinking: '动伴在想…',
  speaking: '动伴正在说',
  sleeping: '已省电休眠 · 点此唤回',
  unsupported: '当前浏览器不支持语音，建议用电脑版 Chrome',
  failed: '语音不可用 · 点此重试',
  off: '',
}

export function Workout({ back, finish }: { back: () => void; finish: (session: WorkoutSession) => void }) {
  const { state } = useStore()
  const [active, setActive] = useState(false)
  const [simulatedPose, setSimulatedPose] = useState(false)
  const [paused, setPaused] = useState(false)
  const pose = usePose(active && !simulatedPose)
  const heartRate = useHeartRateMonitor(state.age)
  const metrics = useSquatMetrics(pose.landmarks, simulatedPose, active && !paused, 20)
  const workout = useWorkoutSession(metrics, heartRate, active, paused)
  const session = workout.session

  // 交给对话层的事实。模型只能引用这些，不能自己编。
  const voiceContext = useMemo(() => ({
    reps: metrics.reps,
    targetReps: metrics.targetReps,
    phase: metrics.phase,
    durationSeconds: session?.durationSeconds || 0,
    bpm: heartRate.connected && !heartRate.signalInterrupted ? heartRate.currentBpm : null,
    active: active && !paused,
  }), [metrics.reps, metrics.targetReps, metrics.phase, session?.durationSeconds, heartRate.connected, heartRate.signalInterrupted, heartRate.currentBpm, active, paused])

  const voice = useCoachVoice(active, voiceContext)

  // 主动教练的定时器要读最新的 voice，但不能把 voice 放进依赖——
  // 它每次渲染都是新对象，会让定时器每帧重建。用 ref 桥接。
  const voiceRef = useRef(voice)
  useEffect(() => { voiceRef.current = voice }, [voice])

  // 历史最佳单组次数，用于「破纪录」鼓励
  const personalBest = useMemo(
    () => state.history.reduce((best, item) => Math.max(best, item.reps || 0), 0),
    [state.history],
  )

  // ── 主动教练 ────────────────────────────────────────────────
  // 训练中由动伴主动开口：报数、里程碑鼓励、动作提示、久未动作时的问候。
  // 必须走 voice.say —— 它会先停识别器再播报，否则麦克风会听到动伴自己的
  // 声音形成死循环。
  const cueStateRef = useRef(createCueState())
  const lastRepAtRef = useRef(Date.now())
  const cueInputRef = useRef({ reps: 0, targetReps: 0, feedback: '', phase: 'standing', demo: false })

  useEffect(() => {
    cueInputRef.current = {
      reps: metrics.reps,
      targetReps: metrics.targetReps,
      feedback: metrics.feedback,
      phase: metrics.phase,
      demo: simulatedPose,
    }
  }, [metrics.reps, metrics.targetReps, metrics.feedback, metrics.phase, simulatedPose])

  // 记录最近一次完成动作的时间，用于判断「久未动作」
  useEffect(() => { lastRepAtRef.current = Date.now() }, [metrics.reps])

  // 每组重新开始时重置，否则上一组的报数基线会压掉新一组的第一个
  useEffect(() => {
    if (!active) cueStateRef.current = createCueState()
  }, [active])

  useEffect(() => {
    if (!active || paused) return
    const timer = window.setInterval(() => {
      // 用户正在跟动伴对话时不要插话
      if (voiceRef.current.inConversation) return
      const now = Date.now()
      const cue = pickCue({
        ...cueInputRef.current,
        personalBest,
        sinceLastRepMs: now - lastRepAtRef.current,
        now,
      }, cueStateRef.current)
      if (cue) voiceRef.current.say(cue.text)
    }, 350)
    return () => clearInterval(timer)
  }, [active, paused, personalBest])

  // unlockAudio 必须在用户手势里调用：浏览器的自动播放策略要求 AudioContext
  // 在点击事件中创建，否则建出来是 suspended 状态，第一句话没有声音。
  const startRealPose = () => { unlockAudio(); setSimulatedPose(false); setActive(true); window.setTimeout(pose.start, 30) }
  const startDemo = () => { unlockAudio(); setSimulatedPose(true); setActive(true) }
  const done = () => { const completed = workout.finish(); if (completed) finish(completed) }
  const scoreLabel = metrics.formScore === 0 ? '待完成' : metrics.formScore >= 90 ? '优秀' : metrics.formScore >= 80 ? '良好' : '需调整'

  if (!active) return <div className="page workout-page setup">
    <Header title="深蹲 SQUAT" back={back}/>
    <div className="setup-visual"><div className="scan-ring"><Icon name="spark" size={42}/></div><span className="eyebrow">准备训练</span><h2>选择识别方式</h2><p>真实识别会启动摄像头与本地姿态模型；演示模式无需设备，也能跑通完整闭环。</p></div>
    <button className="primary" onClick={startRealPose}><span>📷</span> 开启 AI 摄像头识别</button>
    <button className="secondary" onClick={startDemo}><Icon name="play"/> 使用演示动作</button>
    <div className="voice-hint">
      <Icon name="mic" size={15}/>
      <span>
        <b>训练中会主动报数和提醒 · 说「你好动伴」随时聊</b>
        <small>{
          !voice.supported ? '当前浏览器不支持语音识别，建议用电脑版 Chrome 或 Edge'
            : `${voice.hasModel ? '大模型已接入' : '本地话术模式（未配置 key）'} · ${voice.neural === true ? '自然语音' : voice.neural === false ? '浏览器语音（中转站不支持 TTS）' : '语音引擎检测中'} · 10 分钟无对话自动关麦，摄像头不受影响`
        }</small>
      </span>
    </div>
    <div className="ble-setup"><div><Icon name="bluetooth"/><span><b>{heartRate.deviceName || 'BLE 心率带'}</b><small>{heartRate.status === 'unsupported' ? '当前浏览器不支持 Web Bluetooth，请使用桌面 Chrome 或 Edge 演示。' : heartRate.connected && heartRate.signalInterrupted ? '心率信号中断' : heartRate.connected && !heartRate.lastPacketAt ? '等待心率数据…' : heartRate.connected ? `${heartRate.currentBpm} BPM · Zone ${heartRate.currentZone}` : heartRate.status === 'disconnected' ? '心率带已断开' : heartRate.errorMessage || '标准 0x180D / 0x2A37'}</small></span></div><button disabled={heartRate.status === 'connecting' || heartRate.status === 'unsupported' || heartRate.connected} onClick={heartRate.connect}>{heartRate.status === 'connecting' ? '正在连接…' : heartRate.connected ? '已连接' : '连接心率带'}</button></div>
  </div>

  return <div className="page workout-page live">
    <Header title="深蹲 SQUAT" back={back} action={<span className="live-pill"><i/>{simulatedPose ? 'DEMO' : 'AI 识别中'}</span>}/>
    <div className="workout-stats"><div><Icon name="flame"/><span><b>{format(session?.durationSeconds || 0)}</b><small>训练时长</small></span></div><div><Icon name="heart"/><span><b>{!heartRate.connected ? '未连接' : heartRate.signalInterrupted ? '信号中断' : heartRate.currentBpm ? `${heartRate.currentBpm} BPM` : '等待数据'}</b><small>{heartRate.currentZone ? `BLE · Zone ${heartRate.currentZone}` : 'BLE 心率设备'}</small></span></div></div>
    <div className="camera-card"><PoseCanvas videoRef={pose.videoRef} landmarks={pose.landmarks} demo={simulatedPose} phase={metrics.phase}/><div className="camera-label"><i/>{simulatedPose ? 'DEMO 姿态模型' : pose.status === 'loading' ? '模型加载中' : pose.status === 'denied' ? '摄像头被拒绝' : pose.status === 'error' ? '姿态模型加载失败' : 'AI 骨骼追踪'}</div><div className="phase-tag">{metrics.phase.toUpperCase()}</div></div>
    <div className="count-score"><div className="rep-count"><b>{metrics.reps}</b><span>/ {metrics.targetReps} 次</span></div><div className="score-ring" style={{ '--score': `${metrics.formScore * 3.6}deg` } as React.CSSProperties}><div><b>{metrics.formScore || '--'}</b><small>分</small></div></div><div className="score-copy"><small>平均动作评分</small><b>{scoreLabel}</b></div></div>
    <div className="feedback"><Icon name="spark"/><span>{metrics.feedback}</span></div>
    <div className={`voice-bar ${voice.state}`}>
      <button
        className="voice-status"
        onClick={
          voice.state === 'sleeping' || voice.state === 'failed' ? voice.rearm
            : voice.state === 'idle' ? voice.openConversation
            : undefined
        }
        disabled={voice.state !== 'sleeping' && voice.state !== 'failed' && voice.state !== 'idle'}
      >
        <Icon name={voice.state === 'idle' || voice.state === 'active' || voice.state === 'thinking' || voice.state === 'speaking' ? 'mic' : 'micOff'} size={15}/>
        <span>
          <b>{VOICE_LABEL[voice.state] || ''}</b>
          <small>{
            voice.state === 'failed' || voice.state === 'unsupported'
              ? voice.errorMessage || '语音识别不可用'
              : voice.state === 'speaking' || voice.state === 'thinking'
                ? voice.reply || '…'
                : voice.transcript || (voice.hasModel ? '大模型已接入' : '本地话术模式')
          }</small>
        </span>
      </button>
      <button className="voice-mute" onClick={voice.toggleMute} aria-label={voice.muted ? '打开声音' : '关闭声音'}>
        <Icon name={voice.muted ? 'volumeOff' : 'volume'} size={15}/>
      </button>
    </div>
    <div className="zone-card"><div><Icon name="heart"/><span>当前心率<b>{!heartRate.connected ? '未连接' : heartRate.signalInterrupted ? '信号中断' : heartRate.currentBpm ? <>{heartRate.currentBpm} <small>BPM</small></> : '等待数据'}</b></span></div><div className="zones">{[1, 2, 3, 4, 5].map(zone => <span key={zone} className={heartRate.currentZone === zone ? 'current' : ''}><i/>Zone {zone}</span>)}</div></div>
    <div className="workout-actions"><button className="secondary" onClick={() => setPaused(value => !value)}><Icon name={paused ? 'play' : 'pause'}/>{paused ? '继续' : '暂停'}</button><button className="primary" onClick={done}><Icon name="check"/>完成本组</button></div>
  </div>
}
