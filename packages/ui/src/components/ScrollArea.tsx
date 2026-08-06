import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { type ReactNode, type Ref } from 'react'
import { cn } from '../cn'

type ScrollAreaProps = {
  children: ReactNode
  className?: string
  orientation?: 'vertical' | 'horizontal' | 'both'
  /**
   * Ref to the scrolling viewport element. Needed by consumers that virtualize
   * their content (the virtualizer reads scrollTop/height off this node) so
   * they don't have to reach for the library's internal DOM attributes.
   */
  viewportRef?: Ref<HTMLDivElement>
}

export function ScrollArea({
  children,
  className,
  orientation = 'vertical',
  viewportRef,
}: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn('overflow-hidden', className)}>
      <BaseScrollArea.Viewport ref={viewportRef} className="h-full w-full">
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>

      {(orientation === 'vertical' || orientation === 'both') && (
        <BaseScrollArea.Scrollbar
          orientation="vertical"
          className="border-outline-variant bg-surface-container flex w-2 touch-none border-l p-px"
        >
          <BaseScrollArea.Thumb className="bg-outline-variant hover:bg-outline w-full" />
        </BaseScrollArea.Scrollbar>
      )}

      {(orientation === 'horizontal' || orientation === 'both') && (
        <BaseScrollArea.Scrollbar
          orientation="horizontal"
          className="border-outline-variant bg-surface-container flex h-2 touch-none border-t p-px"
        >
          <BaseScrollArea.Thumb className="bg-outline-variant hover:bg-outline h-full" />
        </BaseScrollArea.Scrollbar>
      )}

      {orientation === 'both' && <BaseScrollArea.Corner className="bg-surface-container" />}
    </BaseScrollArea.Root>
  )
}
