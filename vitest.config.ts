import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only Kynska's tests: .cache/ holds an upstream Strudel checkout with its own.
    include: ['test/**/*.test.ts'],
  },
});
