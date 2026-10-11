import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

type Point = { x: number; y: number }

function angle(a: Point, b: Point, c: Point) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let degrees = Math.abs((radians * 180) / Math.PI)
  if (degrees > 180) degrees = 360 - degrees
  return degrees
}

// tilt of the line a→b away from vertical, in degrees
function tilt(a: Point, b: Point) {
  return (Math.atan2(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 180) / Math.PI
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
      let side = 'left'
      let repCount = 0
      let readyFrames = 0
      let frameCount = 0
      let lastTime = -1
      let startX = 0
      let startTorso = 0
      let startFoot = 0

      // smoothed measurements (remembered between frames)
      let smoothKnee = 180
      let smoothLean = 0
      let smoothNeck = 180
      let smoothFoot = 0
      let smoothBalance = 50
      let smoothKneePos = 50
      let smoothShin = 0

      // worst value of each measurement during the current rep
      let minAngle = 180
      let maxLean = 0
      let minNeck = 180
      let maxHeelLift = 0
      let maxBalance = 0
      let maxKneePos = 0
      let maxShin = 0

      function resetRep() {
        minAngle = 180
        maxLean = 0
        minNeck = 180
        maxHeelLift = 0
        maxBalance = 0
        maxKneePos = 0
        maxShin = 0
      }

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
            const vis = (i: number) => landmarks[i].visibility ?? 0
            const seen = (i: number) => vis(i) > 0.5
            const blend = (old: number, fresh: number) => old * 0.7 + fresh * 0.3

            // while waiting, pick whichever side faces the camera
            if (stage === 'waiting') {
              side = vis(23) + vis(25) + vis(27) >= vis(24) + vis(26) + vis(28) ? 'left' : 'right'
            }
            const [ear, shoulder, hip, kneeJoint, ankle, heel, toe] =
              side === 'left' ? [7, 11, 23, 25, 27, 29, 31] : [8, 12, 24, 26, 28, 30, 32]

            // measurements
            const torso = Math.hypot(px(shoulder).x - px(hip).x, px(shoulder).y - px(hip).y)

            smoothKnee = blend(smoothKnee, angle(px(hip), px(kneeJoint), px(ankle)))
            const kneeAngle = smoothKnee

            smoothLean = blend(smoothLean, tilt(px(shoulder), px(hip)))
            const lean = smoothLean

            smoothNeck = blend(smoothNeck, angle(px(ear), px(shoulder), px(hip)))
            const neck = smoothNeck

            // shin: how far the lower leg tips forward from vertical
            smoothShin = blend(smoothShin, tilt(px(kneeJoint), px(ankle)))
            const shin = smoothShin

            // heels: tilt of the heel→toe line, compared with standing
            const footTilt =
              (Math.atan2(px(toe).y - px(heel).y, Math.abs(px(toe).x - px(heel).x)) * 180) / Math.PI
            smoothFoot = blend(smoothFoot, footTilt)
            const heelLift = smoothFoot - startFoot

            // positions along the foot: 0% = above the heel, 100% = above the toes
            const footLength = px(toe).x - px(heel).x || 1
            const alongFoot = (x: number) => ((x - px(heel).x) / footLength) * 100
            const midX = (a: number, b: number) => (px(a).x + px(b).x) / 2

            // balance: rough centre of mass (trunk 60%, thigh 25%, lower leg 15%)
            const comX =
              0.6 * midX(shoulder, hip) + 0.25 * midX(hip, kneeJoint) + 0.15 * midX(kneeJoint, ankle)
            smoothBalance = blend(smoothBalance, alongFoot(comX))
            const balance = smoothBalance

            // knee: how far forward the knee is
            smoothKneePos = blend(smoothKneePos, alongFoot(px(kneeJoint).x))
            const kneePos = smoothKneePos

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
                startFoot = smoothFoot
                setStatus('Ready. Start squatting')
              }
            }

            // pause if the user leaves their squat spot
            const moved = Math.abs(px(hip).x - startX) > startTorso
            const resized = Math.abs(torso - startTorso) > startTorso * 0.25

            if (stage !== 'waiting' && (moved || resized)) {
              stage = 'waiting'
              readyFrames = 0
              resetRep()
              setStatus('Paused. Get back into position')
            }

            // 1. standing → going down
            if (stage === 'up' && kneeAngle < 130) {
              stage = 'down'
            }

            // 2. while down, remember the worst value of each measurement
            if (stage === 'down') {
              if (kneeAngle < minAngle) minAngle = kneeAngle
              if (shin > maxShin) maxShin = shin
              if (seen(shoulder) && lean > maxLean) maxLean = lean
              if (seen(ear) && seen(shoulder) && neck < minNeck) minNeck = neck
              if (seen(heel) && seen(toe)) {
                if (heelLift > maxHeelLift) maxHeelLift = heelLift
                if (balance > maxBalance) maxBalance = balance
                if (kneePos > maxKneePos) maxKneePos = kneePos
              }
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
              if (maxBalance > 50) problems.push('Sit back, your weight is on your toes')
              if (maxHeelLift > 8) problems.push('Keep your heels down')  
              const verdict = problems.length === 0 ? 'Good rep' : problems.join(' and ')
              const line = [
                verdict,
                `depth ${minAngle.toFixed(0)}°`,
                `lean ${maxLean.toFixed(0)}°`,
                `neck ${minNeck.toFixed(0)}°`,
                `heels ${maxHeelLift.toFixed(0)}°`,
                `balance ${maxBalance.toFixed(0)}%`,
                `knee ${maxKneePos.toFixed(0)}%`,
                `shin ${maxShin.toFixed(0)}°`,
              ].join(' | ')
              setFeedback(line)
              onRep(line)
              resetRep()
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