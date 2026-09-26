import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 用相对 base + HashRouter，便于任意子路径静态部署
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173 },
})
