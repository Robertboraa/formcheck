import { useState } from 'react'
import { kindOf, shortCue, verdictOf, type Exercise, type Rep } from './exercises'
import { Barbell, Plate } from './Plate'
import { formatDate, scoreOf, type SessionSummary } from './api'
import { Change } from './History'

export type SaveState = 'guest' | 'saving' | 'saved' | 'error'

type Props = {
    exercise: Exercise
    clipName: string
    reps: Rep[]
    onRestart: () => void
    saveState?: SaveState // for a session that was just finished
    onSignIn?: () => void
    previous?: SessionSummary // the session before this one, to compare with
    savedAt?: string // set when opening a saved session from history
    onBack?: () => void
    onDelete?: () => void
}

function Summary({
    exercise,
    clipName,
    reps,
    onRestart,
    saveState,
    onSignIn,
    previous,
    savedAt,
    onBack,
    onDelete,
}: Props) {
    const [copied, setCopied] = useState(false)
    const good = reps.filter((r) => r.good).length
    const perfectCount = reps.filter((r) => verdictOf(r) === 'Perfect rep').length
    const score = reps.length ? Math.round((good / reps.length) * 100) : 0

    // most common fault across the session
    const counts: Record<string, number> = {}
    for (const r of reps) for (const f of r.faults) counts[shortCue(f)] = (counts[shortCue(f)] ?? 0) + 1
    const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]

    // best rep = fewest faults, then deepest; worst = most faults, then shallowest
    const ranked = [...reps].sort((a, b) => a.faults.length - b.faults.length || a.bottom - b.bottom)
    const best = ranked[0]
    const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined
    const deepest = Math.max(...reps.map((r) => 180 - r.bottom), 1)
    const avgBottom = reps.reduce((sum, r) => sum + r.bottom, 0) / (reps.length || 1)

    function copy() {
        const text = [
            `${exercise.name}, ${clipName}`,
            `${reps.length} reps, ${good} with good form (${score}%)`,
            ...reps.map((r) => `${r.n}. ${r.line}`),
        ].join('\n')
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    if (reps.length === 0) {
        return (
            <main className="summary">
                <section className="card empty">
                    <h2>No reps recorded</h2>
                    <p className="muted">
                        The app didn't count any reps. Check that your whole body is in view, side-on, and hold still
                        for a second before you start.
                    </p>
                    <button className="btn primary" onClick={onRestart}>
                        Try again
                    </button>
                </section>
            </main>
        )
    }

    return (
        <main className="summary">
            <section className="summary-head">
                <div>
                    <h2>{exercise.name}</h2>
                    <p className="muted">{savedAt ? `${formatDate(savedAt)}, ${clipName}` : clipName}</p>
                </div>
                <div className="actions">
                    {onBack && (
                        <button className="btn" onClick={onBack}>
                            ‹ History
                        </button>
                    )}
                    {onDelete && (
                        <button className="btn danger" onClick={onDelete}>
                            Delete
                        </button>
                    )}
                    <button className="btn" onClick={copy}>
                        {copied ? 'Copied' : 'Copy results'}
                    </button>
                    <button className="btn primary" onClick={onRestart}>
                        New session
                    </button>
                </div>
            </section>

            {saveState === 'saving' && <p className="save-note muted">Saving to your history…</p>}
            {saveState === 'saved' && <p className="save-note good-text">✓ Saved to your history</p>}
            {saveState === 'error' && <p className="save-note bad-text">Couldn't save this session. Is the API running?</p>}
            {saveState === 'guest' && onSignIn && (
                <p className="save-note muted">
                    Not saved.{' '}
                    <button className="link" onClick={onSignIn}>
                        Sign in
                    </button>{' '}
                    to keep your sessions and compare them over time.
                </p>
            )}

            {previous && (
                <section className="card compare">
                    <span className="label">Compared with your previous session ({formatDate(previous.createdAt)})</span>
                    <div className="compare-grid">
                        <div>
                            <b>
                                {scoreOf(previous)}% → {score}%
                            </b>
                            <Change value={score - scoreOf(previous)} unit="%" />
                        </div>
                        <div>
                            <b>
                                {previous.avgBottom.toFixed(0)}° → {avgBottom.toFixed(0)}° average depth
                            </b>
                            <Change value={previous.avgBottom - avgBottom} unit="°" deeper />
                        </div>
                        <div>
                            <b>
                                {previous.repCount} → {reps.length} reps
                            </b>
                            <Change value={reps.length - previous.repCount} unit={Math.abs(reps.length - previous.repCount) === 1 ? ' rep' : ' reps'} />
                        </div>
                    </div>
                </section>
            )}

            <section className="card set-card">
                <div className="set-score">
                    <b>{score}%</b>
                    <span>of reps had good form</span>
                </div>
                <Barbell reps={reps.map((r) => ({ n: r.n, kind: kindOf(r) }))} />
                <div className="legend">
                    <i className="perfect" /> perfect <i className="good" /> good <i className="bad" /> needs work
                </div>
            </section>

            <section className="stats">
                <div className="card stat">
                    <span className="label">Reps</span>
                    <b className="stat-number">{reps.length}</b>
                    <span className="muted">
                        {good} with good form{perfectCount > 0 && `, ${perfectCount} perfect`}
                    </span>
                </div>
                <div className="card stat">
                    <span className="label">Most common fault</span>
                    {common ? (
                        <>
                            <b className="stat-text bad-text">{common[0]}</b>
                            <span className="muted">
                                {common[1]} of {reps.length} reps
                            </span>
                        </>
                    ) : (
                        <b className="stat-text good-text">None, clean set</b>
                    )}
                </div>
                <div className="card stat">
                    <span className="label">Best rep</span>
                    <b className="stat-number">#{best.n}</b>
                    <span className="muted">
                        {best.good ? verdictOf(best) : shortCue(best.faults[0])}
                    </span>
                </div>
                {worst && (
                    <div className="card stat">
                        <span className="label">Worst rep</span>
                        <b className="stat-number">#{worst.n}</b>
                        <span className="muted">
                            {verdictOf(worst)}
                        </span>
                    </div>
                )}
            </section>

            <section className="card">
                <div className="card-row">
                    <span className="label">Depth per rep</span>
                </div>
                <p className="muted small">
                    Lowest {exercise.mainLabel.toLowerCase()} angle in each rep. Taller bar = deeper.
                </p>
                <div className="bars">
                    {reps.map((r) => (
                        <div key={r.n} className="bar-col" title={r.line}>
                            <span className="bar-value">{r.bottom.toFixed(0)}°</span>
                            <div
                                className={`bar ${kindOf(r)}`}
                                style={{ height: `${Math.max(4, ((180 - r.bottom) / deepest) * 100)}%` }}
                            />
                            <span className="bar-label">{r.n}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="card">
                <span className="label">Every rep</span>
                <ol className="rep-table">
                    {reps.map((r) => (
                        <li key={r.n}>
                            <Plate label={r.n} kind={kindOf(r)} size={36} />
                            <div>
                                <p className={`${kindOf(r)}-text`}>
                                    {verdictOf(r, false)}
                                </p>
                                <div className="chips">
                                    {r.numbers.map((x) => (
                                        <span key={x.label} className="chip">
                                            {x.label} <b>{x.value}</b>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
            </section>
        </main>
    )
}

export default Summary
