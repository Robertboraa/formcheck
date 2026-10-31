// A goniometer (the protractor physios use to measure joints) reading a knee angle.
// The moving arm sweeps down once on load, like someone sitting into a squat.
const CX = 200
const CY = 200
const R = 170
const ANGLE = 94

function point(deg: number, r: number) {
  const rad = (deg * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) }
}

function Gauge() {
  const ticks = []
  for (let d = 0; d <= 180; d += 5) {
    const major = d % 30 === 0
    const a = point(d, R)
    const b = point(d, R - (major ? 18 : 9))
    ticks.push(
      <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={major ? 2 : 1} opacity={major ? 0.9 : 0.45} />,
    )
    if (major) {
      const t = point(d, R + 18)
      ticks.push(
        <text key={`t${d}`} x={t.x} y={t.y + 5} textAnchor="middle" className="gauge-num">
          {d}
        </text>,
      )
    }
  }
  const arcEnd = point(ANGLE, 62)
  return (
    <figure className="gauge">
      <svg viewBox="0 -10 400 225" role="img" aria-label="A goniometer reading a 94 degree knee angle">
        {ticks}
        {/* the measured angle */}
        <path
          className="gauge-arc"
          d={`M ${CX + 62} ${CY} A 62 62 0 0 0 ${arcEnd.x} ${arcEnd.y} L ${CX} ${CY} Z`}
        />
        {/* fixed arm along the shin */}
        <line x1={CX} y1={CY} x2={CX + R - 26} y2={CY} className="gauge-arm" />
        {/* moving arm along the thigh */}
        <g className="gauge-moving" style={{ transformOrigin: `${CX}px ${CY}px` }}>
          <line x1={CX} y1={CY} x2={CX + R - 26} y2={CY} className="gauge-arm" />
        </g>
        <circle cx={CX} cy={CY} r={9} className="gauge-joint" />
      </svg>
      <figcaption>
        <b>{ANGLE}°</b> knee angle at the bottom of a squat
      </figcaption>
    </figure>
  )
}

export default Gauge
