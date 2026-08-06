import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { type ComponentProps } from 'react'
import { cn } from '../cn'

type CheckboxProps = ComponentProps<typeof BaseCheckbox.Root> & {
  label?: string
}

export function Checkbox({ label, className, id, ...props }: CheckboxProps) {
  return (
    <label className="font-content text-on-surface flex cursor-pointer items-center gap-2 text-[13px] select-none">
      <BaseCheckbox.Root
        id={id}
        className={cn(
          'border-outline-variant bg-surface-container-lowest flex h-4 w-4 shrink-0 items-center justify-center border',
          'transition-colors outline-none',
          'focus-visible:ring-primary focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-1',
          'data-[checked]:border-primary data-[checked]:bg-primary',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          className
        )}
        {...props}
      >
        <BaseCheckbox.Indicator className="text-on-primary flex items-center justify-center">
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label && <span>{label}</span>}
    </label>
  )
}
