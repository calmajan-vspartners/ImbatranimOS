/**
 * Client-side validation for the change-password form.
 *
 * A mirror of the server's rules, not a replacement for them — `AuthService`
 * enforces every one of these again, and the client copy exists only so the user
 * finds out what is wrong before a round trip.
 *
 * Extracted rather than inlined because the interesting part is the *reason* the
 * submit button is disabled. A form that greys out its own button and says nothing
 * is the failure mode this avoids, and "which reason wins" is exactly the kind of
 * ordering that is easy to get subtly wrong and impossible to see by looking.
 */

/** Same minimum as first-run setup and the server DTO. One rule, three places. */
export const MIN_PASSWORD_LENGTH = 10

export type PasswordChangeFields = {
  current: string
  next: string
  confirm: string
  /** The TOTP code; only consulted when `totpEnabled`. */
  token: string
}

/**
 * Why the form cannot be submitted yet, or null when it can.
 *
 * Ordered by what the user is most likely still working on, so the message tracks
 * their progress down the form rather than jumping to the last field. The
 * "different from current" check comes last of the new-password rules: complaining
 * that it matches the old one while it is still half-typed would be noise.
 */
export function describeInvalid(fields: PasswordChangeFields, totpEnabled: boolean): string | null {
  if (!fields.current) return 'Enter your current password.'
  if (!fields.next) return 'Enter a new password.'
  if (fields.next.length < MIN_PASSWORD_LENGTH) {
    return `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!fields.confirm) return 'Confirm the new password.'
  if (fields.next !== fields.confirm) return 'The new passwords do not match.'
  if (fields.next === fields.current) {
    return 'The new password must be different from the current one.'
  }
  if (totpEnabled && !fields.token) return 'Enter the code from your authenticator app.'
  return null
}

export function canSubmit(fields: PasswordChangeFields, totpEnabled: boolean): boolean {
  return describeInvalid(fields, totpEnabled) === null
}
