import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { frameTime, loadVideo, seek } from './csv'
import type { KeypointRow } from './compare/data'

// Clicking joints on video frames by hand: the ground truth the pose models are measured against.
// Frames are numbered exactly like the model runs (same frame rate), so they line up.

// the joints the rules use, in click order (for the side facing the camera)
const ORDER = ['nose', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const
type JointName = (typeof ORDER)[number]

type Mark = { x: number; y: number } | 'hidden'
type FrameMarks = { side: 'l' | 'r'; marks: Partial<Record<JointName, Mark>> }
type Store = Record<number, FrameMarks> // by frame number

const base = (joint: string) => joint.replace(/^[lr]_/, '') as JointName

function toStore(rows: KeypointRow[]): Store {
    const store: Store = {}
    for (const r of rows) {
        const entry = (store[r.frame] ??= { side: r.side, marks: {} })
        entry.marks[base(r.joint)] = Number.isFinite(r.x) && Number.isFinite(r.y) ? { x: r.x, y: r.y } : 'hidden'
    }
    return store
}

function toRows(video: string, store: Store): KeypointRow[] {
    const rows: KeypointRow[] = []
    for (const [f, entry] of Object.entries(store)) {
        for (const j of ORDER) {
            const m = entry.marks[j]
            if (!m) continue
            const joint = j === 'nose' ? 'nose' : `${entry.side}_${j}`
            rows.push({ video, frame: Number(f), side: entry.side, joint, x: m === 'hidden' ? NaN : m.x, y: m === 'hidden' ? NaN : m.y })
        }
    }
    return rows.sort((a, b) => a.frame - b.frame)
}

type Props = {
    file: File
    fps: number
    marks: KeypointRow[] // this clip's marks
    onChange: (rows: KeypointRow[]) => void
    suggestions?: number[] // frames worth marking (top, halfway down and bottom of reps)
    defaultSide?: 'l' | 'r'
    top?: ReactNode // shown at the top of the controls column
    bottom?: ReactNode // shown at the bottom of the controls column
}

function JointMarker({ file, fps, marks: rows, onChange, suggestions = [], defaultSide = 'l', top, bottom }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [ready, setReady] = useState(false)
    const [frames, setFrames] = useState(0)
    const [frame, setFrame] = useState(suggestions[0] ?? 0)
    const [side, setSide] = useState<'l' | 'r'>(defaultSide)

    const store = useMemo(() => toStore(rows), [rows])
    const current = store[frame]
    const marks = useMemo(() => current?.marks ?? {}, [current])
    const next = ORDER.find((j) => !(j in marks))
    const complete = (f: number) => Object.keys(store[f]?.marks ?? {}).length >= ORDER.length
    const nextSuggestion = suggestions.find((f) => !complete(f) && f !== frame) ?? null

    useEffect(() => setSide(defaultSide), [defaultSide])

    // open the clip
    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        let cancelled = false
        setReady(false)
        loadVideo(video, file).then(() => {
            if (cancelled) return
            setFrames(Math.floor(video.duration * fps))
            setReady(true)
        })
        return () => {
            cancelled = true
        }
    }, [file, fps])

    useEffect(() => {
        if (suggestions.length) setFrame((f) => (suggestions.includes(f) ? f : (suggestions.find((s) => !complete(s)) ?? suggestions[0])))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [suggestions])

    // show the chosen frame with the marks drawn on top
    useEffect(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!ready || !video || !canvas || !ctx) return
        let cancelled = false
        seek(video, frameTime(frame, fps)).then(() => {
            if (cancelled) return
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0)
            const r = Math.max(6, canvas.width / 110)
            ctx.font = `${Math.round(r * 2.6)}px Archivo, sans-serif`
            ctx.lineWidth = Math.max(2, r / 2.5)
            for (const j of ORDER) {
                const m = marks[j]
                if (!m || m === 'hidden') continue
                ctx.fillStyle = '#f5c518'
                ctx.strokeStyle = '#17202e'
                ctx.beginPath()
                ctx.arc(m.x, m.y, r, 0, Math.PI * 2)
                ctx.fill()
                ctx.stroke()
                ctx.fillStyle = '#ffffff'
                ctx.strokeText(j, m.x + r * 1.6, m.y + r * 0.8)
                ctx.fillText(j, m.x + r * 1.6, m.y + r * 0.8)
            }
        })
        return () => {
            cancelled = true
        }
    }, [ready, frame, fps, marks])

    function update(newMarks: FrameMarks['marks'], newSide = current?.side ?? side) {
        const copy = { ...store }
        if (Object.keys(newMarks).length === 0) delete copy[frame]
        else copy[frame] = { side: newSide, marks: newMarks }
        onChange(toRows(file.name, copy))
        // frame finished: move on to the next suggested frame
        if (Object.keys(newMarks).length >= ORDER.length && nextSuggestion !== null) setTimeout(() => setFrame(nextSuggestion), 350)
    }

    function place(e: React.MouseEvent<HTMLCanvasElement>) {
        if (!next) return
        const canvas = e.currentTarget
        const box = canvas.getBoundingClientRect()
        // the canvas keeps the video's shape inside its box (object-fit: contain)
        const scale = Math.min(box.width / canvas.width, box.height / canvas.height)
        const offX = (box.width - canvas.width * scale) / 2
        const offY = (box.height - canvas.height * scale) / 2
        const x = (e.clientX - box.left - offX) / scale
        const y = (e.clientY - box.top - offY) / scale
        if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return
        update({ ...marks, [next]: { x, y } })
    }

    function skip() {
        if (next) update({ ...marks, [next]: 'hidden' })
    }

    function undo() {
        const placed = ORDER.filter((j) => j in marks)
        const last = placed[placed.length - 1]
        if (!last) return
        const copy = { ...marks }
        delete copy[last]
        update(copy)
    }

    function go(delta: number) {
        setFrame((f) => Math.min(Math.max(0, f + delta), Math.max(0, frames - 1)))
    }

    // keyboard: ← → one frame, shift for ten, S = not visible, backspace = undo, N = next suggested frame
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'SELECT') return
            if (e.key === 'ArrowRight') go(e.shiftKey ? 10 : 1)
            else if (e.key === 'ArrowLeft') go(e.shiftKey ? -10 : -1)
            else if (e.key === 's' || e.key === 'S') skip()
            else if (e.key === 'Backspace') undo()
            else if ((e.key === 'n' || e.key === 'N') && nextSuggestion !== null) setFrame(nextSuggestion)
            else return
            e.preventDefault()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const markedFrames = Object.keys(store)
        .map(Number)
        .sort((a, b) => a - b)
    const doneSuggested = suggestions.filter(complete).length

    return (
        <div className="research-grid">
            <section className="card research-controls">
                {top}

                {suggestions.length > 0 && (
                    <>
                        <span className="label">
                            Frames to mark · {doneSuggested} of {suggestions.length} done
                        </span>
                        <p className="muted small">The top, halfway down and bottom of the first reps. Finish a frame and the next one opens.</p>
                        <div className="chips">
                            {suggestions.map((f) => (
                                <button key={f} className={`chip ${f === frame ? 'on' : ''} ${complete(f) ? 'done' : ''}`} onClick={() => setFrame(f)}>
                                    {complete(f) ? '✓ ' : ''}
                                    {f}
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <span className="label">Side facing the camera</span>
                <div className="segmented">
                    {(['l', 'r'] as const).map((s) => (
                        <button
                            key={s}
                            className={(current?.side ?? side) === s ? 'selected' : ''}
                            onClick={() => {
                                setSide(s)
                                if (current) update(current.marks, s)
                            }}
                        >
                            {s === 'l' ? 'Left side' : 'Right side'}
                        </button>
                    ))}
                </div>

                <span className="label">Click the joints in order</span>
                <ol className="joint-order">
                    {ORDER.map((j) => (
                        <li key={j} className={j === next ? 'next' : marks[j] ? 'done' : ''}>
                            {j}
                            {marks[j] === 'hidden' && <span className="muted"> (not visible)</span>}
                        </li>
                    ))}
                </ol>
                <div className="actions">
                    <button className="btn" onClick={skip} disabled={!next}>
                        Not visible (S)
                    </button>
                    <button className="btn" onClick={undo}>
                        Undo (⌫)
                    </button>
                    <button className="btn" onClick={() => update({})} disabled={!current}>
                        Clear frame
                    </button>
                </div>

                {markedFrames.some((f) => !suggestions.includes(f)) && (
                    <>
                        <span className="label">Other marked frames</span>
                        <div className="chips">
                            {markedFrames
                                .filter((f) => !suggestions.includes(f))
                                .map((f) => (
                                    <button key={f} className={`chip ${f === frame ? 'on' : ''}`} onClick={() => setFrame(f)}>
                                        {f}
                                    </button>
                                ))}
                        </div>
                    </>
                )}

                {bottom}
            </section>

            <section className="card research-preview">
                <div className="research-stage annotate">
                    <video ref={videoRef} muted playsInline className="hidden-video" />
                    <canvas ref={canvasRef} onClick={place} className={next ? 'crosshair' : ''} />
                </div>
                <div className="frame-bar">
                    <button className="btn" onClick={() => go(-10)}>
                        −10
                    </button>
                    <button className="btn" onClick={() => go(-1)}>
                        −1
                    </button>
                    <input type="range" min={0} max={Math.max(0, frames - 1)} value={frame} onChange={(e) => setFrame(Number(e.target.value))} />
                    <button className="btn" onClick={() => go(1)}>
                        +1
                    </button>
                    <button className="btn" onClick={() => go(10)}>
                        +10
                    </button>
                </div>
                <p className="small">
                    Frame <b>{frame}</b> of {frames} · {(frame / fps).toFixed(2)} s
                    {nextSuggestion !== null && (
                        <>
                            {' · '}
                            <button className="link" onClick={() => setFrame(nextSuggestion)}>
                                Next frame to mark (N)
                            </button>
                        </>
                    )}
                </p>
                <p className="muted small">Click the centre of each joint. ← → one frame, Shift for ten.</p>
            </section>
        </div>
    )
}

export default JointMarker
