import { defineConfig } from 'vitest/config'

// Two pure things, both of which fail silently if they are wrong: the desktop clamp
// (a note dropped off the edge is gone for good) and the colour maps (a palette entry
// the backend accepts but the frontend has no class for renders as `undefined`).
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
