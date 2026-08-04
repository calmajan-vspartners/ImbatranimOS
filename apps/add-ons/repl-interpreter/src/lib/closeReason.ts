/**
 * What a closed PTY socket means, and whether reconnecting is the right answer.
 *
 * The brief's headline is that a dropped socket killed the window permanently.
 * But "just retry" is wrong: several of the ways this socket closes are the user
 * or the server saying *stop*, and reconnecting through them would either fight
 * the user or hammer a backend that is refusing us.
 *
 * ## What the backend actually sends
 *
 * Read off `pty.gateway.ts` and `pty-session.ts` rather than guessed:
 *
 * | code | reason            | cause                                   |
 * |------|-------------------|-----------------------------------------|
 * | 1000 | `pty-exit`        | the shell exited — the user typed `exit` |
 * | 1000 | `closed`          | generic dispose                          |
 * | 1001 | `shutdown`        | backend shutting down / restarting       |
 * | 1011 | `spawn-failed`    | the shell could not be spawned           |
 * | 4401 | `session-revoked` | the session was logged out or expired    |
 *
 * ## The 1006 problem
 *
 * An unauthorized or over-cap upgrade is rejected with `socket.destroy()` after a
 * raw `401`/`503` status line. The browser never surfaces that status to script —
 * a rejected handshake and a yanked network cable both arrive as code **1006 with
 * no reason**. So the close code alone *cannot* tell an auth failure from a blip,
 * and the brief's "must not retry forever against a 401" cannot be satisfied by
 * inspecting the code.
 *
 * Two things make up for it:
 *
 * 1. **`everOpened`.** A socket that closed without ever opening was refused at
 *    the handshake — a 401, the session cap, or nothing listening. A socket that
 *    was open and then closed is a genuine drop. Different messages, and the
 *    former is the one worth checking auth for.
 * 2. **A bounded retry budget.** Retries are finite regardless, so even a
 *    misdiagnosed 401 stops. The caller then asks the API who it is and reports
 *    accurately — see `usePtyConnection`.
 */

export type CloseVerdict = {
  /** Whether an automatic reconnect should be attempted. */
  retry: boolean
  /**
   * True when this is a settled end state that no retry can change — the shell
   * exited, or the session is gone. The UI offers a manual "new shell" instead of
   * a countdown.
   */
  terminal: boolean
  /** One line for the terminal, already user-facing. No codes, no jargon. */
  message: string
  /**
   * True when the caller should confirm the session is still valid before
   * reporting a cause. Set for handshake refusals, where 401 and "backend down"
   * are indistinguishable.
   */
  checkAuth: boolean
  /**
   * Whether to offer a manual Reconnect button.
   *
   * False only for a revoked session: clicking it would 401 again, and a button
   * that cannot work is worse than no button. Every other settled state — the
   * shell exited, a clean close, even a failed spawn — is worth one more try,
   * because the user may have just fixed the cause.
   */
  allowManualRetry: boolean
}

/** WebSocket close code the gateway uses for a revoked session. */
export const CLOSE_SESSION_REVOKED = 4401

export function classifyClose(code: number, reason: string, everOpened: boolean): CloseVerdict {
  // The session is gone. Retrying cannot succeed and would hammer the upgrade
  // endpoint with a dead cookie.
  if (code === CLOSE_SESSION_REVOKED) {
    return {
      retry: false,
      terminal: true,
      message: 'Session ended — sign in again to open a new shell.',
      checkAuth: false,
      allowManualRetry: false,
    }
  }

  // The user typed `exit`. Reconnecting here would be the app overriding an
  // explicit instruction, and it is the one close we must never treat as a fault.
  if (reason === 'pty-exit') {
    return {
      retry: false,
      terminal: true,
      message: 'Shell exited.',
      checkAuth: false,
      allowManualRetry: true,
    }
  }

  // The shell could not start at all. A retry loop would spawn-fail just as fast;
  // this needs a human to look at $SHELL or the image.
  if (reason === 'spawn-failed' || code === 1011) {
    return {
      retry: false,
      terminal: true,
      message: 'The shell could not be started.',
      checkAuth: false,
      allowManualRetry: true,
    }
  }

  // The backend said it is going away — which in dev is `npm run dev` restarting
  // Nest, the single most common cause of this whole brief. It IS coming back, so
  // this is the case retrying was built for.
  if (code === 1001 || reason === 'shutdown') {
    return {
      retry: true,
      terminal: false,
      message: 'Backend restarting…',
      checkAuth: false,
      allowManualRetry: true,
    }
  }

  // A bare 1000 is a NORMAL closure per RFC 6455 — the peer shut the connection
  // down deliberately. `pty-exit` above is the specific case we can name; anything
  // else arriving as 1000 is still "someone closed this on purpose", so it gets a
  // manual Reconnect rather than an automatic one. Retrying a clean close means
  // reopening a shell the server just tidied away.
  if (code === 1000) {
    return {
      retry: false,
      terminal: true,
      message: 'Connection closed.',
      checkAuth: false,
      allowManualRetry: true,
    }
  }

  // Never opened: the handshake itself was refused. Could be a 401, the session
  // cap, or nothing listening yet — indistinguishable here, so retry (bounded)
  // and let the caller resolve the cause.
  if (!everOpened) {
    return {
      retry: true,
      terminal: false,
      message: 'Could not reach the shell…',
      checkAuth: true,
      allowManualRetry: true,
    }
  }

  // Was open, then dropped: a real disconnect.
  return {
    retry: true,
    terminal: false,
    message: 'Disconnected…',
    checkAuth: false,
    allowManualRetry: true,
  }
}

/** How many automatic attempts before falling back to a manual Reconnect. */
export const MAX_RETRIES = 5

/**
 * Backoff delay in ms for a given attempt (1-based): 1s, 2s, 4s, 8s, capped.
 *
 * Capped rather than unbounded doubling because the common case is a dev-server
 * restart that takes a few seconds — a 30-second sixth wait would feel broken
 * even though it is "working".
 */
export function retryDelay(attempt: number): number {
  const capped = Math.min(Math.max(attempt, 1), 4)
  return 1000 * 2 ** (capped - 1)
}
