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
  topAbove: number // main angle above this = top of the rep (and ready position)
  downBelow: number // main angle below this = a rep has started
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
  downBelow: 130,
  measures: [
    { key: 'depth', label: 'depth', unit: '°', worst: 'min', get: kneeAngle },
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
    if ((w.depth ?? 180) > 95) problems.push('Go lower next time')
    if ((w.lean ?? 0) > 50) problems.push('Keep your chest up')
    if ((w.neck ?? 180) < 140) problems.push('Keep your head in line with your back')
    if ((w.balance ?? 0) > 50) problems.push('Sit back, your weight is on your toes')
    if ((w.heels ?? 0) > 8) problems.push('Keep your heels down')
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
  downBelow: 120,
  measures: [
    { key: 'depth', label: 'depth', unit: '°', worst: 'min', get: elbowAngle },
    {
      key: 'legs',
      label: 'legs',
      unit: '°',
      worst: 'min',
      needs: ['hip', 'knee', 'ankle'],
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
    if ((w.depth ?? 180) > 100) problems.push('Go lower, upper arms to parallel')
    if ((w.depth ?? 180) < 60) problems.push("Don't sink so deep")
    if ((w.legs ?? 180) < 140) problems.push('Keep your legs straight')
    return problems
  },
}
 
export const EXERCISES: Exercise[] = [squat, dips]