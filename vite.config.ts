/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // ffmpeg.wasm charge ses workers dynamiquement : ne pas le pré-bundler.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
