import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.schema';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { ThrottleService } from './throttle.service';
import { Public } from './public.decorator';
import { LogService } from '../logs/log.service';
import { SESSION_COOKIE_NAME, readSessionCookie } from './auth.constants';
import {
  ChangePasswordDto,
  DisableTotpDto,
  EnrollTotpDto,
  LoginDto,
  SetupDto,
  TotpTokenDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly config: ConfigService<Env, true>,
    private readonly logs: LogService,
  ) {}

  // ---- Public: unlock-screen surface ------------------------------------

  /** Frontend bootstrap: what screen to show (wizard / lock / desktop). */
  @Public()
  @Get('status')
  status(@Req() req: Request) {
    return {
      needsSetup: !this.auth.isSetup(),
      authenticated: !!this.sessions.validateFromRequest(req),
      totpEnabled: this.auth.totpEnabled(),
      // Only meaningful pre-claim: tells the wizard to ask for the operator's
      // out-of-band token. False once claimed or when SETUP_TOKEN is unset.
      setupTokenRequired:
        !this.auth.isSetup() && !!this.config.get('SETUP_TOKEN'),
    };
  }

  /** First run: create the single user, then auto-login. */
  @Public()
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(
    @Body() dto: SetupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.assertSetupToken(dto.token);
    await this.auth.setup(dto.password);
    this.issueSessionCookie(req, res);
    this.logs.audit('auth.setup', 'The machine was claimed by its first user', {
      ip: req.ip,
    });
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = req.ip ?? 'unknown';
    this.throttle.assertNotLocked(key);

    const passwordOk =
      this.auth.isSetup() && (await this.auth.verifyPassword(dto.password));
    const totpOk =
      !this.auth.totpEnabled() ||
      (!!dto.token && this.auth.verifyTotp(dto.token));

    if (!passwordOk || !totpOk) {
      this.throttle.recordFailure(key);
      // Logged as `warn`, with the IP and NOTHING the caller typed. `dto` is
      // never passed here: the redactor would strip `password`, but the safest
      // secret is the one that was never handed to the logger in the first
      // place. Which factor failed stays out of the log for the same reason it
      // stays out of the response.
      this.logs.record(
        'warn',
        'auth.login.failed',
        'A sign-in attempt failed',
        {
          ip: key,
          totpRequired: this.auth.totpEnabled(),
        },
      );
      // Generic message: do not reveal which factor failed.
      throw new UnauthorizedException('Invalid credentials');
    }

    this.throttle.reset(key);
    this.issueSessionCookie(req, res);
    this.logs.audit('auth.login.ok', 'Signed in', { ip: key });
    return { ok: true };
  }

  /** Idempotent; public so a stale/invalid cookie can still be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = readSessionCookie(req);
    if (raw) this.sessions.destroy(raw);
    res.clearCookie(SESSION_COOKIE_NAME, this.cookieClearOpts(req));
    if (raw) this.logs.audit('auth.logout', 'Signed out', { ip: req.ip });
    return { ok: true };
  }

  // ---- Authenticated: TOTP management (settings surface) ----------------

  @Post('totp/enroll')
  @HttpCode(HttpStatus.OK)
  enrollTotp(@Body() dto: EnrollTotpDto) {
    return this.auth.beginTotpEnroll(dto.password);
  }

  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  enableTotp(@Body() dto: TotpTokenDto) {
    this.auth.confirmTotp(dto.token);
    this.logs.audit(
      'auth.totp.enabled',
      'Two-factor authentication was turned on',
    );
    return { ok: true, totpEnabled: true };
  }

  @Post('totp/disable')
  @HttpCode(HttpStatus.OK)
  async disableTotp(@Body() dto: DisableTotpDto) {
    await this.auth.disableTotp(dto.password);
    // Warn, not info: turning a factor OFF is the half of this pair an intruder
    // would want, and the one worth spotting in a review of last week.
    this.logs.record(
      'warn',
      'auth.totp.disabled',
      'Two-factor authentication was turned off',
    );
    return { ok: true, totpEnabled: false };
  }

  /**
   * Rotate the password. Authenticated (no `@Public()`), so the global session
   * guard already requires a valid cookie before this runs.
   *
   * ## Throttled on the same counter as login
   *
   * The route re-verifies the current password, which makes it an oracle for it.
   * Without the throttle, someone holding a stolen session could brute-force the
   * password from inside the OS while the lock screen stayed protected. Sharing
   * login's per-IP counter means those guesses cost the same as guesses at the
   * front door.
   *
   * ## Every session dies, including the caller's — then the caller gets a new one
   *
   * `destroyAll()` rather than "all but mine". The point of a rotation is usually
   * that a credential may have leaked, and the caller's *current* token is as
   * plausibly leaked as any other. Killing everything and issuing a fresh cookie
   * in the same response leaves the user signed in on this browser and signs out
   * every other, with no pre-change token still valid anywhere.
   *
   * The order is load-bearing: the password is changed FIRST, and sessions are only
   * dropped once that has succeeded. Dropping them first would sign the user out of
   * every device on a *failed* change.
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = req.ip ?? 'unknown';
    this.throttle.assertNotLocked(key);

    try {
      await this.auth.changePassword(
        dto.currentPassword,
        dto.newPassword,
        dto.token,
      );
    } catch (err) {
      // Only a failed *credential* check feeds the throttle. A rejected weak or
      // unchanged new password is the user fumbling their own form, and counting
      // it would let honest mistakes lock them out of their own machine.
      if (err instanceof UnauthorizedException) {
        this.throttle.recordFailure(key);
        this.logs.record(
          'warn',
          'auth.password.failed',
          'A password change was refused: the current password did not match',
          { ip: key },
        );
      }
      throw err;
    }

    this.throttle.reset(key);
    this.sessions.destroyAll();
    this.issueSessionCookie(req, res);
    this.logs.audit(
      'auth.password.changed',
      'The password was changed; every other session was signed out',
      { ip: key },
    );
    return { ok: true };
  }

  // ---- helpers ----------------------------------------------------------

  /**
   * Gate first-run claim behind the operator's out-of-band SETUP_TOKEN.
   *
   * When SETUP_TOKEN is unset/empty the check is skipped entirely — behaviour
   * is byte-for-byte identical to before Brief 28. When it is set, `dto.token`
   * must match it exactly or the claim is refused with 401 (thrown BEFORE any
   * account is created).
   *
   * The compare is constant-time: both sides are SHA-256'd first so
   * `timingSafeEqual` always sees two equal-length (32-byte) buffers — it never
   * throws on a length mismatch, and the comparison time does not leak the
   * length of, or difference in, the provided token. A missing token hashes to
   * a value that cannot match a non-empty secret, so it fails like any other
   * wrong token. The secret itself is never logged.
   */
  private assertSetupToken(provided: string | undefined): void {
    const expected = this.config.get('SETUP_TOKEN', { infer: true });
    if (!expected) return; // opt-in: unset => no gate, identical to today.
    const digest = (s: string): Buffer =>
      createHash('sha256').update(s, 'utf8').digest();
    const ok = timingSafeEqual(digest(provided ?? ''), digest(expected));
    if (!ok) {
      throw new UnauthorizedException('Invalid setup token');
    }
  }

  /**
   * Mark the cookie Secure when COOKIE_SECURE is set OR the request itself
   * arrived over HTTPS. `req.secure` reflects X-Forwarded-Proto once
   * TRUST_PROXY wires up `trust proxy`, so a TLS-terminating reverse proxy
   * auto-upgrades the cookie without the operator flipping COOKIE_SECURE —
   * while plain-HTTP LAN use still works (browsers drop Secure cookies on http).
   */
  private isSecureRequest(req: Request): boolean {
    return this.config.get('COOKIE_SECURE') || req.secure;
  }

  private issueSessionCookie(req: Request, res: Response): void {
    const { token, maxAgeMs } = this.sessions.issue();
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.isSecureRequest(req),
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeMs,
    });
  }

  private cookieClearOpts(req: Request) {
    return {
      httpOnly: true,
      secure: this.isSecureRequest(req),
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
