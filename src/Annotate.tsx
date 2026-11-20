import { useState } from 'react'
import JointMarker from './JointMarker'
import { download, toCsv } from './csv'
import type { KeypointRow } from './compare/data'

// The Mark joints tab: mark any clip by hand, outside the clip-by-clip flow.
// Marks are saved with the rest of the study data as you click.

type Props = {
    keypoints: KeypointRow[]
    onChange: (video: string, rows: KeypointRow[]) => void
}

function Annotate({ keypoints, onChange }: Props) {
    const [file, setFile] = useState<File | null>(null)
    const [fps, setFps] = useState(30)
    const marks = file ? keypoints.filter((k) => k.video === file.name) : []

    function exportCsv() {
        if (!file) return
        const rows = marks.filter((k) => Number.isFinite(k.x)).map((k) => ({ video: k.video, frame: k.frame, time: k.frame / fps, side: k.side, joint: k.joint, x: k.x, y: k.y }))
        download(`keypoints_${file.name.replace(/\.[^.]+$/, '')}.csv`, toCsv(rows))
    }

    const picker = (
        <>
            <span className="label">Video</span>
            <label className="btn">
                {file ? 'Change video' : 'Choose a video'}
                <input type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
            </label>
            {file && <p className="small">{file.name}</p>}
            <p className="muted small">
                Frame rate (same as the model run){' '}
                <input type="number" className="num" value={fps} min={5} max={60} onChange={(e) => setFps(Number(e.target.value) || 30)} />
            </p>
        </>
    )

    if (!file)
        return (
            <div className="research-grid">
                <section className="card research-controls">{picker}</section>
                <section className="card research-preview">
                    <p className="muted small">
                        Choose a clip to mark. Clip by clip does this for you with suggested frames; this tab is for marking
                        extra frames or clips on their own.
                    </p>
                </section>
            </div>
        )

    return (
        <JointMarker
            file={file}
            fps={fps}
            marks={marks}
            onChange={(rows) => onChange(file.name, rows)}
            top={picker}
            bottom={
                <>
                    <span className="label">Save</span>
                    <p className="muted small">{new Set(marks.map((m) => m.frame)).size} frames marked, saved in this browser as you click.</p>
                    <button className="btn" onClick={exportCsv} disabled={marks.length === 0}>
                        Download keypoints CSV
                    </button>
                </>
            }
        />
    )
}

export default Annotate
