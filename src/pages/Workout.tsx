import { useEffect, useMemo, useRef, useState } from 'react'
import { Header } from '../components/Header'
import { Icon } from '../components/Icons'
import { PoseCanvas } from '../components/PoseCanvas'
import { useXiaozhiCoach } from '../hooks/useXiaozhiCoach'
import { createCueState, pickCue } from '../lib/coachCues'
import { createCorrectionGateState, decideCorrectionCue, POSE_ISSUE_COPY } from '../lib/poseFeedback'
import { unlockAudio } from '../lib/tts'
import { useHeartRateMonitor } from '../hooks/useHeartRateMonitor'
import { usePose } from '../hooks/usePose'
import { useSquatMetrics } from '../hooks/useSquatMetrics'
import { useWorkoutSession } from '../hooks/useWorkoutSession'
import { useStore } from '../lib/store'
import type { WorkoutContext, WorkoutSession, XiaozhiState } from '../types'

const format = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

const VOICE_LABEL: Record<XiaozhiState, string> = {
  off: '', idle: '说「你好动伴」或点这里开始', activating: '首次使用，需要绑定小智账号',
  connecting: '正在连接动伴…', listening: '我在听，你接着说', thinking: '动伴在想…',
  speaking: '动伴正在用小智音色说话', reconnecting: '网络波动，正在恢复…', fallback: '小智语音离线 · 文字反馈中', failed: '语音暂不可用 · 点此重试',
}

const SOURCE_LABEL = { xiaozhi: '小智官方音色', compatible: '兼容模型 · 仅文字', local: '本地话术 · 仅文字' }
const POSE_STATUS = { stable: '姿势稳定', adjust: '建议调整', uncertain: '无法判断' }

export function Workout({ back, finish }: { back: () => void; finish: (session: WorkoutSession) => void }) {
  const { state: appState } = useStore()
  const [active, setActive] = useState(false)
  const [simulatedPose, setSimulatedPose] = useState(false)
  const [paused, setPaused] = useState(false)
  const [visionConsent, setVisionConsent] = useState<boolean | null>(null)
  const pose = usePose(active && !simulatedPose)
  const heartRate = useHeartRateMonitor(appState.age)
  const metrics = useSquatMetrics(pose.landmarks, simulatedPose, active && !paused, 20)
  const workout = useWorkoutSession(metrics, heartRate, active, paused)
  const session = workout.session

  const voiceContext: WorkoutContext = useMemo(() => ({
    reps: metrics.reps, targetReps: metrics.targetReps, phase: metrics.phase,
    durationSeconds: session?.durationSeconds || 0,
    bpm: heartRate.connected && !heartRate.signalInterrupted ? heartRate.currentBpm : null,
    active: active && !paused,
    poseStatus: metrics.poseFeedback.status,
    poseIssues: metrics.poseFeedback.issues,
    recentScore: metrics.formScore,
  }), [metrics.reps, metrics.targetReps, metrics.phase, metrics.poseFeedback.status, metrics.poseFeedback.issues, metrics.formScore, session?.durationSeconds, heartRate.connected, heartRate.signalInterrupted, heartRate.currentBpm, active, paused])

  const voice = useXiaozhiCoach({ enabled: active, context: voiceContext, videoRef: pose.videoRef, visionConsent: visionConsent === true })
  const voiceRef = useRef(voice)
  useEffect(() => { voiceRef.current = voice }, [voice])
  useEffect(() => { voice.sendWorkoutContext(voiceContext) }, [voiceContext])

  const personalBest = useMemo(
    () => appState.history.reduce((best, item) => Math.max(best, item.reps || 0), 0),
    [appState.history],
  )
  const cueStateRef = useRef(createCueState())
  const correctionGateRef = useRef(createCorrectionGateState())
  const lastRepAtRef = useRef(Date.now())
  const cueInputRef = useRef({ reps: 0, targetReps: 0, feedback: '', phase: 'standing', demo: false })

  useEffect(() => {
    cueInputRef.current = {
      reps: metrics.reps, targetReps: metrics.targetReps, feedback: metrics.feedback,
      phase: metrics.phase, demo: true, // 逐帧提示只显示；语音由完整动作门控器决定。
    }
  }, [metrics.reps, metrics.targetReps, metrics.feedback, metrics.phase])
  useEffect(() => { lastRepAtRef.current = Date.now() }, [metrics.reps])
  useEffect(() => {
    if (active) return
    cueStateRef.current = createCueState()
    correctionGateRef.current = createCorrectionGateState()
  }, [active])

  useEffect(() => {
    if (!active || paused) return
    const timer = window.setInterval(() => {
      if (voiceRef.current.inConversation) return
      const now = Date.now()
      const cue = pickCue({ ...cueInputRef.current, personalBest, sinceLastRepMs: now - lastRepAtRef.current, now }, cueStateRef.current)
      if (cue) voiceRef.current.say(cue.text, cue.kind === 'idle' ? 'low' : 'normal')
    }, 350)
    return () => clearInterval(timer)
  }, [active, paused, personalBest])

  // 矫姿语音只在一次完整动作结束后决策；连续问题才提醒，改善则优先确认。
  const correctedRepRef = useRef(0)
  useEffect(() => {
    if (!active || simulatedPose || metrics.reps <= correctedRepRef.current) return
    correctedRepRef.current = metrics.reps
    const cue = decideCorrectionCue(metrics.lastRepIssues, Date.now(), correctionGateRef.current)
    if (cue) voiceRef.current.say(cue.text, 'high')
    if (metrics.repeatedIssue && visionConsent === true) {
      const issue = metrics.repeatedIssue
      voiceRef.current.requestVision(
        `这是一次深蹲关键帧。本地算法连续检测到“${POSE_ISSUE_COPY[issue].label}”。请用朋友口吻简短复核，只给一个可执行建议；不要诊断，不要推翻本地计数。`,
        'repeated_issue', issue,
      )
    }
  }, [active, simulatedPose, metrics.reps, metrics.lastRepIssues, metrics.repeatedIssue, visionConsent])

  const startRealPose = () => {
    if (visionConsent === null) return
    unlockAudio()
    voice.prepareAudio()
    setSimulatedPose(false)
    setActive(true)
    window.setTimeout(pose.start, 30)
  }
  const startDemo = () => { unlockAudio(); voice.prepareAudio(); setVisionConsent(false); setSimulatedPose(true); setActive(true) }
  const done = () => {
    const completed = workout.finish()
    if (completed) finish({ ...completed, visionInsights: voice.visionInsights, conversationTurnCount: voice.conversationTurnCount })
  }
  const scoreLabel = metrics.formScore === 0 ? '待完成' : metrics.formScore >= 90 ? '优秀' : metrics.formScore >= 80 ? '良好' : '需调整'

  if (!active) return <div className="page workout-page setup">
    <Header title="深蹲 SQUAT" back={back}/>
    <div className="setup-visual"><div className="scan-ring"><Icon name="spark" size={42}/></div><span className="eyebrow">准备训练</span><h2>选择识别方式</h2><p>姿态识别和实时矫正始终在浏览器本地运行；原始视频不会保存。</p></div>
    <div className="vision-consent" role="group" aria-label="关键帧复核选择">
      <b>开始前确认视觉范围</b>
      <p>小智只会在你主动要求“看看动作”，或同一问题连续影响两次动作时收到一张压缩关键帧。</p>
      <div>
        <button className={visionConsent === false ? 'selected' : ''} onClick={() => setVisionConsent(false)}>仅本地分析</button>
        <button className={visionConsent === true ? 'selected' : ''} onClick={() => setVisionConsent(true)}>允许智能复核</button>
      </div>
    </div>
    <button className="primary" disabled={visionConsent === null} onClick={startRealPose}><span>📷</span> 开启 AI 摄像头识别</button>
    <button className="secondary" onClick={startDemo}><Icon name="play"/> 使用演示动作</button>
    <div className="voice-hint"><Icon name="mic" size={15}/><span><b>小智音色对话 · 说「你好动伴」连续聊</b><small>所有可听回复只播放小智官方音频；报数与矫姿实时显示字幕，网络异常时不混用系统音色。</small></span></div>
    <div className="ble-setup"><div><Icon name="bluetooth"/><span><b>{heartRate.deviceName || 'BLE 心率带'}</b><small>{heartRate.status === 'unsupported' ? '请使用桌面 Chrome 或 Edge' : heartRate.connected ? `${heartRate.currentBpm || '--'} BPM · Zone ${heartRate.currentZone || '--'}` : heartRate.errorMessage || '标准 0x180D / 0x2A37'}</small></span></div><button disabled={heartRate.status === 'connecting' || heartRate.status === 'unsupported' || heartRate.connected} onClick={heartRate.connect}>{heartRate.status === 'connecting' ? '正在连接…' : heartRate.connected ? '已连接' : '连接心率带'}</button></div>
  </div>

  return <div className="page workout-page live">
    <Header title="深蹲 SQUAT" back={back} action={<span className="live-pill"><i/>{simulatedPose ? 'DEMO' : 'AI 识别中'}</span>}/>
    {voice.state === 'activating' && <div className="activation-card"><span className="coach-face caring">◕‿◕</span><div><b>绑定小智账号</b><small>{voice.activationMessage}</small><strong>{voice.activationCode}</strong><a href="https://xiaozhi.me" target="_blank" rel="noreferrer">打开 xiaozhi.me 完成绑定</a></div></div>}
    <div className="workout-stats"><div><Icon name="flame"/><span><b>{format(session?.durationSeconds || 0)}</b><small>训练时长</small></span></div><div><Icon name="heart"/><span><b>{!heartRate.connected ? '未连接' : heartRate.signalInterrupted ? '信号中断' : heartRate.currentBpm ? `${heartRate.currentBpm} BPM` : '等待数据'}</b><small>{heartRate.currentZone ? `BLE · Zone ${heartRate.currentZone}` : 'BLE 心率设备'}</small></span></div></div>
    <div className="camera-card">
      <PoseCanvas videoRef={pose.videoRef} landmarks={pose.landmarks} demo={simulatedPose} phase={metrics.phase} affectedJoints={metrics.poseFeedback.affectedJoints}/>
      <div className="camera-label"><i/>{simulatedPose ? 'DEMO 姿态模型' : pose.status === 'loading' ? '模型加载中' : pose.status === 'denied' ? '摄像头被拒绝' : pose.status === 'error' ? '姿态模型加载失败' : 'AI 骨骼追踪'}</div>
      <div className="phase-tag">{metrics.phase.toUpperCase()}</div>
      <div className={`pose-confidence ${metrics.poseFeedback.status}`}><b>{POSE_STATUS[metrics.poseFeedback.status]}</b><small>{metrics.poseFeedback.calibrated ? `${Math.round(metrics.poseFeedback.confidence * 100)}% 置信` : '站姿校准中'}</small></div>
    </div>
    <div className="count-score"><div className="rep-count"><b>{metrics.reps}</b><span>/ {metrics.targetReps} 次</span></div><div className="score-ring" style={{ '--score': `${metrics.formScore * 3.6}deg` } as React.CSSProperties}><div><b>{metrics.formScore || '--'}</b><small>分</small></div></div><div className="score-copy"><small>平均动作评分</small><b>{scoreLabel}</b></div></div>
    <div className={`feedback ${metrics.poseFeedback.status}`}><Icon name="spark"/><span><b>{metrics.poseFeedback.primaryIssue ? POSE_ISSUE_COPY[metrics.poseFeedback.primaryIssue].label : POSE_STATUS[metrics.poseFeedback.status]}</b><small>{metrics.feedback}</small></span></div>
    <div className={`coach-panel ${voice.state}`}>
      <span className={`coach-face ${voice.emotion}`} aria-label={`动伴表情：${voice.emotion}`}>{voice.emotion === 'celebrating' ? '★‿★' : voice.emotion === 'concerned' ? '◕︵◕' : voice.emotion === 'thinking' ? '◔_◔' : voice.emotion === 'listening' ? '◉‿◉' : '◕‿◕'}</span>
      <button className="voice-status" onClick={voice.state === 'idle' || voice.state === 'fallback' ? voice.wake : voice.state === 'failed' ? voice.retry : undefined} disabled={!['idle', 'fallback', 'failed'].includes(voice.state)}>
        <span><b>{VOICE_LABEL[voice.state]}</b><small>{voice.state === 'speaking' || voice.state === 'thinking' ? voice.reply || '…' : voice.transcript || voice.reply || voice.errorMessage || '随时叫我，我会先听你说'}</small></span>
      </button>
      {(voice.state === 'speaking' || voice.state === 'thinking') && <button className="interrupt-btn" onClick={voice.interrupt}>打断</button>}
      <button className="voice-mute" onClick={voice.toggleMute} aria-label={voice.muted ? '打开声音' : '关闭声音'}><Icon name={voice.muted ? 'volumeOff' : 'volume'} size={15}/></button>
      <em>{SOURCE_LABEL[voice.source]}{voice.xiaozhiVoiceReady ? ' · 声音就绪' : ''}{voice.visionAvailable && visionConsent ? ' · 视觉就绪' : ''}</em>
    </div>
    <div className="zone-card"><div><Icon name="heart"/><span>当前心率<b>{!heartRate.connected ? '未连接' : heartRate.signalInterrupted ? '信号中断' : heartRate.currentBpm ? <>{heartRate.currentBpm} <small>BPM</small></> : '等待数据'}</b></span></div><div className="zones">{[1, 2, 3, 4, 5].map(zone => <span key={zone} className={heartRate.currentZone === zone ? 'current' : ''}><i/>Zone {zone}</span>)}</div></div>
    <div className="workout-actions"><button className="secondary" onClick={() => setPaused(value => !value)}><Icon name={paused ? 'play' : 'pause'}/>{paused ? '继续' : '暂停'}</button><button className="primary" onClick={done}><Icon name="check"/>完成本组</button></div>
  </div>
}
