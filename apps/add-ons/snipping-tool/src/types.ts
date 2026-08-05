export type Tool = 'arrow' | 'rect' | 'text' | 'pixelate' | 'blackout' | 'freehand'

export type Point = { x: number; y: number }

export type Annotation =
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { type: 'pixelate'; x: number; y: number; w: number; h: number }
  /**
   * Opaque redaction. Not a colour choice: a blackout exists to destroy content, and a
   * semi-visible box in whatever swatch happened to be selected would undermine the one
   * thing it is for.
   */
  | { type: 'blackout'; x: number; y: number; w: number; h: number }
  | { type: 'freehand'; points: Point[]; color: string }

/** Capture selection in CSS pixels, relative to the viewport. */
export type Selection = { x: number; y: number; width: number; height: number }
