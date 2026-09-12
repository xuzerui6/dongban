import { useEffect, useRef, useState } from 'react'
import type { NormalizedLandmark, PoseLandmarker } from '@mediapipe/tasks-vision'

export function usePose(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'denied' | 'error'>('idle')
  const landmarker = useRef<PoseLandmarker | null>(null)
  const raf = useRef(0)

  const start = async () => {
    setStatus('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 960 }, audio: false })
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm')
      landmarker.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
        runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .55, minTrackingConfidence: .55,
      })
      setStatus('ready')
    } catch (e) {
      setStatus(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'error')
    }
  }

  useEffect(() => {
    if (!active || status !== 'ready') return
    let last = -1
    const loop = () => {
      const video = videoRef.current
      if (video && landmarker.current && video.currentTime !== last) {
        last = video.currentTime
        const result = landmarker.current.detectForVideo(video, performance.now())
        setLandmarks(result.landmarks[0] || null)
      }
      raf.current = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf.current)
  }, [active, status])

  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach(t => t.stop())
    landmarker.current?.close()
  }, [])
  return { videoRef, landmarks, status, start }
}
