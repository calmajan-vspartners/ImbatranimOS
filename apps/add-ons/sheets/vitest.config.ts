import { defineConfig } from 'vitest/config'

// The ExcelJS bridge and the package scan both run in node; no DOM needed. The
// fidelity fixture is a real .xlsx read off disk.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
