import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react() as any],
  resolve: {
    alias: {
      '@tether/shared': path.join(import.meta.dirname, '../../packages/shared/src/index.ts'),
      '@': import.meta.dirname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
});
