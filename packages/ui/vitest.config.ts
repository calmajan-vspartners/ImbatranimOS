import { defineConfig } from 'vitest/config'

// Node by default; a test that needs a DOM opts in per file with
// `// @vitest-environment jsdom`, the same convention core uses.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
