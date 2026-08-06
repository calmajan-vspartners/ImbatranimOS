import { Component, type ErrorInfo, type ReactNode } from 'react'
import { notify } from '../../store/notificationStore'
import { shouldReportCrash } from './crashToastGuard'

interface Props {
  appId: string
  appName: string
  children: ReactNode
  /**
   * Rendered instead of the children after a catch.
   *
   * Recovery is the caller's job, done by changing this boundary's `key`, not a
   * `reset()` here. Clearing the error state in place would re-render the same
   * child in the same state that just threw, which usually throws again — a
   * "Reload" that visibly does nothing. Remounting is what the user means.
   */
  fallback: (error: Error) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * Containment for a single window's app content (brief 47).
 *
 * Every windowed app renders into core's shared React tree, so one uncaught
 * `throw` in a render or effect unmounts **the whole desktop** — React's default
 * behaviour is all that stands between a buggy app and a blank screen. Apps here
 * are first-party and built in, so the threat is a *buggy* app rather than a
 * malicious one, and a boundary addresses that completely at no API cost.
 *
 * Two things this deliberately does not do:
 *
 * - **It does not wrap the window chrome.** The boundary sits inside the frame,
 *   so a crashed app can still be dragged, focused, resized and closed. Putting
 *   the chrome inside would mean a crash takes away the very controls needed to
 *   deal with it.
 * - **It does not catch a hang.** An error boundary catches throws, not infinite
 *   loops, and a spinning app still freezes the tab because every app shares the
 *   main thread. Real hang isolation needs the iframe/worker transport that
 *   brief 48's seam makes possible; a watchdog here would be a worse version of
 *   it. The limit is documented rather than half-solved.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { appId, appName } = this.props
    if (shouldReportCrash(appId)) {
      notify({
        title: `${appName} crashed`,
        body: error.message || 'The app stopped unexpectedly.',
        level: 'error',
        appId,
      })
    }
    // Still goes to the console: the toast is for the user, this is for whoever
    // is debugging, and the component stack is the useful half.
    console.error(`[${appId}] crashed`, error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) return this.props.fallback(error)
    return this.props.children
  }
}
