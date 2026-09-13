import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { helloMessage, listenMessage, mcpResult, mcpTextResult } from '../src/lib/xiaozhiProtocol'

const sessionId = 'mock-session-42'
const server = new WebSocketServer({ port: 0 })
await once(server, 'listening')
const address = server.address()
if (typeof address === 'string' || !address) throw new Error('mock server address unavailable')

const serverReceived: Array<Record<string, any> | Buffer> = []
let resolveSequence!: () => void
const sequenceComplete = new Promise<void>(resolve => { resolveSequence = resolve })

server.on('connection', socket => {
  socket.on('message', (data, binary) => {
    if (binary) return serverReceived.push(Buffer.from(data as Buffer))
    const message = JSON.parse(data.toString()) as Record<string, any>
    serverReceived.push(message)
    if (message.type === 'hello') {
      socket.send(JSON.stringify({ type: 'hello', session_id: sessionId, transport: 'websocket', audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 60 } }))
      socket.send(JSON.stringify({ type: 'stt', session_id: sessionId, text: '我做几个了' }))
      socket.send(JSON.stringify({ type: 'llm', session_id: sessionId, emotion: 'happy' }))
      socket.send(JSON.stringify({ type: 'tts', session_id: sessionId, state: 'sentence_start', text: '已经三个了，节奏很稳' }))
      socket.send(Buffer.from([0xf8, 0xff, 0xfe]), { binary: true })
      socket.send(JSON.stringify({ type: 'mcp', session_id: sessionId, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } }))
      return
    }
    if (message.type !== 'mcp') return
    if (message.payload.id === 1) socket.send(JSON.stringify({ type: 'mcp', session_id: sessionId, payload: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} } }))
    if (message.payload.id === 2) socket.send(JSON.stringify({ type: 'mcp', session_id: sessionId, payload: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'self.motion.get_workout_status', arguments: {} } } }))
    if (message.payload.id === 3) socket.send(JSON.stringify({ type: 'mcp', session_id: sessionId, payload: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'self.camera.take_photo', arguments: { question: '看看动作' } } } }))
    if (message.payload.id === 4) resolveSequence()
  })
})

const client = new WebSocket(`ws://127.0.0.1:${address.port}`)
const events: string[] = []
let binaryPackets = 0
client.on('message', (data, binary) => {
  if (binary) {
    binaryPackets += 1
    return
  }
  const message = JSON.parse(data.toString()) as Record<string, any>
  events.push(message.type)
  if (message.type === 'hello') client.send(JSON.stringify(listenMessage('start', message.session_id)))
  if (message.type !== 'mcp') return
  const payload = message.payload
  if (payload.method === 'initialize') client.send(JSON.stringify(mcpResult(payload.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} } }, message.session_id)))
  if (payload.method === 'tools/list') client.send(JSON.stringify(mcpResult(payload.id, { tools: [{ name: 'self.motion.get_workout_status' }, { name: 'self.camera.take_photo' }] }, message.session_id)))
  if (payload.method === 'tools/call' && payload.params.name === 'self.motion.get_workout_status') {
    client.send(JSON.stringify(mcpTextResult(payload.id, { reps: 3, targetReps: 20, updatedAt: '2026-09-13T00:00:00.000Z' }, message.session_id)))
  }
  if (payload.method === 'tools/call' && payload.params.name === 'self.camera.take_photo') {
    client.send(JSON.stringify(mcpTextResult(payload.id, { success: true, summary: '膝盖轨迹更稳定了' }, message.session_id)))
  }
})
await once(client, 'open')
client.send(JSON.stringify(helloMessage()))
await Promise.race([
  sequenceComplete,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('MCP mock sequence timeout')), 1_000)),
])

assert.equal(binaryPackets, 1, '裸 Opus 包应保持二进制帧')
const messages = serverReceived.filter((item): item is Record<string, any> => !(item instanceof Buffer))
assert.equal(messages[0].audio_params.frame_duration, 60)
assert.deepEqual(messages.find(item => item.type === 'listen'), { type: 'listen', state: 'start', mode: 'auto', session_id: sessionId })
const statusResult = messages.find(item => item.payload?.id === 3)
assert.equal(statusResult.session_id, sessionId)
assert.equal(JSON.parse(statusResult.payload.result.content[0].text).reps, 3)
const cameraResult = messages.find(item => item.payload?.id === 4)
assert.equal(cameraResult.session_id, sessionId)
assert.equal(JSON.parse(cameraResult.payload.result.content[0].text).summary, '膝盖轨迹更稳定了')
assert.equal(cameraResult.payload.result.isError, false)
assert.ok(events.includes('stt') && events.includes('tts') && events.includes('mcp'))

client.close()
server.close()
await once(server, 'close')
console.log('Xiaozhi mock integration passed: session-aware listen, raw Opus, MCP initialize/list/workout status/camera content results')
