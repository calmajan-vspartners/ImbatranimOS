import { defineConfig } from 'vitest/config'

// Clock's correctness lives in pure functions: the countdown/elapsed rounding
// asymmetry (format.ts), the alarm firing decision (alarmSchedule.ts) and the
// timestamp-driven timer transitions (timerModel.ts). All three are the kind of
// off-by-one that reads fine and behaves wrong, so they are unit-tested rather
// than eyeballed.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
