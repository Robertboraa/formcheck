import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { LEFT, RIGHT, shortCue, type Exercise, type Frame, type Joints, type Part, type Rep } from './exercises'

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

// which bones to colour for each body part, as pairs of landmark numbers
function bonesFor(part: Part, j: Joints): [number, number][] {
    switch (part) {
        case 'back':
            return [[j.shoulder, j.hip]]
        case 'hips':
            return [[j.shoulder, j.hip], [j.hip, j.knee], [j.knee, j.ankle]]
        case 'legs':
            return [[j.hip, j.knee], [j.knee, j.ankle]]
        case 'arms':
            return [[j.shoulder, j.elbow], [j.elbow, j.wrist]]
        case 'head':
            return [[j.ear, j.shoulder], [0, j.ear]]
        case 'feet':
            return [[j.ankle, j.heel], [j.heel, j.toe], [j.ankle, j.toe]]
    }
}

const GOOD = '#4ade80'
const BAD = '#f97316'

type Props = {
    file: File | null
    exercise: Exercise
    onRep: (rep: Rep) => void
    children?: ReactNode // shown under the live panel (the rep list)
}

function Camera({ file, exercise, onRep, children }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const chartRef = useRef<HTMLCanvasElement>(null)
    const [mainValue, setMainValue] = useState(0)
    const [reps, setReps] = useState(0)
    const [status, setStatus] = useState<'loading' | 'waiting' | 'ready' | 'paused'>('loading')
    const [lastRep, setLastRep] = useState<Rep | null>(null)
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
            setStatus('waiting')

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
            let top = 0 // highest main angle since the last rep (how far the user straightened)
            let bottom = 180 // lowest main angle in the current rep (how deep the user went)
            let startShoulderY = 0 // shoulder height at the ready position
            let lowestShoulderY = 0 // lowest the shoulder got in the current rep (bigger y = lower)

            // bones to colour after a rep (green = good rep, orange = where the fault is)
            let highlight: [number, number][] = []
            let highlightColour = GOOD
            let highlightUntil = 0

            // smoothed values (remembered between frames), the values at the ready
            // position, and the worst value of each measurement during the current rep
            const smooth: Record<string, number> = {}
            let baseline: Record<string, number> = {}
            let worst: Record<string, number | undefined> = {}

            // keep = how much of the previous value to keep (more = smoother but slower to react)
            function blend(key: string, value: number, keep = 0.7) {
                smooth[key] = key in smooth ? smooth[key] * keep + value * (1 - keep) : value
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
                        const main = blend('main', exercise.main(frame), 0.5) // lighter smoothing so fast reps aren't missed
                        const values: Record<string, number> = {}
                        for (const m of exercise.measures) {
                            let v = blend(m.key, m.get(frame))
                            if (m.fromBaseline) v = v - (baseline[m.key] ?? v)
                            if (m.abs) v = Math.abs(v)
                            values[m.key] = v
                        }
                        const shoulderY = blend('shoulderY', px(j.shoulder).y)
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
                                top = main
                                startShoulderY = shoulderY
                                setStatus('ready')
                                say('Ready')
                            }
                        }

                        // pause if the user leaves their spot
                        const moved = Math.abs(px(j.hip).x - startX) > startTorso
                        const resized = Math.abs(torso - startTorso) > startTorso * 0.25
                        // body far above the start height = climbed on (e.g. jumped onto the dip bars)
                        const climbed = startShoulderY - shoulderY > startTorso * 0.25
                        // body far below the start height with arms/legs straight = stepped off
                        const steppedOff = shoulderY - startShoulderY > startTorso * 0.3 && main > exercise.topAbove

                        if (stage !== 'waiting' && (moved || resized || climbed || steppedOff)) {
                            stage = 'waiting'
                            readyFrames = 0
                            worst = {}
                            setStatus('paused')
                            say('Paused')
                        }

                        // a rep is the main angle moving down by at least `range` from the top,
                        // then back up by at least `range` from the bottom, wherever those are

                        // 1. at the top: remember the highest point, start a rep once it drops far enough
                        if (stage === 'up') {
                            if (main > top) top = main
                            if (main < top - exercise.range) {
                                stage = 'down'
                                bottom = main
                                lowestShoulderY = shoulderY
                            }
                        }

                        // 2. going down: remember the lowest point and the worst value of each measurement
                        if (stage === 'down') {
                            if (main < bottom) bottom = main
                            if (shoulderY > lowestShoulderY) lowestShoulderY = shoulderY
                            for (const m of exercise.measures) {
                                if (m.needs && !allSeen(m.needs)) continue
                                const v = values[m.key]
                                const old = worst[m.key]
                                if (old === undefined || (m.worst === 'min' ? v < old : v > old)) {
                                    worst[m.key] = v
                                }
                            }
                        }

                        // 3. coming back up far enough → count the rep and judge it
                        // (the body must actually rise too, so straightening the arms while
                        // stepping down off the bars doesn't count as a rep)
                        const rose = lowestShoulderY - shoulderY > startTorso * 0.08
                        if (stage === 'down' && main > bottom + exercise.range && rose) {
                            stage = 'up'
                            repCount = repCount + 1
                            setReps(repCount)

                            // the first rep can start before the app has seen a full lockout, so skip that check
                            if (repCount > 1) worst.top = top
                            const faults = exercise.judge(worst)
                            const good = faults.length === 0
                            const numbers = exercise.measures.map((m) => {
                                const v = worst[m.key]
                                return { label: m.label, value: `${v === undefined ? '–' : v.toFixed(0)}${m.unit}` }
                            })
                            numbers.push({ label: 'top', value: `${top.toFixed(0)}°` })
                            const verdict = good ? 'Good rep' : faults.map((f) => f.text).join(' and ')
                            const rep: Rep = {
                                n: repCount,
                                good,
                                faults: faults.map((f) => f.text),
                                numbers,
                                bottom,
                                top,
                                line: [verdict, ...numbers.map((x) => `${x.label} ${x.value}`)].join(' | '),
                            }
                            setLastRep(rep)
                            onRep(rep)
                            const cue = good ? 'good' : shortCue(faults[0].text)
                            say(`${repCount}, ${cue}`)

                            // flash the video edge, show the cue big, and colour the body part at fault
                            setFlash(good ? 'good' : 'bad')
                            setBanner(good ? 'Good rep' : cue)
                            clearTimeout(flashTimer)
                            flashTimer = setTimeout(() => setFlash(null), 1500)
                            highlight = good
                                ? bonesFor('hips', j).concat(bonesFor('arms', j))
                                : faults.flatMap((f) => f.parts.flatMap((part) => bonesFor(part, j)))
                            highlightColour = good ? GOOD : BAD
                            highlightUntil = performance.now() + 1500
                            worst = {}
                            top = main
                        }

                        // angle chart
                        history.push(main)
                        if (history.length > 300) history.shift()

                        chartCtx.clearRect(0, 0, chart.width, chart.height)
                        // faint guide lines every 45°
                        chartCtx.strokeStyle = 'rgba(255,255,255,0.08)'
                        chartCtx.lineWidth = 1
                        for (const deg of [45, 90, 135]) {
                            const y = chart.height - (deg / 180) * chart.height
                            chartCtx.beginPath()
                            chartCtx.moveTo(0, y)
                            chartCtx.lineTo(chart.width, y)
                            chartCtx.stroke()
                        }
                        chartCtx.strokeStyle = GOOD
                        chartCtx.lineWidth = 3
                        chartCtx.lineJoin = 'round'
                        chartCtx.beginPath()
                        for (let i = 0; i < history.length; i++) {
                            const x = (i / 300) * chart.width
                            const y = chart.height - (history[i] / 180) * chart.height
                            if (i === 0) chartCtx.moveTo(x, y)
                            else chartCtx.lineTo(x, y)
                        }
                        chartCtx.stroke()

                        // skeleton: bones
                        ctx.strokeStyle = 'rgba(255,255,255,0.75)'
                        ctx.lineWidth = 4
                        ctx.lineCap = 'round'
                        for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
                            ctx.beginPath()
                            ctx.moveTo(px(start).x, px(start).y)
                            ctx.lineTo(px(end).x, px(end).y)
                            ctx.stroke()
                        }

                        // skeleton: coloured bones after a rep
                        if (performance.now() < highlightUntil) {
                            ctx.strokeStyle = highlightColour
                            ctx.lineWidth = 12
                            for (const [a, b] of highlight) {
                                ctx.beginPath()
                                ctx.moveTo(px(a).x, px(a).y)
                                ctx.lineTo(px(b).x, px(b).y)
                                ctx.stroke()
                            }
                        }

                        // skeleton: joints
                        ctx.fillStyle = GOOD
                        for (let i = 0; i < landmarks.length; i++) {
                            ctx.beginPath()
                            ctx.arc(px(i).x, px(i).y, 5, 0, Math.PI * 2)
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

    const statusText = {
        loading: 'Loading the pose model…',
        waiting: 'Get into position, side-on, with your whole body in view',
        ready: exercise.readyText,
        paused: 'Paused. Get back into position',
    }[status]

    return (
        <div className="session-grid">
            <div className={`stage ${flash ?? ''}`}>
                <video ref={videoRef} autoPlay playsInline muted />
                <canvas ref={canvasRef} />

                {/* big rep counter and cue, readable from a few metres away */}
                <div className="counter">
                    <div className="counter-number">{reps}</div>
                    <div className="counter-label">reps</div>
                </div>
                {flash && <div className={`banner ${flash}`}>{banner}</div>}
                <div className={`status-pill ${status}`}>
                    <span className="dot" />
                    {statusText}
                </div>
            </div>

            <aside className="panel">
                <div className="card">
                    <div className="card-row">
                        <span className="label">{exercise.mainLabel} angle</span>
                        <span className="live-value">{mainValue.toFixed(0)}°</span>
                    </div>
                    <canvas ref={chartRef} width={600} height={220} className="chart" />
                </div>

                <div className="card">
                    <span className="label">Last rep</span>
                    {lastRep ? (
                        <>
                            <p className={`verdict ${lastRep.good ? 'good' : 'bad'}`}>
                                {lastRep.good ? 'Good rep' : lastRep.faults.map(shortCue).join(' · ')}
                            </p>
                            <div className="chips">
                                {lastRep.numbers.map((x) => (
                                    <span key={x.label} className="chip">
                                        {x.label} <b>{x.value}</b>
                                    </span>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="muted">Your first rep will show up here.</p>
                    )}
                </div>

                {children}
            </aside>
        </div>
    )
}

export default Camera
