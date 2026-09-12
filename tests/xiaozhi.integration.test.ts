import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { helloMessage, listenMessage } from '../src/lib/xiaozhiProtocol'

const server = new WebSocketServer({ port: 0 })
await once(server, 'listening')
const address = server.address()
if (typeof address === 'string' || !address) throw new Error('mock server address unavailable')

const serverReceived: Array<string | Buffer> = []
server.on('connection', socket => {
  socket.on('message', (data, binary) => {
    serverReceived.push(binary ? Buffer.from(data as Buffer) : data.toString())
    if (!binary && JSON.parse(data.toString()).type === 'hello') {
      socket.send(JSON.stringify({ type: 'hello', transport: 'websocket', audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 60 } }))
      socket.send(JSON.stringify({ type: 'stt', text: '我做几个了' }))
      socket.send(JSON.stringify({ type: 'llm', emotion: 'happy' }))
      socket.send(JSON.stringify({ type: 'tts', state: 'sentence_start', text: '已经五个了，节奏很稳' }))
      socket.send(JSON.stringify({ type: 'tts', state: 'start' }))
      socket.send(Buffer.from([0xf8, 0xff, 0xfe]), { binary: true })
      socket.send(JSON.stringify({ type: 'tts', state: 'stop' }))
      socket.send(JSON.stringify({ type: 'mcp', payload: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} } }))
    }
  })
})

const client = new WebSocket(`ws://127.0.0.1:${address.port}`)
const events: string[] = []
let binaryPackets = 0
client.on('message', (data, binary) => {
  if (binary) binaryPackets += 1
  else events.push(JSON.parse(data.toString()).type)
})
await once(client, 'open')
client.send(JSON.stringify(helloMessage()))
client.send(JSON.stringify(listenMessage('start')))
await new Promise(resolve => setTimeout(resolve, 80))

assert.deepEqual(events, ['hello', 'stt', 'llm', 'tts', 'tts', 'tts', 'mcp'])
assert.equal(binaryPackets, 1, '裸 Opus 包应保持二进制帧')
assert.equal(JSON.parse(serverReceived[0].toString()).audio_params.frame_duration, 60)
assert.deepEqual(JSON.parse(serverReceived[1].toString()), { type: 'listen', state: 'start', mode: 'auto' })

client.close()
server.close()
await once(server, 'close')
console.log('Xiaozhi mock integration passed: hello, listen:auto, STT, TTS, emotion, raw Opus and MCP sequence')
