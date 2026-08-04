import { defineConfig } from 'vitest/config'

// Pure logic — the history ring buffer, sparkline geometry, rate formatting and
// the process filter. No DOM needed.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
