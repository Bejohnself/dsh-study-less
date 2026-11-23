/**
 * OpenAI-compatible HTTP providers.
 *
 * The base URL is the API root (for OpenAI: `https://api.openai.com/v1`); the
 * provider appends the endpoint. Text, embeddings and images are separate
 * classes so a user can point each capability at a different service.
 */
import { ProviderError, type EmbeddingProvider, type ImageProvider, type ImageResult, type TextProvider, type TextRequest, type TextResult } from './types.ts'

/** Join an API root and an endpoint without doubling slashes. */
function endpoint(baseURL: string, path: string): string {
  const base = baseURL.trim().replace(/\/+$/, '')
  if (base.length === 0) throw new ProviderError('missing-base-url', '未配置 API Base URL')
  return `${base}/${path.replace(/^\/+/, '')}`
}

/** Combine a caller signal with a timeout. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1_000, timeoutMs))
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** Read a response body as text, capped, for error messages. */
async function responseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

/** The chat-completions text engine. */
export class OpenAiTextProvider implements TextProvider {
  readonly name = 'openai-compatible'
  private readonly baseURL: string
  private readonly apiKey: string
  private readonly model: string
  private readonly temperature: number
  private readonly maxTokens: number
  private readonly timeoutMs: number

  constructor(options: {
    baseURL: string
    apiKey?: string
    model: string
    temperature?: number
    maxTokens?: number
    timeoutMs?: number
  }) {
    this.baseURL = options.baseURL
    this.apiKey = options.apiKey ?? ''
    this.model = options.model
    this.temperature = options.temperature ?? 0.3
    this.maxTokens = options.maxTokens ?? 4096
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  async complete(request: TextRequest): Promise<TextResult> {
    const messages: Array<{ role: string; content: string }> = []
    if (request.system !== undefined && request.system.trim().length > 0) {
      messages.push({ role: 'system', content: request.system })
    }
    messages.push({ role: 'user', content: request.user })
    let response: Response
    try {
      response = await fetch(endpoint(this.baseURL, 'chat/completions'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: request.temperature ?? this.temperature,
          max_tokens: request.maxTokens ?? this.maxTokens,
          stream: false,
        }),
        signal: withTimeout(request.signal, this.timeoutMs),
      })
    } catch (error) {
      throw new ProviderError('network', `文本接口请求失败：${(error as Error).message}`)
    }
    if (!response.ok) {
      throw new ProviderError('http', `文本接口返回 HTTP ${response.status}：${await responseText(response)}`, response.status)
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          model?: string
          choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            prompt_tokens_details?: { cached_tokens?: number }
            cache_read_input_tokens?: number
            cost?: number
            total_cost?: number
            currency?: string
          }
        }
      | null
    const content = payload?.choices?.[0]?.message?.content
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map(part => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '')).join('')
          : ''
    if (text.trim().length === 0) throw new ProviderError('empty', '文本接口返回了空内容')
    request.onProgress?.(text.length)
    const cachedTokens = payload?.usage?.prompt_tokens_details?.cached_tokens
      ?? payload?.usage?.cache_read_input_tokens
    const inputTokens = payload?.usage?.prompt_tokens === undefined
      ? undefined
      : Math.max(0, payload.usage.prompt_tokens - (cachedTokens ?? 0))
    return {
      text,
      ...(payload?.model === undefined ? {} : { model: payload.model }),
      ...(payload?.choices?.[0]?.finish_reason === 'length' ? { truncated: true } : {}),
      ...(payload?.usage === undefined
        ? {}
        : {
            usage: {
              ...(inputTokens === undefined ? {} : { inputTokens }),
              ...(cachedTokens === undefined ? {} : { cacheReadTokens: cachedTokens }),
              ...(payload.usage.completion_tokens === undefined ? {} : { outputTokens: payload.usage.completion_tokens }),
              ...(payload.usage.cost === undefined
                ? payload.usage.total_cost === undefined
                  ? {}
                  : { cost: payload.usage.total_cost }
                : { cost: payload.usage.cost }),
              ...(payload.usage.currency === undefined ? {} : { currency: payload.usage.currency }),
            },
          }),
    }
  }
}

/** The embeddings engine. */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible'
  private readonly baseURL: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: { baseURL: string; apiKey?: string; model: string; timeoutMs?: number }) {
    this.baseURL = options.baseURL
    this.apiKey = options.apiKey ?? ''
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    let response: Response
    try {
      response = await fetch(endpoint(this.baseURL, 'embeddings'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: withTimeout(signal, this.timeoutMs),
      })
    } catch (error) {
      throw new ProviderError('network', `嵌入接口请求失败：${(error as Error).message}`)
    }
    if (!response.ok) {
      throw new ProviderError('http', `嵌入接口返回 HTTP ${response.status}：${await responseText(response)}`, response.status)
    }
    const payload = (await response.json().catch(() => null)) as
      | { data?: Array<{ index?: number; embedding?: number[] }> }
      | null
    const rows = payload?.data
    if (rows === undefined || rows.length !== texts.length) {
      throw new ProviderError('invalid', '嵌入接口返回的向量数量不匹配')
    }
    return [...rows]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(row => {
        if (!Array.isArray(row.embedding)) throw new ProviderError('invalid', '嵌入接口返回了非法向量')
        return row.embedding
      })
  }
}

/** The images engine. */
export class OpenAiImageProvider implements ImageProvider {
  readonly name = 'openai-compatible'
  private readonly baseURL: string
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: { baseURL: string; apiKey?: string; model: string; timeoutMs?: number }) {
    this.baseURL = options.baseURL
    this.apiKey = options.apiKey ?? ''
    this.model = options.model
    this.timeoutMs = options.timeoutMs ?? 180_000
  }

  async generate(prompt: string, options: { size?: string; signal?: AbortSignal } = {}): Promise<ImageResult> {
    let response: Response
    try {
      response = await fetch(endpoint(this.baseURL, 'images/generations'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey.length === 0 ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          n: 1,
          size: options.size ?? '1024x1024',
          response_format: 'b64_json',
        }),
        signal: withTimeout(options.signal, this.timeoutMs),
      })
    } catch (error) {
      throw new ProviderError('network', `图片接口请求失败：${(error as Error).message}`)
    }
    if (!response.ok) {
      throw new ProviderError('http', `图片接口返回 HTTP ${response.status}：${await responseText(response)}`, response.status)
    }
    const payload = (await response.json().catch(() => null)) as
      | { data?: Array<{ b64_json?: string; url?: string }> }
      | null
    const row = payload?.data?.[0]
    if (row?.b64_json !== undefined) {
      return { bytes: new Uint8Array(Buffer.from(row.b64_json, 'base64')), mediaType: 'image/png' }
    }
    if (row?.url !== undefined) {
      const image = await fetch(row.url, { signal: withTimeout(options.signal, this.timeoutMs) })
      if (!image.ok) throw new ProviderError('http', `图片下载失败 HTTP ${image.status}`, image.status)
      return {
        bytes: new Uint8Array(await image.arrayBuffer()),
        mediaType: image.headers.get('content-type') ?? 'image/png',
      }
    }
    throw new ProviderError('empty', '图片接口没有返回图片')
  }
}
