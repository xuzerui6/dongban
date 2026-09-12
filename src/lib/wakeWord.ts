// 唤醒词「你好动伴」的模糊匹配。
//
// 两个现实问题决定了这里必须很宽容：
//
// 1. 中文语音识别对「动伴」这个非常见词经常听错，会给出冻伴/懂伴/动版/动拌
//    之类的同音字。所以名字用「声母组合」穷举，而不是列几个特例。
//
// 2. Chrome 会把「你好动伴」拆成两段 final 结果返回（中间有停顿时），
//    单独看每一段都不含完整唤醒词。所以调用方需要把最近几段拼起来再匹配
//    （见 useCoachVoice 里的 recentRef 缓冲）。
//
// 另外：招呼语是**可选**的。只说「动伴」也能唤醒。
// 强制要求「你好」会让识别漏掉招呼语时怎么喊都不应，代价是「动伴」单独出现
// 也会唤醒——在训练场景里这个误触发概率很低，换来的可用性提升更值。

/** 「动」的常见同音误识别 */
const NAME_HEAD = ['动', '動', '冻', '懂', '东', '東', '洞', '栋', '棟', '冬', '董', '逗']

/** 「伴」的常见同音误识别。含 班/般 这类一声字——ASR 的声调经常判错。 */
const NAME_TAIL = ['伴', '半', '版', '办', '辦', '板', '拌', '扮', '瓣', '绊', '伴儿', '班', '般', '搬', '斑']

const NAMES: string[] = []
for (const head of NAME_HEAD) {
  for (const tail of NAME_TAIL) NAMES.push(head + tail)
}
NAMES.push('dongban', 'dongbam')

/** 去掉空白与标点并转小写，让「你好，动伴。」和「你好动伴」等价 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[，。、！？；：,.!?;:~～·「」『』""''（）()【】\[\]—\-]/g, '')
}

/** 文本里是否出现了动伴的名字（含同音容错） */
export function matchesWakeWord(text: string): boolean {
  const flat = normalize(text)
  if (!flat) return false
  return NAMES.some(name => flat.includes(name))
}

/**
 * 把唤醒词及其之前的内容剥掉，返回同一句里跟在名字后面的正文。
 * 这样用户可以一口气说「你好动伴，我想练深蹲」，不用喊两遍。
 * 取最后一次出现的位置，避免用户重复喊时把前面的残句当正文。
 */
export function stripWakeWord(text: string): string {
  let end = -1
  for (const name of NAMES) {
    const index = text.lastIndexOf(name)
    if (index !== -1 && index + name.length > end) end = index + name.length
  }
  // 只在归一化后才匹配上（原文里夹了标点）时，拿不到可靠的切割点，
  // 这时返回空串，由调用方回一句「我在，你说」。
  if (end === -1) return ''
  return text.slice(end).replace(/^[\s　，。、！？；：,.!?;:]+/, '').trim()
}
