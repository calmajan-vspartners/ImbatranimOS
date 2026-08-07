// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useState } from 'react'
import { SystemProvider } from '../systemContext'
import { useUnsavedGuard } from './systemHooks'
import type { SystemHandle } from '../system'

/**
 * The async unsaved-close guard (brief 102). Exercised through a real React
 * root — the dialog is state driven, so nothing short of mounting answers
 * whether the guard's promise actually follows the buttons.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Guard = () => boolean | Promise<boolean>

function makeSystem(): { system: SystemHandle; guardRef: { current: Guard | null } } {
  const guardRef: { current: Guard | null } = { current: null }
  const system = {
    window: {
      setTitle: () => undefined,
      onCloseRequest: (g: Guard) => {
        guardRef.current = g
        return () => {
          guardRef.current = null
        }
      },
    },
  } as unknown as SystemHandle
  return { system, guardRef }
}

/** Host with externally drivable dirty state, the way a real editor behaves. */
type HostProps = {
  system: SystemHandle
  initialDirty: boolean
  onSave?: () => void | Promise<void>
  expose?: (setDirty: (v: boolean) => void) => void
}

// The hook must run inside the provider, so the provider wraps from outside.
function HostInProvider(props: HostProps) {
  return (
    <SystemProvider system={props.system}>
      <HookBody {...props} />
    </SystemProvider>
  )
}
function HookBody({ initialDirty, onSave, expose }: HostProps) {
  const [dirty, setDirty] = useState(initialDirty)
  expose?.(setDirty)
  return <>{useUnsavedGuard(dirty, 'notes.txt', onSave)}</>
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

function clickButton(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  )
  expect(button, `a "${label}" button should be on screen`).toBeDefined()
  act(() => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

describe('useUnsavedGuard (brief 102)', () => {
  it('a clean window closes synchronously with no dialog', () => {
    const { system, guardRef } = makeSystem()
    act(() => root.render(<HostInProvider system={system} initialDirty={false} />))

    expect(guardRef.current).not.toBeNull()
    expect(guardRef.current!()).toBe(true)
    expect(document.body.textContent).not.toContain('unsaved')
  })

  it("Don't Save settles true; Cancel settles false; re-entry joins the same promise", async () => {
    const { system, guardRef } = makeSystem()
    act(() => root.render(<HostInProvider system={system} initialDirty={true} />))

    let verdict: boolean | Promise<boolean>
    act(() => {
      verdict = guardRef.current!()
    })
    expect(verdict!).toBeInstanceOf(Promise)
    // The second Ctrl+W while the dialog is up: the SAME pending promise.
    let second: boolean | Promise<boolean>
    act(() => {
      second = guardRef.current!()
    })
    expect(second!).toBe(verdict!)

    clickButton('Close without saving')
    await expect(verdict!).resolves.toBe(true)

    // Ask again — a fresh question this time — and cancel it.
    let again: boolean | Promise<boolean>
    act(() => {
      again = guardRef.current!()
    })
    expect(again!).not.toBe(verdict!)
    clickButton('Cancel')
    await expect(again!).resolves.toBe(false)
  })

  it('Save-and-close proceeds only when the save actually cleared the dirty flag', async () => {
    const { system, guardRef } = makeSystem()
    let setDirty!: (v: boolean) => void
    // A save that works: clears dirty (the way setSavedContent does).
    const onSave = async () => {
      setDirty(false)
    }
    act(() =>
      root.render(
        <HostInProvider
          system={system}
          initialDirty={true}
          onSave={onSave}
          expose={(s) => (setDirty = s)}
        />
      )
    )

    let verdict!: boolean | Promise<boolean>
    act(() => {
      verdict = guardRef.current!()
    })
    clickButton('Save')
    await act(async () => {})
    await expect(verdict).resolves.toBe(true)
  })

  it('a failed save (dirty persists) aborts the close instead of discarding work', async () => {
    const { system, guardRef } = makeSystem()
    // A save that fails: rejects, dirty stays true.
    const onSave = async () => {
      throw new Error('disk full')
    }
    act(() => root.render(<HostInProvider system={system} initialDirty={true} onSave={onSave} />))

    let verdict!: boolean | Promise<boolean>
    act(() => {
      verdict = guardRef.current!()
    })
    clickButton('Save')
    await act(async () => {})
    await expect(verdict).resolves.toBe(false)
  })

  it('unmounting with the question pending settles false so the store never hangs', async () => {
    const { system, guardRef } = makeSystem()
    act(() => root.render(<HostInProvider system={system} initialDirty={true} />))

    let verdict!: boolean | Promise<boolean>
    act(() => {
      verdict = guardRef.current!()
    })
    act(() => root.unmount())
    await expect(verdict).resolves.toBe(false)
  })
})
