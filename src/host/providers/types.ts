/**
 * Provider contracts shared by the inline generation engines.
 *
 * Every provider raises `ProviderError` with a stable code so the job layer can
 * show an actionable failure without leaking an API key or a raw response body.
 */

/** A provider refusal or transport failure. */
export class ProviderError extends Error {
  readonly code: string
  readonly status?: number

  constructor(code: string, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

/** One text completion request. */
export interface TextRequest {
  system?: string
  user: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** Called as text accumulates, for job progress. */
  onProgress?: (chars: number) => void
}

/** One text completion result. */
export interface TextResult {
  text: string
  model?: string
  /** The engine stopped at the output budget; the text may end mid-sentence. */
  truncated?: boolean
  usage?: {
    /** Non-cached input tokens. */
    inputTokens?: number
    cacheReadTokens?: number
    outputTokens?: number
    /** Some gateways report the call's own charge. */
    cost?: number
    currency?: string
  }
}

/** A text engine. */
export interface TextProvider {
  readonly name: string
  complete(request: TextRequest): Promise<TextResult>
}

/** An embedding engine. */
export interface EmbeddingProvider {
  readonly name: string
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
}

/** Generated image bytes. */
export interface ImageResult {
  bytes: Uint8Array
  mediaType: string
}

/** An image engine. */
export interface ImageProvider {
  readonly name: string
  generate(prompt: string, options: { size?: string; signal?: AbortSignal }): Promise<ImageResult>
}
