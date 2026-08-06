import { fetchRecentFiles } from '../../lib/recentFiles'
import { openApp } from '../intents/openApp'
import type { CommandSource, CommandItem } from './CommandSourcesRegistry'

const GROUP = 'Recent files'

/** `recent:<root>:<appId>:<path>` — root/appId never contain ':', path is the tail. */
function encodeId(root: string, appId: string, path: string): string {
  return `recent:${root}:${appId}:${path}`
}

function decodeId(id: string): { root: string; appId: string; path: string } {
  const rest = id.slice('recent:'.length)
  const firstColon = rest.indexOf(':')
  const root = rest.slice(0, firstColon)
  const afterRoot = rest.slice(firstColon + 1)
  const secondColon = afterRoot.indexOf(':')
  const appId = afterRoot.slice(0, secondColon)
  const path = afterRoot.slice(secondColon + 1)
  return { root, appId, path }
}

/**
 * Palette source over the OS-wide recents (brief 94). Replaces Notepad's
 * private "Recent Files" source: entries carry the app that opened them, so
 * activation reopens a spreadsheet in Sheets and a photo in the Image Viewer,
 * not everything in Notepad.
 */
export const recentFilesSource: CommandSource = {
  group: GROUP,

  async search(query: string): Promise<CommandItem[]> {
    try {
      const files = await fetchRecentFiles()
      const q = query.trim().toLowerCase()
      return files
        .filter((f) => !q || f.path.toLowerCase().includes(q))
        .slice(0, 8)
        .map((f) => ({
          id: encodeId(f.root, f.appId, f.path),
          label: f.path.split('/').pop() ?? f.path,
          subtitle: f.path,
          group: GROUP,
        }))
    } catch {
      // A failing source is skipped — matches searchAllSources' contract.
      return []
    }
  },

  activate(item: CommandItem): void {
    const { root, appId, path } = decodeId(item.id)
    openApp(appId, { openPath: path, root })
  },
}
