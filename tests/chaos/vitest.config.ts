import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'regressions/**/*.test.ts'],
    testTimeout: 60000,
  },
});
