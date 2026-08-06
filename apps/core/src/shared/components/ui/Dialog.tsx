import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { type ReactNode } from 'react'
import { cn } from '../../../lib/cn'

type DialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  title?: string
  description?: string
  children: ReactNode
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  className,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <BaseDialog.Trigger>{trigger}</BaseDialog.Trigger>}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-[1000] bg-black/50" />
        <BaseDialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-[1001] -translate-x-1/2 -translate-y-1/2',
            'border-outline-variant bg-surface-container-lowest min-w-[320px] border',
            'shadow-[0_24px_60px_rgba(0,0,0,0.55)]',
            'outline-none',
            className
          )}
        >
          {title && (
            <div className="border-outline-variant bg-surface-container-high flex items-center justify-between border-b px-3 py-1.5">
              <BaseDialog.Title className="font-ui text-on-surface text-[13px] font-semibold">
                {title}
              </BaseDialog.Title>
              <BaseDialog.Close className="border-outline-variant bg-surface-container-low font-ui text-on-surface hover:bg-error hover:text-on-error flex h-5 w-5 cursor-pointer items-center justify-center border text-[12px]">
                ×
              </BaseDialog.Close>
            </div>
          )}
          <div className="font-content text-on-surface p-3 text-[13px]">
            {description && (
              <BaseDialog.Description className="text-on-surface-variant mb-3">
                {description}
              </BaseDialog.Description>
            )}
            {children}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
