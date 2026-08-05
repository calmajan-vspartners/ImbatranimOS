import { defineConfig } from 'vitest/config'

// Pure logic — marker helpers, outline parsing, scroll-sync maths, asset paths — plus
// the preview's render-to-string tests (react-dom/server needs no DOM, so still node).
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
