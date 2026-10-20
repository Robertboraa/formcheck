import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { LEFT, RIGHT, type Exercise, type Frame } from './exercises'
// pick a British English voice once the browser has loaded its voice list
let britishVoice: SpeechSynthesisVoice | undefined

function pickVoice() {
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Google UK English Male', 'Daniel (Premium)', 'Daniel (Enhanced)', 'Daniel']
    britishVoice =
        preferred.map((name) => voices.find((v) => v.name === name)).find(Boolean) ??
        voices.find((v) => v.lang === 'en-GB') ??
        voices.find((v) => v.lang.startsWith('en'))
}

if ('speechSynthesis' in window) {
    pickVoice()
    window.speechSynthesis.onvoiceschanged = pickVoice
}

// speaks a short cue out loud, cutting off anything still being said
function say(text: string) {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-GB'
    if (britishVoice) utterance.voice = britishVoice
    utterance.rate = 1.1
    window.speechSynthesis.speak(utterance)
}

type Props = {
    file: File | null
    exercise: Exercise
    onRep: (line: string) => void
}

function Camera({ file, exercise, onRep }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const chartRef = useRef<HTMLCanvasElement>(null)
    const [mainValue, setMainValue] = useState(0)
    const [reps, setReps] = useState(0)
    const [status, setStatus] = useState('Get into position, side-on, with your whole body in view')
    const [feedback, setFeedback] = useState('')
    const [flash, setFlash] = useState<'good' | 'bad' | null>(null)
    const [banner, setBanner] = useState('')

    useEffect(() => {
        let stream: MediaStream | null = null
        let model: PoseLandmarker | null = null
        let stopped = false
        let flashTimer: ReturnType<typeof setTimeout> | undefined

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
            let joints = LEFT
            let repCount = 0
            let readyFrames = 0
            let frameCount = 0
            let lastTime = -1
            let startX = 0
            let startTorso = 0

            // smoothed values (remembered between frames), the values at the ready
            // position, and the worst value of each measurement during the current rep
            const smooth: Record<string, number> = {}
            let baseline: Record<string, number> = {}
            let worst: Record<string, number | undefined> = {}

            function blend(key: string, value: number) {
                smooth[key] = key in smooth ? smooth[key] * 0.7 + value * 0.3 : value
                return smooth[key]
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

                        // while waiting, pick whichever side faces the camera
                        if (stage === 'waiting') {
                            const score = (s: typeof LEFT) =>
                                vis(s.shoulder) + vis(s.elbow) + vis(s.wrist) + vis(s.hip) + vis(s.knee) + vis(s.ankle)
                            joints = score(LEFT) >= score(RIGHT) ? LEFT : RIGHT
                        }
                        const j = joints
                        const frame: Frame = { p: px, j }
                        const allSeen = (names: (keyof typeof j)[]) => names.every((name) => seen(j[name]))

                        // measurements
                        const main = blend('main', exercise.main(frame))
                        const values: Record<string, number> = {}
                        for (const m of exercise.measures) {
                            let v = blend(m.key, m.get(frame))
                            if (m.fromBaseline) v = v - (baseline[m.key] ?? v)
                            if (m.abs) v = Math.abs(v)
                            values[m.key] = v
                        }
                        const torso = Math.hypot(px(j.shoulder).x - px(j.hip).x, px(j.shoulder).y - px(j.hip).y)

                        frameCount = frameCount + 1
                        if (frameCount % 10 === 0) {
                            setMainValue(main)
                        }

                        // wait until the user is holding the start position in view
                        if (stage === 'waiting') {
                            if (allSeen(exercise.mainNeeds) && main > exercise.topAbove) {
                                readyFrames = readyFrames + 1
                            } else {
                                readyFrames = 0
                            }
                            if (readyFrames > (file ? 5 : 30)) {
                                stage = 'up'
                                startX = px(j.hip).x
                                startTorso = torso
                                baseline = { ...smooth }
                                setStatus(exercise.readyText)
                                say('Ready')
                            }
                        }

                        // pause if the user leaves their spot
                        const moved = Math.abs(px(j.hip).x - startX) > startTorso
                        const resized = Math.abs(torso - startTorso) > startTorso * 0.25

                        if (stage !== 'waiting' && (moved || resized)) {
                            stage = 'waiting'
                            readyFrames = 0
                            worst = {}
                            setStatus('Paused. Get back into position')
                            say('Paused')
                        }

                        // 1. top → going down
                        if (stage === 'up' && main < exercise.downBelow) {
                            stage = 'down'
                        }

                        // 2. while down, remember the worst value of each measurement
                        if (stage === 'down') {
                            for (const m of exercise.measures) {
                                if (m.needs && !allSeen(m.needs)) continue
                                const v = values[m.key]
                                const old = worst[m.key]
                                if (old === undefined || (m.worst === 'min' ? v < old : v > old)) {
                                    worst[m.key] = v
                                }
                            }
                        }

                        // 3. back at the top → count the rep and judge it
                        if (stage === 'down' && main > exercise.topAbove) {
                            stage = 'up'
                            repCount = repCount + 1
                            setReps(repCount)

                            const problems = exercise.judge(worst)
                            const verdict = problems.length === 0 ? 'Good rep' : problems.join(' and ')
                            const numbers = exercise.measures.map((m) => {
                                const v = worst[m.key]
                                return `${m.label} ${v === undefined ? '–' : v.toFixed(0)}${m.unit}`
                            })
                            const line = [verdict, ...numbers].join(' | ')
                            setFeedback(line)
                            onRep(line)
                            const cue = problems.length === 0 ? 'good' : problems[0].split(/[.,]/)[0]
                            say(`${repCount}, ${cue}`)

                            // flash the video edge green or amber, and show the cue big
                            setFlash(problems.length === 0 ? 'good' : 'bad')
                            setBanner(problems.length === 0 ? 'Good rep' : cue)
                            clearTimeout(flashTimer)
                            flashTimer = setTimeout(() => setFlash(null), 1500)
                            worst = {}
                        }

                        // angle chart
                        history.push(main)
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
            window.speechSynthesis?.cancel()
            clearTimeout(flashTimer)
        }
    }, [file, exercise, onRep])

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
                <div
                    style={{
                        position: 'relative',
                        flex: 1,
                        height: '70vh',
                        background: 'black',
                        boxShadow: flash ? `inset 0 0 0 10px ${flash === 'good' ? '#22c55e' : '#f59e0b'}` : 'none',
                        transition: 'box-shadow 0.2s',
                    }}
                >
                    <video ref={videoRef} autoPlay playsInline muted style={layer} />
                    <canvas ref={canvasRef} style={layer} />

                    {/* big rep counter and cue, readable from a few metres away */}
                    <div style={{ position: 'absolute', top: 20, left: 24, color: 'white', textShadow: '0 2px 8px black' }}>
                        <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1 }}>{reps}</div>
                        {flash && (
                            <div
                                style={{
                                    marginTop: 8,
                                    fontSize: 28,
                                    fontWeight: 700,
                                    color: flash === 'good' ? '#22c55e' : '#f59e0b',
                                }}
                            >
                                {banner}
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ flex: 1 }}>
                    <canvas ref={chartRef} width={600} height={340} style={{ width: '100%', background: '#0a1630' }} />
                </div>
            </div>
            <p>Status: {status}</p>
            <p>
                {exercise.mainLabel}: {mainValue.toFixed(0)}°
            </p>
            <p>Reps: {reps}</p>
            <p>{feedback}</p>
        </div>
    )
}

export default Camera