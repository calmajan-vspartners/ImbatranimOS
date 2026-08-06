import { defineConfig } from 'vitest/config'

/**
 * Kept separate from vite.config.ts on purpose: the app build must not carry a
 * test config, and the test run must not load the tailwind/react plugins it
 * does not need.
 *
 * `environment: 'node'` is still the default because almost everything here is
 * pure logic — layout arithmetic, comparators, formatters — and a DOM per file
 * is not free. Brief 47 needed a real DOM for the window error boundary, so
 * `.test.tsx` files are included too and opt in per file with a
 * `// @vitest-environment jsdom` docblock. jsdom was already a devDependency;
 * @testing-library/react was NOT added — `react-dom/client` plus React 19's
 * `act` covers "does it catch, does Reload remount" in a dozen lines, and the
 * day component tests outgrow that is the day to reconsider.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
