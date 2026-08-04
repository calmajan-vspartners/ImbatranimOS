import { api } from '@imbatranim/core'

// Mirrors apps/backend/src/modules/system/system.service.ts response shapes.

export type CpuStats = {
  percent: number
  cores: number
  /** Busy percent per core; empty on the first poll, which has no baseline. */
  perCore: number[]
}

export type LoadAverage = { one: number; five: number; fifteen: number }

export type SwapStats = {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  percent: number
}

export type NetStats = {
  rxBytes: number
  txBytes: number
  rxPerSec: number
  txPerSec: number
}

export type MemoryStats = {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  percent: number
}

export type DiskStats = {
  path: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  percent: number
}

export type SystemStats = {
  cpu: CpuStats
  memory: MemoryStats
  disk: DiskStats
  swap: SwapStats
  loadAvg: LoadAverage
  net: NetStats
  uptimeSeconds: number
}

export type ProcessInfo = {
  pid: number
  uid: number
  name: string
  /** null until a baseline exists — render an em dash, not `0.0`. */
  cpuPercent: number | null
  memPercent: number
  memBytes: number
}

export type AboutInfo = {
  hostname: string
  kernel: string
  platform: string
  arch: string
  uptimeSeconds: number
  imageVersion: string
  /** This backend's own pid, so killing it can be warned about rather than forbidden. */
  serverPid: number
}

export type KillResult = {
  pid: number
  signaled: boolean
}

export async function fetchStats(): Promise<SystemStats> {
  const res = await api.get<SystemStats>('/system/stats')
  return res.data
}

export async function fetchProcesses(): Promise<ProcessInfo[]> {
  const res = await api.get<ProcessInfo[]>('/system/processes')
  return res.data
}

export async function fetchAbout(): Promise<AboutInfo> {
  const res = await api.get<AboutInfo>('/system/about')
  return res.data
}

export async function killProcess(pid: number, signal?: string): Promise<KillResult> {
  const res = await api.post<KillResult>(`/system/processes/${pid}/kill`, signal ? { signal } : {})
  return res.data
}
