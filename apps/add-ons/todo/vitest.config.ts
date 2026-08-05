import { defineConfig } from 'vitest/config'

// Due-date encoding and the sort comparators are pure, and both are places a task
// list goes quietly wrong: a todo that reads "late" from one minute past midnight,
// or a manual order that reshuffles itself after a drag.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
