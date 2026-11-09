// The rep counter and form judge, separated from the camera and the screen.
// It gets landmarks one frame at a time and says when the user is ready, paused, or finished a rep.
// The live camera (Camera.tsx) and the batch evaluation (Evaluate.tsx) both use this same code,
// so both pose models are always judged by exactly the same rules.

import { LEFT, RIGHT, type Exercise, type Fault, type Frame, type Joints, type Rep } from './exercises'
import type { Landmark } from './pose'

export type EngineStatus = 'waiting' | 'ready' | 'paused'

// a finished rep, with the extra detail the evaluation needs
export type RepResult = Rep & {
    perfect: boolean
    faultList: Fault[]
    worst: Record<string, number | undefined>
    startTime: number // seconds: the top position just before the rep went down
    bottomTime: number // seconds: the lowest point
    countTime: number // seconds: when the rep was counted (part-way back up)
    endTime: number | null // seconds: the top position after the rep (known once the next rep starts or the set ends)
}

export type StepOutput = {
    detected: boolean
    joints: Joints
    main: number | null // smoothed main angle (what drives counting)
    rawMain: number | null // the same angle before smoothing
    status?: EngineStatus // set when the status changes on this frame
    rep?: RepResult // set when a rep is counted on this frame
}

const VISIBLE = 0.5
const NEAR_TOP = 5 // degrees: a rep starts when the angle leaves this band below the top, and ends when it gets back into it

export function createEngine(exercise: Exercise, options: { fromFile: boolean }) {
    let stage: 'waiting' | 'up' | 'down' = 'waiting'
    let joints = LEFT
    let repCount = 0
    let readyFrames = 0
    let startX = 0
    let startTorso = 0
    let top = 0 // highest main angle since the last rep (how far the user straightened)
    let upTrace: { t: number; m: number }[] = [] // main angle over time while at the top, for the rep boundaries
    let bottom = 180 // lowest main angle in the current rep (how deep the user went)
    let bottomTime = 0
    let startTime = 0
    let startShoulderY = 0 // shoulder height at the ready position
    let lowestShoulderY = 0 // lowest the shoulder got in the current rep (bigger y = lower)
    let lastRep: RepResult | null = null
    const reps: RepResult[] = []

    // smoothed values (remembered between frames), the values at the ready
    // position, and the worst value of each measurement during the current rep
    const smooth: Record<string, number> = {}
    let baseline: Record<string, number> = {}
    let worst: Record<string, number | undefined> = {}

    // keep = how much of the previous value to keep (more = smoother but slower to react)
    function blend(key: string, value: number, keep = 0.7) {
        smooth[key] = key in smooth ? smooth[key] * keep + value * (1 - keep) : value
        return smooth[key]
    }

    // the rep before this one ends when the angle first gets back near the top
    function closeLastRep() {
        if (!lastRep || lastRep.endTime !== null || upTrace.length === 0) return
        const peak = Math.max(...upTrace.map((x) => x.m))
        lastRep.endTime = (upTrace.find((x) => x.m >= peak - NEAR_TOP) ?? upTrace[upTrace.length - 1]).t
    }

    // a new rep starts at the last moment the angle was near the top
    function repStart() {
        const peak = Math.max(...upTrace.map((x) => x.m))
        for (let i = upTrace.length - 1; i >= 0; i--) if (upTrace[i].m >= peak - NEAR_TOP) return upTrace[i].t
        return upTrace[0]?.t ?? 0
    }

    // landmarks: one frame from a pose model; width/height: video size in pixels; time: seconds
    function step(landmarks: Landmark[] | undefined, width: number, height: number, time: number): StepOutput {
        if (!landmarks) return { detected: false, joints, main: null, rawMain: null }

        const px = (i: number) => ({ x: landmarks[i].x * width, y: landmarks[i].y * height })
        const vis = (i: number) => landmarks[i].visibility
        const seen = (i: number) => vis(i) > VISIBLE
        let status: EngineStatus | undefined
        let rep: RepResult | undefined

        // while waiting, pick whichever side faces the camera
        if (stage === 'waiting') {
            const score = (s: Joints) =>
                vis(s.shoulder) + vis(s.elbow) + vis(s.wrist) + vis(s.hip) + vis(s.knee) + vis(s.ankle)
            joints = score(LEFT) >= score(RIGHT) ? LEFT : RIGHT
        }
        const j = joints
        const frame: Frame = { p: px, j }
        const allSeen = (names: (keyof Joints)[]) => names.every((name) => seen(j[name]))

        // measurements
        const rawMain = exercise.main(frame)
        const main = blend('main', rawMain, 0.5) // lighter smoothing so fast reps aren't missed
        const values: Record<string, number> = {}
        for (const m of exercise.measures) {
            let v = blend(m.key, m.get(frame))
            if (m.fromBaseline) v = v - (baseline[m.key] ?? v)
            if (m.abs) v = Math.abs(v)
            values[m.key] = v
        }
        const shoulderY = blend('shoulderY', px(j.shoulder).y)
        const torso = Math.hypot(px(j.shoulder).x - px(j.hip).x, px(j.shoulder).y - px(j.hip).y)

        // wait until the user is holding the start position in view
        if (stage === 'waiting') {
            if (allSeen(exercise.mainNeeds) && main > exercise.topAbove) {
                readyFrames = readyFrames + 1
            } else {
                readyFrames = 0
            }
            if (readyFrames > (options.fromFile ? 5 : 30)) {
                stage = 'up'
                startX = px(j.hip).x
                startTorso = torso
                baseline = { ...smooth }
                top = main
                upTrace = []
                startShoulderY = shoulderY
                status = 'ready'
            }
        }

        // pause if the user leaves their spot
        const moved = Math.abs(px(j.hip).x - startX) > startTorso
        const resized = Math.abs(torso - startTorso) > startTorso * 0.25
        // body far above the start height = climbed on (e.g. jumped onto the dip bars)
        const climbed = exercise.onEquipment && startShoulderY - shoulderY > startTorso * 0.25
        // body far below the start height with arms/legs straight = stepped off
        const steppedOff = exercise.onEquipment && shoulderY - startShoulderY > startTorso * 0.3 && main > exercise.topAbove

        if (stage !== 'waiting' && (moved || resized || climbed || steppedOff)) {
            closeLastRep()
            stage = 'waiting'
            readyFrames = 0
            worst = {}
            status = 'paused'
        }

        // a rep is the main angle moving down by at least `range` from the top,
        // then back up by at least `range` from the bottom, wherever those are

        // 1. at the top: remember the highest point, start a rep once it drops far enough
        if (stage === 'up') {
            upTrace.push({ t: time, m: main })
            if (main > top) top = main
            if (main < top - exercise.range) {
                closeLastRep()
                stage = 'down'
                startTime = repStart()
                bottom = main
                bottomTime = time
                lowestShoulderY = shoulderY
            }
        }

        // 2. going down: remember the lowest point and the worst value of each measurement
        if (stage === 'down') {
            if (main < bottom) {
                bottom = main
                bottomTime = time
            }
            if (shoulderY > lowestShoulderY) lowestShoulderY = shoulderY
            for (const m of exercise.measures) {
                if (m.needs && !allSeen(m.needs)) continue
                const v = values[m.key]
                const old = worst[m.key]
                if (old === undefined || (m.worst === 'min' ? v < old : v > old)) {
                    worst[m.key] = v
                }
            }
        }

        // 3. coming back up far enough → count the rep and judge it
        // (the body must actually rise too, so straightening the arms while
        // stepping down off the bars doesn't count as a rep)
        const rose = lowestShoulderY - shoulderY > startTorso * 0.08
        if (stage === 'down' && main > bottom + exercise.range && rose) {
            stage = 'up'
            repCount = repCount + 1

            // the first rep can start before the app has seen a full lockout, so skip that check
            if (repCount > 1) worst.top = top
            const faults = exercise.judge(worst)
            const good = faults.length === 0
            const numbers = exercise.measures.map((m) => {
                const v = worst[m.key]
                return { label: m.label, value: `${v === undefined ? '–' : v.toFixed(0)}${m.unit}` }
            })
            numbers.push({ label: 'top', value: `${top.toFixed(0)}°` })
            const perfect = good && (exercise.perfect?.(worst) ?? false)
            const verdict = perfect ? 'Perfect rep' : good ? 'Good rep' : faults.map((f) => f.text).join(' and ')
            rep = {
                n: repCount,
                good,
                faults: faults.map((f) => f.text),
                numbers,
                bottom,
                top,
                line: [verdict, ...numbers.map((x) => `${x.label} ${x.value}`)].join(' | '),
                perfect,
                faultList: faults,
                worst: { ...worst },
                startTime,
                bottomTime,
                countTime: time,
                endTime: null,
            }
            reps.push(rep)
            lastRep = rep
            worst = {}
            top = main
            upTrace = []
        }

        return { detected: true, joints: j, main, rawMain, status, rep }
    }

    // call at the end of a video so the last rep gets its end time
    function finish() {
        closeLastRep()
        return reps
    }

    return { step, finish, reps }
}
