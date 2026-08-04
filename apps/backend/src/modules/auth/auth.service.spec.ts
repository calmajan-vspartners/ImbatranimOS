import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSync } from 'otplib';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { DbService } from '../../db/db.service';
import { makeConfig, makeTestDb } from './test-utils';

describe('AuthService', () => {
  let db: DbService;
  let auth: AuthService;

  beforeEach(() => {
    db = makeTestDb();
    const sessions = new SessionService(db, makeConfig());
    auth = new AuthService(db, sessions);
  });

  describe('first-run setup', () => {
    it('reports needsSetup until a user is created', async () => {
      expect(auth.isSetup()).toBe(false);
      await auth.setup('correct-horse-battery');
      expect(auth.isSetup()).toBe(true);
    });

    it('stores an argon2id hash, never the plaintext', async () => {
      await auth.setup('correct-horse-battery');
      const row = db.db
        .prepare('SELECT password_hash FROM auth_user WHERE id = 1')
        .get() as {
        password_hash: string;
      };
      expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(row.password_hash).not.toContain('correct-horse-battery');
    });

    it('refuses a second setup (no silent password reset)', async () => {
      await auth.setup('correct-horse-battery');
      await expect(auth.setup('another-password')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects weak passwords', async () => {
      await expect(auth.setup('short')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('password verification', () => {
    it('accepts the correct password and rejects a wrong one', async () => {
      await auth.setup('correct-horse-battery');
      expect(await auth.verifyPassword('correct-horse-battery')).toBe(true);
      expect(await auth.verifyPassword('wrong-password-here')).toBe(false);
    });

    it('returns false (never throws) when no user exists', async () => {
      expect(await auth.verifyPassword('anything-here')).toBe(false);
    });
  });

  describe('TOTP', () => {
    it('is disabled until enrolled and confirmed', async () => {
      await auth.setup('correct-horse-battery');
      expect(auth.totpEnabled()).toBe(false);

      const { secret } = await auth.beginTotpEnroll('correct-horse-battery');
      expect(auth.totpEnabled()).toBe(false); // pending, not yet confirmed

      auth.confirmTotp(generateSync({ secret }));
      expect(auth.totpEnabled()).toBe(true);
    });

    it('verifies valid codes and rejects invalid ones once enabled', async () => {
      await auth.setup('correct-horse-battery');
      const { secret } = await auth.beginTotpEnroll('correct-horse-battery');
      auth.confirmTotp(generateSync({ secret }));

      expect(auth.verifyTotp(generateSync({ secret }))).toBe(true);
      expect(auth.verifyTotp('000000')).toBe(false);
    });

    it('can be disabled with the correct password', async () => {
      await auth.setup('correct-horse-battery');
      const { secret } = await auth.beginTotpEnroll('correct-horse-battery');
      auth.confirmTotp(generateSync({ secret }));

      await auth.disableTotp('correct-horse-battery');
      expect(auth.totpEnabled()).toBe(false);
    });

    it('returns a QR data URL on enroll', async () => {
      await auth.setup('correct-horse-battery');
      const enroll = await auth.beginTotpEnroll('correct-horse-battery');
      expect(enroll.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(enroll.uri.startsWith('otpauth://totp/')).toBe(true);
    });

    it('requires the current password to enroll (step-up auth)', async () => {
      await auth.setup('correct-horse-battery');
      await expect(auth.beginTotpEnroll('wrong-password')).rejects.toThrow();
    });
  });
});

describe('AuthService.changePassword', () => {
  let db: DbService;
  let auth: AuthService;
  const CURRENT = 'correct-horse-battery';

  beforeEach(async () => {
    db = makeTestDb();
    auth = new AuthService(db, new SessionService(db, makeConfig()));
    await auth.setup(CURRENT);
  });

  const hash = () =>
    (
      db.db
        .prepare('SELECT password_hash FROM auth_user WHERE id = 1')
        .get() as {
        password_hash: string;
      }
    ).password_hash;

  it('rejects a wrong current password and leaves the stored hash alone', async () => {
    const before = hash();
    await expect(
      auth.changePassword('not-the-password', 'a-brand-new-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(hash()).toBe(before);
    // And the real password still works — the failed attempt changed nothing.
    expect(await auth.verifyPassword(CURRENT)).toBe(true);
  });

  it('checks the current password BEFORE the new one is validated', async () => {
    // Otherwise an attacker holding a stolen session could probe the strength rule
    // (and get a distinguishable error) without knowing the current password.
    await expect(auth.changePassword('wrong', 'short')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a new password that is too short', async () => {
    await expect(auth.changePassword(CURRENT, 'short')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await auth.verifyPassword(CURRENT)).toBe(true);
  });

  it('enforces the SAME minimum as first-run setup', async () => {
    // A weaker bar for rotation would make rotating a downgrade. Nine characters
    // fails in both places; ten passes in both.
    await expect(
      auth.changePassword(CURRENT, '123456789'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      auth.changePassword(CURRENT, '1234567890'),
    ).resolves.toBeUndefined();
  });

  it('refuses a no-op change', async () => {
    // "Succeeding" here would evict every other session while rotating nothing.
    await expect(auth.changePassword(CURRENT, CURRENT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('re-hashes with argon2id and makes the new password the only one that works', async () => {
    const before = hash();
    await auth.changePassword(CURRENT, 'a-brand-new-secret');
    const after = hash();
    expect(after).not.toBe(before);
    expect(after.startsWith('$argon2id$')).toBe(true);
    expect(after).not.toContain('a-brand-new-secret');
    expect(await auth.verifyPassword('a-brand-new-secret')).toBe(true);
    expect(await auth.verifyPassword(CURRENT)).toBe(false);
  });

  it('does not disable TOTP', async () => {
    // A password change must not silently drop the second factor.
    const { secret } = await auth.beginTotpEnroll(CURRENT);
    auth.confirmTotp(generateSync({ secret }));
    expect(auth.totpEnabled()).toBe(true);

    await auth.changePassword(
      CURRENT,
      'a-brand-new-secret',
      generateSync({ secret }),
    );
    expect(auth.totpEnabled()).toBe(true);
    expect(auth.verifyTotp(generateSync({ secret }))).toBe(true);
  });

  it('requires a TOTP code when TOTP is enabled', async () => {
    const { secret } = await auth.beginTotpEnroll(CURRENT);
    auth.confirmTotp(generateSync({ secret }));

    // Right password, no code: refused.
    await expect(
      auth.changePassword(CURRENT, 'a-brand-new-secret'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Right password, wrong code: refused.
    await expect(
      auth.changePassword(CURRENT, 'a-brand-new-secret', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await auth.verifyPassword(CURRENT)).toBe(true);

    // Right password, right code: allowed.
    await expect(
      auth.changePassword(
        CURRENT,
        'a-brand-new-secret',
        generateSync({ secret }),
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores a TOTP code when TOTP is not enabled', async () => {
    // A stray token must not become an accidental requirement.
    await expect(
      auth.changePassword(CURRENT, 'a-brand-new-secret', '000000'),
    ).resolves.toBeUndefined();
  });

  it('refuses before setup', async () => {
    const fresh = new AuthService(
      makeTestDb(),
      new SessionService(makeTestDb(), makeConfig()),
    );
    await expect(
      fresh.changePassword('anything', 'a-brand-new-secret'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
