import { defineConfig } from 'vitest/config'

// The diff model is the one place in this app where being "roughly right" is not
// enough: the patch it builds is handed to `git apply --cached` and executed, and
// side-by-side pairing decides which deletion the user reads against which addition.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
