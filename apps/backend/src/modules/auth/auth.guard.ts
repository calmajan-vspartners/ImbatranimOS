import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.schema';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionService, type SessionRecord } from './session.service';
import { SESSION_COOKIE_NAME, readSessionCookie } from './auth.constants';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global guard (registered via APP_GUARD): every route requires a valid
 * session cookie unless explicitly marked {@link Public}. Also enforces the
 * CSRF stance — see checkOrigin.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { session?: unknown }>();

    // CSRF defence runs before the public check so login/setup are covered too.
    this.checkOrigin(req);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const session = this.sessions.validateFromRequest(req);
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }
    req.session = session;
    this.slideSession(ctx, req, session);
    return true;
  }

  /**
   * Sliding expiry (brief 101): daily use should never hard-expire a session
   * mid-keystroke. The server-side slide alone would be theater — the cookie's
   * Max-Age was fixed at login and the browser drops it on schedule — so a
   * renewal re-issues the same token with the new Max-Age. renewIfDue skips
   * sub-hour gains, so this writes (and sets a cookie) at most hourly.
   */
  private slideSession(
    ctx: ExecutionContext,
    req: Request,
    session: SessionRecord,
  ): void {
    const raw = readSessionCookie(req);
    if (!raw) return;
    const renewed = this.sessions.renewIfDue(session, raw);
    if (!renewed) return;
    const res = ctx.switchToHttp().getResponse<Response>();
    res.cookie(SESSION_COOKIE_NAME, raw, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE') || req.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: renewed.maxAgeMs,
    });
  }

  /**
   * CSRF stance: session cookie is SameSite=Lax (blocks it on cross-site
   * subresource/POST), backed by an Origin check on state-changing requests.
   * When an Origin header is present it must match the request Host or the
   * configured FRONTEND_URL. Absent Origin (same-origin GET, non-browser
   * clients) is allowed — Lax already covers the cross-site cookie case.
   */
  private checkOrigin(req: Request): void {
    if (!MUTATING_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin) return; // no Origin => not a cross-site browser form post
    const frontend = this.config.get('FRONTEND_URL', { infer: true });
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ForbiddenException('Bad origin');
    }
    if (origin === frontend || originHost === req.headers.host) return;
    throw new ForbiddenException('Cross-origin request rejected');
  }
}
