import { useRef, useState } from 'react'
import { EXERCISES } from './exercises'
import { POSE_MODELS, loadPoseModel, type Landmark } from './pose'
import { JOINTS, clipInfo, download, exerciseFromName, frameTime, loadVideo, seek, toCsv } from './csv'

// Batch run: every chosen video through every chosen pose model, frame by frame. It saves where
// each model put each joint on every frame, and how long it took. The Compare tab measures those
// joints against the hand-marked ones.
//
// Every frame is processed (the video is stepped, not played), so a slower model never skips
// frames. The time per frame is measured around the model only, not the stepping.

// which side of the body faces the camera: the side whose joints the model sees more clearly
function sideOf(l: Landmark[] | undefined): 'l' | 'r' {
    if (!l) return 'l'
    const score = (ids: number[]) => ids.reduce((s, i) => s + (l[i]?.visibility ?? 0), 0)
    return score([11, 13, 15, 23, 25, 27]) >= score([12, 14, 16, 24, 26, 28]) ? 'l' : 'r'
}

type Row = Record<string, string | number | null>

type Progress = { video: string; model: string; frame: number; frames: number; done: number; total: number }

type Results = { frames: Row[]; runs: Row[] }

// onResults: hands a finished run to the Compare tab
function Evaluate({ onResults }: { onResults?: (r: Results) => void }) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const stopRef = useRef(false)
    const [files, setFiles] = useState<File[]>([])
    const [models, setModels] = useState<string[]>(['mediapipe-full', 'yolo11n'])
    const [fps, setFps] = useState(30)
    const [fallback, setFallback] = useState(EXERCISES[0].id)
    const [running, setRunning] = useState(false)
    const [progress, setProgress] = useState<Progress | null>(null)
    const [error, setError] = useState('')
    const [results, setResults] = useState<Results | null>(null)

    function toggleModel(id: string) {
        setModels((old) => (old.includes(id) ? old.filter((m) => m !== id) : [...old, id]))
    }

    async function run() {
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!video || !canvas || !ctx) return
        setRunning(true)
        setError('')
        setResults(null)
        stopRef.current = false
        const frames: Row[] = []
        const runs: Row[] = []
        let done = 0
        const total = files.length * models.length

        try {
            for (const modelId of models) {
                const model = await loadPoseModel(modelId)
                const has = new Set(model.points)
                for (const file of files) {
                    if (stopRef.current) break
                    const exerciseId = exerciseFromName(file.name) ?? fallback
                    await loadVideo(video, file)
                    const w = video.videoWidth
                    const h = video.videoHeight
                    canvas.width = w
                    canvas.height = h
                    const count = Math.floor(video.duration * fps)
                    let detectedFrames = 0
                    let totalMs = 0

                    for (let i = 0; i < count; i++) {
                        if (stopRef.current) break
                        await seek(video, frameTime(i, fps))
                        const time = i / fps
                        const result = await model.detect(video, time * 1000)
                        const detected = !!result.landmarks
                        totalMs += result.ms
                        if (detected) detectedFrames++

                        const row: Row = {
                            video: file.name,
                            exercise: exerciseId,
                            model: modelId,
                            frame: i,
                            time,
                            width: w,
                            height: h,
                            ms: result.ms,
                            detected: detected ? 1 : 0,
                            side: sideOf(result.landmarks),
                        }
                        for (const [name, index] of JOINTS) {
                            const l = result.landmarks?.[index]
                            row[`${name}_x`] = l ? l.x * w : null
                            row[`${name}_y`] = l ? l.y * h : null
                            row[`${name}_v`] = l ? l.visibility : null
                        }
                        frames.push(row)

                        // preview, a few times a second
                        if (i % 5 === 0) {
                            ctx.clearRect(0, 0, w, h)
                            const l = result.landmarks
                            if (l) {
                                ctx.strokeStyle = 'rgba(255,255,255,0.85)'
                                ctx.lineWidth = Math.max(3, w / 250)
                                for (const [a, b] of model.connections) {
                                    ctx.beginPath()
                                    ctx.moveTo(l[a].x * w, l[a].y * h)
                                    ctx.lineTo(l[b].x * w, l[b].y * h)
                                    ctx.stroke()
                                }
                                ctx.fillStyle = '#f5c518'
                                for (const p of has) {
                                    ctx.beginPath()
                                    ctx.arc(l[p].x * w, l[p].y * h, Math.max(4, w / 200), 0, Math.PI * 2)
                                    ctx.fill()
                                }
                            }
                            setProgress({ video: file.name, model: model.info.name, frame: i, frames: count, done, total })
                        }
                    }

                    runs.push({
                        video: file.name,
                        exercise: exerciseId,
                        model: modelId,
                        model_name: model.info.name,
                        backend: model.backend,
                        fps,
                        frames: count,
                        detected_frames: detectedFrames,
                        mean_ms: count ? totalMs / count : null,
                        width: w,
                        height: h,
                        browser: navigator.userAgent,
                        date: new Date().toISOString(),
                    })
                    done++
                }
                model.close()
            }
            setResults({ frames, runs })
            onResults?.({ frames, runs })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            if (runs.length) {
                setResults({ frames, runs })
                onResults?.({ frames, runs })
            }
        } finally {
            setRunning(false)
            setProgress(null)
        }
    }

    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

    return (
        <div className="research-grid">
            <section className="card research-controls">
                <span className="label">1. Videos</span>
                <label className="btn">
                    Choose videos
                    <input
                        type="file"
                        accept="video/*"
                        multiple
                        hidden
                        onChange={(e) => setFiles([...(e.target.files ?? [])])}
                    />
                </label>
                {files.length > 0 && (
                    <ul className="file-list">
                        {files.map((f) => (
                            <li key={f.name}>
                                <span>{f.name}</span>
                                <span className="muted">
                                    {exerciseFromName(f.name) ?? `${fallback}?`} · {clipInfo(f.name).condition}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="muted small">
                    The exercise and camera setup are read from the file name (squat / pushup, and side / diagonal /
                    dim / far). Files without an exercise use:{' '}
                    <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
                        {EXERCISES.map((x) => (
                            <option key={x.id} value={x.id}>
                                {x.name}
                            </option>
                        ))}
                    </select>
                </p>

                <span className="label">2. Pose models</span>
                <div className="model-checks">
                    {POSE_MODELS.map((m) => (
                        <label key={m.id} className="check">
                            <input type="checkbox" checked={models.includes(m.id)} onChange={() => toggleModel(m.id)} />
                            <span>
                                <b>{m.name}</b> <span className="muted">{m.note}</span>
                            </span>
                        </label>
                    ))}
                </div>

                <span className="label">3. Frame rate</span>
                <p className="muted small">
                    Frames per second to analyse. Use the rate you filmed at (30).{' '}
                    <input
                        type="number"
                        min={5}
                        max={60}
                        value={fps}
                        onChange={(e) => setFps(Number(e.target.value) || 30)}
                        className="num"
                    />
                </p>

                <div className="actions">
                    {running ? (
                        <button className="btn" onClick={() => (stopRef.current = true)}>
                            Stop
                        </button>
                    ) : (
                        <button
                            className="btn primary big"
                            disabled={files.length === 0 || models.length === 0}
                            onClick={run}
                        >
                            Run {files.length * models.length || ''} {files.length * models.length === 1 ? 'run' : 'runs'}
                        </button>
                    )}
                </div>
                {error && <p className="form-error">{error}</p>}

                {results && (
                    <div className="downloads">
                        <span className="label">4. Save the results</span>
                        <p className="muted small">
                            Already added to the Compare tab. Download both files too, so you can load them again after
                            a refresh or on another day.
                        </p>
                        <div className="actions">
                            <button className="btn primary" onClick={() => download(`frames_${stamp()}.csv`, toCsv(results.frames))}>
                                frames.csv ({results.frames.length})
                            </button>
                            <button className="btn" onClick={() => download(`runs_${stamp()}.csv`, toCsv(results.runs))}>
                                runs.csv
                            </button>
                        </div>
                        <table className="mini-table">
                            <thead>
                                <tr>
                                    <th>Video</th>
                                    <th>Model</th>
                                    <th>Found</th>
                                    <th>ms/frame</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.runs.map((r) => (
                                    <tr key={`${r.video}-${r.model}`}>
                                        <td>{r.video}</td>
                                        <td>{r.model_name}</td>
                                        <td>{Math.round(((r.detected_frames as number) / ((r.frames as number) || 1)) * 100)}%</td>
                                        <td>{(r.mean_ms as number)?.toFixed(1)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="card research-preview">
                <div className="research-stage">
                    <video ref={videoRef} muted playsInline />
                    <canvas ref={canvasRef} />
                </div>
                {progress ? (
                    <>
                        <p className="small">
                            <b>{progress.model}</b> · {progress.video} · frame {progress.frame + 1} of {progress.frames}
                        </p>
                        <div className="progress">
                            <div
                                style={{
                                    width: `${((progress.done + progress.frame / Math.max(progress.frames, 1)) / progress.total) * 100}%`,
                                }}
                            />
                        </div>
                        <p className="muted small">
                            Run {progress.done + 1} of {progress.total}. Keep this tab open and in front.
                        </p>
                    </>
                ) : (
                    <p className="muted small">The video being analysed shows here, with the skeleton the model sees.</p>
                )}
            </section>
        </div>
    )
}

export default Evaluate
