import { api } from '@imbatranim/core'
import type { LogEntry, LogLevel } from './logFormat'

export interface LogPage {
  entries: LogEntry[]
  truncated: boolean
}

export async function fetchLogs(params: {
  level?: LogLevel
  q?: string
  limit?: number
}): Promise<LogPage> {
  const res = await api.get<LogPage>('/logs', {
    params: {
      ...(params.level ? { level: params.level } : {}),
      ...(params.q ? { q: params.q } : {}),
      limit: params.limit ?? 300,
    },
  })
  return res.data
}

export function errorMessage(err: unknown): string {
  const response = (err as { response?: { data?: { message?: string | string[] } } })?.response
  const message = response?.data?.message
  if (Array.isArray(message)) return message.join(', ')
  if (typeof message === 'string') return message
  return err instanceof Error ? err.message : 'Could not read the system log'
}
