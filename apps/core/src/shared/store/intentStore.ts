import { create } from 'zustand'

type IntentStore = {
  intents: Map<string, unknown>
  setIntent: (windowId: string, payload: unknown) => void
  consumeIntent: (windowId: string) => unknown
  /** Drop any pending intent for a window without reading it (close cleanup). */
  clearIntent: (windowId: string) => void
}

export const useIntentStore = create<IntentStore>((set, get) => ({
  intents: new Map(),

  setIntent: (windowId, payload) => {
    set((state) => {
      const newIntents = new Map(state.intents)
      newIntents.set(windowId, payload)
      return { intents: newIntents }
    })
  },

  consumeIntent: (windowId) => {
    const intent = get().intents.get(windowId)
    if (intent !== undefined) {
      set((state) => {
        const newIntents = new Map(state.intents)
        newIntents.delete(windowId)
        return { intents: newIntents }
      })
    }
    return intent
  },

  clearIntent: (windowId) => {
    if (!get().intents.has(windowId)) return
    set((state) => {
      const newIntents = new Map(state.intents)
      newIntents.delete(windowId)
      return { intents: newIntents }
    })
  },
}))
