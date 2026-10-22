import { useCallback, useState } from 'react'
import Camera, { shortCue } from './Camera'
import { EXERCISES, type Rep } from './exercises'
import Summary from './Summary'

function App() {
  const [screen, setScreen] = useState<'start' | 'session' | 'summary'>('start')
  const [file, setFile] = useState<File | null>(null)
  const [reps, setReps] = useState<Rep[]>([])
  const [exerciseId, setExerciseId] = useState(EXERCISES[0].id)

  const exercise = EXERCISES.find((x) => x.id === exerciseId) ?? EXERCISES[0]
  const clipName = file?.name ?? 'Live camera'
  const addRep = useCallback((rep: Rep) => setReps((old) => [...old, rep]), [])

  function begin(video: File | null) {
    setReps([])
    setFile(video)
    setScreen('session')
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('start')}>
          <span className="brand-mark">◆</span> FormCheck
        </button>
        {screen === 'session' && (
          <div className="topbar-right">
            <span className="muted">{exercise.name}</span>
            <button className="btn primary" onClick={() => setScreen('summary')}>
              Finish
            </button>
          </div>
        )}
      </header>

      {screen === 'session' && (
        <main className="session">
          <Camera file={file} exercise={exercise} onRep={addRep}>
            <div className="card">
              <span className="label">All reps</span>
              {reps.length === 0 ? (
                <p className="muted">Nothing yet.</p>
              ) : (
                <ol className="rep-list">
                  {[...reps].reverse().map((rep) => (
                    <li key={rep.n}>
                      <span className={`badge ${rep.good ? 'good' : 'bad'}`}>{rep.n}</span>
                      <span>{rep.good ? 'Good rep' : rep.faults.map(shortCue).join(' · ')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Camera>
        </main>
      )}

      {screen === 'summary' && (
        <Summary exercise={exercise} clipName={clipName} reps={reps} onRestart={() => setScreen('start')} />
      )}

      {screen === 'start' && (
        <main className="start">
          <section className="hero">
            <p className="eyebrow">Rep-by-rep form feedback</p>
            <h1>
              Your camera,
              <br />
              your coach.
            </h1>
            <p className="lead">
              FormCheck watches you train, counts your reps and tells you what to fix after every one. It runs
              entirely in your browser: your video never leaves your device.
            </p>
          </section>

          <section className="card setup">
            <span className="label">1. Pick an exercise</span>
            <div className="exercise-grid">
              {EXERCISES.map((x) => (
                <button
                  key={x.id}
                  className={`exercise-option ${x.id === exerciseId ? 'selected' : ''}`}
                  onClick={() => setExerciseId(x.id)}
                >
                  {x.name}
                </button>
              ))}
            </div>

            <span className="label">2. Start</span>
            <div className="actions">
              <button className="btn primary big" onClick={() => begin(null)}>
                Start camera
              </button>
              <label className="btn big">
                Upload a video
                <input
                  type="file"
                  accept="video/*"
                  hidden
                  onChange={(e) => {
                    begin(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>

            <div className="tips">
              <span className="label">Filming tips</span>
              <ul>
                <li>Phone side-on, at hip height, about 3 metres away</li>
                <li>Whole body in frame, feet included</li>
                <li>Hold still for a second before your first rep</li>
              </ul>
            </div>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
