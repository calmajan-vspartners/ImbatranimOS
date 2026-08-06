import { describe, expect, it } from 'vitest'
import { CurlParseError, describeIgnored, parseCurl, shellQuote, toCurl, tokenize } from './curl'
import type { HeaderRow } from '../types'

const row = (name: string, value: string, enabled = true): HeaderRow => ({
  id: name,
  name,
  value,
  enabled,
})

describe('tokenize — where the quoting bugs live', () => {
  it('splits on whitespace', () => {
    expect(tokenize('curl -X GET http://x')).toEqual(['curl', '-X', 'GET', 'http://x'])
  })

  it('keeps a single-quoted value whole, including spaces and double quotes', () => {
    expect(tokenize(`curl -d '{"a": "b c"}'`)).toEqual(['curl', '-d', '{"a": "b c"}'])
  })

  it('treats everything inside single quotes as literal — no escapes', () => {
    // POSIX: there is no escape inside '…', so a backslash stays a backslash.
    expect(tokenize(`curl -d 'a\\nb'`)).toEqual(['curl', '-d', 'a\\nb'])
  })

  it('unescapes only the shell-meaningful characters inside double quotes', () => {
    expect(tokenize(`curl -d "say \\"hi\\""`)).toEqual(['curl', '-d', 'say "hi"'])
    expect(tokenize(`curl -d "a\\\\b"`)).toEqual(['curl', '-d', 'a\\b'])
    expect(tokenize(`curl -d "cost \\$5"`)).toEqual(['curl', '-d', 'cost $5'])
    // A backslash before something else stays literal, which is what bash does.
    expect(tokenize(`curl -d "a\\nb"`)).toEqual(['curl', '-d', 'a\\nb'])
  })

  it('handles a single quote inside double quotes and vice versa', () => {
    expect(tokenize(`curl -d "it's"`)).toEqual(['curl', '-d', "it's"])
    expect(tokenize(`curl -d 'say "hi"'`)).toEqual(['curl', '-d', 'say "hi"'])
  })

  it('joins backslash line continuations, the way a pasted command arrives', () => {
    expect(tokenize('curl \\\n  -X POST \\\n  http://x')).toEqual([
      'curl',
      '-X',
      'POST',
      'http://x',
    ])
  })

  it('tolerates a Windows ^ continuation', () => {
    expect(tokenize('curl ^\n  -X POST ^\n  http://x')).toEqual(['curl', '-X', 'POST', 'http://x'])
  })

  it('keeps an explicitly empty quoted value as a token', () => {
    // `--data ''` means an empty body, which is different from no body at all.
    expect(tokenize(`curl --data '' http://x`)).toEqual(['curl', '--data', '', 'http://x'])
  })

  it('adjacent quoted and bare text form ONE token', () => {
    expect(tokenize(`curl -d a'b c'd`)).toEqual(['curl', '-d', 'ab cd'])
  })

  it('throws on an unclosed quote instead of guessing', () => {
    expect(() => tokenize(`curl -d 'unclosed`)).toThrow(CurlParseError)
  })

  it('does NOT interpret shell substitution — it is data, not a command', () => {
    // A pasted curl command is untrusted input; `$(…)` must stay literal text.
    expect(tokenize(`curl -d '$(rm -rf ~)' http://x`)).toEqual([
      'curl',
      '-d',
      '$(rm -rf ~)',
      'http://x',
    ])
    expect(tokenize('curl -d `id` http://x')).toEqual(['curl', '-d', '`id`', 'http://x'])
  })
})

describe('parseCurl', () => {
  it('parses the shape a browser copies', () => {
    const result = parseCurl(`curl 'https://api.example.com/v1/users?page=2' \\
      -H 'accept: application/json' \\
      -H 'authorization: Bearer abc123'`)
    expect(result.method).toBe('GET')
    expect(result.url).toBe('https://api.example.com/v1/users?page=2')
    expect(result.headers).toEqual([
      { name: 'accept', value: 'application/json' },
      { name: 'authorization', value: 'Bearer abc123' },
    ])
    expect(result.body).toBe('')
  })

  it('infers POST from data, as curl does', () => {
    const result = parseCurl(`curl http://x -d '{"a":1}'`)
    expect(result.method).toBe('POST')
    expect(result.body).toBe('{"a":1}')
  })

  it('honours an explicit -X over the inference', () => {
    expect(parseCurl(`curl -X PUT http://x -d 'a=1'`).method).toBe('PUT')
  })

  it('accepts every data alias and joins repeats with &', () => {
    for (const flag of ['-d', '--data', '--data-raw', '--data-binary', '--data-ascii']) {
      expect(parseCurl(`curl http://x ${flag} 'a=1'`).body).toBe('a=1')
    }
    expect(parseCurl(`curl http://x -d 'a=1' -d 'b=2'`).body).toBe('a=1&b=2')
  })

  it('accepts --flag=value as well as --flag value', () => {
    const result = parseCurl(`curl --url=http://x --header='X-A: 1' --data='q=2'`)
    expect(result.url).toBe('http://x')
    expect(result.headers).toEqual([{ name: 'X-A', value: '1' }])
    expect(result.body).toBe('q=2')
  })

  it('turns --json into a body plus the two headers curl would add', () => {
    const result = parseCurl(`curl http://x --json '{"a":1}'`)
    expect(result.body).toBe('{"a":1}')
    expect(result.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ])
  })

  it('encodes -u into a real Basic header', () => {
    const result = parseCurl(`curl -u 'alice:s3cret' http://x`)
    expect(result.headers).toEqual([
      { name: 'Authorization', value: `Basic ${btoa('alice:s3cret')}` },
    ])
  })

  it('maps -b, -A and -e to their headers', () => {
    const result = parseCurl(`curl -b 'k=v' -A 'agent/1' -e 'http://ref' http://x`)
    expect(result.headers.map((h) => h.name)).toEqual(['Cookie', 'User-Agent', 'Referer'])
  })

  it('-I means HEAD', () => {
    expect(parseCurl('curl -I http://x').method).toBe('HEAD')
  })

  it('-G moves the data into the query string and forces GET', () => {
    const result = parseCurl(`curl -G http://x -d 'a=1&b=2'`)
    expect(result.method).toBe('GET')
    expect(result.url).toBe('http://x?a=1&b=2')
    expect(result.body).toBe('')
  })

  it('-G appends with & when the URL already has a query', () => {
    expect(parseCurl(`curl -G 'http://x?z=0' -d 'a=1'`).url).toBe('http://x?z=0&a=1')
  })

  it('collects -F form fields and sets a multipart content type', () => {
    const result = parseCurl(`curl http://x -F 'name=alice' -F 'file=@a.txt'`)
    expect(result.method).toBe('POST')
    expect(result.body).toBe('name=alice\nfile=@a.txt')
    expect(result.headers).toEqual([{ name: 'Content-Type', value: 'multipart/form-data' }])
  })

  it('finds the URL wherever it sits in the command', () => {
    expect(parseCurl(`curl -s -H 'A: 1' http://x -v`).url).toBe('http://x')
  })

  it('consumes the value of a flag it ignores, so the URL is not stolen', () => {
    // `-o out.json` must not leave `out.json` looking like the URL.
    const result = parseCurl(`curl -o out.json http://x`)
    expect(result.url).toBe('http://x')
    expect(result.ignored).toContain('-o out.json')
  })

  it('reports boolean flags it disregards', () => {
    const result = parseCurl('curl -sSkL http://x --compressed')
    // -sSkL is one token and unknown as a bundle, so it is recorded, not guessed at.
    expect(result.ignored.length).toBeGreaterThan(0)
    expect(result.url).toBe('http://x')
  })

  it('tolerates a leading $ or sudo', () => {
    expect(parseCurl('$ curl http://x').url).toBe('http://x')
    expect(parseCurl('sudo curl http://x').url).toBe('http://x')
  })

  it('refuses something that is not a curl command', () => {
    expect(() => parseCurl('wget http://x')).toThrow(/does not start with/)
    expect(() => parseCurl('')).toThrow(CurlParseError)
  })

  it('refuses a command with no URL', () => {
    expect(() => parseCurl(`curl -X POST -d 'a=1'`)).toThrow(/No URL/)
  })

  it('refuses a method it cannot represent', () => {
    expect(() => parseCurl('curl -X TRACE http://x')).toThrow(/Unsupported method/)
  })

  it('keeps a body containing shell metacharacters as literal text', () => {
    const result = parseCurl(`curl http://x --data-raw '$(touch /tmp/x); rm -rf ~'`)
    expect(result.body).toBe('$(touch /tmp/x); rm -rf ~')
  })
})

describe('shellQuote', () => {
  it('single-quotes everything, so nothing can be re-interpreted', () => {
    expect(shellQuote('plain')).toBe("'plain'")
    expect(shellQuote('a b')).toBe("'a b'")
    expect(shellQuote('$(id)')).toBe("'$(id)'")
    expect(shellQuote('a"b')).toBe(`'a"b'`)
  })

  it('escapes an embedded single quote the only way that works', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('toCurl', () => {
  it('writes a command that parses back to the same request', () => {
    const request = {
      method: 'POST' as const,
      url: 'https://api.example.com/v1/items?q=a b',
      headers: [row('Content-Type', 'application/json'), row('Authorization', 'Bearer {{token}}')],
      body: '{"name":"it\'s fine","n":1}',
    }
    const back = parseCurl(toCurl(request))
    expect(back.method).toBe('POST')
    expect(back.url).toBe(request.url)
    expect(back.headers).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Authorization', value: 'Bearer {{token}}' },
    ])
    expect(back.body).toBe(request.body)
  })

  it('leaves out disabled and nameless header rows', () => {
    const out = toCurl({
      method: 'GET',
      url: 'http://x',
      headers: [row('Keep', '1'), row('Drop', '2', false), row('   ', '3')],
      body: '',
    })
    expect(out).toContain('Keep: 1')
    expect(out).not.toContain('Drop')
    expect(out).not.toContain(': 3')
  })

  it('omits the body for GET and HEAD, where curl would not send it', () => {
    expect(toCurl({ method: 'GET', url: 'http://x', headers: [], body: 'ignored' })).not.toContain(
      '--data-raw'
    )
    expect(toCurl({ method: 'HEAD', url: 'http://x', headers: [], body: 'ignored' })).not.toContain(
      '--data-raw'
    )
  })

  it('uses --data-raw so a multi-line body survives', () => {
    const out = toCurl({ method: 'POST', url: 'http://x', headers: [], body: 'a\nb' })
    expect(out).toContain('--data-raw')
    expect(parseCurl(out).body).toBe('a\nb')
  })

  it('is multi-line with continuations, which is what people paste', () => {
    const out = toCurl({ method: 'GET', url: 'http://x', headers: [row('A', '1')], body: '' })
    expect(out.split('\n').length).toBeGreaterThan(1)
    expect(out).toContain('\\\n')
  })
})

describe('describeIgnored', () => {
  it('is null when nothing was dropped', () => {
    expect(describeIgnored([])).toBeNull()
  })

  it('names what was dropped, and summarises a long tail', () => {
    expect(describeIgnored(['-v'])).toBe('Imported, but these parts were not carried over: -v.')
    expect(describeIgnored(['a', 'b', 'c', 'd', 'e'])).toBe(
      'Imported, but these parts were not carried over: a, b, c and 2 more.'
    )
  })
})
