import { defineConfig } from 'vitest/config'

// Pure transport logic only — no DOM needed. Mirrors apps/core's setup.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
