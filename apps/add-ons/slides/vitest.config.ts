import { defineConfig } from 'vitest/config'

// Notes parsing + zoom math are pure; the fixture is a real .pptx read off disk.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
