import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Spec files run in parallel against the one test database, so card writes from all
    // of them wait their turn on the changeSeq advisory lock.
    testTimeout: 15_000,
  },
});
