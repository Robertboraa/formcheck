import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    // pose-detection's optional BlazePose runtime isn't used; see src/stubs/mediapipe-pose.ts
    alias: { '@mediapipe/pose': fileURLToPath(new URL('./src/stubs/mediapipe-pose.ts', import.meta.url)) },
  },
  server: {
    host: true,
    // cross-origin isolation: lets the browser run WebAssembly on several CPU cores at once
    // (ONNX Runtime uses this for RTMO, and for YOLO when there's no WebGPU)
    headers: isolation,
    // send /api requests to the FormCheck API (server/), so the app and API share one address
    proxy: { '/api': 'http://localhost:3001' },
  },
  preview: { headers: isolation },
})
