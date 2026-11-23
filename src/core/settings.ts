/**
 * Study settings: defaults, normalization, masking and patching.
 *
 * The settings document lives in the study root, not in the profile patch, so a
 * user can change engines from the panel without editing YAML. Secrets are kept
 * on the Host: `settingsView` never returns an API key, only whether one is set.
 */
import type {
  AnimationSettings,
  CapabilitySettings,
  QuickAction,
  StudyPreferences,
  StudySettings,
  TextEngineSettings,
} from './types.ts'
import type { SettingsUpdate, SettingsView } from './views.ts'

/** How many custom actions the selection bar may hold. */
export const MAX_QUICK_ACTIONS = 3
/** Button text limit; longer labels would push the bar too wide. */
export const QUICK_LABEL_MAX = 6
/** Instruction limit, same as the question cap on /ask. */
export const QUICK_PROMPT_MAX = 400

/** Ship one example so the feature is visible, editable and easy to copy. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  { label: '翻译', prompt: '把这段翻成中文，保留术语和公式，不要总结。' },
]

/** Default study preferences. */
export const DEFAULT_STUDY: StudyPreferences = {
  targetRetention: 0.9,
  maxIntervalDays: 365,
  dailyNewUnits: 0,
  autoQuiz: true,
  autoInsight: false,
  verifyNotes: false,
  showInsights: true,
  concurrency: 1,
  requestTimeoutMs: 120_000,
  pricing: { currency: 'USD', inputPerMillion: 0, cacheInputPerMillion: 0, outputPerMillion: 0 },
  quickActions: DEFAULT_QUICK_ACTIONS.map(action => ({ ...action })),
}

/** Default text engine: reuse the DSH model unless a custom endpoint is set. */
export const DEFAULT_TEXT: TextEngineSettings = {
  kind: 'dsh',
  model: '',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 120_000,
}

/** Disabled optional capability. */
export function disabledCapability(): CapabilitySettings {
  return { enabled: false }
}

/** Default settings document. */
export function defaultSettings(): StudySettings {
  return {
    version: 1,
    text: { ...DEFAULT_TEXT },
    image: disabledCapability(),
    animation: { ...disabledCapability(), mode: 'svg-html' },
    embedding: disabledCapability(),
    study: {
      ...DEFAULT_STUDY,
      pricing: { ...DEFAULT_STUDY.pricing },
      quickActions: DEFAULT_STUDY.quickActions.map(action => ({ ...action })),
    },
    updatedAt: new Date().toISOString(),
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeCapability(value: unknown, fallback: CapabilitySettings): CapabilitySettings {
  const input = record(value)
  const baseURL = str(input.baseURL)
  const apiKey = str(input.apiKey)
  const apiKeyEnv = str(input.apiKeyEnv)
  const model = str(input.model)
  const timeoutMs = num(input.timeoutMs)
  return {
    enabled: bool(input.enabled, fallback.enabled),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(model === undefined ? {} : { model }),
    ...(timeoutMs === undefined ? {} : { timeoutMs: clamp(Math.round(timeoutMs), 1_000, 600_000) }),
  }
}

function normalizeText(value: unknown): TextEngineSettings {
  const input = record(value)
  const kind = input.kind === 'openai-compatible' ? 'openai-compatible' : 'dsh'
  const baseURL = str(input.baseURL)
  const apiKey = str(input.apiKey)
  const apiKeyEnv = str(input.apiKeyEnv)
  const model = str(input.model)
  const temperature = num(input.temperature)
  const maxTokens = num(input.maxTokens)
  const timeoutMs = num(input.timeoutMs)
  return {
    kind,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(model === undefined ? {} : { model }),
    ...(temperature === undefined ? {} : { temperature: clamp(temperature, 0, 2) }),
    ...(maxTokens === undefined ? {} : { maxTokens: clamp(Math.round(maxTokens), 256, 32_768) }),
    ...(timeoutMs === undefined ? {} : { timeoutMs: clamp(Math.round(timeoutMs), 1_000, 600_000) }),
  }
}

/** Trim, drop empty slots, cap the count and the lengths. */
function normalizeQuickActions(value: unknown): QuickAction[] {
  // No field at all is an older document: give it the example action. An empty
  // array is a deliberate "I deleted them all", so keep it empty.
  if (!Array.isArray(value)) return DEFAULT_QUICK_ACTIONS.map(action => ({ ...action }))
  const actions: QuickAction[] = []
  for (const entry of value) {
    const row = record(entry)
    const label = str(row.label)
    const prompt = str(row.prompt)
    if (label === undefined || prompt === undefined) continue
    actions.push({
      label: label.slice(0, QUICK_LABEL_MAX),
      prompt: prompt.slice(0, QUICK_PROMPT_MAX),
    })
    if (actions.length >= MAX_QUICK_ACTIONS) break
  }
  return actions
}

function normalizeStudy(value: unknown): StudyPreferences {
  const input = record(value)
  const target = num(input.targetRetention)
  const maxInterval = num(input.maxIntervalDays)
  const daily = num(input.dailyNewUnits)
  const concurrency = num(input.concurrency)
  const timeout = num(input.requestTimeoutMs)
  const pricing = record(input.pricing)
  const currency = pricing.currency === 'CNY' ? 'CNY' : 'USD'
  const inputPrice = Math.max(0, num(pricing.inputPerMillion) ?? 0)
  const cachePrice = Math.max(0, num(pricing.cacheInputPerMillion) ?? 0)
  const outputPrice = Math.max(0, num(pricing.outputPerMillion) ?? 0)
  return {
    targetRetention: clamp(target ?? DEFAULT_STUDY.targetRetention, 0.5, 0.99),
    maxIntervalDays: clamp(Math.round(maxInterval ?? DEFAULT_STUDY.maxIntervalDays), 1, 3650),
    dailyNewUnits: clamp(Math.round(daily ?? DEFAULT_STUDY.dailyNewUnits), 0, 100),
    autoQuiz: bool(input.autoQuiz, DEFAULT_STUDY.autoQuiz),
    autoInsight: bool(input.autoInsight, DEFAULT_STUDY.autoInsight),
    verifyNotes: bool(input.verifyNotes, DEFAULT_STUDY.verifyNotes),
    showInsights: bool(input.showInsights, DEFAULT_STUDY.showInsights),
    concurrency: clamp(Math.round(concurrency ?? DEFAULT_STUDY.concurrency), 1, 4),
    requestTimeoutMs: clamp(Math.round(timeout ?? DEFAULT_STUDY.requestTimeoutMs), 5_000, 600_000),
    pricing: {
      currency,
      inputPerMillion: inputPrice,
      cacheInputPerMillion: cachePrice,
      outputPerMillion: outputPrice,
    },
    quickActions: normalizeQuickActions(input.quickActions),
  }
}

/** Merge a stored document over the defaults. */
export function normalizeSettings(value: unknown): StudySettings {
  const input = record(value)
  const base = defaultSettings()
  const animationInput = record(input.animation)
  const animation = normalizeCapability(input.animation, base.animation)
  return {
    version: 1,
    text: normalizeText(input.text),
    image: normalizeCapability(input.image, base.image),
    animation: {
      ...animation,
      mode: animationInput.mode === 'video' ? 'video' : 'svg-html',
    } as AnimationSettings,
    embedding: normalizeCapability(input.embedding, base.embedding),
    study: normalizeStudy(input.study),
    updatedAt: str(input.updatedAt) ?? new Date().toISOString(),
  }
}

function keySet(value: unknown): boolean {
  return str(value) !== undefined
}

/** The masked settings payload the browser receives. */
export function settingsView(settings: StudySettings): SettingsView {
  return {
    text: {
      kind: settings.text.kind,
      ...(settings.text.baseURL === undefined ? {} : { baseURL: settings.text.baseURL }),
      apiKeySet: keySet(settings.text.apiKey),
      ...(settings.text.apiKeyEnv === undefined ? {} : { apiKeyEnv: settings.text.apiKeyEnv }),
      ...(settings.text.model === undefined ? {} : { model: settings.text.model }),
      ...(settings.text.temperature === undefined ? {} : { temperature: settings.text.temperature }),
      ...(settings.text.maxTokens === undefined ? {} : { maxTokens: settings.text.maxTokens }),
      ...(settings.text.timeoutMs === undefined ? {} : { timeoutMs: settings.text.timeoutMs }),
    },
    image: capabilityView(settings.image),
    animation: { ...capabilityView(settings.animation), mode: settings.animation.mode },
    embedding: capabilityView(settings.embedding),
    study: { ...settings.study },
    textReady: textReady(settings),
    updatedAt: settings.updatedAt,
  }
}

function capabilityView(value: CapabilitySettings): SettingsView['image'] {
  return {
    enabled: value.enabled,
    ...(value.baseURL === undefined ? {} : { baseURL: value.baseURL }),
    apiKeySet: keySet(value.apiKey),
    ...(value.apiKeyEnv === undefined ? {} : { apiKeyEnv: value.apiKeyEnv }),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
  }
}

/** Whether the text engine can run without the conversation fallback. */
export function textReady(settings: StudySettings): boolean {
  if (settings.text.kind === 'dsh') return true
  return str(settings.text.baseURL) !== undefined && str(settings.text.model) !== undefined
}

/** The key a custom endpoint should use, preferring the environment variable. */
export function resolveSecret(
  value: { apiKey?: string; apiKeyEnv?: string },
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envName = str(value.apiKeyEnv)
  if (envName !== undefined) {
    const fromEnv = env[envName]?.trim()
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  }
  return str(value.apiKey)
}

/**
 * Apply a patch.
 *
 * For secrets: an omitted `apiKey` keeps the stored one, an empty string clears
 * it, and a non-empty string replaces it.
 */
export function patchSettings(current: StudySettings, patch: SettingsUpdate): StudySettings {
  const next = normalizeSettings(current)
  const textPatch = record(patch.text)
  if (patch.text !== undefined) {
    const candidate: Record<string, unknown> = { ...next.text, ...textPatch }
    if (textPatch.apiKey === '') delete candidate.apiKey
    else if (textPatch.apiKey === undefined) candidate.apiKey = next.text.apiKey
    next.text = normalizeText(candidate)
  }
  for (const key of ['image', 'embedding'] as const) {
    const body = patch[key]
    if (body === undefined) continue
    const source = record(body)
    const candidate: Record<string, unknown> = { ...next[key], ...source }
    if (source.apiKey === '') delete candidate.apiKey
    else if (source.apiKey === undefined) candidate.apiKey = next[key].apiKey
    next[key] = normalizeCapability(candidate, next[key])
  }
  if (patch.animation !== undefined) {
    const source = record(patch.animation)
    const candidate: Record<string, unknown> = { ...next.animation, ...source }
    if (source.apiKey === '') delete candidate.apiKey
    else if (source.apiKey === undefined) candidate.apiKey = next.animation.apiKey
    const normalized = normalizeCapability(candidate, next.animation)
    next.animation = {
      ...normalized,
      mode: source.mode === 'video' ? 'video' : source.mode === 'svg-html' ? 'svg-html' : next.animation.mode,
    }
  }
  if (patch.study !== undefined) next.study = normalizeStudy({ ...next.study, ...record(patch.study) })
  next.updatedAt = new Date().toISOString()
  return next
}
