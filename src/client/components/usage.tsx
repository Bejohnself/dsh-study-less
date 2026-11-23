/**
 * Inline token/cost badge shared by jobs, ask answers and quiz feedback,
 * plus the daily cost heatmap in settings.
 */
import type { ReactElement } from 'react'
import type { UsageAmount } from '../../core/types.ts'
import type { UsageTotalsView } from '../../core/views.ts'
import { addDays, daysBetween, localDate } from '../../core/time.ts'

/** Compact token count, e.g. 1.8k. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

/** Format an estimated cost with the configured currency. */
export function formatCost(value: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : '$'
  const digits = value > 0 && value < 0.01 ? 6 : value < 1 ? 4 : 2
  return `${symbol}${value.toFixed(digits)}`
}

/** One line: cost first, tokens second. */
export function UsageNote({
  usage,
  prefix = '本次',
}: {
  usage?: UsageAmount | null
  prefix?: string
}): ReactElement | null {
  if (usage === undefined || usage === null) return null
  const input = usage.inputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  const output = usage.outputTokens ?? 0
  const tokens = input + cacheRead + output > 0
    ? `${formatTokens(input)} 输入${cacheRead > 0 ? ` / ${formatTokens(cacheRead)} 缓存` : ''} / ${formatTokens(output)} 输出`
    : ''
  const cost = usage.cost === undefined
    ? '未配置单价'
    : `${usage.priceSource === 'api' ? '' : '≈ '}${formatCost(usage.cost, usage.currency ?? 'USD')}`
  return (
    <span className="study-usage-note">
      {prefix} {cost}
      {tokens.length === 0 ? '' : ` · ${tokens}`}
    </span>
  )
}

type UsageDay = UsageTotalsView & { date: string }

const WEEKS = 26
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_LEVEL = 4

/** Monday-first weekday index for a local date. */
function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00`).getDay() + 6) % 7
}

/** One cell's tone: share of the window's busiest day, in four steps. */
function levelOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.min(MAX_LEVEL, Math.max(1, Math.ceil((value / max) * MAX_LEVEL)))
}

/** Daily cost as a GitHub-style grid: one column per week, rows are weekdays. */
export function UsageHeatmap({
  days,
  currency,
}: {
  days: readonly UsageDay[]
  currency: string
}): ReactElement {
  const byDate = new Map(days.map(day => [day.date, day]))
  const today = localDate()
  const start = addDays(today, -((WEEKS - 1) * 7 + weekdayOf(today)))
  const total = WEEKS * 7
  const cells = Array.from({ length: total }, (_, index) => {
    const date = addDays(start, index)
    const day = byDate.get(date)
    const future = date > today
    return { date, day, future }
  })

  // Colour by cost; when no call was priced, fall back to call counts so the
  // grid still says something.
  const maxCost = Math.max(0, ...cells.map(cell => cell.day?.cost ?? 0))
  const byCost = maxCost > 0
  const maxValue = byCost ? maxCost : Math.max(0, ...cells.map(cell => cell.day?.calls ?? 0))

  return (
    <div className="study-usage-heat">
      <p className="study-muted">
        近半年每天的花费{byCost ? '' : '（未配置单价，按调用次数着色）'} · {start} 起
      </p>
      <div className="study-usage-heat-body">
        <div className="study-usage-heat-days" aria-hidden="true">
          {WEEKDAYS.map(label => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="study-usage-heat-grid" role="img" aria-label="每天的用量格子图">
          {cells.map(cell => {
            const calls = cell.day?.calls ?? 0
            const cost = cell.day?.cost ?? 0
            const unpriced = cell.day !== undefined && cell.day.pricedCalls === 0 && calls > 0
            const spent = unpriced ? '未配置单价' : `≈ ${formatCost(cost, currency)}`
            const label = cell.future
              ? cell.date
              : `${cell.date} · ${calls === 0 ? '无花费' : `${spent} · ${calls} 次`}`
            return (
              <span
                key={cell.date}
                className={
                  'study-usage-heat-cell is-' +
                  (cell.future ? 'empty' : String(levelOf(byCost ? cost : calls, maxValue))) +
                  (cell.date === today ? ' is-today' : '')
                }
                title={label}
              />
            )
          })}
        </div>
      </div>
      <p className="study-usage-heat-legend">
        少
        {Array.from({ length: MAX_LEVEL + 1 }, (_, level) => (
          <span key={level} className={'study-usage-heat-cell is-' + String(level)} />
        ))}
        多
      </p>
    </div>
  )
}
