import { Select as BaseSelect } from '@base-ui/react/select'
import { type ComponentProps } from 'react'
import { cn } from '../../../lib/cn'

type SelectRootProps = ComponentProps<typeof BaseSelect.Root>

type SelectOption = {
  value: string
  label: string
}

type SelectProps = Omit<SelectRootProps, 'className'> & {
  label?: string
  placeholder?: string
  options: SelectOption[]
  className?: string
}

export function Select({
  label,
  placeholder = 'Select…',
  options,
  className,
  ...props
}: SelectProps) {
  return (
    <BaseSelect.Root {...props}>
      <div className="flex flex-col gap-1">
        {label && (
          <BaseSelect.Label className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase">
            {label}
          </BaseSelect.Label>
        )}
        <BaseSelect.Trigger
          className={cn(
            'border-outline-variant bg-surface-container-low flex w-full items-center justify-between border px-2.5 py-1.5',
            'font-ui text-on-surface text-[12px]',
            'hover:bg-surface-container-high cursor-pointer transition-colors outline-none',
            'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
            'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
            className
          )}
        >
          {/*
            The trigger must show the option's LABEL, not its value.
            `<Select.Value>` with no children renders the raw value, because base-ui
            can only look a label up when `Select.Root` is given an `items` map. So
            every Select in the OS whose value differs from its label displayed the
            value — found by measurement in brief 75, where a folder picker read "6"
            instead of "Work / Specs". `git-gui`'s root picker and Calendar's reminder
            offsets had the same defect.

            The lookup is by `String(value)` because a caller may pass a number even
            though `SelectOption.value` is typed as a string, and a mismatch here would
            silently fall back to the placeholder.
          */}
          <BaseSelect.Value placeholder={placeholder}>
            {(value: unknown) =>
              options.find((option) => option.value === String(value))?.label ?? placeholder
            }
          </BaseSelect.Value>
          <BaseSelect.Icon className="text-on-surface-variant ml-2">▾</BaseSelect.Icon>
        </BaseSelect.Trigger>

        <BaseSelect.Portal>
          {/* z-index on the Positioner (the fixed element): overlays must clear the
              window band, whose zIndex grows unboundedly. */}
          <BaseSelect.Positioner sideOffset={1} className="z-[1000]">
            <BaseSelect.Popup
              className={cn(
                'border-outline-variant bg-surface-container-lowest min-w-[8rem] border',
                'shadow-[0_10px_28px_rgba(0,0,0,0.4)]',
                'py-0.5 outline-none'
              )}
            >
              <BaseSelect.List>
                {options.map((opt) => (
                  <BaseSelect.Item
                    key={opt.value}
                    value={opt.value}
                    className={cn(
                      'flex cursor-pointer items-center px-2 py-1',
                      'font-ui text-on-surface text-[12px]',
                      'outline-none',
                      'data-[highlighted]:bg-primary-container data-[highlighted]:text-on-primary-container',
                      'data-[selected]:bg-primary-container data-[selected]:text-on-primary-container'
                    )}
                  >
                    <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </div>
    </BaseSelect.Root>
  )
}
