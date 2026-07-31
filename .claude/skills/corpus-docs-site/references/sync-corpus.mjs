// Sync the hand-authored narrative from corpus/ into the Starlight content
// tree. The corpus is the single source of truth (see corpus-flow); this
// script only *renders* it — it never writes back.
//
//   corpus/wiki/*.md  ┐
//   corpus/status.md  ┼─►  src/content/docs/wiki/<slug>.md
//   corpus/log.md     ┘     (frontmatter rewritten to Starlight's schema,
//                            intra-corpus links remapped to /wiki/...)
//
// Pages are auto-discovered: every *.md under corpus/wiki/, plus status.md and
// log.md at the corpus root if present. The generated files carry a "do not
// edit" banner and should be gitignored. Run via `npm run sync-corpus` (also
// runs before `dev` and `docs`).
//
// EDIT THIS: set GITHUB_BLOB_BASE to the repo's blob URL so links to
// briefs/todos/source (pages not rendered here) resolve. Set to '' to leave
// such links untouched.
const GITHUB_BLOB_BASE = 'https://github.com/OWNER/REPO/blob/main'

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// This script lives at <docs>/scripts/sync-corpus.mjs; corpus/ is at repo root.
const repoRoot = resolve(here, '../../..')
const corpus = resolve(repoRoot, 'corpus')
const outDir = resolve(here, '../src/content/docs/wiki')

/** Discover the corpus pages to render, in a stable order. */
async function discoverPages() {
  const pages = []
  const wikiDir = resolve(corpus, 'wiki')
  if (existsSync(wikiDir)) {
    const files = (await readdir(wikiDir)).filter((f) => f.endsWith('.md')).sort()
    for (const f of files) pages.push({ src: `wiki/${f}`, slug: basename(f, '.md') })
  }
  for (const root of ['status.md', 'log.md']) {
    if (existsSync(resolve(corpus, root))) pages.push({ src: root, slug: basename(root, '.md') })
  }
  return pages
}

/** Split leading `--- ... ---` frontmatter from a markdown body. */
function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { fm: {}, body: raw }
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  return { fm, body: raw.slice(m[0].length) }
}

/** Pull the first `# H1` as the title, and strip it from the body. */
function extractTitle(body, fallback) {
  const m = /^#\s+(.+?)\s*$/m.exec(body)
  if (m && body.slice(0, m.index).trim() === '') {
    return { title: m[1].trim(), body: body.slice(m.index + m[0].length).replace(/^\r?\n/, '') }
  }
  return { title: fallback, body }
}

/** Remap links that point at other corpus files to their /wiki/<slug>/ route. */
function rewriteLinks(body, known) {
  return body.replace(/\]\(([^)]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#|\/)/.test(target)) return whole
    const [pathPart, anchor] = target.split('#')
    const stem = pathPart
      .replace(/^(\.\.\/)+/, '')
      .replace(/^wiki\//, '')
      .replace(/\.md$/, '')
    if (known.has(stem)) {
      return `](/wiki/${stem}/${anchor ? '#' + anchor : ''})`
    }
    if (GITHUB_BLOB_BASE && (/\.md$/.test(pathPart) || pathPart.startsWith('../'))) {
      const clean = pathPart.replace(/^(\.\.\/)+/, '')
      return `](${GITHUB_BLOB_BASE}/corpus/${clean}${anchor ? '#' + anchor : ''})`
    }
    return whole
  })
}

const yamlEscape = (s) => '"' + String(s).replace(/"/g, '\\"') + '"'

async function main() {
  if (!existsSync(corpus)) {
    console.error(`sync-corpus: no corpus/ at ${corpus} — is this a corpus-flow project?`)
    process.exit(1)
  }
  const PAGES = await discoverPages()
  const known = new Set(PAGES.map((p) => p.slug))

  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  let count = 0
  for (const { src, slug } of PAGES) {
    const raw = await readFile(resolve(corpus, src), 'utf8')
    const { fm, body: afterFm } = splitFrontmatter(raw)
    const fallbackTitle = slug.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase())
    const { title, body } = extractTitle(afterFm, fallbackTitle)
    const description = (fm.summary || '').replace(/\s+/g, ' ').slice(0, 160)
    const updated = fm.updated ? ` · updated ${fm.updated}` : ''

    const front = [
      '---',
      `title: ${yamlEscape(title)}`,
      description ? `description: ${yamlEscape(description)}` : null,
      'tableOfContents:',
      '  maxHeadingLevel: 3',
      '---',
      '',
      `:::note[Rendered from \`corpus/${src}\`${updated}]`,
      'This page is generated from the project corpus and rewritten on every docs build. Edit the source in `corpus/`, not here.',
      ':::',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n')

    await writeFile(resolve(outDir, `${slug}.md`), front + rewriteLinks(body, known).trimStart(), 'utf8')
    count++
  }
  console.log(`sync-corpus: wrote ${count} page(s) → src/content/docs/wiki/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
