import { defineConfig } from 'vitest/config'

// Three pure modules, all of which handle input written by other people's software or
// typed by a human: the Netscape reader/writer (a real browser export), the URL
// normaliser that decides when two bookmarks are "the same", and the tree helpers
// whose search must not hide a matching bookmark under a non-matching folder.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
