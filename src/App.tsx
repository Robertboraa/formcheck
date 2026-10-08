import { useState } from 'react'
import Camera from './Camera'

function App() {
  const [started, setStarted] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  if (started) {
    return (
      <div>
        <Camera file={file} />
        <button
  onClick={() => {
    setStarted(false)
    setFile(null)
  }}
>
  Stop
</button>
      </div>
    )
  }

  return (
    <div>
      <h1>FormCheck</h1>
      <button onClick={() => setStarted(true)}>Start camera</button>
      <p>or analyse a recorded video:</p>
      <input
        type="file"
        accept="video/*"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null)
          setStarted(true)
        }}
      />
    </div>
  )
}

export default App