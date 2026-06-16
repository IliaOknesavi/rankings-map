import { defineConfig } from 'vite'

// Static-first build: relative base so the bundle can be hosted from any path
// on an edge CDN (Cloudflare Pages / GitHub Pages / S3).
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2020', outDir: 'dist' },
})
