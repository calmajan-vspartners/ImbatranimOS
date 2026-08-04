import { defineConfig } from 'vitest/config'

// Pure geometry and encoding helpers; no DOM needed.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
