import { Fragment, useMemo, useState } from 'react'
import { download } from './csv'
import { detectKind, parseCsv, type Dataset, type FileKind } from './compare/data'
import { buildReport, modelName, type Chart, type Report, type Section, type Table } from './compare/metrics'
import { COLOURS, fmt, fmtP, pText, tableCsv, toMarkdown } from './compare/report'
import { summarize } from './compare/summary'
import { chartToSvg } from './compare/chart'
import { buildBundle } from './compare/bundle'
import FrameGallery from './FrameGallery'

// The pose model comparison: batch-run joints + hand-marked joints in; angle accuracy, which model
// is better in which situation, consistency checks and speed out.


type Props = {
    data: Dataset
    onAdd: (kind: FileKind, rows: Record<string, unknown>[]) => void
    onClear: () => void
    onBackup: () => void
}

function Compare({ data, onAdd, onClear, onBackup }: Props) {
    const [error, setError] = useState('')
    const report = useMemo(() => buildReport(data), [data])
    const colour = (model: string) => COLOURS[Math.max(0, report.models.indexOf(model)) % COLOURS.length]
    const colourMap = useMemo(() => Object.fromEntries(report.models.map((m, i) => [m, COLOURS[i % COLOURS.length]])), [report.models])
    const hasAnything = data.frames.length > 0 || data.keypoints.length > 0
    const [zipping, setZipping] = useState(false)
    const clips = new Set(data.frames.map((f) => f.video)).size

    // one zip with everything for the paper
    function downloadAll() {
        setZipping(true)
        setTimeout(() => {
            try {
                const zip = buildBundle(data, report)
                const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
                const a = document.createElement('a')
                a.href = url
                a.download = `formcheck-study-${new Date().toISOString().slice(0, 10)}.zip`
                a.click()
                setTimeout(() => URL.revokeObjectURL(url), 2000)
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
            } finally {
                setZipping(false)
            }
        }, 50)
    }
    const marked = new Set(data.keypoints.map((k) => `${k.video}|${k.frame}`)).size

    async function addFiles(list: FileList | null) {
        setError('')
        for (const file of [...(list ?? [])]) {
            const rows = parseCsv(await file.text())
            const kind = detectKind(rows)
            if (kind === 'unknown') {
                setError(`${file.name}: not a FormCheck CSV (frames, runs or keypoints).`)
                continue
            }
            onAdd(kind, rows)
        }
    }

    return (
        <div className="compare">
            <section className="card compare-data">
                <div className="compare-data-head">
                    <div>
                        <span className="label">Data</span>
                        <p className="small">
                            <b>{clips}</b> clips run · <b>{report.models.length}</b> models · <b>{marked}</b> frames marked by hand
                        </p>
                        <p className="muted small">
                            Everything from Clip by clip, Batch run and Mark joints is saved in this browser and shows here.
                            <b> Download everything</b> gives one zip with the report, every table and chart, all the data
                            and how the study was run: send that for writing the paper. To add data from another computer,
                            load its CSV files.
                        </p>
                    </div>
                    <div className="actions">
                        {hasAnything && (
                            <button className="btn primary" onClick={downloadAll} disabled={zipping}>
                                {zipping ? 'Preparing…' : 'Download everything (.zip)'}
                            </button>
                        )}
                        <label className="btn">
                            Load CSV files
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                multiple
                                hidden
                                onChange={(e) => {
                                    addFiles(e.target.files)
                                    e.target.value = ''
                                }}
                            />
                        </label>
                        {hasAnything && (
                            <>
                                <button className="btn" onClick={onBackup}>
                                    Download backup
                                </button>
                                <button className="btn danger" onClick={onClear}>
                                    Clear all
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {error && <p className="form-error">{error}</p>}
                {report.missing.length > 0 && hasAnything && (
                    <ul className="missing">
                        {report.missing.map((m) => (
                            <li key={m}>Missing: {m}</li>
                        ))}
                    </ul>
                )}
            </section>

            {report.verdict && <Findings report={report} />}

            {report.verdict && <VerdictCard report={report} colour={colour} />}

            {report.sections.map((s) => (
                <Fragment key={s.id}>
                    <SectionCard section={s} colours={report.models.map(colour)} />
                    {s.id === 'situations' && <FrameGallery data={data} worst={report.worst} models={report.models} colours={colourMap} />}
                </Fragment>
            ))}
            {!hasAnything && (
                <section className="card compare-empty">
                    <p>
                        <b>Nothing yet.</b> Go to <b>Clip by clip</b>, pick a video, and mark the suggested frames. This page
                        then adds up every clip: how far each model's angles are from yours, which model is better in which
                        situation (camera angle, light, distance, exercise, how bent the joint is), consistency checks,
                        speed, and a report to download.
                    </p>
                </section>
            )}
        </div>
    )
}

// the findings in plain words, at the top of the page
function Findings({ report }: { report: Report }) {
    const lines = summarize(report)
    if (!lines.length) return null
    return (
        <section className="card findings">
            <span className="label">What the data says</span>
            {lines.map((l, i) => (
                <p key={i} dangerouslySetInnerHTML={{ __html: md(l) }} />
            ))}
            <p className="muted small">Written from the numbers below, and updated as you add clips. Every "clearly better" is backed by a significance test.</p>
        </section>
    )
}

// **bold** and _italic_ only; the text comes from summarize(), never from the user
const md = (t: string) =>
    t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>')

function SectionCard({ section: s, colours }: { section: Section; colours: string[] }) {
    return (
        <section className="card compare-section">
            <h3>{s.title}</h3>
            <p className="muted">{s.intro}</p>
            {s.charts.map((c) => (
                <BarChart key={c.id} chart={c} colours={colours} />
            ))}
            {s.tables.map((t) => (
                <DataTable key={t.id} table={t} />
            ))}
            {s.notes.map((n) => (
                <p key={n} className="muted small">
                    {n}
                </p>
            ))}
        </section>
    )
}

function VerdictCard({ report, colour }: { report: Report; colour: (m: string) => string }) {
    const v = report.verdict!
    const winner = v.winner && v.winner !== 'tie' ? v.winner : null
    const hasAngles = Object.keys(v.values).length > 0
    const significant = v.p !== null && v.p < 0.05
    const used = v.situations.filter((r) => r.n >= 20 && r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie')
    return (
        <section className="card verdict-card">
            <div className="verdict-head">
                <div>
                    <span className="label">Verdict · main measure: angle error against your marks</span>
                    <h2>
                        {!hasAngles ? (
                            'Mark some joints to see which model measures angles better'
                        ) : winner ? (
                            <>
                                <span style={{ color: colour(winner) }}>{modelName(winner)}</span> measures angles more
                                accurately
                            </>
                        ) : (
                            'The models measure angles equally well'
                        )}
                    </h2>
                    {winner && (
                        <p className="muted">
                            {significant
                                ? `Across ${v.n} marked angles it is significantly closer than the runner-up (Wilcoxon ${pText(v.p)}), so it isn't down to chance.`
                                : `But across ${v.n} marked angles the gap to the runner-up is not statistically significant (Wilcoxon ${pText(v.p)}): with this data they can't be told apart overall.`}
                        </p>
                    )}
                </div>
                {hasAngles && (
                    <div className="verdict-scores">
                        {report.models.map((m) => (
                            <div key={m} className="verdict-score" style={{ borderColor: colour(m) }}>
                                <b>{fmt(v.values[m] ?? null, 1)}°</b>
                                <span>{modelName(m)}</span>
                                <small>mean angle error · {v.wins[m] ?? 0} measures won</small>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {v.recommendations.length > 0 && (
                <div className="recommend">
                    <span className="label">Which model to use where</span>
                    <p className="muted small">
                        The best model in each situation, tested against the runner-up. "Use" only appears when the gap is
                        real (p &lt; 0.05) and there are at least 20 marked angles.
                        {used.length === 0 && ' No situation shows a real difference yet.'}
                    </p>
                    <div className="recommend-grid">
                        {v.situations.map((r) => {
                            const real = r.n >= 20 && r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie'
                            return (
                                <div key={r.dimension + r.situation} className={`recommend-item ${real ? 'real' : ''}`} style={real ? { borderLeftColor: colour(r.better!) } : undefined}>
                                    <small className="muted">{r.dimension}</small>
                                    <b>{r.situation}</b>
                                    <span>
                                        {real ? (
                                            <>
                                                Use <b style={{ color: colour(r.better!) }}>{modelName(r.better!)}</b>
                                            </>
                                        ) : (
                                            <span className="muted">
                                                No clear winner{r.better && r.better !== 'tie' ? ` (${modelName(r.better)} slightly ahead)` : ''}
                                            </span>
                                        )}
                                    </span>
                                    <small className="muted">
                                        {r.better && r.runnerUp && r.better !== 'tie'
                                            ? `${fmt(r.values[r.better] ?? null, 1)}° vs ${fmt(r.values[r.runnerUp] ?? null, 1)}° (${modelName(r.runnerUp)})`
                                            : '–'}{' '}
                                        · {r.p === null ? 'p –' : pText(r.p)}
                                    </small>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            <div className="table-wrap">
                <table className="data-table overall">
                    <thead>
                        <tr>
                            <th>Measure</th>
                            {report.models.map((m) => (
                                <th key={m}>{modelName(m)}</th>
                            ))}
                            <th>Better</th>
                            <th>p</th>
                        </tr>
                    </thead>
                    <tbody>
                        {v.rows.map((r) => (
                            <tr key={r.metric}>
                                <td>
                                    {r.metric}
                                    <span className="muted"> · {r.higherIsBetter ? 'higher' : 'lower'} is better</span>
                                </td>
                                {report.models.map((m) => (
                                    <td key={m} className={r.better === m ? 'win' : ''} style={r.better === m ? { boxShadow: `inset 4px 0 0 ${colour(m)}` } : undefined}>
                                        {fmt(r.values[m] ?? null, Math.abs(r.values[m] ?? 0) >= 10 ? 1 : 3)}
                                    </td>
                                ))}
                                <td>{r.better === 'tie' ? 'tie' : r.better ? modelName(r.better) : '–'}</td>
                                <td>{r.p === null ? <span className="muted">–</span> : <span className={`sig ${r.p < 0.05 ? 'yes' : 'no'}`}>{fmtP(r.p)}</span>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="muted small">
                p = paired significance test on the same frames or clips. Green: p &lt; 0.05, a real difference. Grey: could be
                chance.
            </p>
            <div className="actions">
                <button className="btn primary" onClick={() => download('pose-model-comparison.md', toMarkdown(report), 'text/markdown')}>
                    Download report (.md)
                </button>
            </div>
        </section>
    )
}

export function DataTable({ table }: { table: Table }) {
    return (
        <div className="data-block">
            <div className="data-block-head">
                <b>{table.title}</b>
                <button className="link muted small" onClick={() => download(`${table.id}.csv`, tableCsv(table))}>
                    CSV
                </button>
            </div>
            {table.note && <p className="muted small">{table.note}</p>}
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            {table.columns.map((c) => (
                                <th key={c}>{c}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {table.rows.map((r, i) => (
                            <tr key={i}>
                                {r.map((c, j) => (
                                    <td key={j}>
                                        {table.columns[j] === 'p' && typeof c === 'number' ? (
                                            <span className={`sig ${c < 0.05 ? 'yes' : 'no'}`}>{fmtP(c)}</span>
                                        ) : /\bp$/.test(table.columns[j]) && typeof c === 'number' ? (
                                            fmtP(c)
                                        ) : (
                                            fmt(c, table.digits ?? 3)
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

// one chart, drawn by chartToSvg so the downloaded SVG is the same picture
function BarChart({ chart, colours }: { chart: Chart; colours: string[] }) {
    const svg = chartToSvg(chart, colours)
    if (!svg) return null
    return (
        <figure className="bar-chart">
            <figcaption>
                <b>{chart.title}</b>
                <button className="link muted small" onClick={() => download(`${chart.id}.svg`, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, 'image/svg+xml')}>
                    Download SVG
                </button>
            </figcaption>
            <div className="bar-chart-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        </figure>
    )
}

export default Compare
