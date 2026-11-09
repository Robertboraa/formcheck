import { useEffect, useRef, useState, type ReactNode } from 'react'
import { kindOf, shortCue, verdictOf, type Exercise, type Joints, type Part, type Rep } from './exercises'
import { createEngine } from './engine'
import { loadPoseModel, modelInfo, type PoseModel } from './pose'

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

// overlay colours, brighter versions of the plate colours so they read on video
const GOOD = '#5b93ff'
const PERFECT = '#f5c518'
const BAD = '#ff5747'

type Props = {
    file: File | null
    exercise: Exercise
    onRep: (rep: Rep) => void
    modelId: string // which pose model to use (pose.ts)
    children?: ReactNode // shown under the live panel (the rep list)
}

function Camera({ file, exercise, onRep, modelId, children }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const chartRef = useRef<HTMLCanvasElement>(null)
    const [mainValue, setMainValue] = useState(0)
    const [reps, setReps] = useState(0)
    const [status, setStatus] = useState<'loading' | 'waiting' | 'ready' | 'paused'>('loading')
    const [lastRep, setLastRep] = useState<Rep | null>(null)
    const [flash, setFlash] = useState<'perfect' | 'good' | 'bad' | null>(null)
    const [banner, setBanner] = useState('')

    useEffect(() => {
        let stream: MediaStream | null = null
        let model: PoseModel | null = null
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

            // pose model (MediaPipe or YOLO, picked on the start screen)
            const loaded = await loadPoseModel(modelId)
            if (stopped) {
                loaded.close()
                return
            }
            model = loaded
            setStatus('waiting')

            const video = videoRef.current
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            const chart = chartRef.current
            const chartCtx = chart?.getContext('2d')

            // the rep counter and form rules (engine.ts)
            const engine = createEngine(exercise, { fromFile: !!file })
            const history: number[] = []
            let frameCount = 0
            let lastTime = -1
            let busy = false

            // bones to colour after a rep (blue = good, yellow = perfect, red = where the fault is)
            let highlight: [number, number][] = []
            let highlightColour = GOOD
            let highlightUntil = 0

            async function processFrame() {
                if (!video || !canvas || !ctx || !chart || !chartCtx || !model) return
                lastTime = video.currentTime
                const time = file ? video.currentTime : performance.now() / 1000
                const result = await model.detect(video, performance.now())
                if (stopped) return
                const landmarks = result.landmarks

                if (canvas.width !== video.videoWidth) {
                    canvas.width = video.videoWidth
                    canvas.height = video.videoHeight
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                if (!landmarks) return

                const out = engine.step(landmarks, canvas.width, canvas.height, time)
                const j = out.joints
                const main = out.main ?? 0
                const px = (i: number) => ({
                    x: landmarks[i].x * canvas.width,
                    y: landmarks[i].y * canvas.height,
                })

                frameCount = frameCount + 1
                if (frameCount % 10 === 0) {
                    setMainValue(main)
                }

                if (out.status === 'ready') {
                    setStatus('ready')
                    say('Ready')
                }
                if (out.status === 'paused') {
                    setStatus('paused')
                    say('Paused')
                }

                const rep = out.rep
                if (rep) {
                    const { good, perfect, faultList: faults } = rep
                    setReps(rep.n)
                    setLastRep(rep)
                    onRep(rep)
                    const verdict = perfect ? 'Perfect rep' : good ? 'Good rep' : rep.faults.join(' and ')
                    const cue = perfect ? 'perfect' : good ? 'good' : shortCue(faults[0].text)
                    say(`${rep.n}, ${cue}`)

                    // flash the video edge, show the cue big, and colour the body part at fault
                    setFlash(perfect ? 'perfect' : good ? 'good' : 'bad')
                    setBanner(good ? verdict : cue)
                    clearTimeout(flashTimer)
                    flashTimer = setTimeout(() => setFlash(null), 1500)
                    highlight = good
                        ? bonesFor('hips', j).concat(bonesFor('arms', j))
                        : faults.flatMap((f) => f.parts.flatMap((part) => bonesFor(part, j)))
                    highlightColour = perfect ? PERFECT : good ? GOOD : BAD
                    highlightUntil = performance.now() + 1500
                }

                // angle chart
                history.push(main)
                if (history.length > 300) history.shift()

                chartCtx.clearRect(0, 0, chart.width, chart.height)
                // faint guide lines every 45°
                chartCtx.strokeStyle = 'rgba(23,32,46,0.12)'
                chartCtx.lineWidth = 1
                for (const deg of [45, 90, 135]) {
                    const y = chart.height - (deg / 180) * chart.height
                    chartCtx.beginPath()
                    chartCtx.moveTo(0, y)
                    chartCtx.lineTo(chart.width, y)
                    chartCtx.stroke()
                }
                chartCtx.strokeStyle = '#1e4fa8'
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

                // skeleton: bones (only the points this model gives)
                const has = new Set(model.points)
                ctx.strokeStyle = 'rgba(255,255,255,0.75)'
                ctx.lineWidth = 4
                ctx.lineCap = 'round'
                for (const [a, b] of model.connections) {
                    ctx.beginPath()
                    ctx.moveTo(px(a).x, px(a).y)
                    ctx.lineTo(px(b).x, px(b).y)
                    ctx.stroke()
                }

                // skeleton: coloured bones after a rep
                if (performance.now() < highlightUntil) {
                    ctx.strokeStyle = highlightColour
                    ctx.lineWidth = 12
                    for (const [a, b] of highlight) {
                        if (!has.has(a) || !has.has(b)) continue
                        ctx.beginPath()
                        ctx.moveTo(px(a).x, px(a).y)
                        ctx.lineTo(px(b).x, px(b).y)
                        ctx.stroke()
                    }
                }

                // skeleton: joints
                ctx.fillStyle = '#ffffff'
                for (const i of model.points) {
                    ctx.beginPath()
                    ctx.arc(px(i).x, px(i).y, 5, 0, Math.PI * 2)
                    ctx.fill()
                }
            }

            function loop() {
                if (stopped || !video) return
                if (!busy && video.readyState >= 2 && !video.ended && video.currentTime !== lastTime) {
                    busy = true
                    processFrame().finally(() => {
                        busy = false
                    })
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
    }, [file, exercise, onRep, modelId])

    const statusText = {
        loading: `Loading ${modelInfo(modelId).name}…`,
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
                            <p className={`verdict ${kindOf(lastRep)}`}>
                                {verdictOf(lastRep)}
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
