import { useRef, useState } from 'react'
import { createEngine } from './engine'
import { EXERCISES } from './exercises'
import { POSE_MODELS, loadPoseModel } from './pose'
import { JOINTS, download, exerciseFromName, frameTime, loadVideo, seek, toCsv } from './csv'

// Batch evaluation: runs every chosen video through every chosen pose model, frame by frame,
// with the same rules (engine.ts), and saves what happened as CSV files for evaluation/score.py.
//
// Every frame is processed (the video is stepped, not played), so a slower model never skips
// frames. The time per frame is measured around the model only, not the stepping.

type Row = Record<string, string | number | null>

type Progress = { video: string; model: string; frame: number; frames: number; done: number; total: number }

function Evaluate() {
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
    const [results, setResults] = useState<{ reps: Row[]; frames: Row[]; runs: Row[] } | null>(null)

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
        const reps: Row[] = []
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
                    const exercise = EXERCISES.find((x) => x.id === exerciseId)!
                    await loadVideo(video, file)
                    const w = video.videoWidth
                    const h = video.videoHeight
                    canvas.width = w
                    canvas.height = h
                    const count = Math.floor(video.duration * fps)
                    const engine = createEngine(exercise, { fromFile: true })
                    let detectedFrames = 0
                    let totalMs = 0

                    for (let i = 0; i < count; i++) {
                        if (stopRef.current) break
                        await seek(video, frameTime(i, fps))
                        const time = i / fps
                        const result = await model.detect(video, time * 1000)
                        const out = engine.step(result.landmarks, w, h, time)
                        totalMs += result.ms
                        if (out.detected) detectedFrames++

                        const row: Row = {
                            video: file.name,
                            exercise: exerciseId,
                            model: modelId,
                            frame: i,
                            time,
                            width: w,
                            height: h,
                            ms: result.ms,
                            detected: out.detected ? 1 : 0,
                            side: out.joints.shoulder === 11 ? 'l' : 'r',
                            main_raw: out.rawMain,
                            main_smooth: out.main,
                            event: out.rep ? `rep ${out.rep.n}` : (out.status ?? ''),
                        }
                        for (const [name, index] of JOINTS) {
                            const l = result.landmarks?.[index]
                            row[`${name}_x`] = l ? l.x * w : null
                            row[`${name}_y`] = l ? l.y * h : null
                            row[`${name}_v`] = l ? l.visibility : null
                        }
                        frames.push(row)

                        // preview, a few times a second
                        if (i % 5 === 0 || out.rep) {
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

                    for (const rep of engine.finish()) {
                        reps.push({
                            video: file.name,
                            exercise: exerciseId,
                            model: modelId,
                            rep: rep.n,
                            start_s: rep.startTime,
                            bottom_s: rep.bottomTime,
                            count_s: rep.countTime,
                            end_s: rep.endTime,
                            verdict: rep.perfect ? 'perfect' : rep.good ? 'good' : 'bad',
                            correct: rep.good ? 1 : 0,
                            faults: [...new Set(rep.faultList.map((f) => f.code))].join(';'),
                            bottom_angle: rep.bottom,
                            top_angle: rep.top,
                            measures: Object.entries(rep.worst)
                                .filter(([, v]) => v !== undefined)
                                .map(([k, v]) => `${k}=${(v as number).toFixed(2)}`)
                                .join(';'),
                        })
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
                        reps: engine.reps.length,
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
            setResults({ reps, frames, runs })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            if (reps.length || runs.length) setResults({ reps, frames, runs })
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
                                <span className="muted">{exerciseFromName(f.name) ?? `${fallback}?`}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="muted small">
                    The exercise is read from the file name (squat / pushup). Files without one use:{' '}
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
                        <p className="muted small">Put these in the evaluation/data folder, then run score.py.</p>
                        <div className="actions">
                            <button className="btn primary" onClick={() => download(`reps_${stamp()}.csv`, toCsv(results.reps))}>
                                reps.csv ({results.reps.length})
                            </button>
                            <button className="btn" onClick={() => download(`frames_${stamp()}.csv`, toCsv(results.frames))}>
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
                                    <th>Reps</th>
                                    <th>Found</th>
                                    <th>ms/frame</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.runs.map((r) => (
                                    <tr key={`${r.video}-${r.model}`}>
                                        <td>{r.video}</td>
                                        <td>{r.model_name}</td>
                                        <td>{r.reps}</td>
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
