import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

type Point = { x: number; y: number }

function angle(a: Point, b: Point, c: Point) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let degrees = Math.abs((radians * 180) / Math.PI)
  if (degrees > 180) degrees = 360 - degrees
  return degrees
}

function Camera({ file, onRep }: { file: File | null; onRep: (line: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)
  const [knee, setKnee] = useState(0)
  const [reps, setReps] = useState(0)
  const [status, setStatus] = useState('Stand side-on with your whole body in view')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let model: PoseLandmarker | null = null
    let stopped = false

    async function start() {
      // video source: an uploaded file, or the live camera
      if (file) {
        if (videoRef.current) {
          videoRef.current.src = URL.createObjectURL(file)
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      }

      // pose model
      const vision = await FilesetResolver.forVisionTasks('/wasm')
      const landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
      })
      if (stopped) {
        landmarker.close()
        return
      }
      model = landmarker

      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      const chart = chartRef.current
      const chartCtx = chart?.getContext('2d')

      const history: number[] = []
      let stage = 'waiting'
      let repCount = 0
      let readyFrames = 0
      let frameCount = 0
      let lastTime = -1
      let startX = 0
      let startTorso = 0
      let minAngle = 180
      let maxLean = 0
      let minNeck = 180
      let side = 'left'

      function loop() {
        if (stopped || !video || !canvas || !ctx || !chart || !chartCtx) return
        if (video.readyState >= 2 && !video.ended && video.currentTime !== lastTime) {
          lastTime = video.currentTime
          const result = landmarker.detectForVideo(video, performance.now())
          const landmarks = result.landmarks[0]

          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height)

          if (landmarks) {
            const px = (i: number) => ({
              x: landmarks[i].x * canvas.width,
              y: landmarks[i].y * canvas.height,
            })
            const seen = (i: number) => (landmarks[i].visibility ?? 0) > 0.5
            const vis = (i: number) => landmarks[i].visibility ?? 0

            // while waiting, pick whichever side faces the camera
            if (stage === 'waiting') {
              side = vis(23) + vis(25) + vis(27) >= vis(24) + vis(26) + vis(28) ? 'left' : 'right'
            }

            const [ear, shoulder, hip, kneeJoint, ankle] =
              side === 'left' ? [7, 11, 23, 25, 27] : [8, 12, 24, 26, 28]
            // measurements, using whichever side faces the camera
            const kneeAngle = angle(px(hip), px(kneeJoint), px(ankle))
            const torso = Math.hypot(px(shoulder).x - px(hip).x, px(shoulder).y - px(hip).y)
            const lean =
              (Math.atan2(Math.abs(px(shoulder).x - px(hip).x), Math.abs(px(hip).y - px(shoulder).y)) * 180) /
              Math.PI
            const neck = angle(px(ear), px(shoulder), px(hip))

            frameCount = frameCount + 1
            if (frameCount % 30 === 0) {
              setKnee(kneeAngle)
            }

            // wait until the user is standing still in view
            if (stage === 'waiting') {
              if (seen(hip) && seen(kneeJoint) && seen(ankle) && kneeAngle > 160) {
                readyFrames = readyFrames + 1
              } else {
                readyFrames = 0
              }
              if (readyFrames > 30) {
                stage = 'up'
                startX = px(hip).x
                startTorso = torso
                setStatus('Ready. Start squatting')
              }
            }

            // pause if the user leaves their squat spot
            const moved = Math.abs(px(hip).x - startX) > startTorso
            const resized = Math.abs(torso - startTorso) > startTorso * 0.25

            if (stage !== 'waiting' && (moved || resized)) {
              stage = 'waiting'
              readyFrames = 0
              minAngle = 180
              maxLean = 0
              minNeck = 180
              setStatus('Paused. Get back into position')
            }

            // 1. standing → going down
            if (stage === 'up' && kneeAngle < 130) {
              stage = 'down'
            }

            // 2. while down, remember the worst value for each rule
            if (stage === 'down' && kneeAngle < minAngle) {
              minAngle = kneeAngle
            }
            if (stage === 'down' && lean > maxLean && seen(shoulder)) {
              maxLean = lean
            }
            if (stage === 'down' && neck < minNeck && seen(ear) && seen(shoulder)) {
              minNeck = neck
            }

            // 3. stood back up → count the rep and judge it
            if (stage === 'down' && kneeAngle > 160) {
              stage = 'up'
              repCount = repCount + 1
              setReps(repCount)

              const problems: string[] = []
              if (minAngle > 95) problems.push('Go lower next time')
              if (maxLean > 50) problems.push('Keep your chest up')
              if (minNeck < 140) problems.push('Keep your head in line with your back')

              const verdict = problems.length === 0 ? 'Good rep' : problems.join(' and ')
              const line = `${verdict} (depth ${minAngle.toFixed(0)}°, lean ${maxLean.toFixed(0)}°, neck ${minNeck.toFixed(0)}°)`
              setFeedback(line)
              onRep(line)

              minAngle = 180
              maxLean = 0
              minNeck = 180
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
              ctx.moveTo(px(start).x, px(start).y)
              ctx.lineTo(px(end).x, px(end).y)
              ctx.stroke()
            }

            // skeleton: joints
            ctx.fillStyle = 'white'
            for (let i = 0; i < landmarks.length; i++) {
              ctx.beginPath()
              ctx.arc(px(i).x, px(i).y, 6, 0, Math.PI * 2)
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
      model?.close()
    }
  }, [file])

  const layer = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  } as const

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative', flex: 1, height: '70vh', background: 'black' }}>
          <video ref={videoRef} autoPlay playsInline muted style={layer} />
          <canvas ref={canvasRef} style={layer} />
        </div>
        <div style={{ flex: 1 }}>
          <canvas ref={chartRef} width={600} height={340} style={{ width: '100%', background: '#0a1630' }} />
        </div>
      </div>
      <p>Status: {status}</p>
      <p>Knee: {knee.toFixed(0)}°</p>
      <p>Reps: {reps}</p>
      <p>{feedback}</p>
    </div>
  )
}

export default Camera