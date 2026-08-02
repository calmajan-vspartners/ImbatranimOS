import { Button, Dialog, ScrollArea, useConfirm } from '@imbatranim/core'
import { Folder, FileText, RotateCcw, Trash2 } from 'lucide-react'
import {
  useDeleteFromTrashMutation,
  useEmptyTrashMutation,
  useRestoreTrashMutation,
  useTrashQuery,
} from '../queries/filesQueries'

type TrashDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  root: string
  currentPath: string
  onRestored: (path: string) => void
  onError: (message: string) => void
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function TrashDialog({
  open,
  onOpenChange,
  root,
  currentPath,
  onRestored,
  onError,
}: TrashDialogProps) {
  const { data: entries = [], isLoading } = useTrashQuery(open)
  const restore = useRestoreTrashMutation(root, currentPath)
  const removeOne = useDeleteFromTrashMutation()
  const empty = useEmptyTrashMutation()
  const { confirm, confirmDialog } = useConfirm()

  async function handleRestore(id: string) {
    try {
      const { path } = await restore.mutateAsync(id)
      onRestored(path)
    } catch {
      onError('Could not restore that item.')
    }
  }

  async function handleRemove(id: string, name: string) {
    const ok = await confirm({
      title: 'Delete permanently?',
      message: `"${name}" will be gone for good. This cannot be undone.`,
      destructive: true,
    })
    if (!ok) return
    try {
      await removeOne.mutateAsync(id)
    } catch {
      onError('Could not delete that item.')
    }
  }

  async function handleEmpty() {
    const ok = await confirm({
      title: 'Empty the Trash?',
      message: `All ${entries.length} item${entries.length !== 1 ? 's' : ''} will be gone for good. This cannot be undone.`,
      destructive: true,
    })
    if (!ok) return
    try {
      await empty.mutateAsync()
    } catch {
      onError('Could not empty the Trash.')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Trash">
        <div className="flex h-[320px] w-[520px] flex-col">
          <div className="border-outline-variant bg-surface-container-low flex flex-none items-center justify-between border-b px-2 py-1">
            <span className="font-ui text-on-surface-variant text-[11px]">
              {entries.length} item{entries.length !== 1 ? 's' : ''}
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEmpty}
              disabled={entries.length === 0 || empty.isPending}
            >
              Empty Trash
            </Button>
          </div>

          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full w-full">
              {isLoading ? (
                <div className="text-on-surface-variant font-ui p-4 text-center text-[12px]">
                  Loading…
                </div>
              ) : entries.length === 0 ? (
                <div className="text-on-surface-variant flex flex-col items-center justify-center gap-2 py-12">
                  <Trash2 size={32} strokeWidth={1} />
                  <span className="font-ui text-[12px]">The Trash is empty</span>
                </div>
              ) : (
                entries.map((e) => (
                  <div
                    key={e.id}
                    className="border-outline-variant hover:bg-surface-container-low flex items-center gap-2 border-b px-2 py-1"
                  >
                    {e.isDirectory ? (
                      <Folder size={12} strokeWidth={1.5} className="shrink-0" />
                    ) : (
                      <FileText size={12} strokeWidth={1.5} className="shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-ui text-on-surface truncate text-[12px]">{e.name}</div>
                      <div className="font-ui text-on-surface-variant truncate text-[11px]">
                        {e.originalPath} · {formatWhen(e.deletedAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-5 shrink-0 gap-1 px-1.5"
                      title={`Restore to ${e.originalPath}`}
                      onClick={() => void handleRestore(e.id)}
                      disabled={restore.isPending}
                    >
                      <RotateCcw size={11} />
                      Restore
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-5 w-5 shrink-0 p-0"
                      aria-label={`Delete ${e.name} permanently`}
                      title="Delete permanently"
                      onClick={() => void handleRemove(e.id, e.name)}
                      disabled={removeOne.isPending}
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  )
}
