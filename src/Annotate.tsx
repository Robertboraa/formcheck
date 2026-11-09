import { useEffect, useMemo, useRef, useState } from 'react'
import { download, frameTime, loadVideo, seek, toCsv } from './csv'

// Hand-marking joints on video frames. This is the ground truth for the joint-angle error
// and keypoint accuracy (PCK) of each pose model. Frames are numbered exactly like the batch
// evaluation (same frame rate), so score.py can line them up.

// the joints the rules use, in click order (for the side facing the camera)
const ORDER = ['nose', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const
type JointName = (typeof ORDER)[number]

type Mark = { x: number; y: number } | 'hidden'
type FrameMarks = { side: 'l' | 'r'; marks: Partial<Record<JointName, Mark>> }
type Store = Record<number, FrameMarks> // by frame number

const storeKey = (name: string) => `formcheck-annotate:${name}`

function loadStore(name: string): Store {
    try {
        return JSON.parse(localStorage.getItem(storeKey(name)) ?? '{}')
    } catch {
        return {}
    }
}

function saveStore(name: string, store: Store) {
    try {
        localStorage.setItem(storeKey(name), JSON.stringify(store))
    } catch {
        // storage unavailable: marks still live in memory until the CSV is saved
    }
}

function Annotate() {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [file, setFile] = useState<File | null>(null)
    const [fps, setFps] = useState(30)
    const [frames, setFrames] = useState(0)
    const [frame, setFrame] = useState(0)
    const [side, setSide] = useState<'l' | 'r'>('l')
    const [store, setStore] = useState<Store>({})
    const [size, setSize] = useState({ w: 0, h: 0 })

    const current = store[frame]
    const marks = useMemo(() => current?.marks ?? {}, [current])
    const next = ORDER.find((j) => !(j in marks))

    async function open(f: File) {
        const video = videoRef.current
        if (!video) return
        await loadVideo(video, f)
        setFile(f)
        setSize({ w: video.videoWidth, h: video.videoHeight })
        setFrames(Math.floor(video.duration * fps))
        setStore(loadStore(f.name))
        setFrame(0)
    }

    // show the chosen frame with the marks drawn on top
    useEffect(() => {
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!file || !video || !canvas || !ctx) return
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
    }, [file, frame, fps, marks])

    function update(newMarks: FrameMarks['marks'], newSide = current?.side ?? side) {
        if (!file) return
        const copy = { ...store }
        if (Object.keys(newMarks).length === 0) delete copy[frame]
        else copy[frame] = { side: newSide, marks: newMarks }
        setStore(copy)
        saveStore(file.name, copy)
    }

    function place(e: React.MouseEvent<HTMLCanvasElement>) {
        if (!next) return
        const canvas = e.currentTarget
        const box = canvas.getBoundingClientRect()
        const x = ((e.clientX - box.left) / box.width) * canvas.width
        const y = ((e.clientY - box.top) / box.height) * canvas.height
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

    // keyboard: ← → one frame, shift for ten, S = not visible, backspace = undo
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if ((e.target as HTMLElement).tagName === 'INPUT') return
            if (e.key === 'ArrowRight') go(e.shiftKey ? 10 : 1)
            else if (e.key === 'ArrowLeft') go(e.shiftKey ? -10 : -1)
            else if (e.key === 's' || e.key === 'S') skip()
            else if (e.key === 'Backspace') undo()
            else return
            e.preventDefault()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    function exportCsv() {
        if (!file) return
        const rows: Record<string, string | number>[] = []
        for (const [f, entry] of Object.entries(store)) {
            for (const j of ORDER) {
                const m = entry.marks[j]
                if (!m || m === 'hidden') continue
                rows.push({
                    video: file.name,
                    frame: Number(f),
                    time: Number(f) / fps,
                    width: size.w,
                    height: size.h,
                    side: entry.side,
                    joint: j === 'nose' ? 'nose' : `${entry.side}_${j}`,
                    x: m.x,
                    y: m.y,
                })
            }
        }
        rows.sort((a, b) => (a.frame as number) - (b.frame as number))
        download(`keypoints_${file.name.replace(/\.[^.]+$/, '')}.csv`, toCsv(rows))
    }

    const markedFrames = Object.keys(store)
        .map(Number)
        .sort((a, b) => a - b)

    return (
        <div className="research-grid">
            <section className="card research-controls">
                <span className="label">1. Video</span>
                <label className="btn">
                    {file ? 'Change video' : 'Choose a video'}
                    <input type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
                </label>
                {file && <p className="small">{file.name}</p>}
                <p className="muted small">
                    Frame rate (same as the batch run){' '}
                    <input
                        type="number"
                        className="num"
                        value={fps}
                        min={5}
                        max={60}
                        onChange={(e) => setFps(Number(e.target.value) || 30)}
                    />
                </p>

                <span className="label">2. Side facing the camera</span>
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

                <span className="label">3. Click the joints in order</span>
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

                <span className="label">4. Save</span>
                <p className="muted small">
                    {markedFrames.length} frames marked. Marks are kept in this browser while you work.
                </p>
                <button className="btn primary" onClick={exportCsv} disabled={markedFrames.length === 0}>
                    Download keypoints CSV
                </button>
                {markedFrames.length > 0 && (
                    <div className="chips">
                        {markedFrames.map((f) => (
                            <button key={f} className={`chip ${f === frame ? 'on' : ''}`} onClick={() => setFrame(f)}>
                                {f}
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <section className="card research-preview">
                <div className="research-stage annotate">
                    <video ref={videoRef} muted playsInline className="hidden-video" />
                    <canvas ref={canvasRef} onClick={place} className={next ? 'crosshair' : ''} />
                </div>
                {file ? (
                    <>
                        <div className="frame-bar">
                            <button className="btn" onClick={() => go(-10)}>
                                −10
                            </button>
                            <button className="btn" onClick={() => go(-1)}>
                                −1
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={Math.max(0, frames - 1)}
                                value={frame}
                                onChange={(e) => setFrame(Number(e.target.value))}
                            />
                            <button className="btn" onClick={() => go(1)}>
                                +1
                            </button>
                            <button className="btn" onClick={() => go(10)}>
                                +10
                            </button>
                        </div>
                        <p className="small">
                            Frame <b>{frame}</b> of {frames} · {(frame / fps).toFixed(2)} s
                        </p>
                    </>
                ) : (
                    <p className="muted small">
                        Pick frames at the top and the bottom of reps, about 3 per rep. Use ← → to move, Shift for 10
                        frames.
                    </p>
                )}
            </section>
        </div>
    )
}

export default Annotate
