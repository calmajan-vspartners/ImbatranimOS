/**
 * @imbatranim/ui — the app SDK (brief 48).
 *
 * The library half of the old `@imbatranim/core` barrel, split by one objective
 * rule: **can it travel over postMessage?** Nothing in here can — it is
 * components, render hooks and pure functions, linked into the app bundle the
 * way GTK or libc is linked into a process. Anything that *is* a data call or an
 * effect on the OS (files, HTTP, windows, intents, notifications) is a
 * capability on the injected `system` handle instead — see `./system` for the
 * protocol, which this package also owns.
 *
 * The dependency rule is absolute and enforced by eslint: this package imports
 * NOTHING from `@imbatranim/core`. The OS depends on the SDK, never the other
 * way around.
 */

// Styling helper
export { cn } from './cn'

// UI kit
export { Button } from './components/Button'
export { Checkbox } from './components/Checkbox'
export { Dialog } from './components/Dialog'
export { Input } from './components/Input'
export { ScrollArea } from './components/ScrollArea'
export { Select } from './components/Select'
export { Separator } from './components/Separator'
export { Tooltip } from './components/Tooltip'
export { ConfirmDialog, useConfirm } from './components/ConfirmDialog'
export { PromptDialog, usePrompt } from './components/PromptDialog'

// Pure hooks
export { useVirtualList } from './hooks/useVirtualList'
export type { VirtualList } from './hooks/useVirtualList'
export { useElementSize, type ElementSize, type ElementSizeRef } from './hooks/useElementSize'

// Pure utilities
export { installMapGetOrInsert } from './lib/mapGetOrInsert'
export { isTextEntry } from './lib/textEntry'
export { fileName, UploadTooLargeError } from './lib/files'
export { describeFileFailure, type FileFailureOptions } from './lib/fileFailureText'

// Backend log contract (pure types + a pure projection)
export { toSignIns } from './lib/systemLog'
export type { LogEntry, LogLevel, LogSource, SignIn } from './lib/systemLog'

// The shared react-query client. A library concern, not a capability: in a
// future sandboxed world each app bundles its own; in-process everyone shares
// this one, exactly as before the split.
export { queryClient } from './queryClient'

// ── The protocol (brief 48) ──────────────────────────────────────────────────
// `system.ts` is the spec; the provider/context pair is how the compositor
// injects a handle and how apps + SDK hooks reach it.
export { PROTOCOL_VERSION } from './system'
export type {
  FileChoice,
  OpenerCandidate,
  OpenerResolution,
  PickOpenOptions,
  PickSaveOptions,
  ScheduleDomain,
  ShortcutBinding,
  ShortcutDoc,
  ShortcutScope,
  SystemAppearance,
  SystemAppearanceState,
  SystemEvent,
  SystemEventMap,
  SystemFs,
  SystemHandle,
  SystemHttp,
  SystemHttpRequestConfig,
  SystemHttpResponse,
  SystemIntents,
  SystemNotifyInput,
  SystemNotifyLevel,
  SystemSchedule,
  SystemShortcuts,
  SystemWindow,
} from './system'
export { SystemProvider, useSystem } from './systemContext'

// Capability-consuming SDK hooks — the old core hooks, re-homed onto the
// handle. No windowId arguments: the handle already knows its window.
export {
  reportFileFailure,
  reportFileRefusal,
  useDocumentedShortcuts,
  useRegisteredHotkeys,
  useSaveHotkey,
  useSystemAppearance,
  useTopWindowKeydown,
  useUnsavedGuard,
  useWindowVisible,
  type TopWindowKeydownOptions,
} from './hooks/systemHooks'
export {
  useFileDialog,
  useOpenIntent,
  resetOpenedFilesForTest,
  type OpenedFile,
} from './hooks/openIntent'
