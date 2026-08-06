import { defineConfig } from 'vitest/config'

// Both game engines are pure modules; the UI is a thin shell over them. This
// is where rules bugs hide (an illegal Klondike move, a mine on the first
// click), so the models carry the tests.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
