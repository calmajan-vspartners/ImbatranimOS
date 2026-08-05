import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Strikethrough,
  Table,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { Tooltip, cn } from '@imbatranim/core'
import { FORMAT_HINTS, type FormatKind } from '../lib/formatActions'

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

/**
 * Icons live here as data rather than JSX so the row is one `map`, and each icon is
 * referenced in JSX rather than invoked as a value — the same rule `viewMode.ts` follows.
 */
const GROUPS: { kind: FormatKind; icon: IconType; label: string }[][] = [
  [
    { kind: 'bold', icon: Bold, label: 'Bold' },
    { kind: 'italic', icon: Italic, label: 'Italic' },
    { kind: 'strike', icon: Strikethrough, label: 'Strikethrough' },
    { kind: 'code', icon: Code, label: 'Inline code' },
    { kind: 'fence', icon: Braces, label: 'Code block' },
  ],
  [
    { kind: 'h1', icon: Heading1, label: 'Heading 1' },
    { kind: 'h2', icon: Heading2, label: 'Heading 2' },
    { kind: 'h3', icon: Heading3, label: 'Heading 3' },
  ],
  [
    { kind: 'bullet', icon: List, label: 'Bullet list' },
    { kind: 'ordered', icon: ListOrdered, label: 'Numbered list' },
    { kind: 'task', icon: ListTodo, label: 'Task list' },
    { kind: 'quote', icon: Quote, label: 'Quote' },
  ],
  [
    { kind: 'link', icon: LinkIcon, label: 'Link' },
    { kind: 'table', icon: Table, label: 'Table' },
  ],
]

/**
 * The formatting row.
 *
 * Rendered only when the editor pane is visible: in preview-only mode every button here
 * would act on a textarea the user cannot see, which is a worse outcome than the button
 * being absent.
 *
 * `onMouseDown` with `preventDefault`, not `onClick`: clicking a button blurs the
 * textarea and destroys the selection before the handler runs, so bolding the selected
 * word would bold nothing at all. Preventing the default keeps focus — and the
 * selection — exactly where it was.
 */
export function FormatToolbar({
  onApply,
  onInsertImage,
  imageBusy,
  disabled,
}: {
  onApply: (kind: FormatKind) => void
  onInsertImage: () => void
  imageBusy: boolean
  disabled: boolean
}) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 py-0.5">
      {GROUPS.map((group, index) => (
        <div key={group[0].kind} className="flex items-center gap-0.5">
          {index > 0 && <span className="bg-outline-variant mx-1 h-4 w-px shrink-0" />}
          {group.map(({ kind, icon: Icon, label }) => (
            <Tooltip
              key={kind}
              content={FORMAT_HINTS[kind] ? `${label} (${FORMAT_HINTS[kind]})` : label}
            >
              <button
                type="button"
                aria-label={label}
                disabled={disabled}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onApply(kind)
                }}
                className={cn(
                  'text-on-surface flex h-6 w-6 shrink-0 items-center justify-center',
                  'hover:bg-surface-container-high disabled:opacity-40'
                )}
              >
                <Icon size={13} />
              </button>
            </Tooltip>
          ))}
        </div>
      ))}

      <span className="bg-outline-variant mx-1 h-4 w-px shrink-0" />
      <Tooltip content="Insert an image from this machine — or just paste or drop one">
        <button
          type="button"
          aria-label="Insert image"
          disabled={disabled || imageBusy}
          onMouseDown={(event) => {
            event.preventDefault()
            onInsertImage()
          }}
          className={cn(
            'text-on-surface flex h-6 w-6 shrink-0 items-center justify-center',
            'hover:bg-surface-container-high disabled:opacity-40'
          )}
        >
          <ImageIcon size={13} className={imageBusy ? 'animate-pulse' : undefined} />
        </button>
      </Tooltip>
    </div>
  )
}
