import { Input, Select, cn } from '@imbatranim/core'
import { WEEKDAY_LABELS } from './dateUtils'
import { describeRule } from './recurrence'
import { ruleFromDraft, type RecurrenceDraft } from './recurrenceDraft'

const FREQ_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const END_OPTIONS = [
  { value: 'never', label: 'Forever' },
  { value: 'until', label: 'Until a date' },
  { value: 'count', label: 'After a number of times' },
]

/**
 * The repeat section of the event dialog.
 *
 * A separate component because the dialog was already long, and because the
 * weekday row only exists for weekly rules — that conditional reads far better
 * next to the fields it belongs to than inline in a 250-line form.
 */
export function RecurrenceFields({
  draft,
  onChange,
}: {
  draft: RecurrenceDraft
  onChange: (draft: RecurrenceDraft) => void
}) {
  const rule = ruleFromDraft(draft)

  return (
    <div className="flex flex-col gap-2">
      <Select
        label="Repeat"
        options={FREQ_OPTIONS}
        value={draft.freq}
        onValueChange={(value) => onChange({ ...draft, freq: value as RecurrenceDraft['freq'] })}
      />

      {draft.freq !== 'none' && (
        <>
          <div className="flex items-end gap-2">
            <div className="w-20 shrink-0">
              <Input
                label="Every"
                type="number"
                min={1}
                max={365}
                value={draft.interval}
                onChange={(e) => onChange({ ...draft, interval: e.target.value })}
              />
            </div>
            <span className="text-on-surface-variant pb-1.5 text-[11px]">
              {draft.freq === 'daily'
                ? 'day(s)'
                : draft.freq === 'weekly'
                  ? 'week(s)'
                  : draft.freq === 'monthly'
                    ? 'month(s)'
                    : 'year(s)'}
            </span>
          </div>

          {draft.freq === 'weekly' && (
            <div className="flex flex-col gap-1">
              <span className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
                On
              </span>
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, index) => {
                  const on = draft.byWeekday.includes(index)
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      aria-label={`Repeat on ${label}`}
                      onClick={() =>
                        onChange({
                          ...draft,
                          byWeekday: on
                            ? draft.byWeekday.filter((d) => d !== index)
                            : [...draft.byWeekday, index],
                        })
                      }
                      className={cn(
                        'font-ui h-6 w-7 border text-[10px] font-semibold',
                        on
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
                      )}
                    >
                      {label[0]}
                    </button>
                  )
                })}
              </div>
              <p className="text-on-surface-variant text-[10px]">
                {draft.byWeekday.length === 0 && 'Nothing picked — repeats on the start day.'}
              </p>
            </div>
          )}

          <Select
            label="Ends"
            options={END_OPTIONS}
            value={draft.endMode}
            onValueChange={(value) =>
              onChange({ ...draft, endMode: value as RecurrenceDraft['endMode'] })
            }
          />

          {draft.endMode === 'until' && (
            <Input
              label="Last day"
              type="date"
              value={draft.until}
              onChange={(e) => onChange({ ...draft, until: e.target.value })}
            />
          )}
          {draft.endMode === 'count' && (
            <div className="w-24">
              <Input
                label="Times"
                type="number"
                min={1}
                max={1000}
                value={draft.count}
                onChange={(e) => onChange({ ...draft, count: e.target.value })}
              />
            </div>
          )}

          {/* Says in words what the fields add up to — the one place a rule can be
              checked before saving it. */}
          <p className="text-on-surface-variant text-[10px]">{describeRule(rule)}</p>
        </>
      )}
    </div>
  )
}
