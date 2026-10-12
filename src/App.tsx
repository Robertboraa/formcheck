import { useCallback, useState } from 'react'
import Camera from './Camera'
import { EXERCISES } from './exercises'

function App() {
  const [screen, setScreen] = useState('start')
  const [file, setFile] = useState<File | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [exerciseId, setExerciseId] = useState(EXERCISES[0].id)

  const exercise = EXERCISES.find((x) => x.id === exerciseId) ?? EXERCISES[0]
  const clipName = file?.name ?? 'Live camera'
  const addRep = useCallback((line: string) => setLog((old) => [...old, line]), [])

  if (screen === 'session') {
    return (
      <div>
        <h2>{exercise.name}</h2>
        <Camera file={file} exercise={exercise} onRep={addRep} />
        <button onClick={() => setScreen('summary')}>Finish</button>
        <h3>Your reps</h3>
        <ol>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
    )
  }

  if (screen === 'summary') {
    const good = log.filter((line) => line.startsWith('Good rep')).length
    return (
      <div>
        <h1>Session summary</h1>
        <p>
          {exercise.name}, {clipName}
        </p>
        <p>
          {log.length} reps, {good} with good form
        </p>
        <ol>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        <button
          onClick={() =>
            navigator.clipboard.writeText(`${exercise.name}, ${clipName}\n${log.join('\n')}`)
          }
        >
          Copy results
        </button>
        <button onClick={() => setScreen('start')}>New session</button>
      </div>
    )
  }

  return (
    <div>
      <h1>FormCheck</h1>
      <p>
        <label>
          Exercise:{' '}
          <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
            {EXERCISES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <button
        onClick={() => {
          setLog([])
          setFile(null)
          setScreen('session')
        }}
      >
        Start camera
      </button>
      <p>or analyse a recorded video:</p>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => {
          setLog([])
          setFile(e.target.files?.[0] ?? null)
          setScreen('session')
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default App