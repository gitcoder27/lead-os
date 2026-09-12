/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'shared/types': path.resolve(__dirname, '../shared/types.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/components/**/*.{ts,tsx}', 'src/hooks/**/*.ts', 'src/lib/**/*.ts'],
      thresholds: {
        lines: 55,
        statements: 55,
        functions: 50,
        branches: 45,
      },
    },
  },
});
