import { useState } from 'react'

function App() {
  const [started, setStarted] = useState(false)

  if (started) {
  return (
    <div>
      <p>Camera goes here</p>
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