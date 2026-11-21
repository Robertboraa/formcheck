// Picks the frames worth marking by hand in a clip: the top, halfway down and bottom of the first reps.
// It follows the key angle (knee for squats, elbow for push-ups) as one model measured it, so the
// marked frames cover the whole range of the movement.

import { JOINT_INDEX, type FrameRow } from './data'
import { KEY_ANGLE, angleFrom } from './metrics'

// the joints the key angle needs, so frames where they aren't clearly seen can be skipped
const KEY_JOINTS: Record<string, string[]> = { knee: ['hip', 'knee', 'ankle'], elbow: ['shoulder', 'elbow', 'wrist'] }

export function suggestFrames(frames: FrameRow[], exercise: string, reps = 3, fps = 30): number[] {
    const sorted = [...frames].sort((a, b) => a.frame - b.frame)
    if (!sorted.length) return []
    const sides = sorted.filter((f) => f.detected)
    const side: 'l' | 'r' = sides.filter((f) => f.side === 'l').length >= sides.length / 2 ? 'l' : 'r'
    const key = KEY_ANGLE[exercise] ?? 'knee'

    // only frames where the joints of the key angle are clearly seen (while walking into view,
    // models often give nonsense angles that would look like reps)
    const seen = (f: FrameRow) =>
        f.detected &&
        KEY_JOINTS[key].every((j) => {
            const i = JOINT_INDEX[`${side}_${j}`]
            return f.pts[i * 3 + 2] >= 0.5
        })
    const raw = sorted.map((f) => (seen(f) ? angleFrom(f, side, key) : NaN))

    // start once the person has been clearly in view for half a second
    const settle = Math.round(fps * 0.5)
    let start = 0
    for (let run = 0; start < raw.length; start++) {
        run = Number.isFinite(raw[start]) ? run + 1 : 0
        if (run >= settle) {
            start = start - settle + 1
            break
        }
    }

    // median over ±3 frames removes single-frame blips
    const a = raw.map((_, i) => {
        if (i < start) return NaN
        const win = raw.slice(Math.max(start, i - 3), i + 4).filter(Number.isFinite)
        if (win.length < 3) return NaN
        const s = [...win].sort((x, y) => x - y)
        return s[Math.floor(s.length / 2)]
    })
    const n = a.length
    const half = Math.round(fps * 0.6)
    const reach = Math.round(fps * 1.5)

    // a bottom: the lowest point within ±0.6 s, at least 25° below a top within ±1.5 s that is
    // itself a real top (130° or more: standing, or arms nearly straight)
    const bottoms: number[] = []
    for (let i = start; i < n; i++) {
        if (!Number.isFinite(a[i])) continue
        const near = a.slice(Math.max(0, i - half), i + half + 1).filter(Number.isFinite)
        const wide = a.slice(Math.max(0, i - reach), i + reach + 1).filter(Number.isFinite)
        const topNear = Math.max(...wide)
        if (a[i] <= Math.min(...near) && topNear - a[i] >= 25 && topNear >= 130) {
            if (!bottoms.length || i - bottoms[bottoms.length - 1] > half) bottoms.push(i)
        }
        if (bottoms.length >= reps) break
    }

    const picks = new Set<number>()
    if (bottoms.length) {
        let from = Math.max(start, bottoms[0] - reach * 2)
        for (const b of bottoms) {
            // top: the highest clearly-seen point between the previous bottom and this one
            let top = -1
            for (let i = from; i < b; i++) if (Number.isFinite(a[i]) && (top < 0 || a[i] > a[top])) top = i
            if (top < 0) top = Math.max(start, b - half)
            // halfway: where the angle crosses the middle on the way down
            const middle = (a[top] + a[b]) / 2
            let mid = Math.round((top + b) / 2)
            for (let i = top; i <= b; i++)
                if (Number.isFinite(a[i]) && a[i] <= middle) {
                    mid = i
                    break
                }
            picks.add(sorted[top].frame).add(sorted[mid].frame).add(sorted[b].frame)
            from = b
        }
    } else {
        // no clear reps found: spread 9 clearly-seen frames through the clip
        const ok = a.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0)
        for (let k = 1; k <= 9 && ok.length; k++) picks.add(sorted[ok[Math.min(ok.length - 1, Math.round((k / 10) * ok.length))]].frame)
    }
    return [...picks].sort((x, y) => x - y)
}
