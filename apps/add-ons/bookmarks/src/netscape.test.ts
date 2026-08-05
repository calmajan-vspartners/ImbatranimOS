import { describe, expect, it } from 'vitest'
import { MAX_DEPTH, decodeEntities, describeImport, parseNetscape, toNetscape } from './netscape'

/** A file shaped the way Chrome actually writes one, unclosed <DT> and all. */
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1700000002">Example &amp; Co</A>
        <DT><H3 ADD_DATE="1700000003">Dev</H3>
        <DL><p>
            <DT><A HREF="http://localhost:3000/" ADD_DATE="1700000004">Local server</A>
            <DT><A HREF="https://docs.example.com/a?b=c&amp;d=e#frag">Docs</A>
        </DL><p>
    </DL><p>
    <DT><H3>Other</H3>
    <DL><p>
        <DT><A HREF="https://other.example/x">Other thing</A>
    </DL><p>
</DL><p>
`

describe('parseNetscape — a real browser export', () => {
  it('reads the folder tree, at the right depths', () => {
    const result = parseNetscape(CHROME_EXPORT)
    expect(result.folders.map((f) => f.name)).toEqual(['Bookmarks bar', 'Other'])
    const bar = result.folders[0]
    expect(bar.links.map((l) => l.title)).toEqual(['Example & Co'])
    expect(bar.folders.map((f) => f.name)).toEqual(['Dev'])
    expect(bar.folders[0].links.map((l) => l.url)).toEqual([
      'http://localhost:3000/',
      'https://docs.example.com/a?b=c&d=e#frag',
    ])
  })

  it('decodes entities in titles and in the href', () => {
    const result = parseNetscape(CHROME_EXPORT)
    expect(result.folders[0].links[0].title).toBe('Example & Co')
    // &amp; inside a query string must become & or the URL is wrong.
    expect(result.folders[0].folders[0].links[1].url).toContain('b=c&d=e')
  })

  it('reports nothing skipped or flattened for a clean file', () => {
    const result = parseNetscape(CHROME_EXPORT)
    expect(result.skipped).toBe(0)
    expect(result.flattened).toBe(0)
    expect(result.looseLinks).toEqual([])
  })

  it('skips bookmarks that are not http(s), and counts them', () => {
    // Firefox exports include place: URLs; a hostile file could include javascript:.
    const html = `<DL><p>
      <DT><H3>Mixed</H3>
      <DL><p>
        <DT><A HREF="https://ok.example/">Fine</A>
        <DT><A HREF="javascript:alert(1)">XSS</A>
        <DT><A HREF="place:type=6&amp;sort=14">Firefox internal</A>
        <DT><A HREF="data:text/html,<script>x</script>">Data</A>
        <DT><A HREF="">Empty</A>
      </DL><p>
    </DL><p>`
    const result = parseNetscape(html)
    expect(result.folders[0].links.map((l) => l.title)).toEqual(['Fine'])
    expect(result.skipped).toBe(4)
  })

  it('keeps top-level bookmarks that sit outside any folder', () => {
    const html = `<DL><p>
      <DT><A HREF="https://loose.example/">Loose</A>
      <DT><H3>Folder</H3>
      <DL><p><DT><A HREF="https://in.example/">In</A></DL><p>
    </DL><p>`
    const result = parseNetscape(html)
    expect(result.looseLinks.map((l) => l.title)).toEqual(['Loose'])
    expect(result.folders.map((f) => f.name)).toEqual(['Folder'])
  })

  it('survives an unnamed folder, a stray </DL> and unquoted attributes', () => {
    // Each of these has been emitted by a shipping browser at some point.
    const html = `<DL><p>
      <DT><H3></H3>
      <DL><p><DT><A HREF=https://bare.example/>Bare href</A></DL><p>
    </DL><p>
    </DL><p>
    <DT><A HREF="https://after.example/">After the extra close</A>`
    const result = parseNetscape(html)
    expect(result.folders[0].name).toBe('Untitled folder')
    expect(result.folders[0].links[0].url).toBe('https://bare.example/')
    // The stray close must not push the parser above the root and lose this one.
    expect(result.looseLinks.map((l) => l.title)).toEqual(['After the extra close'])
  })

  it('falls back to the URL when a bookmark has no title', () => {
    const result = parseNetscape('<DL><p><DT><A HREF="https://x.example/">   </A></DL><p>')
    expect(result.looseLinks[0].title).toBe('https://x.example/')
  })

  it('strips markup inside a title', () => {
    const result = parseNetscape(
      '<DL><p><DT><A HREF="https://x.example/"><B>Bold</B> title</A></DL><p>'
    )
    expect(result.looseLinks[0].title).toBe('Bold title')
  })

  it('flattens past MAX_DEPTH instead of dropping the bookmarks', () => {
    // A hostile file nests to blow the stack; the bookmarks must still arrive.
    const depth = MAX_DEPTH + 5
    let html = ''
    for (let i = 0; i < depth; i++) html += `<DT><H3>d${i}</H3>\n<DL><p>\n`
    html += '<DT><A HREF="https://deep.example/">Deep</A>\n'
    for (let i = 0; i < depth; i++) html += '</DL><p>\n'
    const result = parseNetscape(`<DL><p>\n${html}</DL><p>`)
    expect(result.flattened).toBe(5)
    const found = JSON.stringify(result.folders).includes('https://deep.example/')
    expect(found).toBe(true)
  })

  it('returns nothing for a file that is not a bookmark export', () => {
    const result = parseNetscape('<html><body><p>Just a page</p></body></html>')
    expect(result.folders).toEqual([])
    expect(result.looseLinks).toEqual([])
  })
})

describe('decodeEntities', () => {
  it('does not double-decode', () => {
    // &amp;lt; means the literal text "&lt;", not "<".
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })

  it('handles numeric and hex forms', () => {
    expect(decodeEntities('caf&#233; &#x2014; bar')).toBe('café — bar')
  })

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeEntities('&notarealentity; &amp;')).toBe('&notarealentity; &')
  })
})

describe('toNetscape', () => {
  it('round-trips through the parser', () => {
    const original = parseNetscape(CHROME_EXPORT)
    const again = parseNetscape(toNetscape(original.folders, original.looseLinks))
    expect(again.folders).toEqual(original.folders)
    expect(again.looseLinks).toEqual(original.looseLinks)
  })

  it('writes the DOCTYPE browsers sniff for', () => {
    expect(toNetscape([])).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
  })

  it('escapes a title and a URL that contain markup characters', () => {
    const html = toNetscape([
      {
        name: 'A & B',
        links: [{ title: '<script>x</script>', url: 'https://x.example/?a=1&b=2' }],
        folders: [],
      },
    ])
    expect(html).toContain('<H3>A &amp; B</H3>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a=1&amp;b=2')
    // And it comes back out intact.
    const back = parseNetscape(html)
    expect(back.folders[0].links[0]).toEqual({
      title: '<script>x</script>',
      url: 'https://x.example/?a=1&b=2',
    })
  })
})

describe('describeImport', () => {
  it('says what happened, including what it refused', () => {
    expect(describeImport({ folders: 2, links: 7, skipped: 3, flattened: 0 })).toBe(
      'Imported 7 bookmarks in 2 folders. 3 skipped (not a web address).'
    )
  })

  it('gets the singulars right', () => {
    expect(describeImport({ folders: 1, links: 1, skipped: 1, flattened: 1 })).toBe(
      'Imported 1 bookmark in 1 folder. 1 skipped (not a web address). 1 deeply nested folder flattened.'
    )
  })

  it('says nothing about skips when there were none', () => {
    expect(describeImport({ folders: 1, links: 2, skipped: 0, flattened: 0 })).toBe(
      'Imported 2 bookmarks in 1 folder.'
    )
  })
})
