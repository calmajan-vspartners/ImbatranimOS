/**
 * @imbatranim/core — the public surface add-ons may import.
 *
 * Everything an add-on needs crosses this barrel; deep imports into core
 * internals are forbidden (enforced by eslint no-restricted-imports in the
 * add-on packages). Keep this surface deliberate: adding an export here is
 * an API decision, not a convenience.
 */

// Add-on contract
export type { AppConfig, AddonManifest } from './contract'
export type { CommandSource, CommandItem } from './shared/commands/CommandSourcesRegistry'

// HTTP + query plumbing
export { api } from './lib/axios'
export { queryClient } from './lib/queryClient'

// Styling helper
export { cn } from './lib/cn'

// UI kit
export { Button } from './shared/components/ui/Button'
export { Checkbox } from './shared/components/ui/Checkbox'
export { Dialog } from './shared/components/ui/Dialog'
export { Input } from './shared/components/ui/Input'
export { ScrollArea } from './shared/components/ui/ScrollArea'
export { Select } from './shared/components/ui/Select'
export { Separator } from './shared/components/ui/Separator'
export { Tooltip } from './shared/components/ui/Tooltip'

// Desktop shell access
export { openApp } from './shared/intents/openApp'
// Read by add-ons that must restyle live on a theme/accent change — the Terminal
// drives its xterm palette from it rather than reading CSS once at mount.
export { useAppearanceStore, type ThemeMode, type AccentId } from './shared/store/appearanceStore'
export { useIntentStore } from './shared/store/intentStore'
export { useWindowStore } from './shared/store/windowStore'

// Notifications — imperative `notify(...)` + the store hook for reactive reads
export { notify, useNotificationStore } from './shared/store/notificationStore'
export type {
  NotificationItem,
  NotifyInput,
  NotificationLevel,
} from './shared/store/notificationStore'

// Shared add-on kit — file bytes over the authed api client
export {
  fetchFileBytes,
  uploadFileBytes,
  UploadTooLargeError,
  downloadUrl,
  fileName,
} from './lib/fileBytes'

// Shared add-on kit — Map.prototype.getOrInsert{,Computed} for pdf.js on
// browsers that do not have them yet (brief 91)
export { installMapGetOrInsert } from './lib/mapGetOrInsert'

// Shared add-on kit — one way to report a failed open/save (briefs 62-64)
export {
  describeFileFailure,
  reportFileFailure,
  reportFileRefusal,
  type FileFailureOptions,
} from './lib/fileFailure'

// Shared add-on kit — opened-file store + editor hooks
export { createOpenedFileStore } from './shared/store/createOpenedFileStore'
export type { OpenedFile } from './shared/store/createOpenedFileStore'
export {
  useElementSize,
  type ElementSize,
  type ElementSizeRef,
} from './shared/hooks/useElementSize'
export { useOpenIntent } from './shared/hooks/useOpenIntent'
export { useSaveHotkey } from './shared/hooks/useSaveHotkey'
export {
  useTopWindowKeydown,
  type TopWindowKeydownOptions,
} from './shared/hooks/useTopWindowKeydown'
export { isTopWindow, topVisibleWindowId, useWindowVisible } from './shared/store/windowStore'
export { isTextEntry } from './shared/hooks/shortcutRegistry'
export { useUnsavedGuard } from './shared/hooks/useUnsavedGuard'
export { useVirtualList } from './shared/hooks/useVirtualList'
export type { VirtualList } from './shared/hooks/useVirtualList'

// Shared add-on kit — confirm dialog
export { ConfirmDialog, useConfirm } from './shared/components/ui/ConfirmDialog'
export { useFileDialog, type FileChoice } from './shared/hooks/useFileDialog'
export {
  useRegisteredHotkeys,
  useDocumentedShortcuts,
  type RegisteredHotkey,
} from './shared/hooks/useRegisteredHotkeys'
export type { Shortcut, ShortcutScope } from './shared/hooks/shortcutRegistry'
export { FilePicker } from './shared/components/files/FilePicker'
export { PromptDialog, usePrompt } from './shared/components/ui/PromptDialog'
