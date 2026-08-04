import { describe, it, expect } from 'vitest'
import {
  describeInvalid,
  canSubmit,
  MIN_PASSWORD_LENGTH,
  type PasswordChangeFields,
} from './passwordChange'

const blank: PasswordChangeFields = { current: '', next: '', confirm: '', token: '' }
const filled: PasswordChangeFields = {
  current: 'old-password-here',
  next: 'a-brand-new-secret',
  confirm: 'a-brand-new-secret',
  token: '',
}

describe('describeInvalid', () => {
  it('walks the user down the form rather than jumping ahead', () => {
    // The message must track what they are most likely still working on. Reporting
    // "confirm the new password" while the current-password box is empty would send
    // them to the wrong field.
    expect(describeInvalid(blank, false)).toMatch(/current password/i)
    expect(describeInvalid({ ...blank, current: 'x' }, false)).toMatch(/new password/i)
  })

  it('requires the same minimum length as setup and the server', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(describeInvalid({ ...filled, next: short, confirm: short }, false)).toMatch(
      /at least 10 characters/
    )
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(describeInvalid({ ...filled, next: exact, confirm: exact }, false)).toBeNull()
  })

  it('catches a mismatched confirmation', () => {
    expect(describeInvalid({ ...filled, confirm: 'a-brand-new-secreT' }, false)).toMatch(
      /do not match/i
    )
  })

  it('asks for the confirmation before comparing the two', () => {
    // An empty confirm box is "not finished", not "does not match" — the latter
    // reads as an error the user made.
    expect(describeInvalid({ ...filled, confirm: '' }, false)).toMatch(/confirm/i)
  })

  it('refuses a no-op change, and only once the new password is fully typed', () => {
    const same = { ...filled, next: filled.current, confirm: filled.current }
    expect(describeInvalid(same, false)).toMatch(/different from the current/i)
    // Mid-typing, the length rule speaks first — complaining that a half-typed
    // password matches the old one would be noise.
    expect(describeInvalid({ ...blank, current: 'old-password-here', next: 'old' }, false)).toMatch(
      /at least 10 characters/
    )
  })

  it('requires a TOTP code only when TOTP is enabled', () => {
    expect(describeInvalid(filled, false)).toBeNull()
    expect(describeInvalid(filled, true)).toMatch(/authenticator/i)
    expect(describeInvalid({ ...filled, token: '123456' }, true)).toBeNull()
  })

  it('ignores a stray token when TOTP is off', () => {
    expect(describeInvalid({ ...filled, token: '123456' }, false)).toBeNull()
  })
})

describe('canSubmit', () => {
  it('mirrors describeInvalid exactly', () => {
    // Two sources of truth for "is this form valid" is how a disabled button and a
    // rejected request end up disagreeing.
    for (const [fields, totp] of [
      [blank, false],
      [filled, false],
      [filled, true],
      [{ ...filled, token: '123456' }, true],
    ] as const) {
      expect(canSubmit(fields, totp)).toBe(describeInvalid(fields, totp) === null)
    }
  })
})
