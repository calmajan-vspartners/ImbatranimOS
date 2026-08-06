/**
 * A compact icon control used across the reader console. Wraps the OS `Button`
 * (ghost / primary) with a `Tooltip`, so every toolbar affordance stays in the
 * OS design language. `icon` is a lucide-react component.
 */
import type { ComponentType, JSX } from 'react'
import { Button, Tooltip } from '@imbatranim/ui'

export interface ToolButtonProps {
  icon: ComponentType<{ size?: number }>
  label: string
  active?: boolean
  disabled?: boolean
  iconSize?: number
  onClick?: () => void
}

export function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  iconSize = 15,
  onClick,
}: ToolButtonProps): JSX.Element {
  return (
    <Tooltip content={label}>
      <Button
        variant={active ? 'primary' : 'ghost'}
        size="sm"
        className="h-7 w-7 justify-center p-0"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      >
        <Icon size={iconSize} />
      </Button>
    </Tooltip>
  )
}
