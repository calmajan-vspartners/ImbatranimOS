import { useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import { CATEGORIES, categoryById, convert, formatResult, type UnitId } from './engine/units'

/**
 * The unit converter (brief 116) — the fourth mode tab every OS calculator
 * ships with.
 *
 * Static tables over the same window as the other three pads; no evaluator, no
 * number type of its own, and deliberately no memory register or tape. Those
 * belong to Basic/Scientific, which share one double; a converted value is a
 * *pair* of numbers with units attached, and pushing one half of it onto the
 * tape would record something the user never computed.
 *
 * Both sides are live: type in either and the other follows, so it reads as one
 * conversion rather than an input and an output. The arithmetic and the tables
 * live in `engine/units.ts` and are tested there against the definitions.
 */
export function ConverterPad({ windowId: _windowId }: { windowId: string }) {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id)
  const category = useMemo(() => categoryById(categoryId), [categoryId])
  const [from, setFrom] = useState<UnitId>(CATEGORIES[0].defaults[0])
  const [to, setTo] = useState<UnitId>(CATEGORIES[0].defaults[1])
  /** The side the user is typing into, and its raw text. */
  const [edited, setEdited] = useState<'from' | 'to'>('from')
  const [raw, setRaw] = useState('1')

  const parsed = Number(raw.trim())
  const valid = raw.trim() !== '' && Number.isFinite(parsed)
  const other = valid
    ? convert(category.id, parsed, edited === 'from' ? from : to, edited === 'from' ? to : from)
    : null

  const fromValue = edited === 'from' ? raw : other === null ? '' : formatResult(other)
  const toValue = edited === 'to' ? raw : other === null ? '' : formatResult(other)

  function pickCategory(id: string) {
    const next = categoryById(id)
    setCategoryId(id)
    setFrom(next.defaults[0])
    setTo(next.defaults[1])
    setEdited('from')
    setRaw('1')
  }

  function swap() {
    // Swapping keeps the number the user is looking at on the side they are
    // looking at, which is what makes it read as "the other way round" rather
    // than as a reset.
    const shown = edited === 'from' ? fromValue : toValue
    const otherShown = edited === 'from' ? toValue : fromValue
    setFrom(to)
    setTo(from)
    setRaw(edited === 'from' ? otherShown : shown)
    setEdited('from')
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => pickCategory(cat.id)}
            aria-pressed={cat.id === categoryId}
            className={cn(
              'font-ui border px-2 py-0.5 text-[11px]',
              cat.id === categoryId
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant text-on-surface hover:bg-surface-container'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <Side
        label="From"
        value={fromValue}
        unit={from}
        units={category.units}
        onValue={(v) => {
          setEdited('from')
          setRaw(v)
        }}
        onUnit={setFrom}
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={swap}
          aria-label="Swap the two units"
          title="Swap"
          className="border-outline-variant text-on-surface-variant hover:text-on-surface border p-1"
        >
          <ArrowLeftRight size={13} />
        </button>
      </div>

      <Side
        label="To"
        value={toValue}
        unit={to}
        units={category.units}
        onValue={(v) => {
          setEdited('to')
          setRaw(v)
        }}
        onUnit={setTo}
      />

      {!valid && raw.trim() !== '' && (
        <span className="font-ui text-error text-[11px]">That is not a number.</span>
      )}
    </div>
  )
}

function Side({
  label,
  value,
  unit,
  units,
  onValue,
  onUnit,
}: {
  label: string
  value: string
  unit: UnitId
  units: { id: UnitId; label: string; symbol: string }[]
  onValue: (value: string) => void
  onUnit: (unit: UnitId) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ui text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </span>
      <div className="flex items-stretch gap-1">
        <input
          value={value}
          inputMode="decimal"
          aria-label={`${label} value`}
          onChange={(e) => onValue(e.target.value)}
          className="border-outline-variant bg-surface-container-lowest text-on-surface min-w-0 flex-1 border px-2 py-1 text-right font-mono text-[15px] outline-none"
        />
        <select
          value={unit}
          aria-label={`${label} unit`}
          onChange={(e) => onUnit(e.target.value)}
          className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface shrink-0 border px-1 text-[11px] outline-none"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.symbol} — {u.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
