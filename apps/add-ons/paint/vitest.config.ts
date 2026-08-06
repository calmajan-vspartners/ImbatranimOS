import { defineConfig } from 'vitest/config'

// The flood fill, the undo model and the coordinate/clamp math are pure and
// are where editor corruption bugs hide; the canvas component is a thin shell.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
