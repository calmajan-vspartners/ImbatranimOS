// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'
import { resetCrashToastHistory, shouldReportCrash } from './crashToastGuard'
import { AppErrorFallback } from './AppErrorFallback'
import { useNotificationStore } from '../../store/notificationStore'

/**
 * Brief 47 — a faulty app must not take down the OS.
 *
 * Driven with `react-dom/client` + React 19's `act` rather than Testing Library:
 * jsdom is already a devDependency, the whole surface under test is "does the
 * boundary catch and does Reload remount", and the repo has held a zero-new-
 * dependency line. If component tests ever get numerous enough that this helper
 * starts growing features, that is the moment to pull RTL in — not before.
 */

let container: HTMLDivElement
let root: Root
/** React logs a caught error to console.error; silence it for these cases. */
let consoleError: typeof console.error

const render = (node: ReactNode): void => {
  act(() => {
    root.render(node)
  })
}

const click = (text: string): void => {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text
  )
  if (!button) throw new Error(`No button labelled "${text}" — saw: ${container.textContent}`)
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  // React 19 re-reports a *caught* error to `window.onerror` on top of logging
  // it, which vitest counts as an unhandled failure. `onCaughtError` is the
  // supported way to say "the boundary handled this" — it does not weaken the
  // test, which asserts on what the boundary actually rendered.
  root = createRoot(container, { onCaughtError: () => {} })
  resetCrashToastHistory()
  useNotificationStore.setState({ notifications: [], toasts: [] })
  consoleError = console.error
  console.error = () => {}
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  console.error = consoleError
})

/**
 * An app that throws while `ctl.broken`, and behaves once the test clears it.
 *
 * Deliberately NOT a self-decrementing counter: React 19 in development
 * re-invokes a component after it throws, to build a better stack. A "throw
 * once" app therefore succeeds on that retry and the boundary never latches —
 * the state is the test's to control, not the component's.
 */
function FlakyApp({ ctl }: { ctl: { broken: boolean } }) {
  if (ctl.broken) throw new Error('kaboom from the app')
  return <div data-testid="app">the app is fine</div>
}

const boundary = (children: ReactNode, onReload = () => {}, onClose = () => {}) => (
  <AppErrorBoundary
    appId="flaky"
    appName="Flaky App"
    fallback={(error) => (
      <AppErrorFallback appName="Flaky App" error={error} onReload={onReload} onClose={onClose} />
    )}
  >
    {children}
  </AppErrorBoundary>
)

describe('AppErrorBoundary (brief 47)', () => {
  it('renders the app normally when it does not throw', () => {
    render(boundary(<div data-testid="app">hello</div>))
    expect(container.querySelector('[data-testid="app"]')).not.toBeNull()
  })

  it('catches a throw and renders the fallback INSTEAD OF unmounting', () => {
    render(boundary(<FlakyApp ctl={{ broken: true }} />))
    // The crucial part: the subtree still exists. Without the boundary React
    // unmounts the whole tree, which in the real app is the entire desktop.
    expect(container.textContent).toContain('Flaky App stopped working')
    expect(container.querySelector('[data-testid="app"]')).toBeNull()
  })

  it('offers Reload and Close, and calls them', () => {
    let reloaded = 0
    let closed = 0
    render(
      boundary(
        <FlakyApp ctl={{ broken: true }} />,
        () => reloaded++,
        () => closed++
      )
    )
    click('Reload')
    click('Close window')
    expect(reloaded).toBe(1)
    expect(closed).toBe(1)
  })

  it('a key change REMOUNTS the app, which is what makes Reload a recovery', () => {
    const ctl = { broken: true }
    function Host() {
      const [k, setK] = useState(0)
      return (
        <AppErrorBoundary
          key={k}
          appId="flaky"
          appName="Flaky App"
          fallback={(error) => (
            <AppErrorFallback
              appName="Flaky App"
              error={error}
              onReload={() => setK((n) => n + 1)}
              onClose={() => {}}
            />
          )}
        >
          <FlakyApp ctl={ctl} />
        </AppErrorBoundary>
      )
    }
    render(<Host />)
    expect(container.textContent).toContain('Flaky App stopped working')

    // Whatever was wrong is fixed; Reload should now get a working app back.
    ctl.broken = false
    click('Reload')
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe('the app is fine')
    expect(container.textContent).not.toContain('stopped working')
  })

  it('shows the message only behind Show details', () => {
    render(boundary(<FlakyApp ctl={{ broken: true }} />))
    expect(container.textContent).not.toContain('kaboom from the app')
    click('Show details')
    expect(container.textContent).toContain('kaboom from the app')
    click('Hide details')
    expect(container.textContent).not.toContain('kaboom from the app')
  })

  it('raises exactly one notification for the crash', () => {
    render(boundary(<FlakyApp ctl={{ broken: true }} />))
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Flaky App crashed')
    expect(items[0].level).toBe('error')
    expect(items[0].appId).toBe('flaky')
  })

  it('DEDUPES a render loop instead of flooding the notification centre', () => {
    // Five separate crashes in quick succession — a throw-on-every-render app.
    for (let i = 0; i < 5; i++) {
      act(() => {
        root.render(boundary(<FlakyApp ctl={{ broken: true }} />))
      })
      act(() => {
        root.render(<div />)
      })
    }
    expect(useNotificationStore.getState().notifications).toHaveLength(1)
  })

  it('the dedupe is per app, so a second app’s crash is still reported', () => {
    // Both mounted at once, as two windows would be. Rendering them one after
    // the other into the same root would NOT test this: same element type in
    // the same position means React reuses the instance, which is already
    // latched in its error state and never catches again.
    render(
      <>
        {boundary(<FlakyApp ctl={{ broken: true }} />)}
        <AppErrorBoundary
          appId="other"
          appName="Other App"
          fallback={(error) => (
            <AppErrorFallback
              appName="Other App"
              error={error}
              onReload={() => {}}
              onClose={() => {}}
            />
          )}
        >
          <FlakyApp ctl={{ broken: true }} />
        </AppErrorBoundary>
      </>
    )
    const titles = useNotificationStore
      .getState()
      .notifications.map((n) => n.title)
      .sort()
    expect(titles).toEqual(['Flaky App crashed', 'Other App crashed'])
  })

  it('the dedupe guard reopens after its window expires', () => {
    const t0 = 1_000_000
    expect(shouldReportCrash('an-app', t0)).toBe(true)
    expect(shouldReportCrash('an-app', t0 + 4_999)).toBe(false)
    expect(shouldReportCrash('an-app', t0 + 5_000)).toBe(true)
  })

  it('falls back to a readable line when the error has no message', () => {
    function Empty(): never {
      throw new Error('')
    }
    render(boundary(<Empty />))
    expect(container.textContent).toContain('Flaky App stopped working')
    const items = useNotificationStore.getState().notifications
    expect(items[0].body).toBe('The app stopped unexpectedly.')
  })
})
