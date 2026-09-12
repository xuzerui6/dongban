// 对话策略层：话题锚定、危险内容拦截、以及无 API key 时的本地话术兜底。
//
// 设计原则（来自实施计划）：事实与表达分离。次数、时长、心率这些事实由代码提供，
// 模型只决定怎么说。所有输出在进入 TTS 之前必须先过这里。

export interface CoachContext {
  reps: number
  targetReps: number
  phase: string
  durationSeconds: number
  bpm: number | null
  active: boolean
}

/** 训练中允许的最大句长。用户在发力时听不进长句。 */
const MAX_ACTIVE_CHARS = 30
const MAX_REST_CHARS = 90

// 处方式表达：不能自动生成个体化负荷、组数、次数建议
const PRESCRIPTION = /(加|减|上|下)\s*\d+\s*(公斤|kg|千克|磅)|建议你?(做|练|加|减)\s*\d+|下一组(做|加|减)|再做\s*\d+\s*(组|个|次)(吧|试试)?|每(天|周)(做|练)\s*\d+/i

// 医疗诊断：绝对不能碰
const DIAGNOSIS = /(半月板|韧带|肌腱|软骨|骨折|拉伤|扭伤|劳损|炎症|滑膜|髌骨)(损伤|撕裂|问题|有事|受伤)|你(可能|大概|应该)(受伤|伤了|拉伤|骨折)|需要(去)?(医院|就医|看医生)?(拍片|核磁|CT)/i

// 评分式判定：D1 冻结决策，不给分数、不贴「标准/不标准」标签
const SCORING = /\d+\s*分(的动作|，|。|$)|动作(评分|得分)|(很|不)?标准(动作)?[，。！]|(完美|perfect|满分)/i

const SAFE_REWRITE = '这个我说不好，得看你自己的感觉。要不要先慢一点？'

export interface PolicyResult {
  text: string
  blocked: boolean
  reason?: 'prescription' | 'diagnosis' | 'scoring'
}

/** 出口检查：模型说的话在播放前必须过这一层 */
export function applyPolicy(raw: string, context: CoachContext): PolicyResult {
  // 先洗掉书面语痕迹（markdown、emoji、开场废话），再做安全检查。
  // 顺序很重要：先洗再查，否则 `**92分**` 里的星号会让评分正则漏判。
  const text = humanize(raw.replace(/\s+/g, ' ')).trim()
  if (!text) return { text: '嗯，我在。', blocked: false }

  if (DIAGNOSIS.test(text)) return { text: '这个我不能判断。如果有明显疼痛，先停下来。', blocked: true, reason: 'diagnosis' }
  if (PRESCRIPTION.test(text)) return { text: SAFE_REWRITE, blocked: true, reason: 'prescription' }
  if (SCORING.test(text)) return { text: '你自己感觉这组怎么样？', blocked: true, reason: 'scoring' }

  // 长度收敛：训练中必须短
  const limit = context.active && context.phase !== 'standing' ? MAX_ACTIVE_CHARS : MAX_REST_CHARS
  if (text.length > limit) {
    const cut = text.slice(0, limit)
    const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('，'))
    return { text: (lastStop > limit * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim(), blocked: false }
  }
  return { text, blocked: false }
}

/** 交给模型的系统提示。约束人格、长度、边界。 */
export function buildSystemPrompt(context: CoachContext): string {
  return [
    '你是「动伴」，正在用户身边陪他训练的朋友。不是助手，不是客服，不是裁判。',
    '',
    '说话方式（最重要）：',
    '- 你的话会被念出来，所以只写口语，像微信语音那样。',
    '- 短。一到两句就够。想说三句时删掉两句。',
    '- 不要开场白。不说「好的」「当然」「没问题」「作为你的教练」这类废话，直接说内容。',
    '- 不要 emoji、不要星号、不要列表、不要任何标点以外的符号。',
    '- 不要感叹号堆叠，不要「加油加油」「你真棒」这种空洞的打气。',
    '- 可以用「嗯」「诶」「其实」这些自然的口语词，也可以不完整成句。',
    '- 别每句都叫对方「你」，像真人聊天那样省略主语。',
    '',
    '边界：',
    '- 只聊训练。用户聊别的，一句话带回来。',
    '- 不打分，不说「标准/不标准」，不判动作对错。',
    '- 不给重量、组数、次数的建议。不做伤病判断。',
    '- 先接住对方的感受，再说事实。看不清、不知道，就直说。',
    '- 鼓励坚持，但不鼓励忍痛。',
    '',
    `长度上限：${context.active ? '15 字' : '40 字'}。`,
    '',
    '现在的实际情况（只能用这些，不要编）：',
    `- 这组做了 ${context.reps} 次${context.targetReps ? `，目标 ${context.targetReps} 次` : ''}`,
    `- 已经练了 ${Math.floor(context.durationSeconds / 60)} 分 ${context.durationSeconds % 60} 秒`,
    context.bpm ? `- 心率 ${context.bpm}` : '- 没戴心率带，别提心率',
  ].join('\n')
}

/**
 * 去掉书面语痕迹。模型即使被要求说口语，也常常带出 markdown、emoji
 * 和「作为你的教练」这类开场白——念出来 AI 味极重，所以在进 TTS 前清一遍。
 */
export function humanize(text: string): string {
  return text
    // markdown 强调符号与代码号
    .replace(/[*_`#>]/g, '')
    // emoji 与杂符号（保留中英文、数字、常用标点）
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
    // 开场废话
    .replace(/^(好的|好吧|当然|没问题|明白了?|收到|了解)[，,。!！~\s]*/g, '')
    .replace(/^(作为你的?(私人)?(教练|助手|健身伙伴|AI)|我是你的?动伴)[，,。\s]*/g, '')
    // 「让我们」这类翻译腔
    .replace(/让我们/g, '我们')
    // 堆叠的感叹号与省略号
    .replace(/[!！]{2,}/g, '！')
    .replace(/[.。]{3,}/g, '…')
    // 列表符号
    .replace(/^[-·•]\s*/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── 本地兜底大脑（没有 API key 时使用）───────────────────────────

interface LocalRule {
  match: RegExp
  reply: (context: CoachContext) => string
}

const LOCAL_RULES: LocalRule[] = [
  { match: /(多少|几个|几次|计数|数量|进度)/, reply: c => `已经 ${c.reps} 次了${c.targetReps ? `，目标 ${c.targetReps}` : ''}。` },
  { match: /(累|喘|顶不住|不行了|没力|酸|吃力)/, reply: () => '嗯，听起来这组挺顶的。要不要先歇一会儿？' },
  { match: /(怎么(做|练)|动作|要领|姿势|正确)/, reply: () => '脚站到舒服稳定的位置，髋和膝一起弯曲，重心放在整个脚掌上。' },
  { match: /(呼吸|喘气|憋气)/, reply: () => '下去的时候吸气，起来的时候呼气，别憋着。' },
  { match: /(停|暂停|结束|不练了|休息)/, reply: () => '好，那就停在这。这组你自己感觉怎么样？' },
  { match: /(加油|鼓励|给我|打气)/, reply: () => '你已经在做了，这就是最难的一步。' },
  { match: /(时间|多久|几分钟)/, reply: c => `练了 ${Math.floor(c.durationSeconds / 60)} 分 ${c.durationSeconds % 60} 秒。` },
  { match: /(心率|bpm|多快)/, reply: c => (c.bpm ? `现在 ${c.bpm} BPM。` : '心率带没连上，这个我看不到。') },
  { match: /(你好|在吗|听得到|喂)/, reply: () => '我在，你说。' },
  { match: /(谢谢|好的|知道了|嗯)/, reply: () => '嗯，继续。' },
]

/** 无 API key 时的本地回答。总会给出一句话，没匹配到规则时把话题带回训练。 */
export function localReply(userText: string, context: CoachContext): string {
  for (const rule of LOCAL_RULES) {
    if (rule.match.test(userText)) return rule.reply(context)
  }
  // 兜底：把话题带回训练
  return context.active ? '我在听。先专心做这组，练完慢慢说。' : '这个我不太确定。我们说回训练吧，现在感觉怎么样？'
}
