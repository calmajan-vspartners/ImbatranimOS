import { Archive, ArchiveRestore, GitBranch, Plus, RefreshCw, X } from 'lucide-react'
import { Button, Select, cn } from '@imbatranim/ui'
import type { BranchesResponse, RecentRepo, StashEntry } from '../types'

/**
 * The toolbar: which repo, which branch, and the stash.
 *
 * Branch selection is a `Select` rather than a text field on purpose — a branch
 * name typed by hand is the input the backend's `assertRefName` exists to refuse,
 * and offering a list means the ordinary path never produces one.
 */
export function RepoBar({
  branches,
  stashes,
  busy,
  onSwitch,
  onCreateBranch,
  onStash,
  onStashPop,
  onRefresh,
  repoLabel,
  onCloseRepo,
}: {
  branches: BranchesResponse | null
  stashes: StashEntry[]
  busy: boolean
  onSwitch: (name: string) => void
  onCreateBranch: () => void
  onStash: () => void
  onStashPop: () => void
  onRefresh: () => void
  repoLabel: string
  onCloseRepo: () => void
}) {
  return (
    <div className="border-outline-variant bg-surface-container-low flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1">
      <span className="font-ui text-on-surface max-w-[30%] truncate text-[12px] font-semibold">
        {repoLabel}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCloseRepo}
        aria-label="Close repository"
        title="Close repository"
      >
        <X size={11} strokeWidth={2} />
      </Button>

      <div className="bg-outline-variant mx-0.5 h-4 w-px" />

      <GitBranch size={12} strokeWidth={2} className="text-on-surface-variant shrink-0" />
      {branches === null ? (
        <span className="font-ui text-on-surface-variant text-[11px]">…</span>
      ) : branches.detached ? (
        // A detached HEAD is a real state and must not be shown as a branch.
        <span className="font-ui text-on-surface-variant text-[11px]" title="HEAD is detached">
          detached HEAD
        </span>
      ) : (
        <div className="min-w-[9rem]">
          <Select
            options={branches.branches.map((b) => ({ value: b.name, label: b.name }))}
            value={branches.current ?? ''}
            onValueChange={(v) => {
              const name = String(v)
              if (name && name !== branches.current) onSwitch(name)
            }}
            placeholder="branch"
          />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onCreateBranch}
        disabled={busy}
        aria-label="New branch"
        title="New branch from here"
      >
        <Plus size={12} strokeWidth={2} />
      </Button>
      {branches?.dirty && (
        <span
          className="font-ui text-on-surface-variant text-[11px]"
          title="There are uncommitted changes"
        >
          uncommitted changes
        </span>
      )}

      <div className="bg-outline-variant mx-0.5 h-4 w-px" />

      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={onStash}
        disabled={busy || !branches?.dirty}
        title={branches?.dirty ? 'Stash all changes' : 'Nothing to stash'}
      >
        <Archive size={12} strokeWidth={2} />
        Stash
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        onClick={onStashPop}
        disabled={busy || stashes.length === 0}
        title={stashes.length > 0 ? `Pop “${stashes[0].label}”` : 'No stashes'}
      >
        <ArchiveRestore size={12} strokeWidth={2} />
        Pop{stashes.length > 0 ? ` (${stashes.length})` : ''}
      </Button>

      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={busy}
        aria-label="Refresh"
        title="Refresh"
      >
        <RefreshCw size={12} strokeWidth={2} className={cn(busy && 'animate-spin')} />
      </Button>
    </div>
  )
}

/** The recents list on the open screen — the brief's repo picker. */
export function RecentRepos({
  repos,
  onOpen,
  onForget,
}: {
  repos: RecentRepo[]
  onOpen: (repo: RecentRepo) => void
  onForget: (repo: RecentRepo) => void
}) {
  if (repos.length === 0) return null
  return (
    <div className="w-full max-w-md">
      <div className="font-ui text-on-surface-variant mb-1 text-[11px] font-semibold tracking-wider uppercase">
        Recent
      </div>
      <div className="border-outline-variant border">
        {repos.map((repo) => (
          <div
            key={`${repo.root}:${repo.path}`}
            className="group/row border-outline-variant hover:bg-surface-container-low flex items-center border-b last:border-b-0"
          >
            <button
              type="button"
              onClick={() => onOpen(repo)}
              className="focus-visible:ring-primary flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="font-content text-on-surface truncate text-[12px]">
                {repo.path || '(root)'}
              </span>
              <span className="font-ui text-on-surface-variant shrink-0 text-[11px]">
                {repo.root}
              </span>
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onForget(repo)}
              aria-label={`Forget ${repo.path || repo.root}`}
              title="Remove from this list"
              className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
            >
              <X size={11} strokeWidth={2} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
