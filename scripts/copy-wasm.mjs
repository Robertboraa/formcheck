// Copies MediaPipe's WebAssembly files into public/wasm so the app can load them.
// Runs automatically after `npm install`.
import { cpSync, existsSync } from 'node:fs'

const from = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(from)) {
  cpSync(from, 'public/wasm', { recursive: true })
  console.log('Copied MediaPipe WASM files to public/wasm')
}
