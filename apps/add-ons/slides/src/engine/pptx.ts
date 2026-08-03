/**
 * Lazy bridge to the pptx renderer. `pptx-preview` (it drags in jszip, lodash,
 * echarts) is heavy and must never land in the desktop boot bundle — it is
 * pulled in on first open via dynamic import, so the whole engine becomes its
 * own chunk. Nothing here is imported at module top level.
 *
 * Best-effort by nature: pptx-preview reconstructs slides from OpenXML in the
 * browser and does not match PowerPoint fidelity. The Slides app pairs it with
 * a visible hint and a Download escape hatch.
 */

export type RenderedDeck = {
  /** One element per slide, in deck order. Empty when nothing was rendered. */
  slides: HTMLElement[]
}

/**
 * The slide elements inside a completed render.
 *
 * pptx-preview builds `.pptx-preview-wrapper` and appends one child per slide
 * (verified against a real five-slide deck). Reading them is what makes
 * navigation, the thumbnail rail and per-slide export possible without
 * re-parsing. If that class ever changes, the fallback treats the container's own
 * children as slides — degraded, probably to a single entry, rather than broken.
 */
function findSlides(container: HTMLElement): HTMLElement[] {
  const wrapper = container.querySelector('.pptx-preview-wrapper')
  const parent = wrapper ?? container
  return [...parent.children].filter((el): el is HTMLElement => el instanceof HTMLElement)
}

/**
 * Render every slide of `data` into `container`, stacked vertically (the host
 * scrolls). Each slide is drawn at `width`×`height` px. Any previous render in
 * the container is cleared first.
 */
export async function renderPptx(
  container: HTMLElement,
  data: ArrayBuffer,
  size: { width: number; height: number }
): Promise<RenderedDeck> {
  const { init } = await import('pptx-preview')
  container.innerHTML = ''
  const previewer = init(container, { width: size.width, height: size.height })
  await previewer.preview(data)
  return { slides: findSlides(container) }
}
