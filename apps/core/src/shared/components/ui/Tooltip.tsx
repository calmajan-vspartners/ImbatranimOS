import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '../../../lib/cn'

type TooltipProps = {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  // base-ui's Trigger renders its own <button> unless `render` is given, so
  // the usual `<Tooltip><Button/></Tooltip>` emitted <button> inside <button>:
  // invalid HTML, and the outer button can swallow the inner one's clicks.
  // `render` merges the trigger's props into the child element instead of
  // wrapping it. Non-element children keep the old wrapper, which stays
  // focusable so the tooltip is still keyboard-reachable.
  const trigger = isValidElement(children) ? (
    <BaseTooltip.Trigger render={children as ReactElement} />
  ) : (
    <BaseTooltip.Trigger>{children}</BaseTooltip.Trigger>
  )

  return (
    <BaseTooltip.Provider delay={400}>
      <BaseTooltip.Root>
        {trigger}
        <BaseTooltip.Portal>
          {/* Above the window band and above dialogs (a tooltip can sit over a dialog). */}
          <BaseTooltip.Positioner side={side} sideOffset={4} className="z-[1100]">
            <BaseTooltip.Popup
              className={cn(
                'border-outline-variant bg-inverse-surface border px-2 py-1',
                'font-ui text-inverse-on-surface text-[11px]',
                'shadow-[0_6px_18px_rgba(0,0,0,0.4)]'
              )}
            >
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  )
}
