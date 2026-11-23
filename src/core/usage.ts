/**
 * The small usage ledger: one aggregate for all inline model calls.
 *
 * This is deliberately not a per-call history. It answers three questions:
 * "what did this one call cost?" (computed before recording), "what have I
 * spent in total / today?" and "what did each day cost?" (the heatmap in
 * settings). Daily buckets are capped; older days roll off.
 */
import type { LibraryPaths } from './paths.ts'
import { readJson, updateJson } from './store.ts'
import { localDate } from './time.ts'

export interface UsageTotals {
  calls: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  cost: number
  pricedCalls: number
  unpricedCalls: number
}

export interface UsageDay extends UsageTotals {
  date: string
}

export interface UsageFile {
  version: 1
  totals: UsageTotals
  today: UsageDay
  /** Per-day buckets, oldest first; capped at MAX_USAGE_DAYS. */
  days: UsageDay[]
  updatedAt: string
}

export interface UsageRecordInput {
  at?: string
  inputTokens?: number
  cacheReadTokens?: number
  outputTokens?: number
  cost?: number
}

/** Keep about a year of daily buckets; the heatmap only reads half that. */
export const MAX_USAGE_DAYS = 400

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function totalsOf(value: unknown): UsageTotals {
  const row = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    calls: count(row.calls),
    inputTokens: count(row.inputTokens),
    cacheReadTokens: count(row.cacheReadTokens),
    outputTokens: count(row.outputTokens),
    cost: count(row.cost),
    pricedCalls: count(row.pricedCalls),
    unpricedCalls: count(row.unpricedCalls),
  }
}

function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, cost: 0, pricedCalls: 0, unpricedCalls: 0 }
}

/** A fresh ledger for one local day. */
export function emptyUsage(today: string = localDate()): UsageFile {
  return {
    version: 1,
    totals: emptyTotals(),
    today: { date: today, ...emptyTotals() },
    days: [],
    updatedAt: new Date().toISOString(),
  }
}

/** Read the stored daily buckets, dropping junk and capping the window. */
function daysOf(value: unknown): UsageDay[] {
  if (!Array.isArray(value)) return []
  const byDate = new Map<string, UsageDay>()
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const date = typeof row.date === 'string' && DAY_KEY.test(row.date) ? row.date : ''
    if (date.length === 0) continue
    byDate.set(date, { date, ...totalsOf(row) })
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-MAX_USAGE_DAYS)
}

/** Normalize a stored ledger, rolling the daily bucket over at midnight. */
export function normalizeUsage(value: unknown, today: string = localDate()): UsageFile {
  const row = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const todayRow = row.today !== null && typeof row.today === 'object' && !Array.isArray(row.today) ? (row.today as Record<string, unknown>) : {}
  const date = typeof todayRow.date === 'string' && DAY_KEY.test(todayRow.date) ? todayRow.date : today
  return {
    version: 1,
    totals: totalsOf(row.totals),
    today: date === today ? { date, ...totalsOf(todayRow) } : { date: today, ...emptyTotals() },
    days: daysOf(row.days),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  }
}

/** Read the ledger, resetting only the daily bucket when the day changed. */
export async function readUsage(paths: LibraryPaths, today: string = localDate()): Promise<UsageFile> {
  return normalizeUsage(await readJson<unknown>(paths.usageFile, null), today)
}

/** Record one model call and return the updated ledger. */
export async function recordUsage(paths: LibraryPaths, input: UsageRecordInput): Promise<UsageFile> {
  const at = input.at ?? new Date().toISOString()
  const day = localDate(new Date(at))
  const inputTokens = count(input.inputTokens)
  const cacheReadTokens = count(input.cacheReadTokens)
  const outputTokens = count(input.outputTokens)
  const cost = input.cost === undefined ? undefined : count(input.cost)
  return updateJson<UsageFile>(paths.usageFile, emptyUsage(day), current => {
    const file = normalizeUsage(current, day)
    const add = (entry: UsageTotals): UsageTotals => ({
      calls: entry.calls + 1,
      inputTokens: entry.inputTokens + inputTokens,
      cacheReadTokens: entry.cacheReadTokens + cacheReadTokens,
      outputTokens: entry.outputTokens + outputTokens,
      cost: entry.cost + (cost ?? 0),
      pricedCalls: entry.pricedCalls + (cost === undefined ? 0 : 1),
      unpricedCalls: entry.unpricedCalls + (cost === undefined ? 1 : 0),
    })
    return {
      ...file,
      totals: add(file.totals),
      today: { ...add(file.today), date: day },
      days: withDay(file.days, day, add),
      updatedAt: at,
    }
  })
}

/** Add one call to its day bucket, creating it and trimming the old window. */
function withDay(days: readonly UsageDay[], date: string, add: (entry: UsageTotals) => UsageTotals): UsageDay[] {
  const found = days.some(entry => entry.date === date)
  const next = found
    ? days.map(entry => (entry.date === date ? { date, ...add(entry) } : entry))
    : [...days, { date, ...add(emptyTotals()) }]
  return [...next].sort((left, right) => left.date.localeCompare(right.date)).slice(-MAX_USAGE_DAYS)
}
