import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: ['react-is', 'recharts', '@react-three/fiber', '@react-three/drei', 'three']
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    outDir: 'web-dist'
  },
  server: {
    // Development server configuration
    port: 5173,
    strictPort: false,
    open: false,
    proxy: {
      '/api': {
        target: 'https://backend.minebench.cloud',
        changeOrigin: true,
        // Local dev runs through Node's TLS stack, which may not trust the
        // backend certificate chain even when browsers do.
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      }
    }
  }
})

