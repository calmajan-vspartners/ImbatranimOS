# TOTP recovery codes

Captured 2026-08-04 while closing [brief 57](../briefs/done/57-settings-password-and-real-about.md),
which deliberately left this out rather than smuggling it in.

Brief 57 closed the "you can never rotate your password" gap. The same class of gap
is still open one factor over: **enable TOTP, lose your phone, and you are locked out
of the machine with no fallback at all.** The honest recovery today is the same as it
was for a forgotten password — delete the data volume and lose the account — except
here the password is still known, which makes it feel much more like a bug.

Why it is not a small addition, and why it earned its own note:

- **Generation.** How many, what entropy, what alphabet. They are password-equivalent
  secrets, so they need the same argon2id treatment as the password — storing them in
  plaintext would make the database strictly more valuable than it is today.
- **One-time use.** Each code must be consumable exactly once, which means per-code
  state and a decision about what happens when the last one is spent.
- **Secure display.** Shown exactly once, at generation, with no way to re-read them
  later — otherwise a stolen session can print the recovery codes and permanently own
  the account.
- **The step-up question.** Generating codes should presumably require the password,
  like `totp/enroll` and `totp/disable` already do.
- **Interaction with the login throttle.** A recovery code is a second guessable
  credential on the unlock screen and needs the same rate limiting.

Prerequisite for none of the other briefs; safe to schedule whenever. It should NOT
become a password-reset path — brief 57's rejection of that stands, and this is only
about the second factor.
