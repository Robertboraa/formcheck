// Draws a comparison chart as SVG text: grouped horizontal bars, one row per group, one bar per model.
// Used on the page and in the downloads, so the figure in the paper is exactly the one on screen.

import type { Chart } from './metrics'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function chartToSvg(chart: Chart, colours: string[]): string | null {
    const values = chart.series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v))
    if (!values.length) return null
    const max = chart.max ?? (Math.max(...values) * 1.15 || 1)
    const bar = 16
    const gap = 4
    const groupH = chart.series.length * (bar + gap) + 14
    const labelW = 190
    const width = 900
    const plotW = width - labelW - 70
    const perRow = 4
    const legendRows = Math.ceil(chart.series.length / perRow)
    const top = 14 + legendRows * 20
    const height = top + chart.groups.length * groupH + 30
    const digits = max < 5 ? 2 : 1
    const out: string[] = []
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Archivo, Helvetica, Arial, sans-serif" role="img" aria-label="${esc(chart.title)}">`)
    out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
    chart.series.forEach((s, i) => {
        const x = labelW + (i % perRow) * 170
        const y = 10 + Math.floor(i / perRow) * 20
        out.push(`<rect x="${x}" y="${y}" width="12" height="12" rx="2" fill="${colours[i]}"/><text x="${x + 18}" y="${y + 11}" font-size="13" fill="#586170">${esc(s.name)}</text>`)
    })
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const x = labelW + t * plotW
        out.push(`<line x1="${x}" x2="${x}" y1="${top - 4}" y2="${height - 26}" stroke="#ebece8"/>`)
        out.push(`<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="12" fill="#586170">${(t * max).toFixed(digits)}${t === 1 && chart.yLabel ? ` ${esc(chart.yLabel)}` : ''}</text>`)
    }
    chart.groups.forEach((g, gi) => {
        const y0 = top + gi * groupH
        out.push(`<text x="${labelW - 12}" y="${y0 + (chart.series.length * (bar + gap)) / 2 + 3}" text-anchor="end" font-size="13" font-weight="600" fill="#17202e">${esc(g)}</text>`)
        chart.series.forEach((s, si) => {
            const v = s.values[gi]
            const ok = v !== null && Number.isFinite(v)
            const w = ok ? Math.max(1, (v / max) * plotW) : 0
            const y = y0 + si * (bar + gap)
            out.push(`<rect x="${labelW}" y="${y}" width="${w}" height="${bar}" rx="1" fill="${colours[si]}"/>`)
            out.push(`<text x="${labelW + w + 6}" y="${y + bar - 4}" font-size="12" fill="#586170">${ok ? v.toFixed(digits) : 'n/a'}</text>`)
        })
    })
    out.push('</svg>')
    return out.join('\n')
}
