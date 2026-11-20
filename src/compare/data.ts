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

export type RunRow = { video: string; model: string; modelName: string; backend: string; loadMs: number; bytes: number }

// what you know about a clip that the models can't tell you: how many reps were really done
export type ClipNote = { video: string; reps: number }

export type KeypointRow = { video: string; frame: number; side: 'l' | 'r'; joint: string; x: number; y: number }

export type Dataset = {
    frames: FrameRow[]
    runs: RunRow[]
    keypoints: KeypointRow[]
    clips: ClipNote[]
}

export const emptyDataset = (): Dataset => ({ frames: [], runs: [], keypoints: [], clips: [] })

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

export type FileKind = 'frames' | 'runs' | 'keypoints' | 'clips' | 'unknown'

export function detectKind(rows: Raw[]): FileKind {
    const cols = new Set(Object.keys(rows[0] ?? {}))
    if (cols.has('joint') && cols.has('x') && cols.has('frame')) return 'keypoints'
    if (cols.has('model') && cols.has('frame') && cols.has('l_knee_x')) return 'frames'
    if (cols.has('backend') && cols.has('model_name')) return 'runs'
    if (cols.has('video') && cols.has('reps') && !cols.has('model')) return 'clips'
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
    return { video: str(r.video), model: str(r.model), modelName: str(r.model_name), backend: str(r.backend), loadMs: num(r.load_ms), bytes: num(r.model_bytes) }
}

// a joint marked "not visible" is kept with x and y empty (NaN)
function toKeypoint(r: Raw): KeypointRow | null {
    const x = num(r.x)
    const y = num(r.y)
    if (!str(r.video) || !str(r.joint) || !Number.isFinite(num(r.frame))) return null
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
    if (kind === 'clips') next.clips = dedupe([...data.clips, ...rows.filter((r) => str(r.video) && Number.isFinite(num(r.reps))).map((r) => ({ video: str(r.video), reps: num(r.reps) }))], (c) => c.video)
    if (kind === 'keypoints') next.keypoints = dedupe([...data.keypoints, ...keep(rows.map(toKeypoint))], (k) => `${k.video}|${k.frame}|${k.joint}`)
    return next
}

// replaces every hand mark of one clip (used while marking, so the results update as you click)
export function setClipKeypoints(data: Dataset, video: string, rows: KeypointRow[]): Dataset {
    return { ...data, keypoints: [...data.keypoints.filter((k) => k.video !== video), ...rows] }
}

// replaces one clip's run for one model
export function setClipRun(data: Dataset, video: string, model: string, frames: Raw[], run: Raw): Dataset {
    const keepFrames = data.frames.filter((f) => !(f.video === video && f.model === model))
    const keepRuns = data.runs.filter((r) => !(r.video === video && r.model === model))
    const next = addRows({ ...data, frames: keepFrames, runs: keepRuns }, 'frames', frames)
    return addRows(next, 'runs', [run])
}

export function removeClip(data: Dataset, video: string): Dataset {
    return {
        frames: data.frames.filter((f) => f.video !== video),
        runs: data.runs.filter((r) => r.video !== video),
        keypoints: data.keypoints.filter((k) => k.video !== video),
        clips: data.clips.filter((c) => c.video !== video),
    }
}

// the real number of reps in a clip (typed in by hand); NaN clears it
export function setClipReps(data: Dataset, video: string, reps: number): Dataset {
    const rest = data.clips.filter((c) => c.video !== video)
    return { ...data, clips: Number.isFinite(reps) ? [...rest, { video, reps }] : rest }
}

// everything as three CSV-ready row lists, for backups and the paper's appendix
export function toRows(data: Dataset) {
    const frames = data.frames.map((f) => {
        const row: Record<string, string | number> = {
            video: f.video,
            model: f.model,
            frame: f.frame,
            time: f.time,
            width: f.width,
            height: f.height,
            ms: f.ms,
            detected: f.detected ? 1 : 0,
            side: f.side,
        }
        JOINTS.forEach(([name], i) => {
            row[`${name}_x`] = f.pts[i * 3]
            row[`${name}_y`] = f.pts[i * 3 + 1]
            row[`${name}_v`] = f.pts[i * 3 + 2]
        })
        return row
    })
    const runs = data.runs.map((r) => ({ video: r.video, model: r.model, model_name: r.modelName, backend: r.backend, load_ms: r.loadMs, model_bytes: r.bytes }))
    const keypoints = data.keypoints.filter((k) => Number.isFinite(k.x)).map((k) => ({ video: k.video, frame: k.frame, side: k.side, joint: k.joint, x: k.x, y: k.y }))
    const clips = data.clips.map((c) => ({ video: c.video, reps: c.reps }))
    return { frames, runs, keypoints, clips }
}

// just one clip's data
export function clipData(data: Dataset, video: string): Dataset {
    return {
        frames: data.frames.filter((f) => f.video === video),
        runs: data.runs.filter((r) => r.video === video),
        keypoints: data.keypoints.filter((k) => k.video === video),
        clips: data.clips.filter((c) => c.video === video),
    }
}
