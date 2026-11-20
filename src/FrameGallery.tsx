import { useEffect, useRef, useState } from 'react'
import { JOINTS, frameTime, loadVideo, seek } from './csv'
import type { Dataset } from './compare/data'
import { modelName, type WorstFrame } from './compare/metrics'

// Pictures of the frames where each model was furthest from the hand marks: your marks in green,
// the model's joints in its colour. Videos aren't saved, so you choose the clips again to see them.

const FPS = 30
const TRUTH = '#16a34a' // green: no model uses it
const BONES: [string, string][] = [
    ['shoulder', 'elbow'],
    ['elbow', 'wrist'],
    ['shoulder', 'hip'],
    ['hip', 'knee'],
    ['knee', 'ankle'],
    ['ear', 'shoulder'],
]

type Props = { data: Dataset; worst: WorstFrame[]; models: string[]; colours: Record<string, string> }

function FrameGallery({ data, worst, models, colours }: Props) {
    const colour = (m: string) => colours[m] ?? '#1e4fa8'
    const palette = JSON.stringify(colours)
    const videoRef = useRef<HTMLVideoElement>(null)
    const [files, setFiles] = useState<Map<string, File>>(new Map())
    const [images, setImages] = useState<Map<string, string>>(new Map())
    const [busy, setBusy] = useState(false)
    const needed = [...new Set(worst.map((w) => w.video))]
    const missing = needed.filter((v) => !files.has(v))

    // draw every worst frame we have the clip for
    useEffect(() => {
        const video = videoRef.current
        if (!video || !files.size) return
        let cancelled = false
        async function draw() {
            setBusy(true)
            const out = new Map<string, string>()
            for (const [name, file] of files) {
                const todo = worst.filter((w) => w.video === name)
                if (!todo.length || !video) continue
                await loadVideo(video, file)
                for (const w of todo) {
                    if (cancelled) return
                    await seek(video, frameTime(w.frame, FPS))
                    const url = render(video, data, w, (JSON.parse(palette) as Record<string, string>)[w.model] ?? '#1e4fa8')
                    if (url) out.set(key(w), url)
                }
            }
            if (!cancelled) {
                setImages(out)
                setBusy(false)
            }
        }
        draw()
        return () => {
            cancelled = true
        }
    }, [files, worst, data, palette])

    if (!worst.length) return null

    return (
        <section className="card compare-section">
            <h3>Worst frames for each model</h3>
            <p className="muted">
                The marked frames where each model was furthest from your marks. <span style={{ color: '#16a34a', fontWeight: 700 }}>Green</span> = your
                marks, the model's colour = where it put the joints. Good for a "where it goes wrong" figure in the paper: click a picture to download it.
            </p>
            <div className="actions">
                <label className="btn">
                    {files.size ? 'Add more clips' : 'Choose the clips to show the pictures'}
                    <input
                        type="file"
                        accept="video/*"
                        multiple
                        hidden
                        onChange={(e) => {
                            const next = new Map(files)
                            for (const f of e.target.files ?? []) if (needed.includes(f.name)) next.set(f.name, f)
                            setFiles(next)
                            e.target.value = ''
                        }}
                    />
                </label>
                {busy && <span className="muted small">Drawing the frames…</span>}
            </div>
            {missing.length > 0 && files.size > 0 && <p className="muted small">Still needed: {missing.join(', ')}</p>}
            {files.size === 0 && <p className="muted small">Clips needed: {needed.join(', ')}</p>}
            {models.map((m) => {
                const ws = worst.filter((w) => w.model === m)
                if (!ws.length) return null
                return (
                    <div key={m} className="gallery-row">
                        <b style={{ color: colour(m) }}>{modelName(m)}</b>
                        <div className="gallery">
                            {ws.map((w) => {
                                const url = images.get(key(w))
                                return (
                                    <figure key={key(w)} className="gallery-item">
                                        {url ? (
                                            <a href={url} download={`worst_${m}_${w.video.replace(/\.[^.]+$/, '')}_f${w.frame}.png`}>
                                                <img src={url} alt={`${modelName(m)} on ${w.video}, frame ${w.frame}`} />
                                            </a>
                                        ) : (
                                            <div className="gallery-empty">{files.has(w.video) ? '…' : 'choose this clip'}</div>
                                        )}
                                        <figcaption>
                                            <b>{w.err.toFixed(1)}°</b> mean error · {w.worstAngle} off by {w.worstErr.toFixed(0)}°
                                            <br />
                                            <span className="muted">
                                                {w.video} · frame {w.frame}
                                            </span>
                                        </figcaption>
                                    </figure>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
            <video ref={videoRef} muted playsInline className="offscreen-video" />
        </section>
    )
}

const key = (w: WorstFrame) => `${w.model}|${w.video}|${w.frame}`

// the frame, cropped around the person, with the hand marks and the model's joints drawn on
function render(video: HTMLVideoElement, data: Dataset, w: WorstFrame, colour: string) {
    const marks = data.keypoints.filter((k) => k.video === w.video && k.frame === w.frame && Number.isFinite(k.x))
    const frame = data.frames.find((f) => f.video === w.video && f.frame === w.frame && f.model === w.model)
    if (!marks.length || !frame) return null
    const base = (j: string) => j.replace(/^[lr]_/, '')
    const truth = new Map(marks.map((k) => [base(k.joint), [k.x, k.y] as [number, number]]))
    const model = new Map<string, [number, number]>()
    for (const j of ['nose', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
        const name = j === 'nose' ? 'nose' : `${w.side}_${j}`
        const i = JOINTS.findIndex(([n]) => n === name)
        const x = frame.pts[i * 3]
        const y = frame.pts[i * 3 + 1]
        if (frame.detected && Number.isFinite(x) && Number.isFinite(y)) model.set(j, [x, y])
    }

    // crop: a box around both sets of points, with a margin
    const all = [...truth.values(), ...model.values()]
    const xs = all.map((p) => p[0])
    const ys = all.map((p) => p[1])
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.18
    const x0 = Math.max(0, Math.min(...xs) - pad)
    const y0 = Math.max(0, Math.min(...ys) - pad)
    const x1 = Math.min(video.videoWidth, Math.max(...xs) + pad)
    const y1 = Math.min(video.videoHeight, Math.max(...ys) + pad)
    const scale = 420 / Math.max(x1 - x0, y1 - y0)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((x1 - x0) * scale)
    canvas.height = Math.round((y1 - y0) * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height)
    const at = (p: [number, number]) => [(p[0] - x0) * scale, (p[1] - y0) * scale] as const

    function skeleton(points: Map<string, [number, number]>, c: string, width: number, r: number) {
        ctx.strokeStyle = c
        ctx.fillStyle = c
        ctx.lineWidth = width
        ctx.lineCap = 'round'
        for (const [a, b] of BONES) {
            const pa = points.get(a)
            const pb = points.get(b)
            if (!pa || !pb) continue
            ctx.beginPath()
            ctx.moveTo(...at(pa))
            ctx.lineTo(...at(pb))
            ctx.stroke()
        }
        for (const p of points.values()) {
            ctx.beginPath()
            ctx.arc(...at(p), r, 0, Math.PI * 2)
            ctx.fill()
        }
    }
    skeleton(truth, TRUTH, 5, 6)
    skeleton(model, colour, 3, 4.5)
    return canvas.toDataURL('image/png')
}

export default FrameGallery
