/**
 * Human-readable uptime from a second count.
 *
 * Its own module with its own tests because "format a duration" is deceptively
 * full of edge cases — a zero, a value under a minute, an exact boundary, a
 * fractional second from the API, and a nonsense input — and every one of them
 * shows up in a panel whose entire job is to state facts about the machine
 * accurately.
 *
 * Two units at most: "3d 4h" rather than "3d 4h 17m 9s". The user wants a sense of
 * how long the box has been up, and trailing precision on a number that changes
 * every second is noise.
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown'

  const total = Math.floor(seconds)
  if (total < 60) return `${total}s`

  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}
