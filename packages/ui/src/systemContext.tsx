import { createContext, useContext, type ReactNode } from 'react'
import type { SystemHandle } from './system'

/**
 * The channel the compositor injects the handle through. Lives in the SDK —
 * not in core — because both sides must resolve the *same* context object: the
 * compositor provides into it, apps and SDK hooks read from it, and neither may
 * import the other.
 */
const SystemContext = createContext<SystemHandle | null>(null)

export function SystemProvider({
  system,
  children,
}: {
  system: SystemHandle
  children: ReactNode
}) {
  return <SystemContext.Provider value={system}>{children}</SystemContext.Provider>
}

/**
 * The app's connection to the OS. Throws outside a provider, deliberately: an
 * app component rendering without a handle is a compositor bug, and limping on
 * without capabilities would surface as mysteriously dead buttons instead.
 */
// The provider and its accessor are one seam; splitting them into two files
// would be two files for one idea.
// eslint-disable-next-line react-refresh/only-export-components
export function useSystem(): SystemHandle {
  const system = useContext(SystemContext)
  if (system === null) {
    throw new Error(
      'useSystem() outside a SystemProvider — app components only run mounted by the compositor.'
    )
  }
  return system
}
