/**
 * Build providers from the stored settings.
 *
 * Keeping the factory here means routes, jobs and the settings test all resolve
 * an engine the same way, and a missing field produces one actionable message.
 */
import { resolveSecret } from '../../core/settings.ts'
import type { CapabilitySettings, StudySettings } from '../../core/types.ts'
import { DshTextProvider, type DshLlmFace, type DshModelSelection } from './dsh.ts'
import { OpenAiEmbeddingProvider, OpenAiImageProvider, OpenAiTextProvider } from './openai.ts'
import { ProviderError, type EmbeddingProvider, type ImageProvider, type TextProvider } from './types.ts'

/** Host faces the DSH engine needs. */
export interface EngineDeps {
  llm?: DshLlmFace
  selection?: () => DshModelSelection | undefined
  /** Test seam: replace the configured text engine. */
  textProvider?: (settings: StudySettings) => TextProvider
}

function requireCustom(value: { baseURL?: string; model?: string }, label: string): { baseURL: string; model: string } {
  if (value.baseURL === undefined || value.baseURL.trim().length === 0) {
    throw new ProviderError('missing-base-url', `${label}还没有配置 Base URL`)
  }
  if (value.model === undefined || value.model.trim().length === 0) {
    throw new ProviderError('missing-model', `${label}还没有配置模型`)
  }
  return { baseURL: value.baseURL.trim(), model: value.model.trim() }
}

/** Resolve the text engine. */
export function textProviderFrom(settings: StudySettings, deps: EngineDeps): TextProvider {
  if (deps.textProvider !== undefined) return deps.textProvider(settings)
  if (settings.text.kind === 'dsh') {
    if (deps.llm === undefined) {
      throw new ProviderError('no-llm', '当前 Host 没有 llm 服务；请在设置里改用自定义文本 API')
    }
    return new DshTextProvider({
      llm: deps.llm,
      selection: () => deps.selection?.(),
    })
  }
  const target = requireCustom(settings.text, '文本引擎')
  return new OpenAiTextProvider({
    ...target,
    ...(resolveSecret(settings.text) === undefined ? {} : { apiKey: resolveSecret(settings.text) }),
    ...(settings.text.temperature === undefined ? {} : { temperature: settings.text.temperature }),
    ...(settings.text.maxTokens === undefined ? {} : { maxTokens: settings.text.maxTokens }),
    ...(settings.text.timeoutMs === undefined ? {} : { timeoutMs: settings.text.timeoutMs }),
  })
}

/** Resolve the embeddings engine, or throw when disabled/unconfigured. */
export function embeddingProviderFrom(settings: StudySettings): EmbeddingProvider {
  if (!settings.embedding.enabled) throw new ProviderError('disabled', '嵌入能力未启用')
  const target = requireCustom(settings.embedding, '嵌入引擎')
  return new OpenAiEmbeddingProvider({
    ...target,
    ...(resolveSecret(settings.embedding) === undefined ? {} : { apiKey: resolveSecret(settings.embedding) }),
    ...(settings.embedding.timeoutMs === undefined ? {} : { timeoutMs: settings.embedding.timeoutMs }),
  })
}

/** Resolve the image engine, or throw when disabled/unconfigured. */
export function imageProviderFrom(settings: StudySettings): ImageProvider {
  if (!settings.image.enabled) throw new ProviderError('disabled', '图片能力未启用')
  const target = requireCustom(settings.image, '图片引擎')
  return new OpenAiImageProvider({
    ...target,
    ...(resolveSecret(settings.image) === undefined ? {} : { apiKey: resolveSecret(settings.image) }),
    ...(settings.image.timeoutMs === undefined ? {} : { timeoutMs: settings.image.timeoutMs }),
  })
}

/** Describe one capability for the settings test button. */
export function capabilityFrom(settings: StudySettings, kind: 'text' | 'image' | 'animation' | 'embedding'): CapabilitySettings {
  if (kind === 'text') {
    return {
      enabled: true,
      ...(settings.text.baseURL === undefined ? {} : { baseURL: settings.text.baseURL }),
      ...(settings.text.apiKey === undefined ? {} : { apiKey: settings.text.apiKey }),
      ...(settings.text.apiKeyEnv === undefined ? {} : { apiKeyEnv: settings.text.apiKeyEnv }),
      ...(settings.text.model === undefined ? {} : { model: settings.text.model }),
      ...(settings.text.timeoutMs === undefined ? {} : { timeoutMs: settings.text.timeoutMs }),
    }
  }
  return settings[kind]
}
