// 主动教练：决定训练中什么时候该开口说什么。
//
// 纯逻辑、无 IO、不碰 DOM，可以单独跑单元测试。
//
// 三条设计约束：
// 1. 报数必须即时——每完成一次就说出数字，这是产品的核心体验。
// 2. 动作提示要具体可执行，且带不确定性措辞；不给分数、不说「对/错」「标准/不标准」。
// 3. 不能话痨。任意两句之间有最小间隔，同一条提示有更长的冷却，否则很烦。

export type CueKind = 'rep' | 'milestone' | 'form' | 'idle'

export interface Cue {
  text: string
  kind: CueKind
}

export interface CueInput {
  reps: number
  targetReps: number
  /** useSquatMetrics 产出的当前提示语 */
  feedback: string
  phase: string
  /** 历史最佳单组次数，用于「破纪录」鼓励 */
  personalBest: number
  /** 距上次完成一次动作过了多久 */
  sinceLastRepMs: number
  /** 是否演示模式（提示语带 Demo 前缀，不播报动作问题） */
  demo: boolean
  now: number
}

export interface CueState {
  announcedReps: number
  lastAnyAt: number
  lastFormAt: number
  lastFormKey: string
  lastIdleAt: number
  celebratedTarget: boolean
  celebratedBest: boolean
}

export const createCueState = (): CueState => ({
  announcedReps: 0,
  lastAnyAt: 0,
  lastFormAt: 0,
  lastFormKey: '',
  lastIdleAt: 0,
  celebratedTarget: false,
  celebratedBest: false,
})

/** 任意两句话之间的最小间隔，避免打断自己 */
const MIN_GAP_MS = 1600
/** 动作提示的冷却 */
const FORM_COOLDOWN_MS = 14_000
/** 同一条动作提示的冷却，更长 */
const SAME_FORM_COOLDOWN_MS = 30_000
/** 多久没动就问一句 */
const IDLE_PROMPT_MS = 28_000
const IDLE_COOLDOWN_MS = 45_000

/** 每 5 次穿插的鼓励语，轮换避免机械感 */
const ENCOURAGE = ['节奏很稳', '就这样', '保持住', '状态不错', '很好']

/**
 * 把 useSquatMetrics 的提示语映射成「可执行 + 不评判」的口语。
 * key 用于冷却去重；null 表示这条提示不值得打断用户去说。
 */
function mapForm(feedback: string): { key: string; text: string } | null {
  if (feedback.includes('再蹲低')) return { key: 'depth', text: '还能再低一点点' }
  if (feedback.includes('膝盖')) return { key: 'knee', text: '膝盖跟着脚尖的方向' }
  if (feedback.includes('躯干') || feedback.includes('胸口')) return { key: 'trunk', text: '胸口打开，背别塌' }
  if (feedback.includes('进入画面')) return { key: 'frame', text: '往后站一点，让我看到你的全身' }
  // 「深度达标」「向上发力」这类是状态描述，不需要打断用户播报
  return null
}

/**
 * 选出此刻最该说的一句话。会就地更新 state。
 * 返回 null 表示现在应该保持安静。
 */
export function pickCue(input: CueInput, state: CueState): Cue | null {
  const { now } = input

  // 冷启动：第一次调用时把基线对齐到当前次数，避免进页面就把历史次数全报一遍
  if (state.lastAnyAt === 0 && state.announcedReps === 0 && input.reps > 0) {
    state.announcedReps = input.reps
  }

  if (now - state.lastAnyAt < MIN_GAP_MS) return null

  // ── 1. 报数（最高优先）──────────────────────────────────────
  if (input.reps > state.announcedReps) {
    const reps = input.reps
    state.announcedReps = reps
    state.lastAnyAt = now

    // 目标达成
    if (input.targetReps > 0 && reps >= input.targetReps && !state.celebratedTarget) {
      state.celebratedTarget = true
      return { text: `${reps} 个，目标完成了`, kind: 'milestone' }
    }
    // 破个人纪录
    if (input.personalBest > 0 && reps > input.personalBest && !state.celebratedBest) {
      state.celebratedBest = true
      return { text: `${reps} 个，这是你目前最多的一组`, kind: 'milestone' }
    }
    // 第一个
    if (reps === 1) return { text: '第一个，开始了', kind: 'milestone' }
    // 半程
    if (input.targetReps > 0 && reps === Math.floor(input.targetReps / 2)) {
      return { text: `${reps} 个，一半了`, kind: 'milestone' }
    }
    // 每 5 次带一句鼓励，其余只报数字
    if (reps % 5 === 0) {
      const word = ENCOURAGE[(reps / 5 - 1) % ENCOURAGE.length]
      return { text: `${reps} 个，${word}`, kind: 'milestone' }
    }
    return { text: `${reps}`, kind: 'rep' }
  }

  // ── 2. 动作提示 ─────────────────────────────────────────────
  if (!input.demo && now - state.lastFormAt > FORM_COOLDOWN_MS) {
    const hint = mapForm(input.feedback)
    if (hint) {
      const sameAgain = hint.key === state.lastFormKey && now - state.lastFormAt < SAME_FORM_COOLDOWN_MS
      if (!sameAgain) {
        state.lastFormAt = now
        state.lastFormKey = hint.key
        state.lastAnyAt = now
        return { text: hint.text, kind: 'form' }
      }
    }
  }

  // ── 3. 长时间没动作 ─────────────────────────────────────────
  if (
    input.reps > 0 &&
    input.sinceLastRepMs > IDLE_PROMPT_MS &&
    now - state.lastIdleAt > IDLE_COOLDOWN_MS
  ) {
    state.lastIdleAt = now
    state.lastAnyAt = now
    return { text: '不着急，准备好了再来', kind: 'idle' }
  }

  return null
}
