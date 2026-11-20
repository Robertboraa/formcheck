import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    // pose-detection's optional BlazePose runtime isn't used; see src/stubs/mediapipe-pose.ts
    alias: { '@mediapipe/pose': fileURLToPath(new URL('./src/stubs/mediapipe-pose.ts', import.meta.url)) },
  },
  server: {
    host: true,
    // send /api requests to the FormCheck API (server/), so the app and API share one address
    proxy: { '/api': 'http://localhost:3001' },
  },
})
