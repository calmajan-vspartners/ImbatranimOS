import type { Frequency, RecurrenceRule } from './types'

/**
 * The repeat editor's own state, and its translation to and from a stored rule.
 *
 * Separate from the component so the form can hold half-typed input ("every " with
 * an empty interval box) without that ever reaching the rule type — and because a
 * component file may only export components.
 */

export type RecurrenceDraft = {
  freq: Frequency | 'none'
  interval: string
  byWeekday: number[]
  endMode: 'never' | 'until' | 'count'
  until: string
  count: string
}

export const EMPTY_RECURRENCE: RecurrenceDraft = {
  freq: 'none',
  interval: '1',
  byWeekday: [],
  endMode: 'never',
  until: '',
  count: '10',
}

export function draftFromRule(rule: RecurrenceRule | null): RecurrenceDraft {
  if (!rule) return EMPTY_RECURRENCE
  return {
    freq: rule.freq,
    interval: String(rule.interval),
    byWeekday: rule.byWeekday ?? [],
    endMode: rule.count !== undefined ? 'count' : rule.until ? 'until' : 'never',
    until: rule.until ?? '',
    count: rule.count !== undefined ? String(rule.count) : '10',
  }
}

/**
 * Build the rule the draft describes, or null for "does not repeat".
 *
 * Invalid input collapses to a sane rule rather than blocking the save: an empty
 * interval box means 1, and an end mode whose field is blank means no end. The
 * alternative is refusing to save an event because a number field is momentarily
 * empty, which is a worse trade for a form this size.
 */
export function ruleFromDraft(draft: RecurrenceDraft): RecurrenceRule | null {
  if (draft.freq === 'none') return null
  const interval = Number(draft.interval)
  const rule: RecurrenceRule = {
    freq: draft.freq,
    interval: Number.isFinite(interval) && interval >= 1 ? Math.trunc(interval) : 1,
  }
  if (draft.freq === 'weekly' && draft.byWeekday.length > 0) {
    rule.byWeekday = [...draft.byWeekday].sort((a, b) => a - b)
  }
  if (draft.endMode === 'until' && draft.until) rule.until = draft.until
  if (draft.endMode === 'count') {
    const count = Number(draft.count)
    if (Number.isFinite(count) && count >= 1) rule.count = Math.trunc(count)
  }
  return rule
}
