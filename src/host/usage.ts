/**
 * Price resolution and the small aggregate usage ledger.
 *
 * Precedence is deliberately short: use a cost reported by the provider first,
 * then the user's per-million prices, then show tokens without a cost. Model
 * catalog integration can be added behind this resolver later.
 */
import { readUsage, recordUsage, type UsageFile } from '../core/usage.ts'
import { localDate } from '../core/time.ts'
import type { UsageCallView, UsageSummaryView } from '../core/views.ts'
import type { LibraryPaths } from '../core/paths.ts'
import type { SettingsService } from './settings.ts'

interface ProviderUsage {
  inputTokens?: number
  cacheReadTokens?: number
  outputTokens?: number
  cost?: number
  currency?: string
}

function sameCurrency(left: string | undefined, right: string): boolean {
  if (left === undefined) return true
  const normalize = (value: string): string => {
    const upper = value.trim().toUpperCase()
    return upper === '$' || upper === 'USD' ? 'USD' : upper === '¥' || upper === 'CNY' || upper === 'RMB' ? 'CNY' : upper
  }
  return normalize(left) === normalize(right)
}

/** Days of daily buckets sent to the settings heatmap (26 weeks). */
const VIEW_DAYS = 182

/** Resolve one call, record it, and return the inline view. */
export class UsageService {
  private readonly paths: LibraryPaths
  private readonly settings: SettingsService

  constructor(paths: LibraryPaths, settings: SettingsService) {
    this.paths = paths
    this.settings = settings
  }

  async record(usage?: ProviderUsage): Promise<UsageCallView> {
    const settings = await this.settings.current()
    const pricing = settings.study.pricing
    const inputTokens = usage?.inputTokens ?? 0
    const cacheReadTokens = usage?.cacheReadTokens ?? 0
    const outputTokens = usage?.outputTokens ?? 0
    let cost: number | undefined
    let priceSource: UsageCallView['priceSource'] = 'none'

    if (usage?.cost !== undefined && sameCurrency(usage.currency, pricing.currency)) {
      cost = usage.cost
      priceSource = 'api'
    } else if (pricing.inputPerMillion > 0 || pricing.cacheInputPerMillion > 0 || pricing.outputPerMillion > 0) {
      const cachePrice = pricing.cacheInputPerMillion > 0 ? pricing.cacheInputPerMillion : pricing.inputPerMillion
      cost =
        (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (cacheReadTokens / 1_000_000) * cachePrice +
        (outputTokens / 1_000_000) * pricing.outputPerMillion
      priceSource = 'user'
    }

    const at = new Date().toISOString()
    await recordUsage(this.paths, {
      at,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      ...(cost === undefined ? {} : { cost }),
    })
    return {
      inputTokens,
      ...(cacheReadTokens === 0 ? {} : { cacheReadTokens }),
      outputTokens,
      ...(cost === undefined ? {} : { cost }),
      currency: pricing.currency,
      priceSource,
    }
  }

  /** Read the aggregate ledger for the settings panel. */
  async summary(): Promise<UsageSummaryView> {
    const settings = await this.settings.current()
    const file: UsageFile = await readUsage(this.paths, localDate())
    return {
      currency: settings.study.pricing.currency,
      totals: file.totals,
      today: file.today,
      // The heatmap reads ~half a year; cap the payload even when the ledger is older.
      days: file.days.slice(-VIEW_DAYS),
    }
  }
}
