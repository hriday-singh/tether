import path from 'node:path';
import { defineConfig } from 'vitest/config';

// JSX compiles through Vite's esbuild using tsconfig `jsx: react-jsx`, so no React plugin is needed.
export default defineConfig({
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
