import { useEffect } from 'react'
import { anchorsFromLineTops, mapScroll, normalizeAnchors, type Anchor } from '../lib/scrollSync'

/**
 * Keep the editor and the preview showing the same part of the document.
 *
 * Only the pane the user is *not* touching is moved. Driving both would fight the
 * user's own scrolling, and the feedback loop — A moves B, B's scroll event moves A —
 * shows up as a jitter that walks the document away under the cursor. That is what the
 * short lock below prevents: the pane we just moved ignores its own scroll event.
 *
 * Anchors for the preview are re-collected lazily at the start of a scroll gesture
 * rather than kept in sync with the DOM. It costs one layout read every 400ms of active
 * scrolling and it is automatically correct after a re-render, a resize, or an image
 * finishing loading — all of which move rendered blocks without any state changing.
 */
export function useScrollSync({
  editor,
  preview,
  lineTops,
  enabled,
}: {
  editor: HTMLTextAreaElement | null
  preview: HTMLElement | null
  lineTops: number[]
  enabled: boolean
}): void {
  useEffect(() => {
    // Copied into consts so the narrowing survives into the closures below.
    const editorEl = editor
    const previewEl = preview
    if (!enabled || !editorEl || !previewEl || lineTops.length === 0) return

    const editorAnchors = normalizeAnchors(anchorsFromLineTops(lineTops))
    let previewAnchors: Anchor[] = []
    let collectedAt = 0
    let lockedUntil = 0
    let lockedElement: EventTarget | null = null

    // Arrow consts rather than function declarations: a hoisted declaration can be called
    // before the null checks above, so TypeScript refuses to carry the narrowing into one.
    /** Rendered block tops, in the preview's own scroll coordinates. */
    const collectPreviewAnchors = (): Anchor[] => {
      const base = previewEl.getBoundingClientRect().top - previewEl.scrollTop
      const found: Anchor[] = []
      for (const el of previewEl.querySelectorAll<HTMLElement>('[data-src-line]')) {
        const line = Number(el.dataset.srcLine)
        if (!Number.isFinite(line)) continue
        found.push({ line, top: el.getBoundingClientRect().top - base })
      }
      return normalizeAnchors(found)
    }

    const freshPreviewAnchors = (now: number): Anchor[] => {
      if (now - collectedAt > 400 || previewAnchors.length === 0) {
        previewAnchors = collectPreviewAnchors()
        collectedAt = now
      }
      return previewAnchors
    }

    const sync = (
      from: HTMLElement,
      to: HTMLElement,
      fromAnchors: Anchor[],
      toAnchors: Anchor[]
    ) => {
      const target = mapScroll(
        { anchors: fromAnchors, scrollTop: from.scrollTop },
        { anchors: toAnchors, scrollHeight: to.scrollHeight, clientHeight: to.clientHeight }
      )
      // Sub-pixel corrections are invisible and would keep the lock permanently hot.
      if (Math.abs(to.scrollTop - target) < 1) return
      lockedElement = to
      lockedUntil = Date.now() + 150
      to.scrollTop = target
    }

    const onEditorScroll = () => {
      const now = Date.now()
      if (lockedElement === editorEl && now < lockedUntil) return
      sync(editorEl, previewEl, editorAnchors, freshPreviewAnchors(now))
    }

    const onPreviewScroll = () => {
      const now = Date.now()
      if (lockedElement === previewEl && now < lockedUntil) return
      sync(previewEl, editorEl, freshPreviewAnchors(now), editorAnchors)
    }

    editorEl.addEventListener('scroll', onEditorScroll, { passive: true })
    previewEl.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      editorEl.removeEventListener('scroll', onEditorScroll)
      previewEl.removeEventListener('scroll', onPreviewScroll)
    }
  }, [editor, preview, lineTops, enabled])
}
