import { defineConfig } from 'vitest/config'

/**
 * Kept separate from vite.config.ts on purpose: the app build must not carry a
 * test config, and the test run must not load the tailwind/react plugins it
 * does not need.
 *
 * `environment: 'node'` because everything tested here so far is pure logic —
 * layout arithmetic, comparators, formatters. Component tests would need jsdom
 * plus @testing-library/react; add those the day a brief actually requires
 * them rather than carrying the weight now.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
