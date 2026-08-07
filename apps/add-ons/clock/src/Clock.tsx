import { useEffect, useRef, useState } from 'react'
import { Clock4, Timer as TimerIcon, AlarmClock, Hourglass } from 'lucide-react'
import { cn, queryClient, useSystem } from '@imbatranim/ui'
import { ClockTab } from './tabs/ClockTab'
import { Stopwatch } from './tabs/Stopwatch'
import { Timer } from './tabs/Timer'
import { Alarms } from './tabs/Alarms'
import { RingingBanner } from './components/RingingBanner'
import { useClockStore } from './clockStore'
import { ALARMS_KEY, WORLD_CLOCKS_KEY, usePatchAlarmMutation } from './queries/clockQueries'
import { migrateLegacyClockState } from './migrateLegacyClock'
import { normaliseClockIntent } from './notificationIntent'
import { snoozePatch } from './alarmSchedule'

type Tab = 'clock' | 'stopwatch' | 'timer' | 'alarms'

const TAB_LABEL: Record<Tab, string> = {
  clock: 'Clock',
  stopwatch: 'Stopwatch',
  timer: 'Timer',
  alarms: 'Alarms',
}

function TabIcon({ tab, active }: { tab: Tab; active: boolean }) {
  const size = 12
  const className = active ? 'text-on-primary' : 'text-on-surface-variant'
  switch (tab) {
    case 'clock':
      return <Clock4 size={size} className={className} />
    case 'stopwatch':
      return <Hourglass size={size} className={className} />
    case 'timer':
      return <TimerIcon size={size} className={className} />
    case 'alarms':
      return <AlarmClock size={size} className={className} />
  }
}

// Window contract: ComponentType<{ windowId: string }>. Single-instance app —
// windowId is unused (no per-window state to key on).
export function Clock({ windowId: _windowId }: { windowId: string }) {
  const system = useSystem()
  const [tab, setTab] = useState<Tab>('clock')
  const ringingCount = useClockStore((s) => s.ringing.length)
  const runningTimers = useClockStore((s) => s.timers.filter((t) => t.running).length)

  // One-time hand-over of any pre-brief-71 localStorage state. Guarded twice: a
  // module-level flag here, and the server refusing to import into a non-empty
  // table.
  useEffect(() => {
    void migrateLegacyClockState(system).then((imported) => {
      if (!imported) return
      void queryClient.invalidateQueries({ queryKey: ALARMS_KEY })
      void queryClient.invalidateQueries({ queryKey: WORLD_CLOCKS_KEY })
    })
  }, [system])

  /**
   * Apply the Snooze pressed on an alarm TOAST (brief 107).
   *
   * The toast's button is data, so pressing it opens/focuses this window and
   * delivers `{ action: 'snooze', alarmId }` here. Subscribing rather than
   * consuming once (the brief-108 pattern) is what makes a second alarm's
   * Snooze work while the window is already open. Same effect as the in-window
   * banner: patch the alarm, clear its ringing entry.
   */
  const patchAlarmMutation = usePatchAlarmMutation()
  const patchRef = useRef(patchAlarmMutation)
  useEffect(() => {
    patchRef.current = patchAlarmMutation
  })
  useEffect(
    () =>
      system.intents.onIntent((raw) => {
        const intent = normaliseClockIntent(raw)
        if (!intent) return
        patchRef.current.mutate({ id: intent.alarmId, patch: snoozePatch(Date.now()) })
        useClockStore.getState().clearRinging(intent.alarmId)
        setTab('alarms')
      }),
    [system]
  )

  const tabs: Tab[] = ['clock', 'stopwatch', 'timer', 'alarms']

  /** Small count on a tab: how many timers are counting, how many alarms ring. */
  const badge = (t: Tab): number => {
    if (t === 'timer') return runningTimers
    if (t === 'alarms') return ringingCount
    return 0
  }

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col select-none">
      {/* Above the tabs: an unacknowledged alarm is visible from every tab. */}
      <RingingBanner />

      {/* Wraps rather than clips: with a badge on two of the four tabs the strip
          no longer fits the 300px minSize on one line, and a half-cut tab label
          is worse than a second row. */}
      <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
        {tabs.map((t) => {
          const active = tab === t
          const count = badge(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'font-ui flex items-center gap-1 border px-2 py-1 text-[11px] font-semibold tracking-wider uppercase transition-colors',
                active
                  ? 'border-primary bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:border-outline-variant hover:text-on-surface border-transparent'
              )}
            >
              <TabIcon tab={t} active={active} />
              {TAB_LABEL[t]}
              {count > 0 && (
                <span
                  className={cn(
                    'font-ui inline-flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-semibold tabular-nums',
                    active ? 'bg-on-primary text-primary' : 'bg-primary text-on-primary'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'clock' && <ClockTab />}
        {tab === 'stopwatch' && <Stopwatch />}
        {tab === 'timer' && <Timer />}
        {tab === 'alarms' && <Alarms />}
      </div>
    </div>
  )
}
