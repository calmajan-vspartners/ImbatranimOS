import { defineConfig } from 'vitest/config'

// Pure logic only — no DOM needed. Mirrors apps/add-ons/media-player's setup.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
