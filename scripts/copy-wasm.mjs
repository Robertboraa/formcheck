// Copies the WebAssembly files the pose models need into public/ so the app can load them.
// Runs automatically after `npm install`.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'

// MediaPipe
const mediapipe = 'node_modules/@mediapipe/tasks-vision/wasm'
if (existsSync(mediapipe)) {
  cpSync(mediapipe, 'public/wasm', { recursive: true })
  console.log('Copied MediaPipe WASM files to public/wasm')
}

// ONNX Runtime (runs the YOLO pose models)
const ort = 'node_modules/onnxruntime-web/dist'
if (existsSync(ort)) {
  mkdirSync('public/ort', { recursive: true })
  for (const name of readdirSync(ort)) {
    if (name.startsWith('ort-wasm') && (name.endsWith('.wasm') || name.endsWith('.mjs'))) {
      cpSync(`${ort}/${name}`, `public/ort/${name}`)
    }
  }
  console.log('Copied ONNX Runtime WASM files to public/ort')
}
