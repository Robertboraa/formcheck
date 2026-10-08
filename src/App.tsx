import { useState } from 'react'
import Camera from './Camera'

function App() {
  const [started, setStarted] = useState(false)

  if (started) {
  return (
    <div>
      <Camera />
      <button onClick={() => setStarted(false)}>Stop camera</button>
    </div>
  )
}

  return (
    <div>
      <h1>FormCheck</h1>
      <button onClick={() => setStarted(true)}>Start camera</button>
    </div>
  )
}

export default App