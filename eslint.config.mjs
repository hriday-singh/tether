import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.log',
      'data/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
      // apps/web has its own eslint.config.mjs with Next.js, react-hooks, and
      // TypeScript plugins. Running the root config over those files would flag
      // legitimate eslint-disable comments for react-hooks rules that only exist
      // in the web-specific config. Use `pnpm -r run lint` to run both configs.
      'apps/web/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts,js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
