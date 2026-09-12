// Web Speech API 的最小类型声明。
//
// 名字统一加 MB 前缀：较新版本的 lib.dom.d.ts 已经自带 SpeechRecognition* 系列接口，
// 同名声明会触发接口合并，一旦成员签名有细微差异就会编译报错。用独立名字彻底避开。
// 运行时的 window.SpeechRecognition 取值在 useCoachVoice.ts 里手动断言，
// 所以这里不去增强 Window。

interface MBRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface MBRecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: MBRecognitionAlternative
}

interface MBRecognitionResultList {
  readonly length: number
  [index: number]: MBRecognitionResult
}

interface MBRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: MBRecognitionResultList
}

interface MBRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface MBRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: MBRecognitionEvent) => void) | null
  onerror: ((event: MBRecognitionErrorEvent) => void) | null
  onend: ((event: Event) => void) | null
  onstart: ((event: Event) => void) | null
}
