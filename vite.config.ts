import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    // send /api requests to the FormCheck API (server/), so the app and API share one address
    proxy: { '/api': 'http://localhost:3001' },
  },
})
