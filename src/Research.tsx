import { useState } from 'react'
import Evaluate from './Evaluate'
import Annotate from './Annotate'
import Compare, { type LoadedFile } from './Compare'
import { addRows, emptyDataset, type FileKind, type Raw } from './compare/data'

// Tools for the model comparison: batch-run videos through the pose models, mark joints by hand,
// and compare the models. The comparison data lives here so it survives switching tabs.
function Research() {
    const [tab, setTab] = useState<'batch' | 'annotate' | 'compare'>('batch')
    const [data, setData] = useState(emptyDataset)
    const [files, setFiles] = useState<LoadedFile[]>([])

    function add(name: string, kind: FileKind, rows: Raw[]) {
        setData((d) => addRows(d, kind, rows))
        setFiles((f) => [...f, { name, kind, rows: rows.length }])
    }

    return (
        <main className="research">
            <div className="research-head">
                <div>
                    <h2>Research tools</h2>
                    <p className="muted">How accurately MediaPipe and YOLO measure joint angles, and where each one is better.</p>
                </div>
                <div className="segmented">
                    <button className={tab === 'batch' ? 'selected' : ''} onClick={() => setTab('batch')}>
                        Batch evaluation
                    </button>
                    <button className={tab === 'annotate' ? 'selected' : ''} onClick={() => setTab('annotate')}>
                        Mark joints
                    </button>
                    <button className={tab === 'compare' ? 'selected' : ''} onClick={() => setTab('compare')}>
                        Compare
                    </button>
                </div>
            </div>
            {tab === 'batch' && (
                <Evaluate
                    onResults={(r) => {
                        add('Batch run (this session): frames', 'frames', r.frames)
                        add('Batch run (this session): runs', 'runs', r.runs)
                    }}
                />
            )}
            {tab === 'annotate' && <Annotate onExport={(name, rows) => add(`${name} (this session)`, 'keypoints', rows)} />}
            {tab === 'compare' && (
                <Compare
                    data={data}
                    files={files}
                    onAdd={add}
                    onClear={() => {
                        setData(emptyDataset())
                        setFiles([])
                    }}
                />
            )}
        </main>
    )
}

export default Research
