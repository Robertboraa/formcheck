// Statistics for the model comparison. Plain functions, no libraries, so every number can be traced.

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export function median(xs: number[]) {
    if (!xs.length) return NaN
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function percentile(xs: number[], p: number) {
    if (!xs.length) return NaN
    const s = [...xs].sort((a, b) => a - b)
    const i = (p / 100) * (s.length - 1)
    const lo = Math.floor(i)
    const hi = Math.ceil(i)
    return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export function std(xs: number[]) {
    if (xs.length < 2) return NaN
    const m = mean(xs)
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

export const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x))

// ---------- tests ----------

// standard normal cumulative distribution
function phi(z: number) {
    const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2))
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

// Wilcoxon signed-rank test on paired values (zero differences dropped).
// Exact for small samples without ties, normal approximation otherwise.
export function wilcoxon(x: number[], y: number[]) {
    const d = x.map((v, i) => v - y[i]).filter((v) => Number.isFinite(v) && v !== 0)
    const n = d.length
    if (n < 6) return { p: NaN, n }
    const order = d.map((v, i) => ({ a: Math.abs(v), i })).sort((p, q) => p.a - q.a)
    const ranks = new Array<number>(n)
    let ties = 0
    for (let i = 0; i < n; ) {
        let j = i
        while (j + 1 < n && order[j + 1].a === order[i].a) j++
        const r = (i + j + 2) / 2
        for (let k = i; k <= j; k++) ranks[order[k].i] = r
        const t = j - i + 1
        if (t > 1) ties += t ** 3 - t
        i = j + 1
    }
    const wPlus = d.reduce((s, v, i) => s + (v > 0 ? ranks[i] : 0), 0)
    if (n <= 30 && ties === 0) {
        // exact: count how many sign patterns give each rank sum
        const max = (n * (n + 1)) / 2
        let counts = new Float64Array(max + 1)
        counts[0] = 1
        for (let k = 1; k <= n; k++) {
            const next = new Float64Array(max + 1)
            for (let s = 0; s <= max; s++) {
                if (!counts[s]) continue
                next[s] += counts[s]
                if (s + k <= max) next[s + k] += counts[s]
            }
            counts = next
        }
        const total = 2 ** n
        const w = Math.min(wPlus, max - wPlus)
        let tail = 0
        for (let s = 0; s <= w; s++) tail += counts[s]
        return { p: Math.min(1, (2 * tail) / total), n }
    }
    const mu = (n * (n + 1)) / 4
    const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - ties / 48)
    const z = (wPlus - mu) / sigma
    return { p: 2 * (1 - phi(Math.abs(z))), n }
}

// ---------- geometry ----------

export type Pt = [number, number]

export function angle(a: Pt, b: Pt, c: Pt) {
    const r = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0])
    let d = Math.abs((r * 180) / Math.PI)
    if (d > 180) d = 360 - d
    return d
}

export function tilt(a: Pt, b: Pt) {
    return (Math.atan2(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) * 180) / Math.PI
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

// ---------- does a score predict error? ----------

function ranks(xs: number[]) {
    const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const r = new Array<number>(xs.length)
    for (let i = 0; i < order.length; ) {
        let j = i
        while (j + 1 < order.length && order[j + 1].v === order[i].v) j++
        for (let k = i; k <= j; k++) r[order[k].i] = (i + j) / 2 + 1
        i = j + 1
    }
    return r
}

// Spearman rank correlation: −1 to 1 (does one go down when the other goes up?)
export function spearman(x: number[], y: number[]) {
    const keep = x.map((v, i) => [v, y[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
    if (keep.length < 5) return NaN
    const rx = ranks(keep.map((p) => p[0]))
    const ry = ranks(keep.map((p) => p[1]))
    const mx = mean(rx)
    const my = mean(ry)
    let num = 0
    let dx = 0
    let dy = 0
    rx.forEach((v, i) => {
        num += (v - mx) * (ry[i] - my)
        dx += (v - mx) ** 2
        dy += (ry[i] - my) ** 2
    })
    return dx && dy ? num / Math.sqrt(dx * dy) : NaN
}

// AUROC: the chance that a randomly picked "bad" item scores lower than a randomly picked "good" one
// (0.5 = the score tells you nothing, 1 = it always ranks bad items below good ones)
export function auroc(scores: number[], bad: boolean[]) {
    const items = scores.map((s, i) => ({ s, bad: bad[i] })).filter((x) => Number.isFinite(x.s))
    const nBad = items.filter((x) => x.bad).length
    const nGood = items.length - nBad
    if (!nBad || !nGood) return NaN
    const r = ranks(items.map((x) => x.s))
    const goodRankSum = items.reduce((sum, x, i) => sum + (x.bad ? 0 : r[i]), 0)
    return (goodRankSum - (nGood * (nGood + 1)) / 2) / (nGood * nBad)
}
