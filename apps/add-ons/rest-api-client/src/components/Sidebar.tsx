import { ScrollArea, cn } from '@imbatranim/core'
import { Clock, Folder, Trash2 } from 'lucide-react'
import type { HistoryEntry, RestClientData, SavedRequest } from '../types'
import { statusToken } from '../lib/ui'

interface SidebarProps {
  data: RestClientData
  onOpenSaved: (req: SavedRequest) => void
  onDeleteSaved: (id: string) => void
  onOpenHistory: (entry: HistoryEntry) => void
  onClearHistory: () => void
}

export function Sidebar({
  data,
  onOpenSaved,
  onDeleteSaved,
  onOpenHistory,
  onClearHistory,
}: SidebarProps) {
  return (
    <aside className="border-outline-variant bg-surface-container-low flex w-56 shrink-0 flex-col border-r">
      <ScrollArea className="min-h-0 flex-1">
        <Section icon="folder" label="Collections">
          {data.collections.length === 0 ? (
            <Empty>No saved requests</Empty>
          ) : (
            data.collections.map((req) => (
              <div key={req.id} className="group flex items-center gap-1 pr-1">
                <button
                  type="button"
                  onClick={() => onOpenSaved(req)}
                  className="hover:bg-surface-container flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left outline-none"
                >
                  <span className="text-secondary shrink-0 font-mono text-[10px] font-semibold">
                    {req.method}
                  </span>
                  <span className="text-on-surface truncate text-[12px]">
                    {req.name || req.url}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSaved(req.id)}
                  title="Delete"
                  className="text-on-surface-variant hover:text-error shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </Section>

        <Section
          icon="clock"
          label="History"
          action={
            data.history.length > 0 ? (
              <button
                type="button"
                onClick={onClearHistory}
                className="text-on-surface-variant hover:text-error font-ui text-[10px]"
                title="Clear history"
              >
                Clear
              </button>
            ) : null
          }
        >
          {data.history.length === 0 ? (
            <Empty>Nothing sent yet</Empty>
          ) : (
            data.history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenHistory(entry)}
                className="hover:bg-surface-container flex w-full items-center gap-1.5 px-2 py-1 text-left outline-none"
              >
                <span
                  className={cn(
                    'shrink-0 font-mono text-[10px] font-semibold',
                    statusToken(entry.status)
                  )}
                >
                  {entry.status || '—'}
                </span>
                <span className="text-secondary shrink-0 font-mono text-[10px]">
                  {entry.method}
                </span>
                <span className="text-on-surface-variant min-w-0 flex-1 truncate text-[11px]">
                  {entry.url}
                </span>
                {entry.elapsedMs !== undefined && (
                  <span className="text-on-surface-variant shrink-0 font-mono text-[10px]">
                    {entry.elapsedMs}ms
                  </span>
                )}
              </button>
            ))
          )}
        </Section>
      </ScrollArea>
    </aside>
  )
}

function Section({
  icon,
  label,
  action,
  children,
}: {
  icon: 'folder' | 'clock'
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="text-on-surface-variant font-ui flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
        {icon === 'folder' ? <Folder size={12} /> : <Clock size={12} />}
        {label}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-on-surface-variant px-2 py-1 text-[11px] italic">{children}</p>
}
