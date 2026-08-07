import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Columns2,
  FileDiff,
  FolderGit2,
  GitCommitVertical,
  History,
  Pencil,
  Undo2,
} from 'lucide-react'
import {
  Button,
  Input,
  ScrollArea,
  Select,
  cn,
  useConfirm,
  useFileDialog,
  usePrompt,
  useSystem,
} from '@imbatranim/ui'
import {
  amendCommit,
  applyPatch,
  commit as apiCommit,
  createBranch,
  discardPaths,
  fetchBranches,
  fetchDiff,
  fetchHeadContent,
  fetchLastMessage,
  fetchLog,
  fetchRecents,
  fetchStashes,
  fetchStatus,
  forgetRepo,
  rememberRepo,
  stagePaths,
  stashPop,
  stashPush,
  switchBranch,
  unstagePaths,
} from './api/gitApi'
import { GIT_ROOTS } from './types'
import type { BranchesResponse, GitCommit, GitStatusEntry, RecentRepo, StashEntry } from './types'
import { badgeCode, codeColor, codeLabel, partitionEntries } from './lib/statusFormat'
import { errorMessage } from './lib/errors'
import { DiffView } from './components/DiffView'
import { RecentRepos, RepoBar } from './components/RepoBar'

type Selection = { path: string; staged: boolean } | null
type RightTab = 'diff' | 'history'

export function GitGui({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  const [root, setRoot] = useState<string>('home')
  const [pathInput, setPathInput] = useState<string>('')
  const [repo, setRepo] = useState<{ root: string; path: string } | null>(null)
  const [recents, setRecents] = useState<RecentRepo[]>([])

  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<BranchesResponse | null>(null)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const [selection, setSelection] = useState<Selection>(null)
  const [diff, setDiff] = useState<string>('')
  /**
   * Kept apart from `diff` on purpose. Putting the message into `diff` meant
   * `DiffView` parsed it as a diff, found no files, and rendered "0 hunks" with an
   * empty body — so the backend's clear 413 ("output is too large… use the
   * Terminal") reached the user as a blank pane. Found by opening a 16 MB diff.
   */
  const [diffError, setDiffError] = useState<string | null>(null)
  const [tab, setTab] = useState<RightTab>('diff')
  const [sideBySide, setSideBySide] = useState<boolean>(true)

  const [message, setMessage] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const { confirm, confirmDialog } = useConfirm()
  const { prompt, promptDialog } = usePrompt()
  const { pickDirectory: chooseDirectory } = useFileDialog()

  const loadRecents = useCallback(() => {
    fetchRecents(system.http)
      .then((res) => setRecents(res.repos))
      .catch(() => setRecents([]))
  }, [system])

  useEffect(loadRecents, [loadRecents])

  const reload = useCallback(
    async (r: string, p: string): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const [status, log, branchState, stashState] = await Promise.all([
          fetchStatus(system.http, r, p),
          fetchLog(system.http, r, p),
          fetchBranches(system.http, r, p),
          fetchStashes(system.http, r, p),
        ])
        setEntries(status.entries)
        setCommits(log.commits)
        setBranches(branchState)
        setStashes(stashState.stashes)
        setChecked(new Set())
        return true
      } catch (err) {
        setError(errorMessage(err, 'Could not open repository'))
        setEntries([])
        setCommits([])
        setBranches(null)
        setStashes([])
        return false
      } finally {
        setBusy(false)
      }
    },
    [system]
  )

  const openRepo = useCallback(
    (r: string, p: string) => {
      setRepo({ root: r, path: p })
      setRoot(r)
      setPathInput(p)
      setSelection(null)
      setDiff('')
      void reload(r, p).then((ok) => {
        // Only remember a repo that actually opened; a failed open leaves the
        // recents list clean instead of accumulating dead entries.
        if (!ok) return
        return rememberRepo(system.http, r, p)
          .then(loadRecents)
          .catch(() => undefined)
      })
    },
    [reload, loadRecents, system]
  )

  // Load the diff whenever the selected file changes.
  useEffect(() => {
    if (!repo || !selection) return
    let cancelled = false
    fetchDiff(system.http, repo.root, repo.path, selection.staged, selection.path)
      .then((res) => {
        if (cancelled) return
        setDiff(res.diff)
        setDiffError(null)
      })
      .catch((err) => {
        // A diff past the 10 MB cap arrives as a 413 with a real message (brief 76,
        // item 7) — shown as an error, not fed to the diff parser.
        if (cancelled) return
        setDiff('')
        setDiffError(errorMessage(err, 'Could not load this diff'))
      })
    return () => {
      cancelled = true
    }
  }, [repo, selection, system])

  const refresh = useCallback(async () => {
    if (!repo) return
    await reload(repo.root, repo.path)
    if (selection) {
      const res = await fetchDiff(
        system.http,
        repo.root,
        repo.path,
        selection.staged,
        selection.path
      )
        .then((r) => {
          setDiffError(null)
          return r
        })
        .catch((err) => {
          setDiffError(errorMessage(err, 'Could not load this diff'))
          return { diff: '' }
        })
      setDiff(res.diff)
    }
  }, [repo, reload, selection, system])

  /** One wrapper for every mutating action: busy, error, refresh, notify. */
  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (!repo) return
      setBusy(true)
      setError(null)
      try {
        await fn()
        await reload(repo.root, repo.path)
      } catch (err) {
        const msg = errorMessage(err, `${label} failed`)
        setError(msg)
        system.notify({ level: 'error', title: `${label} failed`, body: msg })
      } finally {
        setBusy(false)
      }
    },
    [repo, reload, system]
  )

  const toggleCheck = useCallback((key: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const { staged, unstaged } = partitionEntries(entries)
  const checkedIn = (list: GitStatusEntry[], prefix: string) =>
    list.map((e) => `${prefix}:${e.path}`).filter((k) => checked.has(k))
  const selectedUnstaged = checkedIn(unstaged, 'u').map((k) => k.slice(2))
  const selectedStaged = checkedIn(staged, 's').map((k) => k.slice(2))

  // -------------------------------------------------------------------------
  // actions
  // -------------------------------------------------------------------------
  const doStage = (paths: string[], stage: boolean) =>
    void run(stage ? 'Stage' : 'Unstage', async () => {
      if (!repo || paths.length === 0) return
      if (stage) await stagePaths(system.http, repo.root, repo.path, paths)
      else await unstagePaths(system.http, repo.root, repo.path, paths)
    })

  const doDiscard = (paths: string[]) => {
    void (async () => {
      if (!repo || paths.length === 0) return
      // Destructive and irreversible: name exactly what is about to be lost.
      const ok = await confirm({
        title: 'Discard changes',
        message:
          paths.length === 1
            ? `Throw away your changes to ${paths[0]}? This cannot be undone.`
            : `Throw away your changes to these ${paths.length} files? This cannot be undone.\n\n${paths.join('\n')}`,
        confirmLabel: 'Discard',
        destructive: true,
      })
      if (!ok) return
      await run('Discard', async () => {
        await discardPaths(system.http, repo.root, repo.path, paths)
        system.notify({
          level: 'success',
          title: 'Changes discarded',
          body: `${paths.length} file${paths.length === 1 ? '' : 's'} restored from HEAD.`,
        })
      })
    })()
  }

  /**
   * Open the selected file side by side against HEAD in the Diff tool
   * (brief 114).
   *
   * The left side is the committed blob — text, not a file, so it rides the
   * intent rather than a path. The right side is the working-tree file itself,
   * which is what makes the Diff tool's editable right pane useful here: see
   * what changed and fix it in place. A file with no blob at HEAD compares
   * against an empty left side, labelled as new.
   */
  const doCompareWithHead = () => {
    void (async () => {
      if (!repo || !selection) return
      await run('Compare with HEAD', async () => {
        const head = await fetchHeadContent(system.http, repo.root, repo.path, selection.path)
        const label = `${selection.path} @ ${head.exists ? 'HEAD' : 'HEAD (new file)'}`
        system.intents.openApp('diff', {
          leftText: head.content,
          leftLabel: label,
          rightRoot: repo.root,
          // The Diff tool reads from the ROOT, so the path it needs is the
          // repo's own path joined with the file's repo-relative one.
          rightPath: repo.path ? `${repo.path}/${selection.path}` : selection.path,
        })
      })
    })()
  }

  const doSwitch = (name: string) => {
    void (async () => {
      if (!repo) return
      if (branches?.dirty) {
        // The dirty-tree warning the brief asks for. Git decides whether the switch
        // is actually safe; this makes sure the user is not surprised by either
        // outcome. See switchBranch on the backend for why there is no hard block.
        const ok = await confirm({
          title: `Switch to ${name}?`,
          message:
            'You have uncommitted changes. Git will carry them across if it can, and refuse the switch if it cannot. Stash first if you would rather set them aside.',
          confirmLabel: 'Switch',
        })
        if (!ok) return
      }
      await run('Switch', async () => {
        await switchBranch(system.http, repo.root, repo.path, name)
        setSelection(null)
        setDiff('')
        system.notify({ level: 'success', title: `On ${name}` })
      })
    })()
  }

  const doCreateBranch = () => {
    void (async () => {
      if (!repo) return
      const name = await prompt({
        title: 'New branch',
        message: 'Branch name — letters, digits and - _ / . are allowed',
        confirmLabel: 'Create',
      })
      if (name === null) return
      await run('Create branch', async () => {
        await createBranch(system.http, repo.root, repo.path, name)
        system.notify({ level: 'success', title: `Created ${name}` })
      })
    })()
  }

  const doStash = () => {
    void (async () => {
      if (!repo) return
      const label = await prompt({
        title: 'Stash changes',
        message: 'An optional label, so you can tell your stashes apart',
        confirmLabel: 'Stash',
      })
      if (label === null) return
      await run('Stash', async () => {
        await stashPush(system.http, repo.root, repo.path, label || undefined)
        setSelection(null)
        setDiff('')
        system.notify({ level: 'success', title: 'Changes stashed' })
      })
    })()
  }

  const doStashPop = () =>
    void run('Pop stash', async () => {
      if (!repo) return
      await stashPop(system.http, repo.root, repo.path)
      system.notify({ level: 'success', title: 'Stash restored' })
    })

  const doCommit = () =>
    void run('Commit', async () => {
      if (!repo || message.trim().length === 0) return
      await apiCommit(system.http, repo.root, repo.path, message.trim())
      setMessage('')
      setTab('history')
      system.notify({ level: 'success', title: 'Committed' })
    })

  const doAmend = () => {
    void (async () => {
      if (!repo) return
      const previous = await fetchLastMessage(system.http, repo.root, repo.path).catch(() => '')
      if (!previous) {
        system.notify({
          level: 'info',
          title: 'Nothing to amend',
          body: 'There is no commit yet.',
        })
        return
      }
      const next = await prompt({
        title: 'Amend the last commit',
        message: 'This replaces the previous commit rather than adding one.',
        initialValue: message.trim() || previous,
        confirmLabel: 'Amend',
      })
      if (next === null) return
      await run('Amend', async () => {
        await amendCommit(system.http, repo.root, repo.path, next)
        setMessage('')
        setTab('history')
        system.notify({ level: 'success', title: 'Commit amended' })
      })
    })()
  }

  const doApplyHunk = (patch: string, reverse: boolean) =>
    void run(reverse ? 'Unstage hunk' : 'Stage hunk', async () => {
      if (!repo) return
      await applyPatch(system.http, repo.root, repo.path, patch, reverse)
      const res = await fetchDiff(
        system.http,
        repo.root,
        repo.path,
        selection?.staged ?? false,
        selection?.path
      ).catch(() => ({ diff: '' }))
      setDiff(res.diff)
    })

  const pickDirectory = () => {
    void (async () => {
      const choice = await chooseDirectory({ title: 'Choose a repository' })
      if (!choice) return
      openRepo(choice.root, choice.path)
    })()
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  if (!repo) {
    return (
      <div className="bg-surface text-on-surface flex h-full flex-col">
        <div className="border-outline-variant flex items-end gap-2 border-b px-3 py-2">
          <div className="w-28">
            <Select
              label="Root"
              value={root}
              onValueChange={(v) => setRoot(String(v))}
              options={GIT_ROOTS.map((r) => ({ value: r.id, label: r.label }))}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Repository path"
              placeholder="e.g. projects/my-repo"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openRepo(root, pathInput.trim())
              }}
            />
          </div>
          <Button variant="default" onClick={pickDirectory} title="Browse for a repository">
            Browse…
          </Button>
          <Button
            variant="primary"
            onClick={() => openRepo(root, pathInput.trim())}
            disabled={busy}
          >
            <FolderGit2 size={13} /> Open
          </Button>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="text-on-surface-variant flex flex-1 flex-col items-center justify-center gap-4 px-6">
          <FolderGit2 size={40} strokeWidth={1} />
          <p className="font-ui text-center text-[12px]">
            Open a repository to see its status, branches and history.
          </p>
          <RecentRepos
            repos={recents}
            onOpen={(r) => openRepo(r.root, r.path)}
            onForget={(r) => void forgetRepo(system.http, r.root, r.path).then(loadRecents)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface text-on-surface flex h-full flex-col">
      <RepoBar
        branches={branches}
        stashes={stashes}
        busy={busy}
        repoLabel={repo.path || GIT_ROOTS.find((r) => r.id === repo.root)?.label || repo.root}
        onSwitch={doSwitch}
        onCreateBranch={doCreateBranch}
        onStash={doStash}
        onStashPop={doStashPop}
        onRefresh={() => void refresh()}
        onCloseRepo={() => {
          setRepo(null)
          setError(null)
          loadRecents()
        }}
      />

      {error && <ErrorBanner message={error} />}

      <div className="flex min-h-0 flex-1">
        <div className="border-outline-variant flex min-h-0 w-[42%] flex-col border-r">
          <ChangeSection
            title="Staged changes"
            prefix="s"
            entries={staged}
            checked={checked}
            selection={selection}
            staged
            onToggle={toggleCheck}
            onSelect={(path) => {
              setSelection({ path, staged: true })
              setTab('diff')
            }}
          />
          <div className="border-outline-variant flex shrink-0 flex-wrap gap-1 border-t px-2 py-1">
            <Button
              size="sm"
              variant="default"
              disabled={busy || selectedStaged.length === 0}
              onClick={() => doStage(selectedStaged, false)}
            >
              Unstage ({selectedStaged.length})
            </Button>
          </div>

          <ChangeSection
            title="Changes"
            prefix="u"
            entries={unstaged}
            checked={checked}
            selection={selection}
            staged={false}
            onToggle={toggleCheck}
            onSelect={(path) => {
              setSelection({ path, staged: false })
              setTab('diff')
            }}
          />
          <div className="border-outline-variant flex shrink-0 flex-wrap gap-1 border-t px-2 py-1">
            <Button
              size="sm"
              variant="default"
              disabled={busy || selectedUnstaged.length === 0}
              onClick={() => doStage(selectedUnstaged, true)}
            >
              Stage ({selectedUnstaged.length})
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="gap-1"
              disabled={busy || selectedUnstaged.length === 0}
              onClick={() => doDiscard(selectedUnstaged)}
              title="Restore these files from HEAD"
            >
              <Undo2 size={11} strokeWidth={2} />
              Discard ({selectedUnstaged.length})
            </Button>
          </div>

          <div className="border-outline-variant mt-auto flex shrink-0 flex-col gap-1.5 border-t p-2">
            <textarea
              className={cn(
                'border-outline-variant bg-surface-container-lowest text-on-surface min-h-[48px] w-full resize-none border px-2 py-1.5',
                'font-content text-[13px] outline-none',
                'placeholder:text-on-surface-variant',
                'focus:border-primary focus:ring-primary/40 focus:ring-2'
              )}
              placeholder="Commit message"
              aria-label="Commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex gap-1">
              <Button
                variant="primary"
                size="sm"
                className="flex-1 gap-1"
                disabled={busy || message.trim().length === 0 || staged.length === 0}
                onClick={doCommit}
              >
                <GitCommitVertical size={13} /> Commit{staged.length > 0 && ` (${staged.length})`}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1"
                disabled={busy || commits.length === 0}
                onClick={doAmend}
                title="Replace the last commit"
              >
                <Pencil size={12} strokeWidth={2} /> Amend
              </Button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-outline-variant flex shrink-0 border-b">
            <TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
              <FileDiff size={13} /> Diff
            </TabButton>
            <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
              <History size={13} /> History
            </TabButton>
            <div className="flex-1" />
            {tab === 'diff' && selection !== null && (
              <Button
                size="sm"
                variant="ghost"
                className="my-0.5 mr-1 gap-1"
                disabled={busy}
                onClick={doCompareWithHead}
                title="Open this file side by side against HEAD, in the Diff tool"
              >
                <Columns2 size={12} />
                Compare with HEAD
              </Button>
            )}
          </div>

          {tab === 'history' ? (
            <LogPane commits={commits} />
          ) : selection === null ? (
            <div className="text-on-surface-variant flex flex-1 items-center justify-center text-[12px]">
              Select a file to view its diff
            </div>
          ) : diffError !== null ? (
            <div className="text-on-surface-variant flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle size={24} strokeWidth={1.5} />
              <span className="font-ui text-[12px]">{diffError}</span>
            </div>
          ) : (
            <DiffView
              diff={diff}
              staged={selection.staged}
              sideBySide={sideBySide}
              onToggleLayout={() => setSideBySide((v) => !v)}
              onApplyHunk={doApplyHunk}
              busy={busy}
            />
          )}
        </div>
      </div>

      {confirmDialog}
      {promptDialog}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-error-container text-on-error-container flex shrink-0 items-center gap-2 px-3 py-1.5 text-[12px]">
      <AlertTriangle size={13} className="shrink-0" /> {message}
    </div>
  )
}

function ChangeSection({
  title,
  prefix,
  entries,
  checked,
  selection,
  staged,
  onToggle,
  onSelect,
}: {
  title: string
  prefix: string
  entries: GitStatusEntry[]
  checked: Set<string>
  selection: Selection
  staged: boolean
  onToggle: (key: string) => void
  onSelect: (path: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="text-on-surface-variant font-ui bg-surface-container-low shrink-0 px-2 py-1 text-[11px] font-semibold tracking-wider uppercase">
        {title} ({entries.length})
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <div className="text-on-surface-variant px-2 py-2 text-[12px]">Nothing here</div>
        ) : (
          <ul>
            {entries.map((e) => {
              const key = `${prefix}:${e.path}`
              const code = badgeCode(e)
              const active = selection?.path === e.path && selection.staged === staged
              return (
                <li
                  key={key}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1',
                    'hover:bg-surface-container-high',
                    active && 'bg-primary-container text-on-primary-container'
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary shrink-0 cursor-pointer"
                    checked={checked.has(key)}
                    aria-label={`Select ${e.path}`}
                    onChange={() => onToggle(key)}
                  />
                  <button
                    type="button"
                    className="focus-visible:ring-primary flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                    onClick={() => onSelect(e.path)}
                  >
                    <span
                      className={cn(
                        'w-4 shrink-0 text-center font-mono text-[12px] font-bold',
                        codeColor(code)
                      )}
                      title={codeLabel(code)}
                    >
                      {code}
                    </span>
                    <span className="font-content truncate text-[13px]">{e.path}</span>
                    {e.origPath && (
                      <span className="text-on-surface-variant truncate text-[11px]">
                        ← {e.origPath}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-ui flex items-center gap-1.5 px-3 py-1.5 text-[12px]',
        'cursor-pointer border-b-2 transition-colors',
        'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
        active
          ? 'border-primary text-on-surface'
          : 'text-on-surface-variant hover:text-on-surface border-transparent'
      )}
    >
      {children}
    </button>
  )
}

function LogPane({ commits }: { commits: GitCommit[] }) {
  if (commits.length === 0) {
    return (
      <div className="text-on-surface-variant flex flex-1 items-center justify-center text-[12px]">
        No commits yet
      </div>
    )
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="divide-outline-variant/50 divide-y">
        {commits.map((c) => (
          <li key={c.hash} className="px-3 py-2">
            <div className="font-content text-on-surface text-[13px]">{c.subject}</div>
            <div className="text-on-surface-variant font-ui mt-0.5 flex items-center gap-2 text-[11px]">
              <span className="font-mono">{c.hash.slice(0, 7)}</span>
              <span>{c.authorName}</span>
              <span>{formatDate(c.date)}</span>
            </div>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
