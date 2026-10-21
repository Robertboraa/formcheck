// Everything that is specific to one exercise lives in this file.
// Camera.tsx reads these settings and runs the same loop for every exercise.

export type Point = { x: number; y: number }

// angle at b, between a and c, in degrees
export function angle(a: Point, b: Point, c: Point) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
    let degrees = Math.abs((radians * 180) / Math.PI)
    if (degrees > 180) degrees = 360 - degrees
    return degrees
}

// tilt of the line a→b away from vertical, in degrees
export function tilt(a: Point, b: Point) {
    return (Math.atan2(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 180) / Math.PI
}

function dist(a: Point, b: Point) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

// landmark numbers for one side of the body
export type Joints = {
    ear: number
    shoulder: number
    elbow: number
    wrist: number
    hip: number
    knee: number
    ankle: number
    heel: number
    toe: number
}

export const LEFT: Joints = { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 }
export const RIGHT: Joints = { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 }

// what a measurement function gets: a way to read a landmark in pixels, and the joint numbers
export type Frame = { p: (i: number) => Point; j: Joints }

export type Measure = {
    key: string
    label: string
    unit: string
    worst: 'min' | 'max' // which direction is worse during a rep
    needs?: (keyof Joints)[] // only measured when these joints are clearly visible
    fromBaseline?: boolean // compare with the value at the ready position
    abs?: boolean // ignore direction (used with fromBaseline)
    get: (f: Frame) => number
}

export type Exercise = {
    id: string
    name: string
    readyText: string
    mainLabel: string
    main: (f: Frame) => number // the angle that drives rep counting and the chart
    mainNeeds: (keyof Joints)[]
    topAbove: number // main angle must be above this to be ready to start
    range: number // a rep = the main angle moving down then back up by at least this much
    measures: Measure[]
    judge: (w: Record<string, number | undefined>) => string[]
}

// ---------- squat ----------

const kneeAngle = ({ p, j }: Frame) => angle(p(j.hip), p(j.knee), p(j.ankle))

// position along the foot: 0% = above the heel, 100% = above the toes
function alongFoot({ p, j }: Frame, x: number) {
    const footLength = p(j.toe).x - p(j.heel).x || 1
    return ((x - p(j.heel).x) / footLength) * 100
}

const squat: Exercise = {
    id: 'squat',
    name: 'Bodyweight squat',
    readyText: 'Ready. Start squatting',
    mainLabel: 'Knee',
    main: kneeAngle,
    mainNeeds: ['hip', 'knee', 'ankle'],
    topAbove: 160,
    range: 30,
    measures: [
        { key: 'depth', label: 'depth', unit: '°', worst: 'min', get: kneeAngle }, {
            // thigh angle from horizontal at the bottom: 0 = parallel, positive = hip below knee
            key: 'thigh',
            label: 'thigh',
            unit: '°',
            worst: 'max',
            needs: ['hip', 'knee'],
            get: ({ p, j }) =>
                (Math.atan2(p(j.hip).y - p(j.knee).y, Math.abs(p(j.hip).x - p(j.knee).x)) * 180) / Math.PI,
        },
        {
            key: 'lean',
            label: 'lean',
            unit: '°',
            worst: 'max',
            needs: ['shoulder'],
            get: ({ p, j }) => tilt(p(j.shoulder), p(j.hip)),
        },
        {
            key: 'neck',
            label: 'neck',
            unit: '°',
            worst: 'min',
            needs: ['ear', 'shoulder'],
            get: ({ p, j }) => angle(p(j.ear), p(j.shoulder), p(j.hip)),
        },
        {
            // how far the nose points up from level (positive = looking up)
            key: 'headUp',
            label: 'head up',
            unit: '°',
            worst: 'max',
            needs: ['ear'],
            get: ({ p, j }) =>
                (Math.atan2(p(j.ear).y - p(0).y, Math.abs(p(0).x - p(j.ear).x)) * 180) / Math.PI,
        },
        {
            key: 'heels',
            label: 'heels',
            unit: '°',
            worst: 'max',
            needs: ['heel', 'toe'],
            fromBaseline: true,
            get: ({ p, j }) =>
                (Math.atan2(p(j.toe).y - p(j.heel).y, Math.abs(p(j.toe).x - p(j.heel).x)) * 180) / Math.PI,
        },
        {
            key: 'balance',
            label: 'balance',
            unit: '%',
            worst: 'max',
            needs: ['heel', 'toe'],
            get: (f) => {
                const { p, j } = f
                const midX = (a: number, b: number) => (p(a).x + p(b).x) / 2
                const comX = 0.6 * midX(j.shoulder, j.hip) + 0.25 * midX(j.hip, j.knee) + 0.15 * midX(j.knee, j.ankle)
                return alongFoot(f, comX)
            },
        },
        {
            key: 'kneePos',
            label: 'knee',
            unit: '%',
            worst: 'max',
            needs: ['heel', 'toe'],
            get: (f) => alongFoot(f, f.p(f.j.knee).x),
        },
        { key: 'shin', label: 'shin', unit: '°', worst: 'max', get: ({ p, j }) => tilt(p(j.knee), p(j.ankle)) },
    ],
    judge: (w) => {
        const problems: string[] = []
        const thigh = w.thigh ?? 0
        const lean = w.lean ?? 0
        const head = w.headUp ?? 0
        const balance = w.balance ?? 0
        const leaning = lean > 40

        // depth
        if (thigh < -35) problems.push('Go much lower, aim for thighs parallel to the floor. A slightly wider stance with toes turned out can help')
        else if (thigh < -22) problems.push('Almost there, go a little lower')

        // forward lean
        if (lean > 50) problems.push('Too much forward lean, push your chest up and keep your back straight')
        else if (leaning) problems.push('Lift your chest a little')

        // looking down
        if (head < -50) problems.push('Look up, your eyes are on the floor')
        else if (head < -38) problems.push('Lift your chin, look a few metres ahead')

        // weight on toes (only when not leaning)
        if (!leaning && balance > 70) problems.push('Your weight is far onto your toes, sit back into your heels')
        else if (!leaning && balance > 50) problems.push('Shift your weight back towards the middle of your foot')

        return problems
    },
}

// ---------- dips ----------

const elbowAngle = ({ p, j }: Frame) => angle(p(j.shoulder), p(j.elbow), p(j.wrist))

const dips: Exercise = {
    id: 'dips',
    name: 'Dips',
    readyText: 'Ready. Start your dips',
    mainLabel: 'Elbow',
    main: elbowAngle,
    mainNeeds: ['shoulder', 'elbow', 'wrist'],
    topAbove: 150,
    range: 15,
    measures: [
        { key: 'depth', label: 'depth', unit: '°', worst: 'min', get: elbowAngle },
        {
            // upper arm angle from horizontal at the bottom: 0 = parallel, positive = shoulder below elbow
            key: 'arm',
            label: 'upper arm',
            unit: '°',
            worst: 'max',
            needs: ['shoulder', 'elbow'],
            get: ({ p, j }) =>
                (Math.atan2(p(j.shoulder).y - p(j.elbow).y, Math.abs(p(j.shoulder).x - p(j.elbow).x)) * 180) / Math.PI,
        },
        {
            // how much the knee angle changes from the start position: bent legs are fine, kicking isn't
            key: 'legs',
            label: 'leg movement',
            unit: '°',
            worst: 'max',
            needs: ['hip', 'knee', 'ankle'],
            fromBaseline: true,
            abs: true,
            get: ({ p, j }) => angle(p(j.hip), p(j.knee), p(j.ankle)),
        },
        {
            // gap between ear and shoulder, as % of torso length: shrugging makes it smaller
            key: 'shrug',
            label: 'neck gap',
            unit: '%',
            worst: 'min',
            needs: ['ear', 'shoulder', 'hip'],
            get: ({ p, j }) => (dist(p(j.ear), p(j.shoulder)) / dist(p(j.shoulder), p(j.hip))) * 100,
        },
        {
            // how far the hips move sideways from the start position, as % of torso length
            key: 'swing',
            label: 'swing',
            unit: '%',
            worst: 'max',
            needs: ['shoulder', 'hip'],
            fromBaseline: true,
            abs: true,
            get: ({ p, j }) => (p(j.hip).x / dist(p(j.shoulder), p(j.hip))) * 100,
        },
        {
            key: 'lean',
            label: 'lean',
            unit: '°',
            worst: 'max',
            needs: ['shoulder', 'hip'],
            get: ({ p, j }) => tilt(p(j.shoulder), p(j.hip)),
        },
    ],
    // placeholders until the numbers from real clips are in
    judge: (w) => {
        const problems: string[] = []
        if ((w.depth ?? 0) > 100) problems.push('Go lower, upper arms to parallel')
        if ((w.depth ?? 180) < 60) problems.push("Don't sink so deep")
        if ((w.legs ?? 0) > 25) problems.push("Keep your legs still, don't kick")
        return problems
    },
}

// ---------- push-ups ----------

// how far the hip sits below the straight shoulder-to-ankle line, as % of body length
// positive = hips sagging towards the floor, negative = hips piked up
function hipOffset({ p, j }: Frame) {
    const s = p(j.shoulder)
    const a = p(j.ankle)
    const h = p(j.hip)
    const t = (h.x - s.x) / (a.x - s.x || 1)
    const lineY = s.y + t * (a.y - s.y)
    return ((h.y - lineY) / (dist(s, a) || 1)) * 100
}

const pushup: Exercise = {
    id: 'pushup',
    name: 'Push-ups',
    readyText: 'Ready. Start your push-ups',
    mainLabel: 'Elbow',
    main: elbowAngle,
    mainNeeds: ['shoulder', 'elbow', 'wrist'],
    topAbove: 120,
    range: 15,
    measures: [
        { key: 'depth', label: 'depth', unit: '°', worst: 'min', get: elbowAngle },
        {
            key: 'sag',
            label: 'sag',
            unit: '%',
            worst: 'max',
            needs: ['shoulder', 'hip', 'ankle'],
            get: hipOffset,
        },
        {
            key: 'pike',
            label: 'pike',
            unit: '%',
            worst: 'min',
            needs: ['shoulder', 'hip', 'ankle'],
            get: hipOffset,
        },
        {
            key: 'body',
            label: 'body line',
            unit: '°',
            worst: 'min',
            needs: ['shoulder', 'hip', 'ankle'],
            get: ({ p, j }) => angle(p(j.shoulder), p(j.hip), p(j.ankle)),
        },
        {
            key: 'neck',
            label: 'neck',
            unit: '°',
            worst: 'min',
            needs: ['ear', 'shoulder', 'hip'],
            get: ({ p, j }) => angle(p(j.ear), p(j.shoulder), p(j.hip)),
        },
    ],
    // placeholders until the numbers from real clips are in
        // thresholds set from recorded clips: good, shallow, sagging, piked, no lockout, head down
    judge: (w) => {
        const problems: string[] = []
        if ((w.sag ?? 0) > 7.5) problems.push('Squeeze your glutes, your hips are sagging')
        if ((w.pike ?? 0) < -7) problems.push('Lower your hips, keep your body in a straight line')
        if ((w.depth ?? 0) > 62) problems.push('Go lower, chest closer to the floor')
        if ((w.top ?? 180) < 150) problems.push('Go higher at the top')
        if ((w.neck ?? 180) < 135) problems.push('Keep your head in line, look at the floor just ahead of your hands')
        return problems
    },
}

export const EXERCISES: Exercise[] = [squat, dips, pushup]