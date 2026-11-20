// The pose model comparison: how close each model's joint angles are to the hand-marked truth,
// in which situations each model does better, plus checks that need no hand marking.
// Compare.tsx draws the result; report.ts writes it as Markdown.

import { modelInfo } from '../pose'
import { clip, JOINT_INDEX, type Dataset, type FrameRow, type KeypointRow } from './data'
import { angle, auroc, dist, finite, mean, median, percentile, spearman, std, tilt, wilcoxon, type Pt } from './stats'
import { createEngine } from '../engine'
import { findExercise } from '../exercises'
import { JOINTS } from '../csv'
import type { Landmark } from '../pose'

export type Cell = string | number | null
export type Table = { id: string; title: string; note?: string; columns: string[]; rows: Cell[][]; digits?: number }
export type Chart = {
    id: string
    title: string
    groups: string[]
    series: { name: string; values: (number | null)[] }[]
    yLabel: string
    max?: number
}
export type Section = { id: string; title: string; intro: string; tables: Table[]; charts: Chart[]; notes: string[] }

// one row of "which model is better here"
export type SituationRow = {
    dimension: string
    situation: string
    n: number
    values: Record<string, number> // mean angle error per model
    better: string | null // model id, 'tie' or null
    runnerUp: string | null // second-best model, the one the test compares against
    p: number | null // best vs runner-up
}
export type OverallRow = { metric: string; values: Record<string, number>; higherIsBetter: boolean; better: string | null; p: number | null }
export type Verdict = {
    winner: string | null
    values: Record<string, number> // overall mean angle error
    p: number | null
    n: number
    wins: Record<string, number>
    rows: OverallRow[]
    situations: SituationRow[]
    recommendations: string[]
}
// the frames where a model was furthest from the hand marks (for the picture gallery)
export type WorstFrame = { model: string; video: string; frame: number; side: 'l' | 'r'; err: number; worstAngle: string; worstErr: number }
export type Report = { models: string[]; sections: Section[]; verdict: Verdict | null; missing: string[]; worst: WorstFrame[]; facts: Facts }

// the numbers the written summary is built from
export type Facts = {
    clips: number
    markedFrames: number
    markedAngles: number
    confidence: Record<string, { rho: number; auroc: number }>
    reps: Record<string, { clips: number; mae: number; exact: number }>
    bottomVsAll: Record<string, { bottom: number; all: number }>
    sizeMB: Record<string, number>
    fps: Record<string, number>
}

export const modelName = (id: string) => (modelInfo(id).id === id ? modelInfo(id).name : id)

// the angles the rules use, from points on one side of the body
export const ANGLES: Record<string, { joints: string[]; fn: (...p: Pt[]) => number; bends?: boolean }> = {
    knee: { joints: ['hip', 'knee', 'ankle'], fn: angle, bends: true },
    elbow: { joints: ['shoulder', 'elbow', 'wrist'], fn: angle, bends: true },
    hip: { joints: ['shoulder', 'hip', 'knee'], fn: angle, bends: true },
    'body line': { joints: ['shoulder', 'hip', 'ankle'], fn: angle },
    neck: { joints: ['ear', 'shoulder', 'hip'], fn: angle },
    'torso lean': { joints: ['shoulder', 'hip'], fn: tilt },
}

// how bent a joint is, from the true angle
function bendOf(name: string, truth: number) {
    if (!ANGLES[name].bends) return null
    if (truth < 90) return 'deep bend (under 90°)'
    if (truth < 140) return 'half bent (90–140°)'
    return 'nearly straight (over 140°)'
}

// the angle that matters most for each exercise (used for the checks without hand marking)
export const KEY_ANGLE: Record<string, string> = { squat: 'knee', pushup: 'elbow' }

// bones whose real length never changes, so their length on screen should stay steady (side-on clips)
const BONES: Record<string, [string, string]> = {
    thigh: ['hip', 'knee'],
    shin: ['knee', 'ankle'],
    'upper arm': ['shoulder', 'elbow'],
    forearm: ['elbow', 'wrist'],
}
const BONE_EXERCISE: Record<string, string[]> = { thigh: ['squat', 'pushup'], shin: ['squat', 'pushup'], 'upper arm': ['pushup'], forearm: ['pushup'] }

const ORDER = ['side', 'diagonal', 'dim', 'far']

// ---------- helpers ----------

function point(f: FrameRow, joint: string, minVis = 0): Pt | null {
    const i = JOINT_INDEX[joint]
    if (i === undefined) return null
    const x = f.pts[i * 3]
    const y = f.pts[i * 3 + 1]
    const v = f.pts[i * 3 + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (minVis > 0 && !(v >= minVis)) return null
    return [x, y]
}

const sideName = (side: 'l' | 'r', base: string) => (base === 'nose' ? 'nose' : `${side}_${base}`)

export function angleFrom(f: FrameRow, side: 'l' | 'r', name: string): number {
    if (!f.detected) return NaN
    const pts = ANGLES[name].joints.map((j) => point(f, sideName(side, j)))
    return pts.every(Boolean) ? ANGLES[name].fn(...(pts as Pt[])) : NaN
}

function groupBy<T>(items: T[], key: (t: T) => string) {
    const m = new Map<string, T[]>()
    for (const t of items) {
        const k = key(t)
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(t)
    }
    return m
}

function sortModels(ids: string[]) {
    const order = ['mediapipe-full', 'mediapipe-lite', 'mediapipe-heavy', 'yolo11n', 'yolo11s']
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : 99)
    return [...ids].sort((a, b) => rank(a) - rank(b))
}

const sortSituations = (xs: string[]) =>
    [...xs].sort((a, b) => {
        const ia = ORDER.indexOf(a)
        const ib = ORDER.indexOf(b)
        if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
        return a.localeCompare(b)
    })

function better(values: Record<string, number>, higherIsBetter: boolean): string | null {
    const valid = Object.entries(values).filter(([, v]) => Number.isFinite(v))
    if (valid.length < 2) return null
    valid.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]))
    return Math.abs(valid[0][1] - valid[valid.length - 1][1]) < 1e-9 ? 'tie' : valid[0][0]
}

const pct = (x: number) => 100 * x

// the best and second-best model for a set of values (the pair the significance test compares)
function topTwo(values: Record<string, number>, higherIsBetter: boolean): [string, string] | null {
    const valid = Object.entries(values).filter(([, v]) => Number.isFinite(v))
    if (valid.length < 2) return null
    valid.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]))
    return [valid[0][0], valid[1][0]]
}

// paired Wilcoxon test between two models on items matched by key
function pairTest<T>(items: T[], a: string, b: string, model: (t: T) => string, key: (t: T) => string, value: (t: T) => number) {
    const vb = new Map(items.filter((t) => model(t) === b && Number.isFinite(value(t))).map((t) => [key(t), value(t)]))
    const both = items.filter((t) => model(t) === a && Number.isFinite(value(t)) && vb.has(key(t)))
    const w = wilcoxon(both.map(value), both.map((t) => vb.get(key(t))!))
    return Number.isFinite(w.p) ? w.p : null
}

// Holm–Bonferroni: adjusts p-values when several comparisons are made at once
function holm(ps: number[]) {
    const order = ps.map((p, i) => [p, i] as const).sort((x, y) => x[0] - y[0])
    const out = new Array<number>(ps.length)
    let running = 0
    order.forEach(([p, i], rank) => {
        running = Math.max(running, Math.min(1, p * (ps.length - rank)))
        out[i] = running
    })
    return out
}

// ---------- the measurements against hand marks ----------

// one hand-marked angle, measured by one model
export type AngleErr = {
    model: string
    key: string // video|frame|angle, to pair the models up
    video: string
    frame: number
    exercise: string
    condition: string
    source: string
    person: string
    angle: string
    bend: string | null
    phase: string | null // top, halfway or bottom of the rep
    size: string | null // how big the person is in the frame
    truth: number
    pred: number // NaN = the model missed it
    err: number // |pred − truth|, NaN when missed
    signed: number // pred − truth
}

type PointErr = { model: string; key: string; video: string; frame: number; condition: string; joint: string; found: boolean; px: number; norm: number; conf: number }

// how big the person is: height of the marked joints as a share of the frame height
function sizeOf(fraction: number) {
    if (!Number.isFinite(fraction)) return null
    if (fraction < 0.4) return 'small (under 40% of frame height)'
    if (fraction < 0.65) return 'medium (40–65%)'
    return 'large (over 65%)'
}

function measure(keypoints: KeypointRow[], frameIndex: Map<string, FrameRow>, models: string[]) {
    const angles: AngleErr[] = []
    const points: PointErr[] = []
    const marked = keypoints.filter((k) => Number.isFinite(k.x) && Number.isFinite(k.y))

    // the phase of each marked frame, from the true key angle: the lowest quarter of a clip's range is the
    // bottom of the rep, the highest quarter the top, the rest halfway
    const keyTruth = new Map<string, number>()
    for (const [key, ks] of groupBy(marked, (k) => `${k.video}|${k.frame}`)) {
        const name = KEY_ANGLE[clip(ks[0].video).exercise]
        if (!name) continue
        const truth = new Map(ks.map((k) => [k.joint.replace(/^[lr]_/, ''), [k.x, k.y] as Pt]))
        if (ANGLES[name].joints.every((j) => truth.has(j))) keyTruth.set(key, ANGLES[name].fn(...ANGLES[name].joints.map((j) => truth.get(j)!)))
    }
    const range = new Map<string, [number, number]>()
    for (const [key, v] of keyTruth) {
        const video = key.slice(0, key.lastIndexOf('|'))
        const r = range.get(video) ?? [Infinity, -Infinity]
        range.set(video, [Math.min(r[0], v), Math.max(r[1], v)])
    }
    const phaseOf = (key: string, video: string) => {
        const v = keyTruth.get(key)
        const r = range.get(video)
        if (v === undefined || !r || r[1] - r[0] < 20) return null // too few marked frames to tell
        const t = (v - r[0]) / (r[1] - r[0])
        return t <= 0.25 ? 'bottom of the rep' : t >= 0.75 ? 'top of the rep' : 'halfway'
    }

    for (const [key, ks] of groupBy(marked, (k) => `${k.video}|${k.frame}`)) {
        const side = ks[0].side
        const c = clip(ks[0].video)
        const base = (j: string) => j.replace(/^[lr]_/, '')
        const truth = new Map(ks.map((k) => [base(k.joint), [k.x, k.y] as Pt]))
        const torso = truth.has('shoulder') && truth.has('hip') ? dist(truth.get('shoulder')!, truth.get('hip')!) : NaN
        const ys = ks.map((k) => k.y)
        const phase = phaseOf(key, ks[0].video)
        for (const model of models) {
            const f = frameIndex.get(`${key}|${model}`)
            if (!f) continue
            const size = sizeOf((Math.max(...ys) - Math.min(...ys)) / f.height)
            for (const k of ks) {
                const p = f.detected ? point(f, k.joint) : null
                const px = p ? dist(p, [k.x, k.y]) : NaN
                const i = JOINT_INDEX[k.joint]
                points.push({
                    model,
                    key: `${key}|${k.joint}`,
                    video: k.video,
                    frame: k.frame,
                    condition: c.condition,
                    joint: base(k.joint),
                    found: !!p,
                    px,
                    norm: p ? px / torso : Infinity,
                    conf: f.detected && i !== undefined ? f.pts[i * 3 + 2] : NaN,
                })
            }
            for (const [name, def] of Object.entries(ANGLES)) {
                if (!def.joints.every((j) => truth.has(j))) continue
                const t = def.fn(...def.joints.map((j) => truth.get(j)!))
                const pred = angleFrom(f, side, name)
                angles.push({
                    model,
                    key: `${key}|${name}`,
                    video: ks[0].video,
                    frame: ks[0].frame,
                    exercise: c.exercise || '?',
                    condition: c.condition,
                    source: c.source,
                    person: c.participant,
                    angle: name,
                    bend: bendOf(name, t),
                    phase,
                    size,
                    truth: t,
                    pred,
                    err: Math.abs(pred - t),
                    signed: pred - t,
                })
            }
        }
    }
    return { angles, points }
}

// paired test between the first two models on the same marked angles
function pairedP(errs: AngleErr[], a: string, b: string) {
    const mb = new Map(errs.filter((e) => e.model === b && Number.isFinite(e.err)).map((e) => [e.key, e.err]))
    const both = errs.filter((e) => e.model === a && Number.isFinite(e.err) && mb.has(e.key))
    const w = wilcoxon(both.map((e) => e.err), both.map((e) => mb.get(e.key)!))
    return { p: Number.isFinite(w.p) ? w.p : null, n: both.length }
}

// ---------- the report ----------

export function buildReport(data: Dataset): Report {
    const models = sortModels([...new Set(data.frames.map((f) => f.model))])
    const ref = models[0] // the reference for the agreement table
    const missing: string[] = []
    if (!data.frames.length) missing.push('frames.csv from a batch run: the joints each model found')
    if (!data.keypoints.length) missing.push('keypoints CSVs (joints you marked by hand): needed for angle accuracy, the main result')
    if (models.length < 2) missing.push('results from at least two models: run the batch with MediaPipe and YOLO both ticked')

    const sections: Section[] = []
    const overall: OverallRow[] = []
    const situations: SituationRow[] = []
    const addOverall = (metric: string, values: Record<string, number>, higherIsBetter: boolean, p: number | null = null) =>
        overall.push({ metric, values, higherIsBetter, better: better(values, higherIsBetter), p })

    const frameIndex = new Map(data.frames.map((f) => [`${f.video}|${f.frame}|${f.model}`, f]))
    const { angles, points } = data.keypoints.length && data.frames.length ? measure(data.keypoints, frameIndex, models) : { angles: [], points: [] }
    const hits = angles.filter((e) => Number.isFinite(e.err))
    const videos = [...new Set(data.frames.map((f) => f.video))]

    // ===== dataset =====
    if (data.frames.length) {
        const s: Section = { id: 'dataset', title: 'Dataset', intro: 'Clips run through the models, and frames marked by hand. Exercise and camera setup come from the file names.', tables: [], charts: [], notes: [] }
        const rows: Cell[][] = []
        for (const [key, vs] of groupBy(videos, (v) => `${clip(v).exercise || '?'}|${clip(v).condition}`)) {
            const [ex, cond] = key.split('|')
            const marked = new Set(data.keypoints.filter((k) => vs.includes(k.video)).map((k) => `${k.video}|${k.frame}`)).size
            rows.push([ex, cond, vs.length, new Set(vs.map((v) => clip(v).participant)).size, marked])
        }
        rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || ORDER.indexOf(String(a[1])) - ORDER.indexOf(String(b[1])))
        s.tables.push({ id: 'dataset', title: 'Clips and marked frames', columns: ['exercise', 'camera', 'clips', 'people', 'frames marked by hand'], rows, digits: 0 })
        if (data.keypoints.length) {
            const unmatched = [...new Set(data.keypoints.map((k) => k.video))].filter((v) => !videos.includes(v))
            if (unmatched.length) s.notes.push(`Marked clips with no batch run yet (left out): ${unmatched.join(', ')}`)
        }
        sections.push(s)
    }

    // ===== angle accuracy =====
    if (hits.length) {
        const s: Section = {
            id: 'angles',
            title: 'Angle accuracy',
            intro: 'Each angle the rules use, worked out from your hand-marked joints (the truth) and from each model’s joints on the same frame. Error = the gap in degrees. Bias shows whether a model reads angles too big (+) or too small (−).',
            tables: [],
            charts: [],
            notes: [],
        }
        const names = Object.keys(ANGLES).filter((a) => hits.some((e) => e.angle === a))
        const rows: Cell[][] = []
        const chart: Record<string, (number | null)[]> = Object.fromEntries(models.map((m) => [m, []]))
        for (const name of [...names, 'all']) {
            for (const m of models) {
                const all = angles.filter((e) => e.model === m && (name === 'all' || e.angle === name))
                const es = all.filter((e) => Number.isFinite(e.err))
                const err = es.map((e) => e.err)
                rows.push([
                    name,
                    modelName(m),
                    es.length,
                    mean(err),
                    median(err),
                    Math.sqrt(mean(err.map((x) => x * x))),
                    mean(es.map((e) => e.signed)),
                    pct(mean(err.map((x) => +(x <= 5)))),
                    pct(mean(err.map((x) => +(x <= 10)))),
                    all.length ? pct(1 - es.length / all.length) : NaN,
                ])
                if (name !== 'all') chart[m].push(err.length ? mean(err) : null)
            }
        }
        s.tables.push({
            id: 'angle_accuracy',
            title: 'Angle error against the hand-marked truth',
            note: 'Lower error = more realistic. "Within 10°" is the share of angles close enough for a form rule to trust. "Missed" = the model gave no joint there.',
            columns: ['angle', 'model', 'frames', 'mean error °', 'median °', 'RMSE °', 'bias °', 'within 5° %', 'within 10° %', 'missed %'],
            rows,
            digits: 1,
        })
        s.charts.push({ id: 'angle_mae', title: 'Mean angle error per angle (lower is better)', groups: names, series: models.map((m) => ({ name: modelName(m), values: chart[m] })), yLabel: '°' })

        if (models.length >= 2) {
            const errOf = (sel: AngleErr[], m: string) => mean(sel.filter((e) => e.model === m && Number.isFinite(e.err)).map((e) => e.err))
            const tests: Cell[][] = []
            for (const name of [...names, 'all']) {
                const sel = angles.filter((e) => name === 'all' || e.angle === name)
                const values = Object.fromEntries(models.map((m) => [m, errOf(sel, m)]))
                const top = topTwo(values, false)
                if (!top) continue
                const { p, n } = pairedP(sel, top[0], top[1])
                tests.push([name, n, modelName(top[0]), values[top[0]], modelName(top[1]), values[top[1]], p])
            }
            s.tables.push({
                id: 'angle_tests',
                title: 'Is the best model really closer? (best vs runner-up)',
                note: 'Wilcoxon signed-rank test on the same marked frames. p < 0.05 = the best model really is closer to the truth than the next one; otherwise the gap could be chance.',
                columns: ['angle', 'pairs', 'best', 'best °', 'runner-up', 'runner-up °', 'p'],
                rows: tests,
                digits: 2,
            })
            if (models.length > 2) {
                const pairs: [string, string][] = []
                for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) pairs.push([models[i], models[j]])
                const raw = pairs.map(([x, y]) => pairedP(angles, x, y))
                const adjusted = holm(raw.map((r) => r.p ?? 1))
                s.tables.push({
                    id: 'angle_pairs',
                    title: 'Every pair of models, all angles',
                    note: 'With several models, some comparisons come out "significant" by luck, so the p-values are Holm-corrected for the number of pairs.',
                    columns: ['model A', 'model B', 'pairs', 'A °', 'B °', 'p (Holm)'],
                    rows: pairs.map(([x, y], i) => [modelName(x), modelName(y), raw[i].n, errOf(angles, x), errOf(angles, y), raw[i].p === null ? null : adjusted[i]]),
                    digits: 2,
                })
            }
            const values = Object.fromEntries(models.map((m) => [m, errOf(angles, m)]))
            const top = topTwo(values, false)
            addOverall('Mean angle error (°)', values, false, top ? pairedP(angles, top[0], top[1]).p : null)
            addOverall('Angles within 10° of the truth (%)', Object.fromEntries(models.map((m) => [m, pct(mean(hits.filter((e) => e.model === m).map((e) => +(e.err <= 10))))])), true)
            addOverall('Size of bias (|mean signed error| °)', Object.fromEntries(models.map((m) => [m, Math.abs(mean(hits.filter((e) => e.model === m).map((e) => e.signed)))])), false)
        }
        sections.push(s)

        // ===== which model where =====
        const sit: Section = {
            id: 'situations',
            title: 'Which model is better in which situation',
            intro: 'Mean angle error split by situation. "Better" is the model closer to the truth there; p says whether that gap is real (p < 0.05) or could be chance.',
            tables: [],
            charts: [],
            notes: [],
        }
        const dims: { id: string; label: string; of: (e: AngleErr) => string | null; order?: (xs: string[]) => string[] }[] = [
            { id: 'camera', label: 'Camera setup', of: (e) => e.condition, order: sortSituations },
            { id: 'exercise', label: 'Exercise', of: (e) => e.exercise },
            { id: 'bend', label: 'How bent the joint is', of: (e) => e.bend, order: (xs) => [...xs].sort((a, b) => ['deep', 'half', 'nearly'].findIndex((w) => a.startsWith(w)) - ['deep', 'half', 'nearly'].findIndex((w) => b.startsWith(w))) },
            { id: 'phase', label: 'Rep phase', of: (e) => e.phase, order: (xs) => ['top of the rep', 'halfway', 'bottom of the rep'].filter((x) => xs.includes(x)) },
            { id: 'size', label: 'Person size in frame', of: (e) => e.size, order: (xs) => ['small', 'medium', 'large'].map((w) => xs.find((x) => x.startsWith(w))).filter((x): x is string => !!x) },
            { id: 'angle', label: 'Angle', of: (e) => e.angle, order: (xs) => Object.keys(ANGLES).filter((a) => xs.includes(a)) },
            { id: 'person', label: 'Person', of: (e) => e.person || null },
            { id: 'source', label: 'Whose clips', of: (e) => (e.source === 'unknown' ? null : e.source) },
        ]
        for (const d of dims) {
            const groups = [...new Set(angles.map(d.of).filter((x): x is string => !!x))]
            if (groups.length < 1 || ((d.id === 'source' || d.id === 'person') && groups.length < 2)) continue
            const ordered = d.order ? d.order(groups) : groups.sort()
            const rows: Cell[][] = []
            const chart: Record<string, (number | null)[]> = Object.fromEntries(models.map((m) => [m, []]))
            for (const g of ordered) {
                const sel = angles.filter((e) => d.of(e) === g)
                const values = Object.fromEntries(models.map((m) => [m, mean(sel.filter((e) => e.model === m && Number.isFinite(e.err)).map((e) => e.err))]))
                const n = new Set(sel.map((e) => e.key)).size
                const top = topTwo(values, false)
                const res = top ? pairedP(sel, top[0], top[1]) : { p: null }
                const b = better(values, false)
                situations.push({ dimension: d.label, situation: g, n, values, better: b, runnerUp: top ? top[1] : null, p: res.p })
                rows.push([g, n, ...models.map((m) => values[m]), b === 'tie' ? 'tie' : b ? modelName(b) : '–', res.p])
                for (const m of models) chart[m].push(Number.isFinite(values[m]) ? values[m] : null)
            }
            sit.tables.push({ id: `situation_${d.id}`, title: d.label, columns: [d.label.toLowerCase(), 'marked angles', ...models.map((m) => `${modelName(m)} °`), 'better', 'p'], rows, digits: 2 })
            if (d.id !== 'angle') sit.charts.push({ id: `situation_${d.id}`, title: `Mean angle error by ${d.label.toLowerCase()} (lower is better)`, groups: ordered, series: models.map((m) => ({ name: modelName(m), values: chart[m] })), yLabel: '°' })
        }
        if (sit.tables.length) sections.push(sit)
    }

    // ===== joint placement =====
    if (points.length) {
        const s: Section = { id: 'joints', title: 'Joint placement', intro: 'How close each model puts each joint to your mark, as a share of torso length (so near and far clips compare fairly).', tables: [], charts: [], notes: [] }
        s.tables.push({
            id: 'pck',
            title: 'Joint placement accuracy',
            note: 'PCK@α = share of joints within α × torso length of your mark. Higher is better.',
            columns: ['model', 'joints', 'mean error px', 'mean error (% torso)', 'PCK@0.1', 'PCK@0.2'],
            rows: models.map((m) => {
                const ps = points.filter((p) => p.model === m)
                return [modelName(m), ps.length, mean(finite(ps.map((p) => p.px))), pct(mean(finite(ps.map((p) => p.norm)))), mean(ps.map((p) => +(p.norm <= 0.1))), mean(ps.map((p) => +(p.norm <= 0.2)))]
            }),
        })
        const joints = ['nose', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'].filter((j) => points.some((p) => p.joint === j))
        const rows: Cell[][] = []
        const chart: Record<string, (number | null)[]> = Object.fromEntries(models.map((m) => [m, []]))
        for (const j of joints) {
            const sel = points.filter((p) => p.joint === j)
            const values = Object.fromEntries(models.map((m) => [m, pct(mean(finite(sel.filter((p) => p.model === m).map((p) => p.norm))))]))
            const top = topTwo(values, false)
            const p = top ? pairTest(sel.filter((x) => x.found), top[0], top[1], (x) => x.model, (x) => x.key, (x) => x.norm) : null
            const b = better(values, false)
            rows.push([j, sel.length / Math.max(models.length, 1), ...models.map((m) => values[m]), b === 'tie' ? 'tie' : b ? modelName(b) : '–', p])
            for (const m of models) chart[m].push(Number.isFinite(values[m]) ? values[m] : null)
        }
        s.tables.push({ id: 'joint_error', title: 'Error per joint (% of torso length)', columns: ['joint', 'marks', ...models.map((m) => `${modelName(m)} %`), 'better', 'p'], rows, digits: 2 })
        s.charts.push({ id: 'joint_error', title: 'Joint placement error (lower is better)', groups: joints, series: models.map((m) => ({ name: modelName(m), values: chart[m] })), yLabel: '% torso' })
        addOverall('Joints within 0.2 torso of the mark (PCK@0.2)', Object.fromEntries(models.map((m) => [m, mean(points.filter((p) => p.model === m).map((p) => +(p.norm <= 0.2)))])), true)
        sections.push(s)
    }

    // ===== can the models' confidence be trusted? =====
    const confidence: Facts['confidence'] = {}
    if (points.length) {
        const s: Section = {
            id: 'confidence',
            title: 'Can each model’s confidence be trusted?',
            intro: 'Every model gives a confidence score for each joint. A useful score is low when the joint is badly placed, so the app could ignore those joints. A "bad" joint here is more than 10% of torso length from your mark.',
            tables: [],
            charts: [],
            notes: ['The scores mean slightly different things: MediaPipe reports how likely the joint is visible, the others how sure they are of the position. Compare how useful each score is, not the raw numbers.'],
        }
        const rows: Cell[][] = []
        const bins: [string, (c: number) => boolean][] = [
            ['under 0.5', (c) => c < 0.5],
            ['0.5–0.8', (c) => c >= 0.5 && c < 0.8],
            ['0.8 and over', (c) => c >= 0.8],
        ]
        const binRows: Cell[][] = []
        for (const m of models) {
            const ps = points.filter((p) => p.model === m && p.found && Number.isFinite(p.conf) && Number.isFinite(p.norm))
            const rho = spearman(ps.map((p) => p.conf), ps.map((p) => p.norm))
            const auc = auroc(ps.map((p) => p.conf), ps.map((p) => p.norm > 0.1))
            confidence[m] = { rho, auroc: auc }
            rows.push([modelName(m), ps.length, rho, auc, pct(mean(ps.map((p) => +(p.norm > 0.1))))])
            for (const [label, test] of bins) {
                const sel = ps.filter((p) => test(p.conf))
                binRows.push([modelName(m), label, sel.length, sel.length ? pct(sel.length / ps.length) : NaN, pct(mean(sel.map((p) => p.norm))), pct(mean(sel.map((p) => +(p.norm > 0.1))))])
            }
        }
        s.tables.push({
            id: 'confidence',
            title: 'Does a low score mean a badly placed joint?',
            note: 'Spearman ρ between confidence and error: negative = lower confidence goes with bigger error (good). AUROC: how well the score separates bad joints from good ones (0.5 = no better than guessing, 1 = perfect).',
            columns: ['model', 'joints', 'Spearman ρ', 'AUROC', 'bad joints %'],
            rows,
        })
        s.tables.push({ id: 'confidence_bins', title: 'Error by confidence score', columns: ['model', 'confidence', 'joints', 'share %', 'mean error (% torso)', 'bad joints %'], rows: binRows, digits: 1 })
        s.charts.push({ id: 'confidence_auroc', title: 'How well the confidence score spots bad joints (AUROC, higher is better)', groups: ['AUROC'], series: models.map((m) => ({ name: modelName(m), values: [Number.isFinite(confidence[m].auroc) ? confidence[m].auroc : null] })), yLabel: '', max: 1 })
        addOverall('Confidence spots bad joints (AUROC)', Object.fromEntries(models.map((m) => [m, confidence[m].auroc])), true)
        sections.push(s)
    }

    // ===== checks with no hand marking =====
    if (data.frames.length) {
        const s: Section = {
            id: 'consistency',
            title: 'Consistency checks (no hand marking needed)',
            intro: "These run on every frame of every clip. A still body doesn't move and bones don't change length, so a model that breaks these less is placing joints more reliably.",
            tables: [],
            charts: [],
            notes: [],
        }
        const runs = [...groupBy(data.frames, (f) => `${f.video}|${f.model}`)].map(([, fs]) => ({ video: fs[0].video, model: fs[0].model, frames: fs.sort((a, b) => a.frame - b.frame) }))
        // the side facing the camera for each clip: the side most frames agree on, across all models
        const sideOfClip = new Map<string, 'l' | 'r'>()
        for (const [video, fs] of groupBy(data.frames.filter((f) => f.detected), (f) => f.video)) sideOfClip.set(video, fs.filter((f) => f.side === 'l').length >= fs.length / 2 ? 'l' : 'r')
        const conds = sortSituations([...new Set(videos.map((v) => clip(v).condition))])

        // tracking
        const trackRows: Cell[][] = models.map((m) => {
            const fs = data.frames.filter((f) => f.model === m)
            return [modelName(m), fs.length, pct(mean(fs.map((f) => +f.detected))), ...conds.map((c) => pct(mean(fs.filter((f) => clip(f.video).condition === c).map((f) => +f.detected))))]
        })
        s.tables.push({ id: 'tracking', title: 'Person found (% of frames)', columns: ['model', 'frames', 'all', ...conds], rows: trackRows, digits: 1 })
        addOverall('Person found (% of frames)', Object.fromEntries(models.map((m) => [m, pct(mean(data.frames.filter((f) => f.model === m).map((f) => +f.detected)))])), true)

        // steadiness in the first second, when the person is standing still
        const still: { video: string; model: string; sd: number; wobble: number }[] = []
        for (const r of runs) {
            const key = KEY_ANGLE[clip(r.video).exercise]
            const side = sideOfClip.get(r.video) ?? 'l'
            const win = r.frames.filter((f) => f.detected && f.time <= 1.0)
            if (!key || win.length < 10) continue
            const sd = std(finite(win.map((f) => angleFrom(f, side, key))))
            const moves: number[] = []
            for (let i = 1; i < win.length; i++) {
                const sh = point(win[i], sideName(side, 'shoulder'))
                const hp = point(win[i], sideName(side, 'hip'))
                const torso = sh && hp ? dist(sh, hp) : NaN
                for (const j of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
                    const a = point(win[i - 1], sideName(side, j))
                    const b = point(win[i], sideName(side, j))
                    if (a && b && torso > 0) moves.push(dist(a, b) / torso)
                }
            }
            still.push({ video: r.video, model: r.model, sd, wobble: pct(mean(moves)) })
        }
        if (still.length) {
            s.tables.push({
                id: 'steadiness',
                title: 'Steadiness while standing still',
                note: 'The first second of each clip, before the first rep, when the body is still. Any change in the key angle (knee for squats, elbow for push-ups) or the joints is noise. Lower is better.',
                columns: ['model', 'clips', 'angle wobble (SD °)', 'joint wobble (% torso per frame)'],
                rows: models.map((m) => {
                    const xs = still.filter((x) => x.model === m)
                    return [modelName(m), xs.length, mean(finite(xs.map((x) => x.sd))), mean(finite(xs.map((x) => x.wobble)))]
                }),
                digits: 2,
            })
            const values = Object.fromEntries(models.map((m) => [m, mean(finite(still.filter((x) => x.model === m).map((x) => x.sd)))]))
            const top = topTwo(values, false)
            addOverall('Angle wobble when still (SD °)', values, false, top ? pairTest(still, top[0], top[1], (x) => x.model, (x) => x.video, (x) => x.sd) : null)
        }

        // bone-length consistency (side-on and dim clips: at an angle, bones really do look shorter as they turn)
        const bones: { model: string; video: string; bone: string; cv: number }[] = []
        for (const r of runs) {
            const c = clip(r.video)
            if (c.condition === 'diagonal') continue
            const side = sideOfClip.get(r.video) ?? 'l'
            for (const [bone, [j1, j2]] of Object.entries(BONES)) {
                if (!BONE_EXERCISE[bone].includes(c.exercise)) continue
                const lengths = finite(
                    r.frames.map((f) => {
                        const a = f.detected ? point(f, sideName(side, j1), 0.5) : null
                        const b = f.detected ? point(f, sideName(side, j2), 0.5) : null
                        return a && b ? dist(a, b) : NaN
                    }),
                )
                if (lengths.length >= 30) bones.push({ model: r.model, video: r.video, bone, cv: (100 * std(lengths)) / mean(lengths) })
            }
        }
        if (bones.length) {
            const names = Object.keys(BONES).filter((b) => bones.some((x) => x.bone === b))
            const rows: Cell[][] = []
            const chart: Record<string, (number | null)[]> = Object.fromEntries(models.map((m) => [m, []]))
            for (const b of [...names, 'all']) {
                const sel = bones.filter((x) => b === 'all' || x.bone === b)
                const values = Object.fromEntries(models.map((m) => [m, mean(sel.filter((x) => x.model === m).map((x) => x.cv))]))
                const top = topTwo(values, false)
                const p = top ? pairTest(sel, top[0], top[1], (x) => x.model, (x) => `${x.video}|${x.bone}`, (x) => x.cv) : null
                const bb = better(values, false)
                rows.push([b, sel.length / Math.max(models.length, 1), ...models.map((m) => values[m]), bb === 'tie' ? 'tie' : bb ? modelName(bb) : '–', p])
                if (b !== 'all') for (const m of models) chart[m].push(Number.isFinite(values[m]) ? values[m] : null)
                if (b === 'all') addOverall('Bone-length variation (%)', values, false, p)
            }
            s.tables.push({
                id: 'bones',
                title: 'Bone-length consistency',
                note: 'How much each bone’s length on screen varies through a clip (coefficient of variation). Real bones don’t change length, so lower = joints placed more consistently. Diagonal clips left out. Squats use the legs; push-ups use legs and arms.',
                columns: ['bone', 'clips', ...models.map((m) => `${modelName(m)} %`), 'better', 'p'],
                rows,
                digits: 2,
            })
            s.charts.push({ id: 'bones', title: 'Bone-length variation (lower is better)', groups: names, series: models.map((m) => ({ name: modelName(m), values: chart[m] })), yLabel: '%' })
        }

        // jitter of the key angle through the whole clip
        const jitterOf = (m: string, cond?: string) => {
            const vals: number[] = []
            for (const r of runs.filter((x) => x.model === m && (!cond || clip(x.video).condition === cond))) {
                const key = KEY_ANGLE[clip(r.video).exercise]
                if (!key) continue
                const side = sideOfClip.get(r.video) ?? 'l'
                const a = r.frames.map((f) => angleFrom(f, side, key))
                for (let i = 2; i < a.length; i++) {
                    const d = Math.abs(a[i] - 2 * a[i - 1] + a[i - 2])
                    if (Number.isFinite(d)) vals.push(d)
                }
            }
            return mean(vals)
        }
        s.tables.push({
            id: 'jitter',
            title: 'Angle jitter through the whole clip (°)',
            note: 'How jumpy the key angle is from frame to frame (mean |θt − 2θt−1 + θt−2|). Real movement is smooth, so most of this is noise. Lower = steadier.',
            columns: ['model', 'all', ...conds],
            rows: models.map((m) => [modelName(m), jitterOf(m), ...conds.map((c) => jitterOf(m, c))]),
            digits: 2,
        })
        addOverall('Angle jitter (°)', Object.fromEntries(models.map((m) => [m, jitterOf(m)])), false)

        // agreement with the reference model on the key angle
        if (models.length >= 2) {
            const rows: Cell[][] = []
            const byKey = new Map(data.frames.map((f) => [`${f.video}|${f.frame}|${f.model}`, f]))
            for (const other of models.slice(1)) {
                for (const c of ['all', ...conds]) {
                    const diffs: number[] = []
                    for (const f of data.frames) {
                        if (f.model !== ref || (c !== 'all' && clip(f.video).condition !== c)) continue
                        const key = KEY_ANGLE[clip(f.video).exercise]
                        const g = byKey.get(`${f.video}|${f.frame}|${other}`)
                        if (!key || !g) continue
                        const side = sideOfClip.get(f.video) ?? 'l'
                        const d = angleFrom(f, side, key) - angleFrom(g, side, key)
                        if (Number.isFinite(d)) diffs.push(d)
                    }
                    if (!diffs.length) continue
                    const md = mean(diffs)
                    const sd = std(diffs)
                    rows.push([modelName(other), c, diffs.length, mean(diffs.map(Math.abs)), md, `${(md - 1.96 * sd).toFixed(1)} to ${(md + 1.96 * sd).toFixed(1)}`])
                }
            }
            if (rows.length)
                s.tables.push({
                    id: 'agreement',
                    title: `How much each model agrees with ${modelName(ref)} on the key angle`,
                    note: `Doesn't say who is right, only how far apart they are. Mean difference > 0 means ${modelName(ref)} reads bigger angles. Range = 95% limits of agreement (Bland–Altman): 95% of frames differ by this much or less.`,
                    columns: ['model', 'camera', 'frames', 'mean |difference| °', 'mean difference °', '95% range °'],
                    rows,
                    digits: 2,
                })
        }
        sections.push(s)
    }

    // ===== the app's rep counting with each model =====
    const repFacts: Facts['reps'] = {}
    const realReps = new Map(data.clips.filter((c) => Number.isFinite(c.reps)).map((c) => [c.video, c.reps]))
    if (realReps.size && data.frames.length) {
        const s: Section = {
            id: 'reps',
            title: 'The app’s rep counting with each model',
            intro: 'FormCheck’s own squat and push-up rules run on each model’s joints, and the reps they count are compared with the real number you typed in. This shows whether the choice of model changes what a user is told.',
            tables: [],
            charts: [],
            notes: ['The weight-on-toes check needs the feet, which the saved joints don’t include, so it is left out for every model.'],
        }
        const counts = new Map<string, { count: number; reps: { bottom: number; good: boolean }[] }>()
        for (const [key, fs] of groupBy(data.frames.filter((f) => realReps.has(f.video)), (f) => `${f.video}|${f.model}`)) {
            const exercise = findExercise(clip(fs[0].video).exercise)
            if (!exercise) continue
            const engine = createEngine(exercise, { fromFile: true })
            for (const f of fs.sort((a, b) => a.frame - b.frame)) engine.step(toLandmarks(f), f.width, f.height, f.time)
            const reps = engine.finish()
            counts.set(key, { count: reps.length, reps: reps.map((r) => ({ bottom: r.bottomTime, good: r.good })) })
        }
        const clipsWithReps = [...realReps.keys()].filter((v) => models.some((m) => counts.has(`${v}|${m}`))).sort()
        const rows: Cell[][] = []
        for (const m of models) {
            const errs = clipsWithReps.filter((v) => counts.has(`${v}|${m}`)).map((v) => counts.get(`${v}|${m}`)!.count - realReps.get(v)!)
            const all = clipsWithReps.filter((v) => counts.has(`${v}|${m}`)).flatMap((v) => counts.get(`${v}|${m}`)!.reps)
            repFacts[m] = { clips: errs.length, mae: mean(errs.map(Math.abs)), exact: pct(mean(errs.map((e) => +(e === 0)))) }
            rows.push([modelName(m), errs.length, repFacts[m].mae, repFacts[m].exact, mean(errs), pct(mean(all.map((r) => +r.good)))])
        }
        s.tables.push({
            id: 'rep_counts',
            title: 'Rep counting accuracy',
            note: 'Count error = |counted − real| per clip. Over/under: positive = counts too many. "Judged good" = share of counted reps the rules passed.',
            columns: ['model', 'clips', 'count error per clip', 'clips exactly right %', 'over/under per clip', 'reps judged good %'],
            rows,
            digits: 2,
        })
        s.tables.push({
            id: 'rep_counts_per_clip',
            title: 'Reps counted in each clip',
            columns: ['clip', 'real reps', ...models.map(modelName)],
            rows: clipsWithReps.map((v) => [v, realReps.get(v)!, ...models.map((m) => counts.get(`${v}|${m}`)?.count ?? null)]),
            digits: 0,
        })
        // do the models agree on each rep's verdict? (reps paired by their lowest point, within 0.7 s)
        if (models.length >= 2) {
            const agreeRows: Cell[][] = []
            for (const other of models.slice(1)) {
                let same = 0
                let paired = 0
                for (const v of clipsWithReps) {
                    const a = counts.get(`${v}|${ref}`)?.reps ?? []
                    const b = counts.get(`${v}|${other}`)?.reps ?? []
                    for (const r of a) {
                        const match = b.find((x) => Math.abs(x.bottom - r.bottom) < 0.7)
                        if (!match) continue
                        paired++
                        if (match.good === r.good) same++
                    }
                }
                agreeRows.push([modelName(other), paired, paired ? pct(same / paired) : NaN])
            }
            s.tables.push({
                id: 'rep_verdicts',
                title: `Same good/bad verdict as ${modelName(ref)}?`,
                note: 'For reps both models counted. Below 100% means the choice of model would change the feedback on some reps.',
                columns: ['model', 'reps compared', 'same verdict %'],
                rows: agreeRows,
                digits: 1,
            })
        }
        s.charts.push({ id: 'rep_counts', title: 'Rep count error per clip (lower is better)', groups: ['count error'], series: models.map((m) => ({ name: modelName(m), values: [Number.isFinite(repFacts[m]?.mae) ? repFacts[m].mae : null] })), yLabel: 'reps' })
        addOverall('Rep count error per clip', Object.fromEntries(models.map((m) => [m, repFacts[m]?.mae ?? NaN])), false)
        sections.push(s)
    }

    // ===== speed =====
    const sizeMB: Record<string, number> = {}
    const fps: Record<string, number> = {}
    if (data.frames.length) {
        const s: Section = { id: 'speed', title: 'Speed', intro: 'Time per frame for the model only (preparing the image, running the model, reading the output). The first 10 frames of each clip are left out as warm-up.', tables: [], charts: [], notes: [] }
        const backend = new Map(data.runs.map((r) => [r.model, r.backend]))
        const ms: Record<string, number[]> = Object.fromEntries(models.map((m) => [m, finite(data.frames.filter((f) => f.model === m && f.frame >= 10).map((f) => f.ms))]))
        s.tables.push({
            id: 'speed',
            title: 'Processing time per frame',
            columns: ['model', 'runs on', 'frames', 'mean ms', 'median ms', '95th percentile ms', 'FPS'],
            rows: models.map((m) => [modelName(m), backend.get(m) ?? '', ms[m].length, mean(ms[m]), median(ms[m]), percentile(ms[m], 95), 1000 / mean(ms[m])]),
            digits: 1,
        })
        for (const m of models) {
            const sizes = finite(data.runs.filter((r) => r.model === m).map((r) => r.bytes)).filter((b) => b > 0)
            sizeMB[m] = sizes.length ? median(sizes) / 1e6 : NaN
            fps[m] = 1000 / mean(ms[m])
        }
        const loads = Object.fromEntries(models.map((m) => [m, median(finite(data.runs.filter((r) => r.model === m).map((r) => r.loadMs)))]))
        if (models.some((m) => Number.isFinite(sizeMB[m]) || Number.isFinite(loads[m]))) {
            s.tables.push({
                id: 'model_size',
                title: 'Download size and start-up time',
                note: 'What a user waits for before the first frame: downloading the model (once) and starting it up (each time). Matters most on a phone.',
                columns: ['model', 'download MB', 'start-up s (median)'],
                rows: models.map((m) => [modelName(m), sizeMB[m], loads[m] / 1000]),
                digits: 1,
            })
            if (models.some((m) => Number.isFinite(sizeMB[m]))) addOverall('Download size (MB)', sizeMB, false)
        }
        const values = Object.fromEntries(models.map((m) => [m, mean(ms[m])]))
        const top = topTwo(values, false)
        const timed = data.frames.filter((f) => f.frame >= 10)
        addOverall('Time per frame (ms)', values, false, top ? pairTest(timed, top[0], top[1], (f) => f.model, (f) => `${f.video}|${f.frame}`, (f) => f.ms) : null)
        s.charts.push({ id: 'speed', title: 'Mean time per frame (lower is better)', groups: ['ms per frame'], series: models.map((m) => ({ name: modelName(m), values: [mean(ms[m])] })), yLabel: 'ms' })
        sections.push(s)
    }

    // ===== verdict and recommendations =====
    let verdict: Verdict | null = null
    if (overall.length && models.length >= 2) {
        const wins: Record<string, number> = Object.fromEntries(models.map((m) => [m, 0]))
        for (const r of overall) if (r.better && r.better !== 'tie') wins[r.better] = (wins[r.better] ?? 0) + 1
        const main = overall.find((r) => r.metric === 'Mean angle error (°)')
        const recommendations: string[] = []
        for (const r of situations) {
            if (!r.better || r.better === 'tie' || !r.runnerUp || r.n < 20) continue
            const where = r.dimension === 'Angle' ? `the ${r.situation} angle` : r.dimension === 'Whose clips' ? `${r.situation} clips` : r.situation
            const best = r.values[r.better]
            const next = r.values[r.runnerUp]
            if (r.p !== null && r.p < 0.05) recommendations.push(`${r.dimension}, ${where}: use ${modelName(r.better)} (${best.toFixed(1)}° vs ${next.toFixed(1)}° for ${modelName(r.runnerUp)}).`)
            else recommendations.push(`${r.dimension}, ${where}: ${modelName(r.better)} and ${modelName(r.runnerUp)} are level (${best.toFixed(1)}° vs ${next.toFixed(1)}°${r.p !== null ? `, p = ${r.p.toFixed(2)}` : ''}).`)
        }
        const winner = main?.better && main.better !== 'tie' ? main.better : models[0]
        verdict = {
            winner: main?.better ?? null,
            values: main?.values ?? {},
            p: main?.p ?? null,
            n: hits.filter((e) => e.model === winner).length,
            wins,
            rows: overall,
            situations,
            recommendations,
        }
    }

    // the worst frames of each model, by mean angle error on the frame
    const worst: WorstFrame[] = []
    for (const m of models) {
        const byFrame = groupBy(hits.filter((e) => e.model === m), (e) => `${e.video}|${e.frame}`)
        const frames = [...byFrame.values()].map((es) => {
            const top = es.reduce((a, b) => (b.err > a.err ? b : a))
            const side = data.keypoints.find((k) => k.video === es[0].video && k.frame === es[0].frame)?.side ?? 'l'
            return { model: m, video: es[0].video, frame: es[0].frame, side, err: mean(es.map((e) => e.err)), worstAngle: top.angle, worstErr: top.err }
        })
        worst.push(...frames.sort((a, b) => b.err - a.err).slice(0, 6))
    }

    const bottomVsAll: Facts['bottomVsAll'] = {}
    for (const m of models) {
        const es = hits.filter((e) => e.model === m)
        bottomVsAll[m] = { bottom: mean(es.filter((e) => e.phase === 'bottom of the rep').map((e) => e.err)), all: mean(es.map((e) => e.err)) }
    }
    const facts: Facts = {
        clips: videos.length,
        markedFrames: new Set(data.keypoints.filter((k) => Number.isFinite(k.x)).map((k) => `${k.video}|${k.frame}`)).size,
        markedAngles: new Set(angles.map((e) => e.key)).size,
        confidence,
        reps: repFacts,
        bottomVsAll,
        sizeMB,
        fps,
    }

    return { models, sections, verdict, missing, worst, facts }
}

// a saved frame back into the 33-point landmark list the rules expect
function toLandmarks(f: FrameRow): Landmark[] | undefined {
    if (!f.detected) return undefined
    const l: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }))
    JOINTS.forEach(([, index], i) => {
        const x = f.pts[i * 3]
        const y = f.pts[i * 3 + 1]
        if (Number.isFinite(x) && Number.isFinite(y)) l[index] = { x: x / f.width, y: y / f.height, visibility: f.pts[i * 3 + 2] }
    })
    return l
}
