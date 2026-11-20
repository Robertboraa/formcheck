import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import JointMarker from './JointMarker'
import { DataTable } from './Compare'
import { clipInfo, loadVideo } from './csv'
import { POSE_MODELS, loadPoseModel, modelInfo } from './pose'
import { runClip, type Row } from './runner'
import { clip as clipOf, clipData, clipName, type Dataset, type KeypointRow } from './compare/data'
import { buildReport, modelName } from './compare/metrics'
import { suggestFrames } from './compare/suggest'
import { COLOURS, fmt, pText } from './compare/report'

// Clip by clip: one video at a time. Pick a clip, the chosen models run on it, mark the suggested
// frames, see that clip's result, then move on. Everything is saved in the browser as you go.

const DEFAULT_MODELS = ['mediapipe-full', 'yolo11n', 'movenet-thunder', 'rtmo-s']
const FPS = 30
const order = (ids: string[]) => POSE_MODELS.map((m) => m.id).filter((id) => ids.includes(id))

function savedModels() {
    try {
        const saved = JSON.parse(localStorage.getItem('formcheck-study-models') ?? 'null')
        if (Array.isArray(saved) && saved.length) return order(saved)
    } catch {
        // fall back to the defaults
    }
    return DEFAULT_MODELS
}

type Props = {
    data: Dataset
    onRun: (video: string, model: string, frames: Row[], run: Row) => void
    onKeypoints: (video: string, rows: KeypointRow[]) => void
    onRemove: (video: string) => void
    onReps: (video: string, reps: number) => void
}

function Study({ data, onRun, onKeypoints, onRemove, onReps }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const stopRef = useRef(false)
    const [file, setFile] = useState<File | null>(null)
    const [running, setRunning] = useState<{ model: string; frame: number; frames: number; step: number; of: number } | null>(null)
    const [phase, setPhase] = useState<'run' | 'mark'>('run')
    const [failed, setFailed] = useState<string[]>([]) // models that couldn't run on this clip, with why
    const [models, setModels] = useState<string[]>(savedModels)
    const [rtmoReady, setRtmoReady] = useState<boolean | null>(null)

    // is the RTMO model downloaded? (the dev server answers a missing file with the app's HTML page)
    useEffect(() => {
        fetch('/models/rtmo-s.onnx', { method: 'HEAD' })
            .then((r) => setRtmoReady(r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')))
            .catch(() => setRtmoReady(false))
    }, [])

    const usable = models.filter((m) => m !== 'rtmo-s' || rtmoReady !== false)

    function toggle(id: string) {
        const next = order(models.includes(id) ? models.filter((m) => m !== id) : [...models, id])
        setModels(next)
        try {
            localStorage.setItem('formcheck-study-models', JSON.stringify(next))
        } catch {
            // remembered for this visit only
        }
    }

    const clips = useMemo(() => {
        const names = [...new Set([...data.frames.map((f) => f.video), ...data.keypoints.map((k) => k.video)])]
        return names.sort()
    }, [data.frames, data.keypoints])

    const name = file ? clipName(file.name) : ''
    const clipFrames = useMemo(() => data.frames.filter((f) => f.video === name), [data.frames, name])
    const clipMarks = useMemo(() => data.keypoints.filter((k) => k.video === name), [data.keypoints, name])
    const info = clipInfo(name)
    const suggestions = useMemo(() => {
        const first = order([...new Set(clipFrames.map((f) => f.model))])[0]
        return first ? suggestFrames(clipFrames.filter((f) => f.model === first), info.exercise, 3, FPS) : []
    }, [clipFrames, info.exercise])
    const side = useMemo(() => {
        const seen = clipFrames.filter((f) => f.detected)
        return seen.filter((f) => f.side === 'l').length >= seen.length / 2 ? 'l' : 'r'
    }, [clipFrames])

    async function choose(f: File) {
        setFailed([])
        setFile(f)
        const fname = clipName(f.name)
        const missing = usable.filter((m) => !data.runs.some((r) => r.video === fname && r.model === m))
        if (!missing.length) {
            setPhase('mark')
            return
        }
        setPhase('run')
        stopRef.current = false
        const video = videoRef.current
        if (!video) return
        const problems: string[] = []
        let ran = data.runs.some((r) => r.video === fname)
        try {
            await loadVideo(video, f)
        } catch (err) {
            setFailed([err instanceof Error ? err.message : String(err)])
            return
        }
        for (const [step, id] of missing.entries()) {
            if (stopRef.current) return
            setRunning({ model: modelInfo(id).name, frame: 0, frames: 1, step, of: missing.length })
            try {
                const loadStart = performance.now()
                const model = await loadPoseModel(id)
                const loadMs = performance.now() - loadStart
                const out = await runClip({
                    video,
                    name: fname,
                    model,
                    fps: FPS,
                    loadMs,
                    canvas: canvasRef.current,
                    drawFrame: true,
                    shouldStop: () => stopRef.current,
                    onProgress: (frame, frames) => setRunning({ model: model.info.name, frame, frames, step, of: missing.length }),
                })
                model.close()
                if (!out.complete) return
                onRun(fname, id, out.frames, out.run)
                ran = true
            } catch (err) {
                // one model failing (e.g. not downloaded) shouldn't stop the others
                problems.push(`${modelInfo(id).name}: ${err instanceof Error ? err.message : String(err)}`)
            }
        }
        setRunning(null)
        setFailed(problems)
        if (ran) setPhase('mark')
    }

    // one video element for the model runs, the same one whichever view is showing
    const hiddenVideo = <video ref={videoRef} muted playsInline className="offscreen-video" />

    let view: ReactNode

    // ---------- the list of clips ----------
    if (!file) {
        view = (
            <>
                <section className="card study-start">
                    <div>
                        <span className="label">Clip by clip</span>
                        <h3>Pick a clip</h3>
                        <p className="muted">
                            The models you tick below run on it, then you mark the joints on the frames it suggests. You see
                            that clip's result straight away. Everything is saved in this browser.
                        </p>
                        <p className="muted small">
                            Name clips like <b>P01_S1_squat_good_side.mp4</b>: exercise (squat / pushup) and camera setup (side /
                            diagonal / dim / far) are read from the name.
                        </p>
                    </div>
                    <label className={`btn primary big ${usable.length < 2 ? 'disabled' : ''}`}>
                        {clips.length ? 'Next clip' : 'Choose a clip'}
                        <input
                            type="file"
                            accept="video/*"
                            hidden
                            disabled={usable.length < 2}
                            onChange={(e) => {
                                if (e.target.files?.[0]) choose(e.target.files[0])
                                e.target.value = ''
                            }}
                        />
                    </label>
                </section>

                <section className="card">
                    <span className="label">Models to compare · {usable.length} ticked</span>
                    <div className="model-picker-grid">
                        {POSE_MODELS.map((m) => {
                            const missingFile = m.id === 'rtmo-s' && rtmoReady === false
                            return (
                                <label key={m.id} className={`model-option ${models.includes(m.id) && !missingFile ? 'on' : ''} ${missingFile ? 'off' : ''}`}>
                                    <input type="checkbox" checked={models.includes(m.id) && !missingFile} disabled={missingFile} onChange={() => toggle(m.id)} />
                                    <span>
                                        <b>{m.name}</b>
                                        <small className="muted">
                                            {m.by} · {missingFile ? 'not downloaded yet: run npm run get-rtmo in the formcheck folder, then refresh' : m.note}
                                        </small>
                                    </span>
                                </label>
                            )
                        })}
                    </div>
                    <p className="muted small">
                        Each model adds a minute or two per clip; your hand marks are shared by all of them. Ticking a model later
                        is fine: it runs on a clip the next time you open that clip. Pick at least two.
                    </p>
                </section>

                {clips.length > 0 && <ClipList data={data} clips={clips} models={usable} onRemove={onRemove} />}
            </>
        )
    }

    // ---------- running the models ----------
    else if (phase === 'run') {
        view = (
                <section className="card study-run">
                    <div className="study-run-head">
                        <div>
                            <span className="label">Step 1 of 2 · Running the models</span>
                            <h3>{name}</h3>
                            <ClipTags video={name} />
                        </div>
                        <button
                            className="btn"
                            onClick={() => {
                                stopRef.current = true
                                setFile(null)
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                    <div className="research-stage">
                        <canvas ref={canvasRef} />
                    </div>
                    {running ? (
                        <>
                            <p className="small">
                                <b>{running.model}</b> (model {running.step + 1} of {running.of}) · frame {running.frame + 1} of {running.frames}
                            </p>
                            <div className="progress">
                                <div style={{ width: `${(running.frame / Math.max(running.frames, 1)) * 100}%` }} />
                            </div>
                            <p className="muted small">Every frame is analysed, so this takes a little while. Keep this tab open and in front.</p>
                        </>
                    ) : (
                        <p className="form-error">{failed.length ? failed.join(' · ') : 'Preparing…'}</p>
                    )}
                </section>
        )
    }

    // ---------- marking + this clip's result ----------
    else {
        view = (
            <>
            <JointMarker
                file={file}
                fps={FPS}
                marks={clipMarks}
                onChange={(rows) => onKeypoints(name, rows)}
                suggestions={suggestions}
                defaultSide={side}
                top={
                    <>
                        <span className="label">Step 2 of 2 · Mark the joints</span>
                        <b className="study-clip-name">{name}</b>
                        <ClipTags video={name} />
                        {failed.length > 0 && <p className="form-error small">Skipped: {failed.join(' · ')}</p>}
                    </>
                }
                bottom={
                    <>
                        <span className="label">Real number of reps in this clip</span>
                        <p className="muted small">
                            Count them while you mark. It lets the Results page check each model's rep counting too.{' '}
                            <input
                                type="number"
                                className="num"
                                min={0}
                                max={100}
                                value={data.clips.find((c) => c.video === name)?.reps ?? ''}
                                onChange={(e) => onReps(name, e.target.value === '' ? NaN : Number(e.target.value))}
                            />
                        </p>
                        <div className="actions study-next">
                            <button className="btn primary" onClick={() => setFile(null)}>
                                Done · next clip
                            </button>
                        </div>
                    </>
                }
            />
            <ClipResult data={data} video={name} />
            </>
        )
    }

    return (
        <div className="study">
            {view}
            {hiddenVideo}
        </div>
    )
}

function ClipTags({ video }: { video: string }) {
    const c = clipInfo(video)
    return (
        <div className="chips">
            <span className="chip">
                exercise <b>{c.exercise || '?'}</b>
            </span>
            <span className="chip">
                camera <b>{c.condition}</b>
            </span>
            {c.participant && (
                <span className="chip">
                    person <b>{c.participant}</b>
                </span>
            )}
            {!c.exercise && <span className="chip warn">add squat or pushup to the file name</span>}
        </div>
    )
}

// this clip's numbers, updated as you mark
function ClipResult({ data, video }: { data: Dataset; video: string }) {
    const sub = useMemo(() => clipData(data, video), [data, video])
    const report = useMemo(() => buildReport(sub), [sub])
    const v = report.verdict
    const angles = report.sections.find((s) => s.id === 'angles')?.tables.find((t) => t.id === 'angle_accuracy')
    const colour = (m: string) => COLOURS[Math.max(0, report.models.indexOf(m)) % COLOURS.length]
    const marked = new Set(sub.keypoints.filter((k) => Number.isFinite(k.x)).map((k) => k.frame)).size
    const has = v && Object.keys(v.values).length > 0
    const speed = report.sections.find((s) => s.id === 'speed')?.tables[0]

    return (
        <section className="card clip-result">
            <span className="label">This clip's result · {marked} frames marked</span>
            {!has ? (
                <p className="muted">Mark the first frame to see which model is closer to your marks on this clip.</p>
            ) : (
                <>
                    <h3>
                        {v.winner && v.winner !== 'tie' ? (
                            <>
                                <span style={{ color: colour(v.winner) }}>{modelName(v.winner)}</span> is closer to your marks on this clip
                            </>
                        ) : (
                            'The models are equally close on this clip'
                        )}
                    </h3>
                    <div className="verdict-scores">
                        {report.models.map((m) => (
                            <div key={m} className="verdict-score" style={{ borderColor: colour(m) }}>
                                <b>{fmt(v.values[m] ?? null, 1)}°</b>
                                <span>{modelName(m)}</span>
                                <small>mean angle error</small>
                            </div>
                        ))}
                    </div>
                    <p className="muted small">
                        {v.n} marked angles on this clip ({v.p === null ? 'too few for a significance test yet' : pText(v.p)}). One clip is a small sample: the
                        Results tab adds up every clip for the real answer.
                    </p>
                    {angles && <DataTable table={{ ...angles, title: 'Angle error on this clip' }} />}
                </>
            )}
            {speed && <DataTable table={{ ...speed, title: 'Speed on this clip' }} />}
        </section>
    )
}

// every clip so far, with how far along it is
function ClipList({ data, clips, models, onRemove }: { data: Dataset; clips: string[]; models: string[]; onRemove: (video: string) => void }) {
    const report = useMemo(() => buildReport(data), [data])
    const shown = order([...new Set([...models, ...data.runs.map((r) => r.model)])])
    const perClip = useMemo(() => {
        const out = new Map<string, Record<string, number>>()
        for (const c of clips) {
            out.set(c, buildReport(clipData(data, c)).verdict?.values ?? {})
        }
        return out
    }, [data, clips])
    const marked = (c: string) => new Set(data.keypoints.filter((k) => k.video === c && Number.isFinite(k.x)).map((k) => k.frame)).size
    const ran = (c: string) => models.filter((m) => data.runs.some((r) => r.video === c && r.model === m)).length
    const v = report.verdict
    const leader = v?.winner && v.winner !== 'tie' ? v.winner : null

    return (
        <section className="card">
            <div className="data-block-head">
                <span className="label">
                    Clips so far · {clips.length} clips · {new Set(data.keypoints.map((k) => `${k.video}|${k.frame}`)).size} frames marked
                </span>
                {leader && v && (
                    <span className="small">
                        Closest so far: <b>{modelName(leader)}</b> ({fmt(v.values[leader] ?? null, 1)}° mean angle error)
                    </span>
                )}
            </div>
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Clip</th>
                            <th>Exercise</th>
                            <th>Camera</th>
                            <th>Models run</th>
                            <th>Frames marked</th>
                            {shown.map((m) => (
                                <th key={m}>{modelName(m)} °</th>
                            ))}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {clips.map((c) => {
                            const vals = perClip.get(c) ?? {}
                            const best = Math.min(...shown.map((m) => vals[m]).filter((x) => Number.isFinite(x)))
                            return (
                                <tr key={c}>
                                    <td>{c}</td>
                                    <td>{clipOf(c).exercise || '?'}</td>
                                    <td>{clipOf(c).condition}</td>
                                    <td>
                                        {ran(c)} of {models.length}
                                    </td>
                                    <td>{marked(c) || <span className="muted">none yet</span>}</td>
                                    {shown.map((m) => (
                                        <td key={m} className={vals[m] === best ? 'win' : ''}>
                                            {fmt(Number.isFinite(vals[m]) ? vals[m] : null, 1)}
                                        </td>
                                    ))}
                                    <td>
                                        <button
                                            className="link muted small"
                                            onClick={() => {
                                                if (window.confirm(`Remove ${c} and its marks from the study?`)) onRemove(c)
                                            }}
                                        >
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <p className="muted small">
                To mark more frames on a clip, or run a model you've just ticked, choose the same file again: its runs and marks
                are kept.
            </p>
        </section>
    )
}

export default Study
