// A rep drawn as a weight plate: yellow for perfect, blue for good, red for a fault
// (the colours of competition bumper plates)
type Props = {
  label: string | number
  kind: 'perfect' | 'good' | 'bad'
  size?: number
}

export function Plate({ label, kind, size = 32 }: Props) {
  return (
    <span className={`plate ${kind}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {label}
    </span>
  )
}

// The whole set as plates loaded onto a barbell, seen from the side
export function Barbell({ reps }: { reps: { n: number; kind: 'perfect' | 'good' | 'bad' }[] }) {
  return (
    <div className="barbell" role="img" aria-label={`${reps.length} reps loaded on a bar`}>
      <div className="barbell-bar" />
      <div className="barbell-collar" />
      {reps.map((r) => (
        <div key={r.n} className="barbell-slot">
          <div className={`barbell-plate ${r.kind}`} title={`Rep ${r.n}: ${r.kind}`} />
          <span className="barbell-n">{r.n}</span>
        </div>
      ))}
    </div>
  )
}
