import { useState } from 'react'
import { shortCue } from './Camera'
import type { Exercise, Rep } from './exercises'

type Props = {
    exercise: Exercise
    clipName: string
    reps: Rep[]
    onRestart: () => void
}

function Summary({ exercise, clipName, reps, onRestart }: Props) {
    const [copied, setCopied] = useState(false)
    const good = reps.filter((r) => r.good).length
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
                    <p className="eyebrow">Session summary</p>
                    <h2>{exercise.name}</h2>
                    <p className="muted">{clipName}</p>
                </div>
                <div className="actions">
                    <button className="btn" onClick={copy}>
                        {copied ? 'Copied' : 'Copy results'}
                    </button>
                    <button className="btn primary" onClick={onRestart}>
                        New session
                    </button>
                </div>
            </section>

            <section className="stats">
                <div className="card score">
                    <div
                        className="ring"
                        style={{ background: `conic-gradient(var(--good) ${score * 3.6}deg, var(--line) 0deg)` }}
                    >
                        <div className="ring-inner">
                            <b>{score}%</b>
                            <span>form score</span>
                        </div>
                    </div>
                </div>
                <div className="card stat">
                    <span className="label">Reps</span>
                    <b className="stat-number">{reps.length}</b>
                    <span className="muted">{good} with good form</span>
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
                        {best.good ? 'Good form' : shortCue(best.faults[0])}, {best.bottom.toFixed(0)}° at the bottom
                    </span>
                </div>
                {worst && (
                    <div className="card stat">
                        <span className="label">Worst rep</span>
                        <b className="stat-number">#{worst.n}</b>
                        <span className="muted">
                            {worst.good ? 'Good form' : worst.faults.map(shortCue).join(', ')}
                        </span>
                    </div>
                )}
            </section>

            <section className="card">
                <div className="card-row">
                    <span className="label">Depth per rep</span>
                    <span className="legend">
                        <i className="good" /> good <i className="bad" /> needs work
                    </span>
                </div>
                <p className="muted small">
                    Lowest {exercise.mainLabel.toLowerCase()} angle in each rep. Taller bar = deeper.
                </p>
                <div className="bars">
                    {reps.map((r) => (
                        <div key={r.n} className="bar-col" title={r.line}>
                            <span className="bar-value">{r.bottom.toFixed(0)}°</span>
                            <div
                                className={`bar ${r.good ? 'good' : 'bad'}`}
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
                            <span className={`badge ${r.good ? 'good' : 'bad'}`}>{r.n}</span>
                            <div>
                                <p className={r.good ? 'good-text' : 'bad-text'}>
                                    {r.good ? 'Good rep' : r.faults.join('. ')}
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
