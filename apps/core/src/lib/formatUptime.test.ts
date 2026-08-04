import { describe, it, expect } from 'vitest'
import { formatUptime } from './formatUptime'

describe('formatUptime', () => {
  it('shows seconds under a minute', () => {
    // A freshly booted machine must not read "0m", which looks like a failure to
    // measure rather than a fact.
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(1)).toBe('1s')
    expect(formatUptime(59)).toBe('59s')
  })

  it('switches to minutes at exactly 60s', () => {
    expect(formatUptime(60)).toBe('1m')
    expect(formatUptime(3599)).toBe('59m')
  })

  it('switches to hours at exactly 3600s', () => {
    expect(formatUptime(3600)).toBe('1h')
    expect(formatUptime(3660)).toBe('1h 1m')
    expect(formatUptime(86_399)).toBe('23h 59m')
  })

  it('switches to days at exactly 86400s', () => {
    expect(formatUptime(86_400)).toBe('1d')
    expect(formatUptime(86_400 + 3600)).toBe('1d 1h')
    expect(formatUptime(3 * 86_400 + 4 * 3600 + 17 * 60)).toBe('3d 4h')
  })

  it('drops a zero second unit rather than printing "1d 0h"', () => {
    expect(formatUptime(2 * 86_400)).toBe('2d')
    expect(formatUptime(5 * 3600)).toBe('5h')
  })

  it('floors a fractional second count', () => {
    // `os.uptime()` returns a float, and the API passes it straight through.
    expect(formatUptime(59.9)).toBe('59s')
    expect(formatUptime(3600.7)).toBe('1h')
  })

  it('says "unknown" for nonsense instead of NaN', () => {
    // A panel titled "About this machine" printing "NaNd NaNh" is worse than
    // admitting it does not know.
    expect(formatUptime(NaN)).toBe('unknown')
    expect(formatUptime(-5)).toBe('unknown')
    expect(formatUptime(Infinity)).toBe('unknown')
  })
})
