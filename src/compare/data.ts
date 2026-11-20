// Loading the comparison data: the batch run (where each model put each joint on every frame)
// and the hand-marked joints (the ground truth). Rows come from CSV files or straight from a batch run.

import { JOINTS, clipInfo, type ClipInfo } from '../csv'

export type Raw = Record<string, unknown>

// one frame from one model; pts holds x, y, visibility for the 17 shared joints (NaN = missing)
export type FrameRow = {
    video: string
    model: string
    frame: number
    time: number
    ms: number
    detected: boolean
    side: 'l' | 'r'
    width: number
    height: number
    pts: Float32Array
}

export type RunRow = { video: string; model: string; modelName: string; backend: string }

export type KeypointRow = { video: string; frame: number; side: 'l' | 'r'; joint: string; x: number; y: number }

export type Dataset = {
    frames: FrameRow[]
    runs: RunRow[]
    keypoints: KeypointRow[]
}

export const emptyDataset = (): Dataset => ({ frames: [], runs: [], keypoints: [] })

export const JOINT_INDEX: Record<string, number> = Object.fromEntries(JOINTS.map(([name], i) => [name, i]))

const clipCache = new Map<string, ClipInfo>()
export function clip(video: string) {
    if (!clipCache.has(video)) clipCache.set(video, clipInfo(video))
    return clipCache.get(video)!
}

// ---------- CSV ----------

export function parseCsv(text: string): Raw[] {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    cell += '"'
                    i++
                } else quoted = false
            } else cell += c
        } else if (c === '"') quoted = true
        else if (c === ',') {
            row.push(cell)
            cell = ''
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++
            row.push(cell)
            rows.push(row)
            row = []
            cell = ''
        } else cell += c
    }
    if (cell !== '' || row.length) {
        row.push(cell)
        rows.push(row)
    }
    const header = (rows.shift() ?? []).map((h) => h.trim().replace(/^﻿/, ''))
    return rows
        .filter((r) => r.some((c) => c.trim() !== ''))
        .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

export type FileKind = 'frames' | 'runs' | 'keypoints' | 'unknown'

export function detectKind(rows: Raw[]): FileKind {
    const cols = new Set(Object.keys(rows[0] ?? {}))
    if (cols.has('joint') && cols.has('x') && cols.has('frame')) return 'keypoints'
    if (cols.has('model') && cols.has('frame') && cols.has('l_knee_x')) return 'frames'
    if (cols.has('backend') && cols.has('model_name')) return 'runs'
    return 'unknown'
}

// ---------- turning rows into records ----------

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const num = (v: unknown) => {
    if (v === null || v === undefined || v === '') return NaN
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : NaN
}

function toFrame(r: Raw): FrameRow | null {
    if (!str(r.video) || !str(r.model)) return null
    const pts = new Float32Array(JOINTS.length * 3)
    JOINTS.forEach(([name], i) => {
        pts[i * 3] = num(r[`${name}_x`])
        pts[i * 3 + 1] = num(r[`${name}_y`])
        pts[i * 3 + 2] = num(r[`${name}_v`])
    })
    return {
        video: str(r.video),
        model: str(r.model),
        frame: num(r.frame),
        time: num(r.time),
        ms: num(r.ms),
        detected: str(r.detected) === '1' || r.detected === 1,
        side: str(r.side) === 'r' ? 'r' : 'l',
        width: num(r.width),
        height: num(r.height),
        pts,
    }
}

function toRun(r: Raw): RunRow | null {
    if (!str(r.video) || !str(r.model)) return null
    return { video: str(r.video), model: str(r.model), modelName: str(r.model_name), backend: str(r.backend) }
}

function toKeypoint(r: Raw): KeypointRow | null {
    const x = num(r.x)
    const y = num(r.y)
    if (!str(r.video) || !Number.isFinite(x) || !Number.isFinite(y)) return null
    return { video: str(r.video), frame: num(r.frame), side: str(r.side) === 'r' ? 'r' : 'l', joint: str(r.joint), x, y }
}

// the same thing loaded twice (a re-run, or the same file added again): keep the newest
function dedupe<T>(items: T[], key: (t: T) => string): T[] {
    const map = new Map<string, T>()
    for (const t of items) map.set(key(t), t)
    return [...map.values()]
}

export function addRows(data: Dataset, kind: FileKind, rows: Raw[]): Dataset {
    const keep = <T>(items: (T | null)[]) => items.filter((x): x is T => x !== null)
    const next = { ...data }
    if (kind === 'frames') next.frames = dedupe([...data.frames, ...keep(rows.map(toFrame))], (f) => `${f.video}|${f.model}|${f.frame}`)
    if (kind === 'runs') next.runs = dedupe([...data.runs, ...keep(rows.map(toRun))], (r) => `${r.video}|${r.model}`)
    if (kind === 'keypoints') next.keypoints = dedupe([...data.keypoints, ...keep(rows.map(toKeypoint))], (k) => `${k.video}|${k.frame}|${k.joint}`)
    return next
}
