import { useMemo, useRef, useState } from 'react'
import { download } from './csv'
import { detectKind, parseCsv, type Dataset, type FileKind } from './compare/data'
import { buildReport, modelName, type Chart, type Report, type Table } from './compare/metrics'
import { fmt, fmtP, pText, tableCsv, toMarkdown } from './compare/report'

// The pose model comparison: batch-run joints + hand-marked joints in; angle accuracy, which model
// is better in which situation, consistency checks and speed out.

export type LoadedFile = { name: string; kind: FileKind; rows: number }

const COLOURS = ['#1e4fa8', '#e9b308', '#c42a1f', '#586170', '#17202e']

const KIND_LABEL: Record<FileKind, string> = {
    frames: 'Batch run: joints per frame',
    runs: 'Batch run: summary',
    keypoints: 'Hand-marked joints',
    unknown: 'Not recognised',
}

type Props = {
    data: Dataset
    files: LoadedFile[]
    onAdd: (name: string, kind: FileKind, rows: Record<string, unknown>[]) => void
    onClear: () => void
}

function Compare({ data, files, onAdd, onClear }: Props) {
    const [error, setError] = useState('')
    const report = useMemo(() => buildReport(data), [data])
    const colour = (model: string) => COLOURS[Math.max(0, report.models.indexOf(model)) % COLOURS.length]
    const hasAnything = files.length > 0

    async function addFiles(list: FileList | null) {
        setError('')
        for (const file of [...(list ?? [])]) {
            const rows = parseCsv(await file.text())
            const kind = detectKind(rows)
            if (kind === 'unknown') {
                setError(`${file.name}: not a FormCheck CSV (frames, runs or keypoints).`)
                continue
            }
            onAdd(file.name, kind, rows)
        }
    }

    return (
        <div className="compare">
            <section className="card compare-data">
                <div className="compare-data-head">
                    <div>
                        <span className="label">Data</span>
                        <p className="muted small">
                            Add the <b>frames</b> and <b>runs</b> CSVs from Batch evaluation and your <b>keypoints</b> CSVs
                            from Mark joints. Anything you ran or marked in this session is already here.
                        </p>
                    </div>
                    <div className="actions">
                        <label className="btn primary">
                            Add CSV files
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
                            <button className="btn" onClick={onClear}>
                                Clear
                            </button>
                        )}
                    </div>
                </div>
                {error && <p className="form-error">{error}</p>}
                {hasAnything && (
                    <ul className="loaded">
                        {files.map((f, i) => (
                            <li key={i}>
                                <span className={`kind ${f.kind}`}>{KIND_LABEL[f.kind]}</span>
                                <span className="loaded-name">{f.name}</span>
                                <span className="muted">{f.rows.toLocaleString()} rows</span>
                            </li>
                        ))}
                    </ul>
                )}
                {report.missing.length > 0 && hasAnything && (
                    <ul className="missing">
                        {report.missing.map((m) => (
                            <li key={m}>Missing: {m}</li>
                        ))}
                    </ul>
                )}
            </section>

            {report.verdict && <VerdictCard report={report} colour={colour} />}

            {report.sections.map((s) => (
                <section key={s.id} className="card compare-section">
                    <h3>{s.title}</h3>
                    <p className="muted">{s.intro}</p>
                    {s.charts.map((c) => (
                        <BarChart key={c.id} chart={c} colours={report.models.map(colour)} />
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
            ))}

            {!hasAnything && (
                <section className="card compare-empty">
                    <p>
                        <b>How it works:</b> run your clips through <b>Batch evaluation</b> with MediaPipe and YOLO ticked,
                        then mark joints on some frames in <b>Mark joints</b>. This page then shows how far each model's
                        angles are from yours, which model is better in which situation (camera angle, light, distance,
                        exercise, how bent the joint is), consistency checks, speed, and a report to download.
                    </p>
                </section>
            )}
        </div>
    )
}

function VerdictCard({ report, colour }: { report: Report; colour: (m: string) => string }) {
    const v = report.verdict!
    const [A, B] = report.models
    const winner = v.winner && v.winner !== 'tie' ? v.winner : null
    const hasAngles = Object.keys(v.values).length > 0
    const significant = v.p !== null && v.p < 0.05
    const used = v.situations.filter((r) => r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie')
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
                            'Both models measure angles equally well'
                        )}
                    </h2>
                    {winner && (
                        <p className="muted">
                            {significant
                                ? `Across ${v.n} marked angles the difference is statistically significant (Wilcoxon ${pText(v.p)}), so it isn't down to chance.`
                                : `But across ${v.n} marked angles the difference is not statistically significant (Wilcoxon ${pText(v.p)}): with this data the models can't be told apart overall.`}
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
                    {used.length === 0 && <p className="muted small">No situation shows a real difference yet (all p ≥ 0.05).</p>}
                    <div className="recommend-grid">
                        {v.situations.map((r) => {
                            const real = r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie'
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
                                            <span className="muted">No real difference</span>
                                        )}
                                    </span>
                                    <small className="muted">
                                        {fmt(r.values[A] ?? null, 1)}° vs {fmt(r.values[B] ?? null, 1)}° · {r.p === null ? 'p –' : pText(r.p)}
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

function DataTable({ table }: { table: Table }) {
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

// grouped horizontal bars: one row per group, one bar per model.
// Styles are written onto the SVG itself, so "Download SVG" gives a figure ready for the paper.
function BarChart({ chart, colours }: { chart: Chart; colours: string[] }) {
    const svgRef = useRef<SVGSVGElement>(null)
    const values = chart.series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v))
    if (!values.length) return null
    const max = chart.max ?? Math.max(...values) * 1.15
    const bar = 16
    const gap = 4
    const groupH = chart.series.length * (bar + gap) + 14
    const labelW = 190
    const width = 900
    const plotW = width - labelW - 70
    const top = 34
    const height = top + chart.groups.length * groupH + 30
    const font = 'Archivo, Helvetica, Arial, sans-serif'
    const digits = max < 5 ? 2 : 1

    function save() {
        const svg = svgRef.current
        if (!svg) return
        const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`
        download(`${chart.id}.svg`, text, 'image/svg+xml')
    }

    return (
        <figure className="bar-chart">
            <figcaption>
                <b>{chart.title}</b>
                <button className="link muted small" onClick={save}>
                    Download SVG
                </button>
            </figcaption>
            <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chart.title} fontFamily={font}>
                <rect width={width} height={height} fill="#ffffff" />
                {chart.series.map((s, i) => (
                    <g key={s.name} transform={`translate(${labelW + i * 170} 10)`}>
                        <rect width={12} height={12} fill={colours[i]} rx={2} />
                        <text x={18} y={11} fontSize={13} fill="#586170">
                            {s.name}
                        </text>
                    </g>
                ))}
                {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                    <g key={t}>
                        <line x1={labelW + t * plotW} x2={labelW + t * plotW} y1={top - 4} y2={height - 26} stroke="#ebece8" />
                        <text x={labelW + t * plotW} y={height - 10} textAnchor="middle" fontSize={12} fill="#586170">
                            {(t * max).toFixed(digits)}
                            {t === 1 ? ` ${chart.yLabel}` : ''}
                        </text>
                    </g>
                ))}
                {chart.groups.map((g, gi) => (
                    <g key={g} transform={`translate(0 ${top + gi * groupH})`}>
                        <text x={labelW - 12} y={(chart.series.length * (bar + gap)) / 2 + 3} textAnchor="end" fontSize={13} fontWeight={600} fill="#17202e">
                            {g}
                        </text>
                        {chart.series.map((s, si) => {
                            const v = s.values[gi]
                            const ok = v !== null && Number.isFinite(v)
                            const w = ok ? Math.max(1, (v / max) * plotW) : 0
                            return (
                                <g key={s.name} transform={`translate(${labelW} ${si * (bar + gap)})`}>
                                    <rect width={w} height={bar} fill={colours[si]} rx={1} />
                                    <text x={w + 6} y={bar - 4} fontSize={12} fill="#586170">
                                        {ok ? v.toFixed(digits) : 'n/a'}
                                    </text>
                                </g>
                            )
                        })}
                    </g>
                ))}
            </svg>
        </figure>
    )
}

export default Compare
