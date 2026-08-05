import { defineConfig } from 'vitest/config'

// The recurrence engine and the ICS codec are pure and are where a calendar goes
// wrong quietly — a series that skips a month, a count that a deleted instance
// silently extends, a DTSTART that loses its timezone-free local meaning.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
