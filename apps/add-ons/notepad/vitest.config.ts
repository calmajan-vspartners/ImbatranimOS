import { defineConfig } from 'vitest/config'

// Pure logic — find/replace, caret maths, text stats, the root-default rule and the
// size guard. No DOM needed.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
