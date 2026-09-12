import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * AI 中转站代理。
 *
 * 浏览器只请求 /ai/*，由 dev/preview 服务器补上 Authorization 头再转发。
 * 这样 API key 只存在于 .env 和 Node 进程里，不会进浏览器 bundle。
 * 前端 bundle 中出现的任何密钥都等同于公开泄露，所以密钥不用 VITE_ 前缀。
 *
 * 需要在项目根目录建 .env（参考 .env.example）：
 *   AI_BASE_URL=https://api.openai-next.com/v1
 *   AI_API_KEY=sk-xxxx
 *   VITE_AI_MODEL=gpt-4o-mini
 *
 * 注意：本项目没有装 @types/node，所以这里不能用 process.cwd()，
 * loadEnv 的第二个参数直接传 '.'（相对项目根目录）。
 */

/** 前端用 /ai/__status 判断代理是否可用，避免靠 404 猜测（SPA 回退会让猜测失效）。 */
function statusPlugin(configured: boolean): Plugin {
  const body = JSON.stringify({ configured })
  const handler = (_request: unknown, response: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(body)
  }
  return {
    name: 'motion-buddy-ai-status',
    configResolved() {
      console.log(configured
        ? '\n[动伴] AI 代理已启用，对话将走中转站。\n'
        : '\n[动伴] 未配置 AI_BASE_URL / AI_API_KEY，对话使用本地话术兜底。\n')
    },
    configureServer(server) {
      server.middlewares.use('/ai/__status', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/ai/__status', handler)
    },
  }
}

export default defineConfig(({ mode }) => {
  // 第三个参数传 '' 表示加载所有变量，不只是 VITE_ 前缀的
  const env = loadEnv(mode, '.', '')
  const baseUrl = (env.AI_BASE_URL || '').trim().replace(/\/+$/, '')
  const apiKey = (env.AI_API_KEY || '').trim()
  const configured = Boolean(baseUrl && apiKey)

  // headers 是 http-proxy 原生选项，会加到发往 target 的请求上。
  const proxy: Record<string, ProxyOptions> | undefined = configured
    ? {
        '/ai': {
          target: baseUrl,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/ai/, ''),
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      }
    : undefined

  return {
    plugins: [react(), statusPlugin(configured)],
    server: { proxy },
    preview: { proxy },
  }
})
