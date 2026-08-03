import { defineConfig } from 'vitest/config'

// Pure logic + zip fixtures; fflate runs in node. No DOM needed.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
