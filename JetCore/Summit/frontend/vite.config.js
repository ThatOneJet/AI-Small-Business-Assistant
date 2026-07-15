import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/admin': 'http://localhost:5000',
      '/link': 'http://localhost:5000',
      '/exchange': 'http://localhost:5000',
      '/health': 'http://localhost:5000',
    },
  },
  build: {
    // Flattened layout: the Python app now lives at the repo root, so the React
    // build outputs straight into ./static/react (one level up from frontend/).
    outDir: '../static/react',
    emptyOutDir: true,
  },
})
