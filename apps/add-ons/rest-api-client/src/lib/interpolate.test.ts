import { describe, expect, it } from 'vitest'
import {
  blocksSend,
  describeIssues,
  interpolateRequest,
  referencedVars,
  schemeOf,
  substitute,
} from './interpolate'

describe('substitute', () => {
  it('replaces a variable', () => {
    expect(substitute('{{host}}/users', { host: 'http://localhost:3000' }).text).toBe(
      'http://localhost:3000/users'
    )
  })

  it('tolerates whitespace inside the braces', () => {
    expect(substitute('{{ host }}/x', { host: 'h' }).text).toBe('h/x')
  })

  it('replaces every occurrence', () => {
    expect(substitute('{{a}}-{{a}}-{{a}}', { a: '1' }).text).toBe('1-1-1')
  })

  it('leaves an unknown variable visible rather than blanking it', () => {
    // A URL with `{{host}}` still in it is a legible mistake; one that silently
    // became `/users` is a confusing one.
    const result = substitute('{{host}}/users', {})
    expect(result.text).toBe('{{host}}/users')
    expect(result.missing).toEqual(['host'])
  })

  it('distinguishes "not set" from "set to empty"', () => {
    const result = substitute('{{a}}{{b}}', { b: '' })
    expect(result.missing).toEqual(['a'])
    expect(result.empty).toEqual(['b'])
  })

  it('leaves malformed braces alone', () => {
    expect(substitute('{{a b}} {single} {{}}', { a: '1' }).text).toBe('{{a b}} {single} {{}}')
  })

  it('does not recurse into a substituted value', () => {
    // A value containing `{{b}}` must NOT be expanded again — that is an easy way to
    // build an unbounded loop, and nobody expects it.
    expect(substitute('{{a}}', { a: '{{b}}', b: 'deep' }).text).toBe('{{b}}')
  })
})

describe('referencedVars', () => {
  it('lists each name once', () => {
    expect(referencedVars('{{a}}/{{b}}/{{a}}')).toEqual(['a', 'b'])
  })

  it('is empty for text with no variables', () => {
    expect(referencedVars('http://x/y')).toEqual([])
  })
})

describe('schemeOf', () => {
  it('reads the scheme when there is one', () => {
    expect(schemeOf('https://x')).toBe('https:')
    expect(schemeOf('HTTP://x')).toBe('http:')
    expect(schemeOf('file:///etc/passwd')).toBe('file:')
    expect(schemeOf('  data:text/html,x')).toBe('data:')
  })

  it('is null for a relative or scheme-relative URL', () => {
    expect(schemeOf('/users')).toBeNull()
    expect(schemeOf('//host/x')).toBeNull()
    expect(schemeOf('x')).toBeNull()
  })
})

describe('interpolateRequest — the security review cases', () => {
  const base = { url: '', headers: [] as { name: string; value: string }[], body: '' }

  it('refuses a variable that smuggles a disallowed scheme', () => {
    // The exact trick the brief says a reviewer will try: the TEMPLATE is innocent
    // and the VALUE is not. The proxy would refuse it too — this layer exists so the
    // user is told why, where they can fix it.
    for (const value of [
      'file:///etc/passwd',
      'gopher://x',
      'data:text/html,<script>x</script>',
      'jar:http://x!/',
      'FILE://x',
    ]) {
      const result = interpolateRequest({ ...base, url: '{{base}}/users' }, { base: value })
      expect(result.issues.some((i) => i.kind === 'scheme')).toBe(true)
      expect(blocksSend(result.issues)).toBe(true)
    }
  })

  it('allows http and https, including a private address', () => {
    // The SSRF stance is deliberate and unchanged: the owner types every URL.
    for (const value of [
      'http://localhost:3000',
      'https://api.example.com',
      'http://127.0.0.1:8080',
      'http://192.168.1.1',
      'http://[::1]:9000',
    ]) {
      const result = interpolateRequest({ ...base, url: '{{base}}/users' }, { base: value })
      expect(result.issues.some((i) => i.kind === 'scheme')).toBe(false)
      expect(blocksSend(result.issues)).toBe(false)
    }
  })

  it('refuses a variable that injects a line break into a header', () => {
    const result = interpolateRequest(
      {
        ...base,
        url: 'http://x',
        headers: [{ name: 'X-Token', value: '{{token}}' }],
      },
      { token: 'good\r\nX-Admin: true' }
    )
    expect(result.issues.some((i) => i.kind === 'crlf')).toBe(true)
    expect(blocksSend(result.issues)).toBe(true)
    // And the poisoned header is dropped, not passed on in a "cleaned" form.
    expect(result.headers).toEqual([])
  })

  it('refuses a bare newline too, not only CRLF', () => {
    const result = interpolateRequest(
      { ...base, url: 'http://x', headers: [{ name: 'A', value: 'x\ninjected: 1' }] },
      {}
    )
    expect(result.issues.some((i) => i.kind === 'crlf')).toBe(true)
  })

  it('catches a line break smuggled into a header NAME', () => {
    const result = interpolateRequest(
      { ...base, url: 'http://x', headers: [{ name: '{{h}}', value: '1' }] },
      { h: 'A\r\nB' }
    )
    expect(result.issues.some((i) => i.kind === 'crlf')).toBe(true)
  })

  it('interpolates url, headers and body together', () => {
    const result = interpolateRequest(
      {
        url: '{{base}}/users/{{id}}',
        headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
        body: '{"id": "{{id}}"}',
      },
      { base: 'https://api.example.com', id: '42', token: 'abc' }
    )
    expect(result.url).toBe('https://api.example.com/users/42')
    expect(result.headers).toEqual([{ name: 'Authorization', value: 'Bearer abc' }])
    expect(result.body).toBe('{"id": "42"}')
    expect(result.issues).toEqual([])
  })

  it('skips disabled and nameless header rows', () => {
    const result = interpolateRequest(
      {
        ...base,
        url: 'http://x',
        headers: [
          { name: 'Keep', value: '1', enabled: true },
          { name: 'Drop', value: '2', enabled: false },
          { name: '  ', value: '3' },
        ],
      },
      {}
    )
    expect(result.headers).toEqual([{ name: 'Keep', value: '1' }])
  })

  it('warns about a missing variable without blocking the send', () => {
    // Sending is still the user's call; only smuggling is refused outright.
    const result = interpolateRequest({ ...base, url: 'http://x/{{id}}' }, {})
    expect(result.issues).toEqual([{ kind: 'missing', name: 'id' }])
    expect(blocksSend(result.issues)).toBe(false)
  })

  it('reports each missing name once across url, headers and body', () => {
    const result = interpolateRequest(
      {
        url: 'http://x/{{id}}',
        headers: [{ name: 'X-Id', value: '{{id}}' }],
        body: '{{id}}',
      },
      {}
    )
    expect(result.issues.filter((i) => i.kind === 'missing')).toHaveLength(1)
  })

  it('does not flag a scheme when the URL is relative', () => {
    const result = interpolateRequest({ ...base, url: '/users' }, {})
    expect(result.issues.some((i) => i.kind === 'scheme')).toBe(false)
  })
})

describe('describeIssues', () => {
  it('leads with the blocking problem', () => {
    const text = describeIssues([
      { kind: 'missing', name: 'id' },
      { kind: 'scheme', scheme: 'file:' },
    ])
    expect(text.startsWith('A variable turned this into a file: URL')).toBe(true)
    expect(text).toContain('id')
  })

  it('names the header for a CRLF injection', () => {
    expect(describeIssues([{ kind: 'crlf', where: 'X-Token' }])).toContain('X-Token')
  })

  it('gets singular and plural right', () => {
    expect(describeIssues([{ kind: 'missing', name: 'a' }])).toContain('Variable with no value')
    expect(
      describeIssues([
        { kind: 'missing', name: 'a' },
        { kind: 'missing', name: 'b' },
      ])
    ).toContain('Variables with no value')
  })

  it('is empty when there is nothing to say', () => {
    expect(describeIssues([])).toBe('')
  })
})
