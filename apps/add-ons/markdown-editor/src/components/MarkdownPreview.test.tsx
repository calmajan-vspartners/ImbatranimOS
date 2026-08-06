import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SystemProvider, type SystemHandle } from '@imbatranim/ui'
import { MarkdownPreview } from './MarkdownPreview'
import { parseHeadings } from '../lib/outline'

// `react-dom/server` renders without a DOM, so these run in the same node environment
// as the pure tests — no jsdom, no testing-library, no new dev dependency for the one
// property in this app that is a security property rather than a feature.
//
// The preview reaches the OS only through the injected handle (brief 48), and only
// for `fs.downloadUrl` — so the fake implements that one protocol member, shaped like
// the real route, and nothing else. Touching any other capability should throw.
const system = {
  fs: {
    downloadUrl: (root: string, path: string) =>
      `/api/files/download?root=${root}&path=${encodeURIComponent(path)}`,
  },
} as unknown as SystemHandle

function render(text: string, docDir = 'docs') {
  return renderToStaticMarkup(
    <SystemProvider system={system}>
      <MarkdownPreview
        text={text}
        root="home"
        docDir={docDir}
        headings={parseHeadings(text)}
        onToggleTaskLine={() => {}}
        onOpenRelative={() => {}}
      />
    </SystemProvider>
  )
}

describe('raw HTML stays inert', () => {
  it('escapes a script tag instead of rendering it', () => {
    const html = render('before\n\n<script>alert(1)</script>\n\nafter')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not emit an event-handler attribute from raw HTML', () => {
    // A markdown file is untrusted input: it can arrive by upload, git clone, or curl
    // in the terminal. This is why `rehype-raw` is not installed, and this test is what
    // stops a later refactor from adding it "to fix the HTML in my notes".
    const html = render('<img src=x onerror="alert(1)">')
    // The whole tag is text, so `onerror` appears only inside escaped markup — there is
    // no element for the browser to attach a handler to.
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x onerror=')
  })

  it('drops a javascript: URL rather than linking to it', () => {
    const html = render('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:alert')
  })

  it('renders an iframe as text', () => {
    expect(render('<iframe src="https://evil.test"></iframe>')).not.toContain('<iframe')
  })
})

describe('source lines are stamped on every block', () => {
  it('records the line each block came from', () => {
    const html = render('# Title\n\npara\n\n- item\n')
    expect(html).toContain('data-src-line="1"')
    expect(html).toContain('data-src-line="3"')
    expect(html).toContain('data-src-line="5"')
  })
})

describe('images', () => {
  it('resolves a relative image against the document directory and the FS root', () => {
    const html = render('![shot](img/shot.png)')
    expect(html).toContain('src="/api/files/download?root=home&amp;path=docs%2Fimg%2Fshot.png"')
  })

  it('honours a root-relative path', () => {
    expect(render('![logo](/assets/logo.png)')).toContain('path=assets%2Flogo.png')
  })

  it('explains a remote image instead of drawing a broken one', () => {
    // `img-src 'self' data: blob:` refuses it, so the browser would show a broken-image
    // icon with no reason given.
    const html = render('![badge](https://img.shields.io/badge.svg)')
    expect(html).not.toContain('<img')
    expect(html).toContain('external image blocked by policy')
    expect(html).toContain('data-external-image="https://img.shields.io/badge.svg"')
  })

  it('still renders an inline data: image', () => {
    // react-markdown's own sanitizer strips `data:` by default, so an inline base64
    // image used to render as nothing at all — not even the blocked placeholder.
    expect(render('![dot](data:image/gif;base64,R0lGOD)')).toContain(
      'src="data:image/gif;base64,R0lGOD"'
    )
  })

  it('permits data: only for image sources', () => {
    const html = render('[click](data:text/html,<script>alert(1)</script>)')
    expect(html).not.toContain('data:text/html')
  })

  it('refuses a path that climbs out of the root', () => {
    expect(render('![x](../../../etc/passwd)')).toContain('external image blocked by policy')
  })
})

describe('links', () => {
  it('sends an external link to a new tab with noopener', () => {
    // The preview lives inside the single-page app that hosts the whole desktop; a
    // same-tab navigation would take the session and the unsaved buffer with it.
    const html = render('[spec](https://example.test/spec)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('gives headings ids so a document’s own table of contents resolves', () => {
    const html = render('# Getting Started\n\n[jump](#getting-started)\n')
    expect(html).toContain('id="getting-started"')
    expect(html).toContain('href="#getting-started"')
  })
})

describe('task lists', () => {
  it('renders checkboxes that are read-only rather than disabled, so clicks arrive', () => {
    const html = render('- [ ] one\n- [x] two\n')
    expect(html).not.toContain('disabled')
    expect(html).toMatch(/readonly/i)
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
    expect(html).toContain('checked')
  })
})

describe('gfm behaviour is preserved', () => {
  it('renders tables, strikethrough and autolinks', () => {
    const html = render('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~ and https://auto.test\n')
    expect(html).toContain('<table')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('href="https://auto.test"')
  })
})
