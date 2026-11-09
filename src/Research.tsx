import { useState } from 'react'
import Evaluate from './Evaluate'
import Annotate from './Annotate'

// Tools for the model comparison: batch-run videos through the pose models, and mark joints by hand.
function Research() {
    const [tab, setTab] = useState<'batch' | 'annotate'>('batch')
    return (
        <main className="research">
            <div className="research-head">
                <div>
                    <h2>Research tools</h2>
                    <p className="muted">
                        Compare pose models on the same videos with the same rules. The results go to evaluation/score.py.
                    </p>
                </div>
                <div className="segmented">
                    <button className={tab === 'batch' ? 'selected' : ''} onClick={() => setTab('batch')}>
                        Batch evaluation
                    </button>
                    <button className={tab === 'annotate' ? 'selected' : ''} onClick={() => setTab('annotate')}>
                        Mark joints
                    </button>
                </div>
            </div>
            {tab === 'batch' ? <Evaluate /> : <Annotate />}
        </main>
    )
}

export default Research
