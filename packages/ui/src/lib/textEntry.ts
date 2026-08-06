/**
 * True when the event target is a place the user types — an input, a textarea,
 * a select, or anything contentEditable. Every keyboard hook that binds plain
 * letters or digits must check this, or typing in a form fires shortcuts.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  // Explicit `=== true`: lib.dom types isContentEditable as boolean, but it is
  // absent in some environments and returns undefined there, which would make
  // this function's declared boolean return a lie.
  return target.isContentEditable === true
}
