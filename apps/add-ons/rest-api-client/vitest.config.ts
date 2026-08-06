import { defineConfig } from 'vitest/config'

// Three pure modules that handle input the user pastes or types: the curl
// reader/writer (the brief's own words — "this is where quoting bugs live"), the
// `{{var}}` interpolator whose output becomes a URL the proxy fetches, and the
// environment model that decides what a secret is.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
