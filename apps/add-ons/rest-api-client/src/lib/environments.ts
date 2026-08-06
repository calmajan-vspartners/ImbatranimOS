import type { Environment, EnvVar, RestClientData } from '../types'
import type { Variables } from './interpolate'

/**
 * Environments: named sets of variables, and the honesty rules around secrets.
 *
 * **Secrets here are plaintext on disk**, in `~/.config/rest-client/collections.json`
 * inside the home volume. That is stated in the UI rather than papered over, because
 * encrypting them needs a key, and the honest place for that key is the
 * account-derived one brief 50 proposes for the browser profile. Until that exists,
 * implying protection would be worse than admitting there is none.
 *
 * What the `secret` flag *does* buy, today:
 * - the value is masked in the editor until revealed,
 * - the value is **excluded from an export by default** ({@link exportableEnvironments}),
 * - and it is never written into a saved request, because a request stores `{{token}}`
 *   and interpolates at send time.
 */

export const MAX_ENVIRONMENTS = 20
export const MAX_VARS_PER_ENV = 100

export function newEnvironment(name: string, id: string): Environment {
  return { id, name, vars: [] }
}

export function newVar(id: string): EnvVar {
  return { id, name: '', value: '', secret: false }
}

/**
 * Flatten an environment to the `{ name: value }` map interpolation wants.
 *
 * A later entry with the same name wins, and a nameless row is skipped — both so a
 * half-typed row in the editor cannot break a send.
 */
export function toVariables(env: Environment | null): Variables {
  if (!env) return {}
  const vars: Variables = {}
  for (const entry of env.vars) {
    const name = entry.name.trim()
    if (name === '') continue
    vars[name] = entry.value
  }
  return vars
}

/** The active environment, or null when none is selected or it has been deleted. */
export function activeEnvironment(data: RestClientData): Environment | null {
  if (!data.activeEnvId) return null
  return data.environments.find((e) => e.id === data.activeEnvId) ?? null
}

/**
 * Environments prepared for export: **secret values are dropped**, names kept.
 *
 * Keeping the names matters — the point of an export is that someone else can fill in
 * their own token, and a variable that vanished entirely would make the imported
 * requests fail with an unexplained `{{token}}`.
 */
export function exportableEnvironments(environments: Environment[]): Environment[] {
  return environments.map((env) => ({
    ...env,
    vars: env.vars.map((entry) => (entry.secret ? { ...entry, value: '' } : entry)),
  }))
}

/** Mask for display. Never used for anything but rendering. */
export function maskValue(value: string): string {
  if (value === '') return ''
  return '•'.repeat(Math.min(value.length, 12))
}

/**
 * Which variables a request needs but the active environment does not have.
 *
 * Used to warn *before* a send, and to offer "add these to the environment" — the
 * common case is typing `{{userId}}` into a URL and then wanting somewhere to put it.
 */
export function undefinedVars(referenced: string[], env: Environment | null): string[] {
  const known = new Set(Object.keys(toVariables(env)))
  return referenced.filter((name) => !known.has(name))
}

/**
 * Add variables to an environment, ignoring ones already present.
 *
 * Returns a new environment; never mutates, because the caller holds it in React state.
 */
export function withVars(
  env: Environment,
  names: string[],
  idFor: (i: number) => string
): Environment {
  const known = new Set(env.vars.map((v) => v.name.trim()))
  const additions = names
    .filter((name) => !known.has(name))
    .slice(0, Math.max(0, MAX_VARS_PER_ENV - env.vars.length))
    .map((name, i) => ({ id: idFor(i), name, value: '', secret: looksSecret(name) }))
  return { ...env, vars: [...env.vars, ...additions] }
}

/**
 * Guess whether a variable should default to secret.
 *
 * A guess, and it only sets a default the user can flip — but defaulting `apiToken` to
 * visible-and-exported is the mistake worth pre-empting, and the cost of a wrong guess
 * is one click.
 */
export function looksSecret(name: string): boolean {
  return /token|secret|password|passwd|pwd|key|auth|bearer|credential/i.test(name)
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * The header an auth helper writes.
 *
 * The **value is a `{{var}}` reference, not the token itself** — that is the point of
 * the helper. A saved request then contains `Authorization: Bearer {{token}}`, which is
 * safe to export and correct in every environment, instead of a token baked into a file.
 */
export function bearerHeader(varName: string): { name: string; value: string } {
  return { name: 'Authorization', value: `Bearer {{${varName}}}` }
}

/**
 * Basic auth as a header.
 *
 * Basic needs base64 of `user:pass`, which cannot be expressed as a template — so this
 * takes the literal pair and encodes it, and the UI steers the password into an
 * environment variable by offering `{{…}}` completion in that field. When the password
 * IS a `{{var}}`, encoding it would produce nonsense, so that case is refused loudly
 * rather than silently sending a broken header.
 */
export function basicHeader(
  user: string,
  password: string
): { name: string; value: string } | { error: string } {
  if (/\{\{/.test(user) || /\{\{/.test(password)) {
    return {
      error:
        'Basic auth has to be encoded, so it cannot use a {{variable}} directly. Put the whole encoded value in a variable and use Bearer-style header instead, or type the password here.',
    }
  }
  const bytes = new TextEncoder().encode(`${user}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { name: 'Authorization', value: `Basic ${btoa(binary)}` }
}
