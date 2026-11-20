// Picks the frames worth marking by hand in a clip: the top, halfway down and bottom of the first reps.
// It follows the key angle (knee for squats, elbow for push-ups) as one model measured it, so the
// marked frames cover the whole range of the movement.

import type { FrameRow } from './data'
import { KEY_ANGLE, angleFrom } from './metrics'

export function suggestFrames(frames: FrameRow[], exercise: string, reps = 3, fps = 30): number[] {
    const sorted = [...frames].sort((a, b) => a.frame - b.frame)
    if (!sorted.length) return []
    const sides = sorted.filter((f) => f.detected)
    const side: 'l' | 'r' = sides.filter((f) => f.side === 'l').length >= sides.length / 2 ? 'l' : 'r'
    const key = KEY_ANGLE[exercise] ?? 'knee'
    const raw = sorted.map((f) => angleFrom(f, side, key))

    // fill gaps and smooth over ±3 frames
    const filled = raw.map((v, i) => {
        if (Number.isFinite(v)) return v
        for (let d = 1; d < 15; d++) {
            if (Number.isFinite(raw[i - d])) return raw[i - d]
            if (Number.isFinite(raw[i + d])) return raw[i + d]
        }
        return NaN
    })
    const a = filled.map((_, i) => {
        const win = filled.slice(Math.max(0, i - 3), i + 4).filter(Number.isFinite)
        return win.length ? win.reduce((s, x) => s + x, 0) / win.length : NaN
    })
    const n = a.length
    const half = Math.round(fps * 0.6)
    const reach = Math.round(fps * 1.5)

    // a bottom: the lowest point within ±0.6 s, at least 25° below the highest point within ±1.5 s
    const bottoms: number[] = []
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(a[i])) continue
        const near = a.slice(Math.max(0, i - half), i + half + 1).filter(Number.isFinite)
        const wide = a.slice(Math.max(0, i - reach), i + reach + 1).filter(Number.isFinite)
        if (a[i] <= Math.min(...near) && Math.max(...wide) - a[i] >= 25) {
            if (!bottoms.length || i - bottoms[bottoms.length - 1] > half) bottoms.push(i)
        }
        if (bottoms.length >= reps) break
    }

    const picks = new Set<number>()
    if (bottoms.length) {
        let from = 0
        for (const b of bottoms) {
            // top: the highest point between the previous bottom and this one
            let top = from
            for (let i = from; i < b; i++) if (a[i] > a[top]) top = i
            // halfway: where the angle crosses the middle on the way down
            const middle = (a[top] + a[b]) / 2
            let mid = Math.round((top + b) / 2)
            for (let i = top; i <= b; i++)
                if (a[i] <= middle) {
                    mid = i
                    break
                }
            picks.add(sorted[top].frame).add(sorted[mid].frame).add(sorted[b].frame)
            from = b
        }
    } else {
        // no clear reps found: spread 9 frames through the clip
        for (let k = 1; k <= 9; k++) picks.add(sorted[Math.min(n - 1, Math.round((k / 10) * n))].frame)
    }
    return [...picks].sort((x, y) => x - y)
}
