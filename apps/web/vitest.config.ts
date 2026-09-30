import path from 'node:path';
import { defineConfig } from 'vitest/config';

// JSX compiles through Vite's esbuild using tsconfig `jsx: react-jsx`, so no React plugin is needed.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tether\/shared\/(.*)$/, replacement: path.join(import.meta.dirname, '../../packages/shared/src/$1') },
      { find: /^@tether\/shared$/, replacement: path.join(import.meta.dirname, '../../packages/shared/src/index.ts') },
      { find: /^@tether\/sync-client$/, replacement: path.join(import.meta.dirname, '../../packages/sync-client/src/index.ts') },
      { find: '@', replacement: import.meta.dirname },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
});
