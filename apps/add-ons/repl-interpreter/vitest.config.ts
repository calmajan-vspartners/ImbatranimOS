import { defineConfig } from 'vitest/config'

// Pure logic — close-code classification, theme mapping, font-size persistence.
// No DOM needed; the storage tests install a small localStorage stub.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
