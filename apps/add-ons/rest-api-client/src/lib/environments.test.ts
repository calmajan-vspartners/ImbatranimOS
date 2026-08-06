import { describe, expect, it } from 'vitest'
import {
  activeEnvironment,
  basicHeader,
  bearerHeader,
  exportableEnvironments,
  looksSecret,
  maskValue,
  toVariables,
  undefinedVars,
  withVars,
} from './environments'
import type { Environment, RestClientData } from '../types'

const env = (id: string, name: string, vars: [string, string, boolean?][]): Environment => ({
  id,
  name,
  vars: vars.map(([n, v, s], i) => ({ id: `${id}-${i}`, name: n, value: v, secret: s ?? false })),
})

describe('toVariables', () => {
  it('flattens to a name → value map', () => {
    expect(
      toVariables(
        env('e', 'local', [
          ['host', 'h'],
          ['id', '1'],
        ])
      )
    ).toEqual({
      host: 'h',
      id: '1',
    })
  })

  it('skips a nameless row, so a half-typed row cannot break a send', () => {
    expect(
      toVariables(
        env('e', 'local', [
          ['', 'orphan'],
          ['a', '1'],
        ])
      )
    ).toEqual({ a: '1' })
  })

  it('trims the name', () => {
    expect(toVariables(env('e', 'l', [['  host  ', 'h']]))).toEqual({ host: 'h' })
  })

  it('lets a later duplicate win', () => {
    expect(
      toVariables(
        env('e', 'l', [
          ['a', 'first'],
          ['a', 'second'],
        ])
      )
    ).toEqual({ a: 'second' })
  })

  it('is empty for no environment', () => {
    expect(toVariables(null)).toEqual({})
  })
})

describe('activeEnvironment', () => {
  const data = (activeEnvId: string | null): RestClientData => ({
    collections: [],
    history: [],
    environments: [env('a', 'local', []), env('b', 'prod', [])],
    activeEnvId,
  })

  it('finds the selected one', () => {
    expect(activeEnvironment(data('b'))?.name).toBe('prod')
  })

  it('is null when none is selected', () => {
    expect(activeEnvironment(data(null))).toBeNull()
  })

  it('is null when the selected one has been deleted', () => {
    // A dangling id must not crash the send path.
    expect(activeEnvironment(data('gone'))).toBeNull()
  })
})

describe('exportableEnvironments — secrets do not leave', () => {
  const source = [
    env('e', 'prod', [
      ['host', 'https://api'],
      ['token', 'sk-real-secret', true],
    ]),
  ]

  it('blanks a secret value but keeps its name', () => {
    // Keeping the name is the point: the recipient fills in their own token, and a
    // variable that vanished entirely would leave `{{token}}` failing unexplained.
    const [out] = exportableEnvironments(source)
    expect(out.vars.map((v) => [v.name, v.value])).toEqual([
      ['host', 'https://api'],
      ['token', ''],
    ])
    expect(out.vars[1].secret).toBe(true)
  })

  it('does not mutate the original', () => {
    exportableEnvironments(source)
    expect(source[0].vars[1].value).toBe('sk-real-secret')
  })

  it('leaves a non-secret value alone', () => {
    expect(exportableEnvironments(source)[0].vars[0].value).toBe('https://api')
  })
})

describe('maskValue', () => {
  it('masks without leaking the length beyond a cap', () => {
    expect(maskValue('abc')).toBe('•••')
    expect(maskValue('x'.repeat(100))).toBe('•'.repeat(12))
  })

  it('shows nothing for an empty value', () => {
    expect(maskValue('')).toBe('')
  })
})

describe('looksSecret', () => {
  it('guesses yes for the obvious names', () => {
    for (const name of ['token', 'apiToken', 'SECRET', 'password', 'api_key', 'authHeader']) {
      expect(looksSecret(name)).toBe(true)
    }
  })

  it('guesses no for ordinary names', () => {
    for (const name of ['host', 'baseUrl', 'userId', 'page']) {
      expect(looksSecret(name)).toBe(false)
    }
  })
})

describe('undefinedVars', () => {
  it('lists what a request needs and the environment lacks', () => {
    expect(undefinedVars(['host', 'id'], env('e', 'l', [['host', 'h']]))).toEqual(['id'])
  })

  it('counts a set-but-empty variable as defined', () => {
    expect(undefinedVars(['a'], env('e', 'l', [['a', '']]))).toEqual([])
  })

  it('lists everything when there is no environment', () => {
    expect(undefinedVars(['a', 'b'], null)).toEqual(['a', 'b'])
  })
})

describe('withVars', () => {
  const idFor = (i: number) => `new-${i}`

  it('adds the missing names and leaves the existing ones alone', () => {
    const result = withVars(env('e', 'l', [['host', 'h']]), ['host', 'id'], idFor)
    expect(result.vars.map((v) => v.name)).toEqual(['host', 'id'])
    expect(result.vars[0].value).toBe('h')
    expect(result.vars[1].value).toBe('')
  })

  it('defaults a secret-looking name to secret', () => {
    const result = withVars(env('e', 'l', []), ['apiToken', 'page'], idFor)
    expect(result.vars.find((v) => v.name === 'apiToken')?.secret).toBe(true)
    expect(result.vars.find((v) => v.name === 'page')?.secret).toBe(false)
  })

  it('does not mutate the input', () => {
    const original = env('e', 'l', [])
    withVars(original, ['a'], idFor)
    expect(original.vars).toEqual([])
  })
})

describe('bearerHeader', () => {
  it('writes a template reference, never the token itself', () => {
    // The whole point of the helper: the saved request is safe to export.
    expect(bearerHeader('apiToken')).toEqual({
      name: 'Authorization',
      value: 'Bearer {{apiToken}}',
    })
  })
})

describe('basicHeader', () => {
  it('encodes the pair', () => {
    expect(basicHeader('alice', 's3cret')).toEqual({
      name: 'Authorization',
      value: `Basic ${btoa('alice:s3cret')}`,
    })
  })

  it('handles non-ASCII by encoding UTF-8 first', () => {
    const result = basicHeader('José', 'pass')
    expect('value' in result).toBe(true)
    if ('value' in result) {
      expect(atob(result.value.slice(6))).toBe(
        String.fromCharCode(...new TextEncoder().encode('José:pass'))
      )
    }
  })

  it('refuses a {{variable}} loudly instead of encoding the placeholder', () => {
    // Encoding `{{token}}` would produce a header that is nonsense but looks fine.
    const result = basicHeader('alice', '{{password}}')
    expect('error' in result).toBe(true)
    const other = basicHeader('{{user}}', 'p')
    expect('error' in other).toBe(true)
  })

  it('accepts an empty password, which is legal Basic', () => {
    const result = basicHeader('alice', '')
    expect('value' in result).toBe(true)
  })
})
