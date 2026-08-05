import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { notify, useFileDialog, useWindowStore } from '@imbatranim/core'
import { CaptureOverlay } from './components/CaptureOverlay'
import { AnnotationStage } from './components/AnnotationStage'
import { CaptureLauncher } from './components/CaptureLauncher'
import type { LaunchMode } from './lib/captureModes'
import { CountdownOverlay } from './components/CountdownOverlay'
import { captureRegion } from './capture/rasterize'
import { loadCaptureCanvas } from './capture/load'
import { describeLossy, scanLossyElements, summarize } from './capture/lossy'
import type { Selection } from './types'
import { APP_NAME } from './appName'

type Phase = 'launcher' | 'selecting' | 'counting' | 'capturing' | 'annotating'

/**
 * Flow: launcher → (arm a mode) → dim + crosshair, or a non-blocking countdown → rasterize
 * the live desktop (excluding this tool's own overlay + taskbar entry) → crop → annotate.
 *
 * The capture surfaces live in a portal over `document.body`, and the host window is hidden
 * only while a capture is armed, so its frame never lands in the shot. It comes back on
 * Escape: **Escape returns to the launcher, not out of the app**, so a mistaken mode choice
 * costs one keystroke rather than a relaunch.
 *
 * On `getDisplayMedia`, which the brief flagged as its one contested call: **not adopted.**
 * It captures the *host browser surface* — its chrome, its other tabs, whatever the user
 * picks in the browser's own picker — which is a different thing from this desktop, and the
 * illusion the project is built on is that the tab *is* the display. It also needs a
 * permission prompt per capture, which is the same "app seizes the screen without warning"
 * problem the launcher above exists to fix. The DOM path is lossy only for canvas, video and
 * cross-origin images, and those are now detected and named on the capture itself, which
 * beats a second capture path that undermines the model. (Screen recording stays rejected
 * for the same reason.)
 */
export function SnippingTool({ windowId }: { windowId: string }) {
  const hideWindow = useWindowStore((s) => s.hideWindow)
  const showWindow = useWindowStore((s) => s.showWindow)
  const closeWindow = useWindowStore((s) => s.closeWindow)

  const [phase, setPhase] = useState<Phase>('launcher')
  const [image, setImage] = useState<HTMLCanvasElement | null>(null)
  const [lossyNotice, setLossyNotice] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)
  const captureStartedRef = useRef(false)

  // The window-scoped picker would latch its choice into the shared opened-file store; this
  // app reads its own file, so it uses the plain dialog.
  const { openFile, fileDialog } = useFileDialog()

  const close = useCallback(() => closeWindow(windowId), [closeWindow, windowId])

  /** Back to the launcher, with the app's own window visible again. */
  const backToLauncher = useCallback(() => {
    captureStartedRef.current = false
    setImage(null)
    setLossyNotice(null)
    setPhase('launcher')
    showWindow(windowId)
  }, [showWindow, windowId])

  // Exclude the tool's own chrome from the shot: any overlay we portal in, plus our
  // minimized taskbar button (matched by its title === app name).
  const filterNode = useCallback((node: HTMLElement): boolean => {
    if (!(node instanceof HTMLElement)) return true
    if (node.dataset && 'snipOverlay' in node.dataset) return false
    if (node.tagName === 'BUTTON' && node.getAttribute('title') === APP_NAME) return false
    return true
  }, [])

  const capture = useCallback(
    async (sel: Selection) => {
      if (captureStartedRef.current) return
      captureStartedRef.current = true
      // Scanned BEFORE the raster, while the desktop is still exactly what the user chose.
      const notice = describeLossy(summarize(scanLossyElements(), sel))
      setPhase('capturing')
      try {
        const canvas = await captureRegion(sel, filterNode)
        setImage(canvas)
        setLossyNotice(notice)
        setPhase('annotating')
      } catch (err) {
        console.error('[snipping-tool] capture failed', err)
        notify({
          title: 'Capture failed',
          body: 'The desktop could not be rasterized. Nothing was saved.',
          level: 'error',
          appId: 'snipping-tool',
        })
        backToLauncher()
      }
    },
    [backToLauncher, filterNode]
  )

  const fullScreenSelection = (): Selection => ({
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  })

  const arm = useCallback(
    (mode: LaunchMode) => {
      captureStartedRef.current = false
      hideWindow(windowId)
      if (mode.kind === 'region') {
        setPhase('selecting')
        return
      }
      if (mode.kind === 'fullscreen') {
        void capture(fullScreenSelection())
        return
      }
      setRemaining(mode.seconds)
      setPhase('counting')
    },
    [capture, hideWindow, windowId]
  )

  // The countdown. One interval, and the capture fires from the tick that reaches zero —
  // not from a second effect watching `remaining`, which would fire again on a re-render.
  useEffect(() => {
    if (phase !== 'counting') return
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev > 1) return prev - 1
        clearInterval(timer)
        void capture(fullScreenSelection())
        return 0
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [phase, capture])

  // Escape gets out of an armed capture from any state, including the countdown — where the
  // overlay is deliberately click-through and so cannot offer a cancel button.
  useEffect(() => {
    if (phase !== 'counting') return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      backToLauncher()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, backToLauncher])

  const openSaved = useCallback(async () => {
    const choice = await openFile({
      title: 'Open a capture to annotate',
      extensions: ['png', 'jpg', 'jpeg', 'webp'],
    })
    if (!choice) return
    try {
      const canvas = await loadCaptureCanvas(choice.root, choice.path)
      setImage(canvas)
      // A saved file was rasterized when it was taken; whatever was lost is already lost, and
      // repeating the warning here would be about the wrong moment.
      setLossyNotice(null)
      setPhase('annotating')
    } catch (err) {
      console.error('[snipping-tool] could not open the capture', err)
      notify({
        title: 'Could not open that image',
        body: `${choice.path} could not be decoded as an image.`,
        level: 'error',
        appId: 'snipping-tool',
      })
    }
  }, [openFile])

  if (phase === 'launcher') {
    // Rendered in the window, not the portal: the desktop stays usable, which is the point.
    return (
      <>
        <CaptureLauncher onArm={arm} onOpenSaved={() => void openSaved()} busy={false} />
        {fileDialog}
      </>
    )
  }

  let content: React.ReactNode = null
  if (phase === 'selecting') {
    content = <CaptureOverlay onSelect={capture} onCancel={backToLauncher} />
  } else if (phase === 'counting') {
    content = <CountdownOverlay remaining={remaining} />
  } else if (phase === 'capturing') {
    content = (
      <div
        data-snip-overlay
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          font: '600 13px "Space Grotesk", sans-serif',
          background: 'rgba(0,0,0,0.35)',
        }}
      >
        Capturing…
      </div>
    )
  } else if (phase === 'annotating' && image) {
    content = (
      <AnnotationStage image={image} notice={lossyNotice} onBack={backToLauncher} onClose={close} />
    )
  }

  return createPortal(content, document.body)
}
