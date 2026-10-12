import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', build: { chunkSizeWarningLimit: 1300 }, test: { environment: 'jsdom', include: ['src/**/*.test.js'] } });
