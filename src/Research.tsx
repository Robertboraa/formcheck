import { useEffect, useRef, useState } from 'react'
import Study from './Study'
import Evaluate from './Evaluate'
import Annotate from './Annotate'
import Compare from './Compare'
import { download, toCsv } from './csv'
import { addRows, cleanNames, emptyDataset, removeClip, setClipKeypoints, setClipReps, setClipRun, toRows, type Dataset, type FileKind, type Raw } from './compare/data'
import { loadSaved, save } from './compare/store'

// The pose model study: run clips through MediaPipe and YOLO, mark joints by hand, compare.
// All the data lives here and is saved in this browser (IndexedDB) as it changes.

type Tab = 'clip' | 'results' | 'batch' | 'annotate'

function Research() {
    const [tab, setTab] = useState<Tab>('clip')
    const [data, setData] = useState<Dataset>(emptyDataset)
    const [loaded, setLoaded] = useState(false)
    const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved')
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    // load what was saved last time
    useEffect(() => {
        loadSaved().then((d) => {
            if (d) setData(cleanNames({ ...emptyDataset(), ...d }))
            setLoaded(true)
        })
    }, [])

    // save shortly after every change
    useEffect(() => {
        if (!loaded) return
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
            setSaved('saving')
            save(data).then((ok) => setSaved(ok ? 'saved' : 'failed'))
        }, 400)
    }, [data, loaded])

    const add = (kind: FileKind, rows: Raw[]) => setData((d) => addRows(d, kind, rows))

    function backup() {
        const rows = toRows(data)
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
        download(`frames_${stamp}.csv`, toCsv(rows.frames))
        setTimeout(() => download(`runs_${stamp}.csv`, toCsv(rows.runs)), 300)
        setTimeout(() => download(`keypoints_${stamp}.csv`, toCsv(rows.keypoints)), 600)
        if (rows.clips.length) setTimeout(() => download(`clips_${stamp}.csv`, toCsv(rows.clips)), 900)
    }

    const tabs: [Tab, string][] = [
        ['clip', 'Clip by clip'],
        ['results', 'Results'],
        ['batch', 'Batch run'],
        ['annotate', 'Mark joints'],
    ]

    return (
        <main className="research">
            <div className="research-head">
                <div>
                    <h2>Pose model comparison</h2>
                    <p className="muted">
                        How accurately MediaPipe, YOLO, MoveNet and RTMO measure joint angles, and where each one is better.{' '}
                        <span className={`save-state ${saved}`}>
                            {saved === 'saved' ? 'Saved in this browser' : saved === 'saving' ? 'Saving…' : 'Could not save: download a backup'}
                        </span>
                    </p>
                </div>
                <div className="segmented">
                    {tabs.map(([id, label]) => (
                        <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {!loaded ? (
                <p className="muted">Loading your saved data…</p>
            ) : (
                <>
                    {tab === 'clip' && (
                        <Study
                            data={data}
                            onRun={(video, model, frames, run) => setData((d) => setClipRun(d, video, model, frames, run))}
                            onKeypoints={(video, rows) => setData((d) => setClipKeypoints(d, video, rows))}
                            onRemove={(video) => setData((d) => removeClip(d, video))}
                            onReps={(video, reps) => setData((d) => setClipReps(d, video, reps))}
                        />
                    )}
                    {tab === 'results' && (
                        <Compare
                            data={data}
                            onAdd={add}
                            onBackup={backup}
                            onClear={() => {
                                if (window.confirm('Delete every model run and hand mark saved in this browser? Download a backup first if you might need them.'))
                                    setData(emptyDataset())
                            }}
                        />
                    )}
                    {tab === 'batch' && (
                        <Evaluate
                            onResults={(r) => {
                                add('frames', r.frames)
                                add('runs', r.runs)
                            }}
                        />
                    )}
                    {tab === 'annotate' && <Annotate keypoints={data.keypoints} onChange={(video, rows) => setData((d) => setClipKeypoints(d, video, rows))} />}
                </>
            )}
        </main>
    )
}

export default Research
