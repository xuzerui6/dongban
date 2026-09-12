// 与第三方中转站通信。走 OpenAI 兼容的 /chat/completions 端点。
//
// 请求不直接打中转站，而是打本地的 /ai 前缀，由 Vite 的代理转发并在服务端注入
// Authorization 头（见 vite.config.ts）。这样 API key 只存在于 .env 与 Node 进程，
// 不会被打进浏览器 bundle。前端 bundle 里出现的任何密钥都等于公开泄露。

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CoachClientResult {
  text: string
  ok: boolean
  /** 失败原因，仅用于开发期定位，不展示给用户 */
  error?: string
}

/** 代理路径。vite.config.ts 里把 /ai 转发到中转站并补上密钥。 */
const ENDPOINT = '/ai/chat/completions'

const MODEL = (import.meta.env.VITE_AI_MODEL as string | undefined)?.trim() || 'gpt-4o-mini'

/** 训练中用户等不了太久，超时就走本地兜底 */
const TIMEOUT_MS = 8000

export async function askCoach(messages: ChatMessage[]): Promise<CoachClientResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        // 训练场景要短、要稳，不要发散
        temperature: 0.6,
        max_tokens: 120,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return { text: '', ok: false, error: `HTTP ${response.status} ${detail.slice(0, 200)}` }
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return { text: '', ok: false, error: 'empty choices' }
    return { text, ok: true }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown'
    return { text: '', ok: false, error: name === 'AbortError' ? 'timeout' : String(error) }
  } finally {
    window.clearTimeout(timer)
  }
}

/**
 * 探测代理是否配置好。没配 key 时前端自动走本地话术，不弹错误给用户。
 * 只在进入训练页时探一次。
 *
 * /ai/__status 由 vite.config.ts 的插件提供，明确返回 { configured: boolean }，
 * 不依赖靠 404 猜测（Vite 的 SPA 回退会让猜测失效）。
 */
export async function probeCoach(): Promise<boolean> {
  try {
    const response = await fetch('/ai/__status')
    if (!response.ok) return false
    const data = await response.json() as { configured?: boolean }
    return data.configured === true
  } catch {
    return false
  }
}
