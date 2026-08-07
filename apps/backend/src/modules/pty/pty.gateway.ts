import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type WebSocket } from 'ws';
import * as pty from 'node-pty';
import type { Env } from '../../config/env.schema';
import { SessionService, readSessionCookie } from '../auth/ws-auth';
import { PtySession } from './pty-session';
import { isPtyUpgrade, authorizeUpgrade } from './pty-upgrade';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MAX_COLS,
  MAX_ROWS,
  MAX_SESSIONS,
  PTY_PATH,
  resolveHome,
  resolveShell,
} from './pty.constants';

/** How often to re-check that each live session's cookie is still valid. */
const REVOKE_SWEEP_MS = 30_000;

interface LiveSession {
  session: PtySession;
  /** Raw session token, re-validated by the revocation sweep. */
  rawToken: string | null;
}

/**
 * Terminal WebSocket gateway. Attaches a raw `ws` server to Nest's underlying
 * HTTP server via the `upgrade` event (`noServer: true`) — no change to
 * main.ts required. Every upgrade is authenticated with the shared
 * SessionService before a pty is spawned as the current process user.
 */
@Injectable()
export class PtyGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PtyGateway.name);
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private readonly live = new Set<LiveSession>();
  private revokeTimer: NodeJS.Timeout | null = null;
  private upgradeHandler:
    | ((req: IncomingMessage, socket: Duplex, head: Buffer) => void)
    | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    // getHttpServer() is typed `any` on the base HttpAdapterHost<AbstractHttpAdapter>
    // generic (TServer defaults to `any`); the concrete adapter Nest wires up
    // here is always the Node http/https server this gateway attaches to.
    const server = this.adapterHost.httpAdapter?.getHttpServer?.() as
      | HttpServer
      | undefined;
    if (!server) {
      this.logger.error('No HTTP server available; terminal WS not attached');
      return;
    }
    this.httpServer = server;
    this.wss = new WebSocketServer({ noServer: true });

    this.upgradeHandler = (req, socket, head) => {
      // Only claim our own path — leave any other upgrade to the rest of the
      // pipeline (there are none today, but don't destroy sockets we don't own).
      if (!isPtyUpgrade(req.url)) return;

      const record = authorizeUpgrade(
        req,
        this.sessions,
        this.config.get('FRONTEND_URL'),
      );
      if (!record) {
        this.logger.warn('Rejected unauthorized terminal upgrade');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Cap concurrent shells so a client can't exhaust PIDs/memory by opening
      // sockets in a loop. Reject the handshake before spawning anything.
      if (this.live.size >= MAX_SESSIONS) {
        this.logger.warn(`Terminal session cap reached (${MAX_SESSIONS})`);
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, req);
      });
    };
    server.on('upgrade', this.upgradeHandler);

    this.revokeTimer = setInterval(() => this.sweepRevoked(), REVOKE_SWEEP_MS);
    this.logger.log(`Terminal WS listening on ${PTY_PATH}`);
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const { cols, rows } = parseGeometry(req.url);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(resolveShell(), [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolveHome(),
        env: process.env,
      });
    } catch (err) {
      this.logger.error(`Failed to spawn shell: ${(err as Error).message}`);
      try {
        ws.send('\r\n[failed to start shell]\r\n');
      } catch {
        /* noop */
      }
      ws.close(1011, 'spawn-failed');
      return;
    }

    const entry: LiveSession = {
      session: new PtySession(ptyProcess, ws),
      rawToken: readSessionCookie(req),
    };
    this.live.add(entry);
    ws.on('close', () => this.live.delete(entry));
    this.logger.log(`Terminal opened (${this.live.size} live)`);
  }

  /**
   * Kill any pty whose session cookie is no longer valid (logged out or
   * expired). Complements the socket-close path so a revoked session can't
   * keep a shell alive.
   */
  private sweepRevoked(): void {
    // `validate` deliberately never renews expiry (brief 101): this sweep runs
    // every 30 s per live terminal, and a renewing validate here would let any
    // open shell immortalize its own session. Only the HTTP guard slides.
    for (const entry of this.live) {
      if (!entry.rawToken || !this.sessions.validate(entry.rawToken)) {
        entry.session.dispose(4401, 'session-revoked');
        this.live.delete(entry);
      }
    }
  }

  onModuleDestroy(): void {
    if (this.revokeTimer) clearInterval(this.revokeTimer);
    if (this.upgradeHandler && this.httpServer) {
      this.httpServer.off('upgrade', this.upgradeHandler);
    }
    for (const entry of this.live) entry.session.dispose(1001, 'shutdown');
    this.live.clear();
    this.wss?.close();
  }
}

/** Read optional `cols`/`rows` from the upgrade URL query string. */
function parseGeometry(url: string | undefined): {
  cols: number;
  rows: number;
} {
  let cols = DEFAULT_COLS;
  let rows = DEFAULT_ROWS;
  const q = url?.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  if (q) {
    const params = new URLSearchParams(q);
    const c = Number(params.get('cols'));
    const r = Number(params.get('rows'));
    // Clamp to sane bounds: reject non-positive and cap the upper end so a
    // client can't request an absurd geometry.
    if (Number.isFinite(c) && c > 0) cols = Math.min(Math.floor(c), MAX_COLS);
    if (Number.isFinite(r) && r > 0) rows = Math.min(Math.floor(r), MAX_ROWS);
  }
  return { cols, rows };
}
