import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

type Point = { x: number; y: number }

function angle(a: Point, b: Point, c: Point) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let degrees = Math.abs((radians * 180) / Math.PI)
  if (degrees > 180) degrees = 360 - degrees
  return degrees
}

function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const [knee, setKnee] = useState(0)
  const [reps, setReps] = useState(0)
  const [status, setStatus] = useState('Stand side-on with your whole body in view')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let stopped = false

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      const vision = await FilesetResolver.forVisionTasks('/wasm')
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
        },
        runningMode: 'VIDEO',
      })

      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      const chart = chartRef.current
      const chartCtx = chart?.getContext('2d')
      const history: number[] = []
      let stage = 'waiting'
      let repCount = 0
      let readyFrames = 0
      let minAngle = 180
      let startX = 0
      let startTorso = 0

      function loop() {
        if (stopped || !video || !canvas || !ctx || !chart || !chartCtx) return
        if (video.readyState >= 2) {
          const result = landmarker.detectForVideo(video, performance.now())
          const landmarks = result.landmarks[0]

          canvas.width = video.videoWidth
          canvas.height = video.videoHeight

          if (landmarks) {
            const px = (i: number) => ({
              x: landmarks[i].x * canvas.width,
              y: landmarks[i].y * canvas.height,
            })

            const kneeAngle = angle(px(23), px(25), px(27))
            setKnee(kneeAngle)

            const visible =
              (landmarks[23].visibility ?? 0) > 0.5 &&
              (landmarks[25].visibility ?? 0) > 0.5 &&
              (landmarks[27].visibility ?? 0) > 0.5

            const torso = Math.hypot(px(11).x - px(23).x, px(11).y - px(23).y)

            // wait until the user is standing still in view
            if (stage === 'waiting') {
              if (visible && kneeAngle > 160) {
                readyFrames = readyFrames + 1
              } else {
                readyFrames = 0
              }
              if (readyFrames > 30) {
                stage = 'up'
                startX = px(23).x
                startTorso = torso
                setStatus('Ready. Start squatting')
              }
            }

            // pause if the user leaves their squat spot
            const moved = Math.abs(px(23).x - startX) > startTorso
            const resized = Math.abs(torso - startTorso) > startTorso * 0.25

            if (stage !== 'waiting' && (moved || resized)) {
              stage = 'waiting'
              readyFrames = 0
              minAngle = 180
              setStatus('Paused. Get back into position')
            }

            // 1. standing → going down
            if (stage === 'up' && kneeAngle < 130) {
              stage = 'down'
            }

            // 2. while down, remember the deepest point
            if (stage === 'down' && kneeAngle < minAngle) {
              minAngle = kneeAngle
            }

            // 3. stood back up → count the rep and judge it
            if (stage === 'down' && kneeAngle > 160) {
              stage = 'up'
              repCount = repCount + 1
              setReps(repCount)

              if (minAngle <= 95) {
                setFeedback('Good depth')
              } else {
                setFeedback('Go lower next time')
              }
              minAngle = 180
            }

            // angle chart
            history.push(kneeAngle)
            if (history.length > 300) history.shift()

            chartCtx.clearRect(0, 0, chart.width, chart.height)
            chartCtx.strokeStyle = 'cyan'
            chartCtx.lineWidth = 3
            chartCtx.beginPath()
            for (let i = 0; i < history.length; i++) {
              const x = (i / 300) * chart.width
              const y = chart.height - (history[i] / 180) * chart.height
              if (i === 0) chartCtx.moveTo(x, y)
              else chartCtx.lineTo(x, y)
            }
            chartCtx.stroke()

            // skeleton: bones
            ctx.strokeStyle = 'cyan'
            ctx.lineWidth = 4
            for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
              ctx.beginPath()
              ctx.moveTo(landmarks[start].x * canvas.width, landmarks[start].y * canvas.height)
              ctx.lineTo(landmarks[end].x * canvas.width, landmarks[end].y * canvas.height)
              ctx.stroke()
            }

            // skeleton: joints
            for (const p of landmarks) {
              ctx.fillStyle = 'white'
              ctx.beginPath()
              ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
        requestAnimationFrame(loop)
      }
      loop()
    }
    start()

    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ display: 'block', width: '100%' }} />
          <canvas
            ref={canvasRef}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <canvas ref={chartRef} width={600} height={340} style={{ width: '100%', background: '#0a1630' }} />
        </div>
      </div>
      <p>Status: {status}</p>
      <p>Left knee: {knee.toFixed(0)}°</p>
      <p>Reps: {reps}</p>
      <p>{feedback}</p>
    </div>
  )
}

export default Camera