import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * What counts as a bookmarkable URL.
 *
 * **Why not `@IsUrl()`, which is what this module shipped with.** Measured against
 * validator.js's defaults, it is wrong in both directions at once:
 *
 * ```
 * http://localhost:3000   REJECTED  ← the OS itself is a localhost web app
 * http://imbatranim       REJECTED  ← the machine's own hostname
 * ftp://x.com             ACCEPTED  ← a scheme nothing here can open
 * ```
 *
 * So a user could not bookmark their own dev server but could store an `ftp:` link,
 * which is exactly backwards. `require_tld` is the cause: a single-label host has no
 * dot, and the check does not care that it resolves.
 *
 * The replacement is a **scheme allow-list** parsed with the platform's own `URL`.
 * That is stricter where it matters and permissive where the OS needs it — and the
 * strictness is load-bearing now that this brief adds import: a Netscape file is
 * untrusted input, and the app renders bookmarks as `<a href>`, so a
 * `javascript:` or `data:` URL reaching the table would be stored XSS. Only
 * `http:` and `https:` pass, which is also all brief 50's browser will be able to
 * fetch through its proxy.
 */
export const ALLOWED_SCHEMES = ['http:', 'https:'] as const;

/** Longest URL accepted. Chrome's own limit is ~2MB; 2048 is the practical one. */
export const MAX_URL_LENGTH = 2048;

export function isBookmarkUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (!(ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return false;
  }
  // `new URL('http://')` throws, but `new URL('http://?x')` does not on every
  // runtime — an empty host is never a bookmark either way.
  return parsed.hostname !== '';
}

export function IsBookmarkUrl(options?: ValidationOptions) {
  return function (target: object, propertyName: string) {
    registerDecorator({
      name: 'isBookmarkUrl',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isBookmarkUrl(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be an http:// or https:// URL`,
      },
    });
  };
}
