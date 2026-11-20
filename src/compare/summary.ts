// The findings in plain words, written from the numbers in the report.
// Only says something is "better" when a paired test backs it up (p < 0.05).

import { modelName, type Report } from './metrics'

const f1 = (x: number) => x.toFixed(1)
const p = (x: number | null) => (x === null ? '' : x < 0.001 ? 'p < 0.001' : `p = ${x.toFixed(3)}`)

function list(xs: string[]) {
    if (xs.length <= 1) return xs.join('')
    return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export function summarize(report: Report): string[] {
    const v = report.verdict
    const out: string[] = []
    if (!v) return out
    const { facts, models } = report
    const name = modelName

    // the data
    out.push(
        `Based on ${facts.clips} clip${facts.clips === 1 ? '' : 's'} and ${facts.markedFrames} hand-marked frame${facts.markedFrames === 1 ? '' : 's'} (${facts.markedAngles} joint angles), comparing ${list(models.map(name))}.`,
    )

    // overall accuracy
    const err = v.rows.find((r) => r.metric === 'Mean angle error (°)')
    if (err) {
        const ranked = models.filter((m) => Number.isFinite(err.values[m])).sort((a, b) => err.values[a] - err.values[b])
        if (ranked.length >= 2) {
            const [best, second] = ranked
            const sig = err.p !== null && err.p < 0.05
            out.push(
                `**Accuracy.** ${name(best)} measured joint angles closest to the hand-marked truth, with a mean error of ${f1(err.values[best])}°, ahead of ${list(
                    ranked.slice(1).map((m) => `${name(m)} (${f1(err.values[m])}°)`),
                )}. ` +
                    (sig
                        ? `The gap to ${name(second)} is statistically significant (Wilcoxon ${p(err.p)}).`
                        : `The gap to ${name(second)} is not statistically significant (${p(err.p) || 'too few angles to test'}), so on this data the two can't be separated.`),
            )
            const within = v.rows.find((r) => r.metric === 'Angles within 10° of the truth (%)')
            if (within) out.push(`${list(ranked.map((m) => `${name(m)} kept ${f1(within.values[m])}%`))} of angles within 10° of the truth.`)
        }
    }

    // situations
    // situations with very few marked angles are too thin to draw conclusions from
    const real = v.situations.filter((r) => r.n >= 20 && r.p !== null && r.p < 0.05 && r.better && r.better !== 'tie')
    const byModel = new Map<string, string[]>()
    for (const r of real) {
        const label = r.dimension === 'Angle' ? `the ${r.situation} angle` : r.dimension === 'Person' ? `person ${r.situation}` : r.dimension === 'Whose clips' ? `${r.situation} clips` : r.situation
        byModel.set(r.better!, [...(byModel.get(r.better!) ?? []), label])
    }
    if (byModel.size) {
        out.push(
            `**Where each model is better.** ` +
                [...byModel]
                    .map(([m, where]) => `${name(m)} was clearly more accurate for ${list(where)}.`)
                    .join(' ') +
                ` (Each tested against the runner-up in that situation, p < 0.05.)`,
        )
    } else if (v.situations.length) {
        out.push('**Where each model is better.** No situation shows a statistically significant gap between the best model and the runner-up yet. More marked frames would make the differences clearer.')
    }
    const level = v.situations.filter((r) => r.dimension === 'Camera setup' && !(r.p !== null && r.p < 0.05)).map((r) => r.situation)
    if (level.length && byModel.size) out.push(`For the ${list(level)} camera setup${level.length > 1 ? 's' : ''}, the best models were level.`)

    // bottom of the rep
    const bottoms = models.filter((m) => Number.isFinite(facts.bottomVsAll[m]?.bottom))
    if (bottoms.length >= 2) {
        const best = bottoms.sort((a, b) => facts.bottomVsAll[a].bottom - facts.bottomVsAll[b].bottom)[0]
        const harder = bottoms.filter((m) => facts.bottomVsAll[m].bottom > facts.bottomVsAll[m].all)
        out.push(
            `**Bottom of the rep** (where depth is judged): ${name(best)} was most accurate (${f1(facts.bottomVsAll[best].bottom)}°). ` +
                (harder.length
                    ? `${list(harder.map(name))} ${harder.length > 1 ? 'were' : 'was'} less accurate at the bottom than on average, which matters because that is where the form rules decide depth.`
                    : 'No model got worse at the bottom of the rep than on average.'),
        )
    }

    // confidence
    const conf = models.filter((m) => Number.isFinite(facts.confidence[m]?.auroc))
    if (conf.length) {
        const sorted = conf.sort((a, b) => facts.confidence[b].auroc - facts.confidence[a].auroc)
        const useful = sorted.filter((m) => facts.confidence[m].auroc >= 0.7)
        const weak = sorted.filter((m) => facts.confidence[m].auroc < 0.6)
        const auc = (m: string) => facts.confidence[m].auroc.toFixed(2)
        if (weak.length === sorted.length)
            out.push(
                `**Confidence scores.** No model's confidence was a useful guide to badly placed joints (AUROC from ${auc(sorted[sorted.length - 1])} to ${auc(sorted[0])}, where 0.5 is guessing), so the app shouldn't use them to decide which joints to trust.`,
            )
        else
            out.push(
                `**Confidence scores.** ${name(sorted[0])}'s confidence was the best guide to badly placed joints (AUROC ${auc(sorted[0])}).` +
                    (useful.length ? ` For ${list(useful.map(name))}, low-confidence joints could safely be ignored by the app.` : '') +
                    (weak.length ? ` ${list(weak.map(name))}'s scores were close to guessing (AUROC under 0.6), so they shouldn't be relied on.` : ''),
            )
    }

    // consistency
    const steady = v.rows.find((r) => r.metric === 'Angle wobble when still (SD °)')
    const bones = v.rows.find((r) => r.metric === 'Bone-length variation (%)')
    const bits: string[] = []
    const steadyBest = steady?.better && steady.better !== 'tie' ? steady.better : null
    const bonesBest = bones?.better && bones.better !== 'tie' ? bones.better : null
    if (steadyBest) bits.push(`${name(steadyBest)} was steadiest while standing still (${f1(steady!.values[steadyBest])}° wobble)`)
    if (bonesBest) bits.push(`${bonesBest === steadyBest ? 'it also' : name(bonesBest)} kept bone lengths most constant (${f1(bones!.values[bonesBest])}% variation)`)
    if (bits.length) out.push(`**Consistency** (every frame, no hand marks needed): ${list(bits)}.`)

    // rep counting
    const reps = models.filter((m) => Number.isFinite(facts.reps[m]?.mae))
    if (reps.length) {
        const sorted = reps.sort((a, b) => facts.reps[a].mae - facts.reps[b].mae)
        const b = sorted[0]
        const worst = sorted[sorted.length - 1]
        if (Math.abs(facts.reps[b].mae - facts.reps[worst].mae) < 1e-9)
            out.push(`**Rep counting with FormCheck's rules.** Every model gave the same count accuracy (off by ${facts.reps[b].mae.toFixed(2)} reps per clip), so the choice of model didn't change rep counting.`)
        else
            out.push(
            `**Rep counting with FormCheck's rules.** ${name(b)} gave the most accurate counts (off by ${facts.reps[b].mae.toFixed(2)} reps per clip, exactly right in ${f1(facts.reps[b].exact)}% of clips)` +
                (sorted.length > 1 ? `; ${name(sorted[sorted.length - 1])} was least accurate (off by ${facts.reps[sorted[sorted.length - 1]].mae.toFixed(2)}).` : '.'),
        )
    }

    // speed
    const fps = models.filter((m) => Number.isFinite(facts.fps[m]))
    if (fps.length >= 2) {
        const sorted = fps.sort((a, b) => facts.fps[b] - facts.fps[a])
        const slow = sorted.filter((m) => facts.fps[m] < 15)
        out.push(
            `**Speed.** ${name(sorted[0])} was fastest (${f1(facts.fps[sorted[0]])} frames per second) and ${name(sorted[sorted.length - 1])} slowest (${f1(facts.fps[sorted[sorted.length - 1]])}).` +
                (slow.length ? ` ${list(slow.map(name))} ran below 15 frames per second on this computer, too slow for smooth live feedback.` : ' All ran fast enough for live feedback.'),
        )
    }

    // recommendation
    if (err) {
        const ranked = models.filter((m) => Number.isFinite(err.values[m])).sort((a, b) => err.values[a] - err.values[b])
        const best = ranked[0]
        const exceptions = [...byModel].filter(([m]) => m !== best)
        if (best)
            out.push(
                `**Recommendation.** Use ${name(best)} as the default` +
                    (exceptions.length ? `, and consider ${exceptions.map(([m, where]) => `${name(m)} for ${list(where)}`).join('; ')}.` : '.') +
                    (facts.fps[best] < 15 ? ` On slower devices, its speed may be a problem.` : ''),
            )
    }

    // how much to trust it
    if (facts.markedAngles < 300 || facts.clips < 8)
        out.push(`_These results are preliminary: ${facts.clips} clips and ${facts.markedAngles} marked angles. Aim for at least 8 clips across all camera setups and 150–200 marked frames before drawing conclusions._`)
    return out
}
