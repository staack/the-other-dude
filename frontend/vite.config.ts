import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { sri } from 'vite-plugin-sri3'
import path from 'path'
import fs from 'fs'

// Read version from package.json for global define
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    sri(), // SRI hashes on production builds only (apply: 'build' by default)
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1800,
    // Let Rollup split shared code with the lazy routes. Manual feature groups
    // pulled unrelated libraries into the entry and can create cross-chunk cycles.
  },
  server: {
    host: '0.0.0.0',
    // HTTPS required for Web Crypto API (crypto.subtle) on non-localhost origins.
    // Self-signed cert — click through browser warning once.
    https: fs.existsSync(path.resolve(__dirname, 'certs/dev-key.pem'))
      ? {
          key: fs.readFileSync(path.resolve(__dirname, 'certs/dev-key.pem')),
          cert: fs.readFileSync(path.resolve(__dirname, 'certs/dev-cert.pem')),
        }
      : undefined,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
