import { useEffect, useState } from 'react'
import { api, formatDate, scoreOf, type SessionSummary } from './api'
import { EXERCISES, findExercise } from './exercises'

type Props = {
    initialExercise: string
    onOpen: (session: SessionSummary, previous: SessionSummary | undefined) => void
    onStart: () => void
}

function History({ initialExercise, onOpen, onStart }: Props) {
    const [exercise, setExercise] = useState(initialExercise)
    const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false
        api.sessions(exercise)
            .then((list) => !cancelled && setSessions(list))
            .catch((err) => !cancelled && setError(err.message))
        return () => {
            cancelled = true
        }
    }, [exercise])

    const ex = findExercise(exercise)
    const oldestFirst = sessions ? [...sessions].reverse().slice(-20) : []
    const latest = sessions?.[0]
    const before = sessions?.[1]

    return (
        <main className="history">
            <section className="summary-head">
                <div>
                    <p className="eyebrow">Your progress</p>
                    <h2>History</h2>
                </div>
                <div className="tabs">
                    {EXERCISES.map((x) => (
                        <button
                            key={x.id}
                            className={`tab ${x.id === exercise ? 'selected' : ''}`}
                            onClick={() => {
                                setSessions(null)
                                setExercise(x.id)
                            }}
                        >
                            {x.name}
                        </button>
                    ))}
                </div>
            </section>

            {error && <p className="form-error">{error}</p>}
            {!sessions && !error && <p className="muted">Loading…</p>}

            {sessions && sessions.length === 0 && (
                <section className="card empty">
                    <h2>No {ex?.name.toLowerCase()} sessions yet</h2>
                    <p className="muted">Finish a set while signed in and it will show up here.</p>
                    <button className="btn primary" onClick={onStart}>
                        Start a session
                    </button>
                </section>
            )}

            {sessions && sessions.length > 0 && latest && (
                <>
                    <section className="stats">
                        <div className="card stat">
                            <span className="label">Sessions</span>
                            <b className="stat-number">{sessions.length}</b>
                        </div>
                        <div className="card stat">
                            <span className="label">Latest form score</span>
                            <b className="stat-number">{scoreOf(latest)}%</b>
                            {before && <Change value={scoreOf(latest) - scoreOf(before)} unit="%" />}
                        </div>
                        <div className="card stat">
                            <span className="label">Latest average depth</span>
                            <b className="stat-number">{latest.avgBottom.toFixed(0)}°</b>
                            {before && <Change value={before.avgBottom - latest.avgBottom} unit="°" deeper />}
                        </div>
                        <div className="card stat">
                            <span className="label">Total reps</span>
                            <b className="stat-number">{sessions.reduce((sum, s) => sum + s.repCount, 0)}</b>
                        </div>
                    </section>

                    <section className="card">
                        <span className="label">Form score per session</span>
                        <div className="bars">
                            {oldestFirst.map((s) => (
                                <div key={s.id} className="bar-col" title={formatDate(s.createdAt)}>
                                    <span className="bar-value">{scoreOf(s)}%</span>
                                    <div
                                        className={`bar ${scoreOf(s) >= 70 ? 'good' : 'bad'}`}
                                        style={{ height: `${Math.max(4, scoreOf(s))}%` }}
                                    />
                                    <span className="bar-label">
                                        {new Date(s.createdAt).toLocaleDateString('en-GB', {
                                            day: 'numeric',
                                            month: 'short',
                                        })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="card">
                        <span className="label">All sessions</span>
                        <ul className="session-list">
                            {sessions.map((s, i) => (
                                <li key={s.id}>
                                    <button onClick={() => onOpen(s, sessions[i + 1])}>
                                        <span className={`badge ${scoreOf(s) >= 70 ? 'good' : 'bad'}`}>
                                            {scoreOf(s)}
                                        </span>
                                        <span className="session-main">
                                            <b>{formatDate(s.createdAt)}</b>
                                            <span className="muted">{s.source}</span>
                                        </span>
                                        <span className="muted">
                                            {s.goodCount}/{s.repCount} good
                                        </span>
                                        <span className="chev">›</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            )}
        </main>
    )
}

// a small "+12% vs last time" line; for depth a smaller angle is better, so `deeper` flips the wording
export function Change({ value, unit, deeper = false }: { value: number; unit: string; deeper?: boolean }) {
    const rounded = Math.round(value)
    if (rounded === 0) return <span className="muted">Same as last time</span>
    const better = rounded > 0
    const text = deeper
        ? `${Math.abs(rounded)}${unit} ${better ? 'deeper' : 'shallower'} than last time`
        : `${better ? '+' : '−'}${Math.abs(rounded)}${unit} vs last time`
    return <span className={better ? 'good-text' : 'bad-text'}>{text}</span>
}

export default History
