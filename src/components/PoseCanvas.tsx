import { useEffect, useRef } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const connections = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]]

export function PoseCanvas({ videoRef, landmarks, demo, phase }: { videoRef: React.RefObject<HTMLVideoElement>; landmarks: NormalizedLandmark[] | null; demo: boolean; phase: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const draw = () => {
      const w = canvas.width, h = canvas.height; ctx.clearRect(0,0,w,h)
      if (videoRef.current?.readyState && !demo) { ctx.save(); ctx.scale(-1,1); ctx.drawImage(videoRef.current,-w,0,w,h); ctx.restore() }
      else {
        const g = ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#111814'); g.addColorStop(1,'#26332d'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h)
        ctx.fillStyle='rgba(255,255,255,.04)'; for(let x=0;x<w;x+=28) for(let y=0;y<h;y+=28) ctx.fillRect(x,y,1,1)
      }
      let pts: {x:number;y:number}[] = []
      if (landmarks && !demo) pts = landmarks.map(p => ({ x:(1-p.x)*w, y:p.y*h }))
      else {
        const down = phase === 'bottom'; const cx=w/2, hip=down?h*.60:h*.48, knee=down?h*.70:h*.67
        pts=Array.from({length:29},()=>({x:cx,y:h*.4})); Object.assign(pts[11],{x:cx-34,y:h*.3}); Object.assign(pts[12],{x:cx+34,y:h*.3}); Object.assign(pts[13],{x:cx-55,y:h*.43}); Object.assign(pts[14],{x:cx+55,y:h*.43}); Object.assign(pts[15],{x:cx-70,y:h*.35}); Object.assign(pts[16],{x:cx+70,y:h*.35}); Object.assign(pts[23],{x:cx-28,y:hip}); Object.assign(pts[24],{x:cx+28,y:hip}); Object.assign(pts[25],{x:cx-58,y:knee}); Object.assign(pts[26],{x:cx+58,y:knee}); Object.assign(pts[27],{x:cx-70,y:h*.88}); Object.assign(pts[28],{x:cx+70,y:h*.88})
      }
      ctx.strokeStyle='#21ed80'; ctx.lineWidth=5; ctx.lineCap='round'; ctx.shadowColor='#21ed80'; ctx.shadowBlur=8
      for (const [a,b] of connections) if (pts[a]&&pts[b]) { ctx.beginPath(); ctx.moveTo(pts[a].x,pts[a].y); ctx.lineTo(pts[b].x,pts[b].y); ctx.stroke() }
      ctx.shadowBlur=0; ctx.fillStyle='#36f093'; for (const i of [11,12,13,14,15,16,23,24,25,26,27,28]) if(pts[i]) {ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,6,0,Math.PI*2);ctx.fill()}
    }
    draw()
  }, [landmarks, demo, phase, videoRef])
  return <><video ref={videoRef} className="hidden-video" muted playsInline/><canvas ref={canvasRef} width={360} height={410} className="pose-canvas"/></>
}
