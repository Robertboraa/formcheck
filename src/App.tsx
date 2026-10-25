import { useCallback, useEffect, useState } from 'react'
import Camera from './Camera'
import { EXERCISES, findExercise, shortCue, type Rep } from './exercises'
import Summary, { type SaveState } from './Summary'
import Auth from './Auth'
import History from './History'
import { api, type SavedSession, type SessionSummary, type User } from './api'
import Logo from './Logo'

type Screen = 'start' | 'session' | 'summary' | 'auth' | 'history' | 'saved'

function App() {
  const [screen, setScreen] = useState<Screen>('start')
  const [file, setFile] = useState<File | null>(null)
  const [reps, setReps] = useState<Rep[]>([])
  const [exerciseId, setExerciseId] = useState(EXERCISES[0].id)
  const [user, setUser] = useState<User | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('guest')
  const [previous, setPrevious] = useState<SessionSummary | undefined>()
  const [saved, setSaved] = useState<SavedSession | null>(null)

  const exercise = EXERCISES.find((x) => x.id === exerciseId) ?? EXERCISES[0]
  const clipName = file?.name ?? 'Live camera'
  const addRep = useCallback((rep: Rep) => setReps((old) => [...old, rep]), [])

  // stay signed in between visits: the API remembers the user with a cookie
  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  function begin(video: File | null) {
    setReps([])
    setFile(video)
    setScreen('session')
  }

  // save the set to the user's history, then find their previous one to compare with
  async function finish() {
    setPrevious(undefined)
    setScreen('summary')
    if (!user || reps.length === 0) {
      setSaveState('guest')
      return
    }
    setSaveState('saving')
    try {
      const { id } = await api.saveSession(exercise.id, clipName, reps)
      setSaveState('saved')
      const list = await api.sessions(exercise.id)
      setPrevious(list.find((s) => s.id !== id))
    } catch {
      setSaveState('error')
    }
  }

  async function openSaved(summary: SessionSummary, before: SessionSummary | undefined) {
    const session = await api.session(summary.id)
    setSaved(session)
    setPrevious(before)
    setScreen('saved')
  }

  async function signOut() {
    await api.logout().catch(() => {})
    setUser(null)
    setScreen('start')
  }

  const savedExercise = saved ? findExercise(saved.exercise) : undefined

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen('start')}>
          <Logo size={34} /> FormCheck
        </button>
        {screen === 'session' ? (
          <div className="topbar-right">
            <span className="muted">{exercise.name}</span>
            <button className="btn primary" onClick={finish}>
              Finish
            </button>
          </div>
        ) : (
          <div className="topbar-right">
            {user ? (
              <>
                <button className="btn ghost" onClick={() => setScreen('history')}>
                  History
                </button>
                <span className="muted user-email">{user.email}</span>
                <button className="btn" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              screen !== 'auth' && (
                <button className="btn" onClick={() => setScreen('auth')}>
                  Sign in
                </button>
              )
            )}
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
        <Summary
          exercise={exercise}
          clipName={clipName}
          reps={reps}
          onRestart={() => setScreen('start')}
          saveState={saveState}
          onSignIn={() => setScreen('auth')}
          previous={previous}
        />
      )}

      {screen === 'auth' && (
        <Auth
          onSignedIn={(u) => {
            setUser(u)
            setScreen('start')
          }}
          onCancel={() => setScreen('start')}
        />
      )}

      {screen === 'history' && user && (
        <History initialExercise={exerciseId} onOpen={openSaved} onStart={() => setScreen('start')} />
      )}

      {screen === 'saved' && saved && savedExercise && (
        <Summary
          exercise={savedExercise}
          clipName={saved.source}
          reps={saved.reps}
          savedAt={saved.createdAt}
          previous={previous}
          onRestart={() => {
            setExerciseId(savedExercise.id)
            setScreen('start')
          }}
          onBack={() => setScreen('history')}
          onDelete={async () => {
            if (!window.confirm('Delete this session from your history?')) return
            await api.deleteSession(saved.id)
            setScreen('history')
          }}
        />
      )}

      {screen === 'start' && (
        <main className="start">
          <section className="hero">
            <p className="eyebrow">Rep-by-rep form feedback</p>
            <h1>
              Your camera.
              <br />
              <em>Your coach.</em>
            </h1>
            <p className="lead">
              FormCheck watches you train, counts your reps and tells you what to fix after every one. The video is
              analysed in your browser and never leaves your device.
            </p>
            <div className="hero-stats">
              <div>
                <b>33</b>
                <span>body points tracked</span>
              </div>
              <div>
                <b>Every rep</b>
                <span>judged and explained</span>
              </div>
              <div>
                <b>On-device</b>
                <span>video never leaves it</span>
              </div>
            </div>
            {!user && (
              <p className="hero-note muted">
                <button className="link" onClick={() => setScreen('auth')}>
                  Create a free account
                </button>{' '}
                to save your sessions and see your progress.
              </p>
            )}
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
