import { Input as BaseInput } from '@base-ui/react/input'
import { type ComponentProps } from 'react'
import { cn } from '../cn'

type InputProps = ComponentProps<typeof BaseInput> & {
  label?: string
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={id}
          className="font-ui text-on-surface-variant text-[11px] font-semibold tracking-wider uppercase"
        >
          {label}
        </label>
      )}
      <BaseInput
        id={id}
        className={cn(
          'border-outline-variant bg-surface-container-lowest w-full border px-2.5 py-1.5',
          'font-content text-on-surface text-[13px]',
          'transition-colors outline-none',
          'placeholder:text-on-surface-variant',
          'data-[focused]:border-primary data-[focused]:ring-primary/40 data-[focused]:ring-2',
          'data-[invalid]:border-error',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  )
}
