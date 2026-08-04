import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { buildPtyUrl } from '../ptyUrl'
import { classifyClose, MAX_RETRIES, retryDelay } from '../lib/closeReason'

export type PtyStatus =
  | { kind: 'connecting' }
  | { kind: 'open' }
  /** Waiting out a backoff delay before attempt `attempt` of MAX_RETRIES. */
  | { kind: 'retrying'; attempt: number; message: string }
  /** Gave up automatically, or hit a settled end state. `canRetry` drives the button. */
  | { kind: 'closed'; message: string; canRetry: boolean }

type UsePtyConnectionArgs = {
  /**
   * Reads the live xterm instance, or null before it exists.
   *
   * A getter rather than the instance itself because the instance is a mutable
   * external object held in a ref, not render data. Passing it through render would
   * mean reading a ref during render, and would stop the caller mutating
   * `term.options` — xterm's only API for theme and font size.
   *
   * **Must be stable.** See the effect's dependency note.
   */
  getTerm: () => XTerm | null
  /**
   * Bumped by the caller once the terminal exists. This — not the instance — is
   * what tells the effect below there is something to connect to, and it is the
   * effect's only dependency.
   */
  generation: number
}

/**
 * Owns the PTY socket: connect, stream, classify a close, reconnect with backoff,
 * and tear down exactly once.
 *
 * Extracted from `Terminal.tsx`'s mount effect, which was doing five jobs at once
 * and had no room for retry logic — the reason a dropped socket used to kill the
 * window permanently.
 *
 * ## Reconnecting gives you a NEW shell
 *
 * This is not session reattach; `wiki/os-layering.md` explicitly parks that, because
 * it needs server-side session state. The pty is reaped when its socket closes, so a
 * reconnect spawns a fresh shell in the home directory. The UI says so on every
 * manual reconnect, because a user who assumes this is tmux will also assume their
 * background job survived.
 *
 * What IS kept is the **scrollback** — it is the user's history, and losing it was
 * the actual pain in the brief. xterm's buffer belongs to the `XTerm` instance, and
 * this hook only ever touches the socket.
 *
 * ## Everything lives in one effect, deliberately
 *
 * The socket, the retry counter, the backoff timer and the pending-input queue are
 * plain locals inside a single effect, and the outward-facing functions are thin
 * wrappers over a ref holding that effect's closure.
 *
 * An earlier draft spread them across `useCallback`s with mirror refs. That needed a
 * self-referencing callback for the retry (`connect` scheduling `connect`) and
 * mirror refs for the arguments, and React's lint rules rejected both — a
 * `useCallback` may not name itself, and a hook-produced value may not be copied
 * into a ref. A recursive local function inside one effect is the shape this
 * actually is, and it needs neither.
 */
export function usePtyConnection({ getTerm, generation }: UsePtyConnectionArgs) {
  const [status, setStatus] = useState<PtyStatus>({ kind: 'connecting' })

  /**
   * The live connection's own operations, published by the effect below.
   *
   * Null between teardown and the next connect, which is why every wrapper below is
   * optional-chained rather than asserting.
   */
  const apiRef = useRef<{
    sendInput: (data: string) => void
    sendResize: (cols: number, rows: number) => void
    reconnect: () => void
  } | null>(null)

  useEffect(() => {
    if (generation <= 0) return

    let disposed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    /** Frames typed before the socket is open, flushed on connect. */
    let pending: string[] = []

    const write = (data: string | Uint8Array) => getTerm()?.write(data)
    /** Dim status line inside the terminal, so it scrolls with the history. */
    const writeStatus = (text: string) => write(`\r\n\x1b[2m${text}\x1b[0m\r\n`)

    const sendFrame = (frame: string) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(frame)
      // Buffered rather than dropped: typing during a reconnect must not be
      // silently swallowed. The original code did this for the pre-open window and
      // the behaviour has to survive here.
      else pending.push(frame)
    }

    const sendResize = (cols: number, rows: number) => {
      // Unlike input there is no value in replaying a stale geometry — a reconnect
      // sends the current size itself — so this is dropped rather than queued.
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    }

    /**
     * Ask the API who we are, to explain a handshake refusal accurately.
     *
     * Needed because an unauthorized upgrade is rejected with a raw 401 and
     * `socket.destroy()`, which reaches script as an anonymous 1006 — exactly what
     * a dead backend produces. Without this the terminal would say "disconnected"
     * when the truth is "you are signed out".
     */
    const describeAuthFailure = async (): Promise<string | null> => {
      try {
        const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'
        const res = await fetch(`${base}/auth/status`, { credentials: 'include' })
        if (!res.ok) return null
        const body = (await res.json()) as { authenticated?: boolean }
        if (body.authenticated === false) {
          return 'Not signed in — unlock the desktop and try again.'
        }
        return null
      } catch {
        // The API is unreachable too, which is its own answer.
        return 'The backend is not reachable.'
      }
    }

    function connect() {
      const term = getTerm()
      if (disposed || !term) return

      setStatus({ kind: 'connecting' })
      let everOpened = false

      const ws = new WebSocket(buildPtyUrl(term.cols, term.rows))
      socket = ws

      ws.onopen = () => {
        everOpened = true
        attempt = 0
        setStatus({ kind: 'open' })
        for (const frame of pending) ws.send(frame)
        pending = []
        // Re-assert the geometry: the pty spawned at the URL's cols/rows, but the
        // window may have been resized while disconnected, and `stty size` has to
        // agree with what xterm is showing after a reconnect.
        const live = getTerm()
        if (live) sendResize(live.cols, live.rows)
      }

      ws.onmessage = (ev) => {
        write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data as ArrayBuffer))
      }

      ws.onclose = (ev) => {
        if (disposed) return
        socket = null
        const verdict = classifyClose(ev.code, ev.reason ?? '', everOpened)

        if (!verdict.retry) {
          writeStatus(verdict.message)
          setStatus({
            kind: 'closed',
            message: verdict.message,
            canRetry: verdict.allowManualRetry,
          })
          return
        }

        attempt += 1
        if (attempt > MAX_RETRIES) {
          const give = `${verdict.message} Giving up after ${MAX_RETRIES} attempts.`
          writeStatus(give)
          setStatus({ kind: 'closed', message: give, canRetry: true })
          // Resolve the real cause now that automatic recovery has failed, so the
          // message names the problem instead of guessing at it.
          if (verdict.checkAuth) {
            void describeAuthFailure().then((detail) => {
              if (!detail || disposed) return
              writeStatus(detail)
              setStatus({ kind: 'closed', message: detail, canRetry: true })
            })
          }
          return
        }

        const delay = retryDelay(attempt)
        writeStatus(`${verdict.message} reconnecting in ${Math.round(delay / 1000)}s…`)
        setStatus({ kind: 'retrying', attempt, message: verdict.message })
        timer = setTimeout(() => {
          timer = null
          connect()
        }, delay)
      }

      // `onerror` fires immediately before `onclose` for a refused handshake.
      // Writing here too would print two lines for one failure, so the close
      // handler owns all user-facing reporting.
      ws.onerror = () => {}
    }

    const reconnect = () => {
      if (disposed) return
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      // A manual retry is the user saying "try now", so the automatic budget starts
      // over rather than the click being spent on the last remaining attempt.
      attempt = 0
      const existing = socket
      socket = null
      try {
        existing?.close()
      } catch {
        /* already gone */
      }
      writeStatus('reconnecting — this starts a NEW shell')
      connect()
    }

    apiRef.current = {
      sendInput: (data) => sendFrame(JSON.stringify({ type: 'input', data })),
      sendResize,
      reconnect,
    }
    connect()

    return () => {
      disposed = true
      apiRef.current = null
      if (timer) clearTimeout(timer)
      timer = null
      const ws = socket
      socket = null
      // Closing the socket is what makes the server reap the pty.
      try {
        ws?.close()
      } catch {
        /* noop */
      }
    }
    // `generation` ONLY. `getTerm` is contractually stable (the caller wraps it in
    // useCallback), and adding it would mean any caller slip re-runs this effect —
    // which tears down a live shell and loses the user's session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  // Stable wrappers, so consumers can put these in their own dependency arrays
  // without re-subscribing every render.
  const sendInput = useCallback((data: string) => apiRef.current?.sendInput(data), [])
  const sendResize = useCallback(
    (cols: number, rows: number) => apiRef.current?.sendResize(cols, rows),
    []
  )
  const reconnect = useCallback(() => apiRef.current?.reconnect(), [])

  return { status, sendInput, sendResize, reconnect }
}
