import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // Keep production sources out of the public Pages artifact. If private
    // error tracking is added later, upload a hidden map outside `dist`.
    sourcemap: false,
  },
})
