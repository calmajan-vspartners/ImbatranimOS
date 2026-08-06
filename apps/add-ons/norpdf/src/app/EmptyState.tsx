/** The welcome screen shown before a document is open. */
import type { JSX } from 'react'
import { FilePen, FolderOpen, Search, List, TextCursorInput, Loader2 } from 'lucide-react'
import { Button } from '@imbatranim/ui'

export interface EmptyStateProps {
  onOpenClick: () => void
  error: string | null
  loading: boolean
}

export function EmptyState({ onOpenClick, error, loading }: EmptyStateProps): JSX.Element {
  return (
    <div className="bg-surface-container-lowest flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-4">
        <div className="border-outline-variant text-primary flex h-14 w-14 items-center justify-center border">
          <FilePen size={28} strokeWidth={1.5} />
        </div>
        <h1 className="text-on-surface font-ui text-lg font-semibold">norPDF</h1>
        <p className="text-on-surface-variant font-content text-[13px] leading-relaxed">
          A reading room for your PDFs. Open a file to read, search, navigate and (soon) mark it up
          — everything runs on-device.
        </p>

        <Button
          variant="primary"
          size="md"
          className="mt-1 flex items-center gap-1.5"
          onClick={onOpenClick}
          disabled={loading}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          {loading ? 'Opening…' : 'Open a PDF'}
        </Button>
        <p className="text-on-surface-variant text-[11px]">
          or drop a file anywhere on this window
        </p>

        {error && <p className="text-error font-ui max-w-sm text-[12px]">{error}</p>}

        <ul className="text-on-surface-variant mt-2 flex flex-col gap-2 text-[12px]">
          <li className="flex items-center gap-2">
            <Search size={14} className="text-on-surface-variant" />
            <span>Full-text search with jump-to-match</span>
          </li>
          <li className="flex items-center gap-2">
            <List size={14} className="text-on-surface-variant" />
            <span>Thumbnails &amp; outline navigation</span>
          </li>
          <li className="flex items-center gap-2">
            <TextCursorInput size={14} className="text-on-surface-variant" />
            <span>Selectable, copyable text</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
