// Writes the comparison as a Markdown report, ready to paste into the paper.

import { modelName, type Cell, type Report, type Table } from './metrics'
import { summarize } from './summary'

// chart and card colours per model, from the app's plate colours
export const COLOURS = ['#1e4fa8', '#e9b308', '#c42a1f', '#586170', '#17202e']

export function fmt(v: Cell, digits = 3): string {
    if (v === null || v === undefined) return '–'
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return '–'
        if (Number.isInteger(v) && Math.abs(v) >= 1 && digits !== 0) return String(v)
        return v.toFixed(digits)
    }
    return v
}

export const fmtP = (p: number | null) => (p === null || !Number.isFinite(p) ? '–' : p < 0.001 ? '< 0.001' : p.toFixed(3))

// for sentences: "p < 0.001" or "p = 0.032"
export const pText = (p: number | null) => (p === null || !Number.isFinite(p) ? 'p not available' : p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`)

function mdTable(t: Table) {
    const head = `| ${t.columns.join(' | ')} |\n|${t.columns.map(() => '---').join('|')}|\n`
    const body = t.rows
        .map((r) => `| ${r.map((c, i) => (/\bp$/.test(t.columns[i]) && typeof c === 'number' ? fmtP(c) : fmt(c, t.digits ?? 3))).join(' | ')} |`)
        .join('\n')
    return head + body + '\n'
}

const fixed = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(Math.abs(v) >= 10 ? 1 : 3))

export function toMarkdown(report: Report) {
    const out: string[] = ['# Pose model comparison: ' + report.models.map(modelName).join(' vs '), '']
    out.push(
        'Every model ran the same videos, frame by frame. Joint angles from each model were compared with angles from joints marked by hand on the same frames.',
        '',
    )
    const v = report.verdict
    const findings = summarize(report)
    if (findings.length) out.push('## What the data says', '', ...findings.flatMap((l) => [l, '']))
    if (v) {
        out.push('## Overall', '')
        if (Object.keys(v.values).length) {
            const vals = report.models.map((m) => `${modelName(m)} ${fixed(v.values[m])}°`).join(', ')
            if (v.winner && v.winner !== 'tie')
                out.push(`**${modelName(v.winner)}** measured joint angles more accurately (mean error: ${vals}; ${v.n} marked angles; Wilcoxon ${pText(v.p)}${v.p !== null && v.p >= 0.05 ? ', not significant' : ''}).`, '')
            else out.push(`Both models measured joint angles equally well (mean error: ${vals}).`, '')
        }
        out.push(
            mdTable({
                id: 'overall',
                title: 'Overall',
                columns: ['measure', ...report.models.map(modelName), 'better', 'p'],
                rows: v.rows.map((r) => [r.metric, ...report.models.map((m) => fixed(r.values[m])), r.better === 'tie' ? 'tie' : r.better ? modelName(r.better) : '–', r.p]),
            }),
        )
        out.push('Measures won: ' + Object.entries(v.wins).map(([m, n]) => `${modelName(m)} ${n}`).join(', '), '')
        if (v.situations.length) {
            out.push('### Which model to use where', '')
            out.push(
                mdTable({
                    id: 'where',
                    title: 'Where',
                    columns: ['situation', 'marked angles', ...report.models.map((m) => `${modelName(m)} °`), 'use', 'p (best vs runner-up)'],
                    rows: v.situations.map((r) => [
                        `${r.dimension}: ${r.situation}`,
                        r.n,
                        ...report.models.map((m) => fixed(r.values[m])),
                        r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie' ? modelName(r.better) : 'no clear winner',
                        r.p,
                    ]),
                }),
            )
        }
    }
    for (const s of report.sections) {
        out.push(`## ${s.title}`, '', s.intro, '')
        for (const t of s.tables) out.push(`**${t.title}**${t.note ? ` ${t.note}` : ''}`, '', mdTable(t))
        for (const n of s.notes) out.push(`_${n}_`, '')
    }
    return out.join('\n')
}

export function tableCsv(t: Table) {
    const esc = (c: Cell) => {
        const s = typeof c === 'number' ? (Number.isFinite(c) ? String(Math.round(c * 10000) / 10000) : '') : (c ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return [t.columns.map(esc).join(','), ...t.rows.map((r) => r.map(esc).join(','))].join('\n') + '\n'
}
