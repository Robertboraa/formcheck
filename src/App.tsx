import { useState } from 'react'
import Camera from './Camera'

function App() {
  const [screen, setScreen] = useState('start')
  const [file, setFile] = useState<File | null>(null)
  const [log, setLog] = useState<string[]>([])

  if (screen === 'session') {
    return (
      <div>
        <Camera file={file} onRep={(line) => setLog((old) => [...old, line])} />
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
          {log.length} reps, {good} with good form
        </p>
        <ol>
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
        <button onClick={() => setScreen('start')}>New session</button>
      </div>
    )
  }

  return (
    <div>
      <h1>FormCheck</h1>
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
        }}
      />
    </div>
  )
}

export default App