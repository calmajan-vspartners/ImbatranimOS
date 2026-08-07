// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationStore } from './notificationStore'

/**
 * Toast actions (brief 107): intent-shaped data that has to survive the
 * persisted history and the raising window closing, which is the whole reason
 * they are not callbacks.
 */

beforeEach(() => {
  useNotificationStore.setState({ notifications: [], toasts: [], dnd: false })
})

describe('notify with actions', () => {
  it('carries actions onto the item and its live toast', () => {
    const { notify } = useNotificationStore.getState()
    const id = notify({
      title: 'Alarm',
      appId: 'clock',
      actions: [{ label: 'Snooze', payload: { action: 'snooze', alarmId: 3 } }],
    })

    const item = useNotificationStore.getState().notifications.find((n) => n.id === id)!
    expect(item.actions).toEqual([{ label: 'Snooze', payload: { action: 'snooze', alarmId: 3 } }])
    expect(useNotificationStore.getState().toasts).toContain(id)
  })

  it('an item raised without actions keeps its exact old shape', () => {
    const { notify } = useNotificationStore.getState()
    const id = notify({ title: 'Saved', appId: 'notepad', level: 'success' })
    const item = useNotificationStore.getState().notifications.find((n) => n.id === id)!
    // Not `undefined`-valued: the key is absent, so persisted JSON written by
    // this build is byte-identical to what the old one wrote.
    expect('actions' in item).toBe(false)
  })

  it('actions are JSON-round-trippable — they ride the persisted history', () => {
    const { notify } = useNotificationStore.getState()
    notify({
      title: 'Deleted 3 files',
      appId: 'file-manager',
      actions: [{ label: 'Undo', payload: { action: 'undo', batch: 'abc' } }],
    })
    const [item] = useNotificationStore.getState().notifications
    expect(JSON.parse(JSON.stringify(item))).toEqual(item)
  })

  it('Do Not Disturb still records the item (with actions) but shows no toast', () => {
    useNotificationStore.setState({ dnd: true })
    const { notify } = useNotificationStore.getState()
    const id = notify({
      title: 'Alarm',
      appId: 'clock',
      actions: [{ label: 'Snooze', payload: { action: 'snooze', alarmId: 1 } }],
    })
    expect(useNotificationStore.getState().toasts).toHaveLength(0)
    const item = useNotificationStore.getState().notifications.find((n) => n.id === id)!
    expect(item.actions).toHaveLength(1)
  })
})
