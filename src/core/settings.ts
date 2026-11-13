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
  StudyPreferences,
  StudySettings,
  TextEngineSettings,
} from './types.ts'
import type { SettingsUpdate, SettingsView } from './views.ts'

/** Default study preferences. */
export const DEFAULT_STUDY: StudyPreferences = {
  targetRetention: 0.9,
  maxIntervalDays: 365,
  dailyNewUnits: 0,
  autoQuiz: true,
  autoInsight: true,
  verifyNotes: false,
  concurrency: 1,
  requestTimeoutMs: 120_000,
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
    study: { ...DEFAULT_STUDY },
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

function normalizeStudy(value: unknown): StudyPreferences {
  const input = record(value)
  const target = num(input.targetRetention)
  const maxInterval = num(input.maxIntervalDays)
  const daily = num(input.dailyNewUnits)
  const concurrency = num(input.concurrency)
  const timeout = num(input.requestTimeoutMs)
  return {
    targetRetention: clamp(target ?? DEFAULT_STUDY.targetRetention, 0.5, 0.99),
    maxIntervalDays: clamp(Math.round(maxInterval ?? DEFAULT_STUDY.maxIntervalDays), 1, 3650),
    dailyNewUnits: clamp(Math.round(daily ?? DEFAULT_STUDY.dailyNewUnits), 0, 100),
    autoQuiz: bool(input.autoQuiz, DEFAULT_STUDY.autoQuiz),
    autoInsight: bool(input.autoInsight, DEFAULT_STUDY.autoInsight),
    verifyNotes: bool(input.verifyNotes, DEFAULT_STUDY.verifyNotes),
    concurrency: clamp(Math.round(concurrency ?? DEFAULT_STUDY.concurrency), 1, 4),
    requestTimeoutMs: clamp(Math.round(timeout ?? DEFAULT_STUDY.requestTimeoutMs), 5_000, 600_000),
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
