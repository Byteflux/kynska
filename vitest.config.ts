import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only Kynska's tests: .cache/ holds an upstream Strudel checkout with its own.
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        // Modules loaded from the Strudel checkout in .cache/ (Tidal) go to Node
        // directly, like node_modules, so Kynska's resolve hooks apply to them.
        external: [/[\\/]\.cache[\\/]/],
      },
    },
  },
});
