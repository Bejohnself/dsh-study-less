/**
 * The DSH-backed text engine.
 *
 * This is the default: the Host already owns provider routes and credentials, so
 * inline generation needs no second API key. The panel still lets a user point
 * text at a custom OpenAI-compatible endpoint when they want another model.
 */
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from './types.ts'

/** The model selection the Host uses by default. */
export interface DshModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The slice of `ctx.llm` used here. */
export interface DshLlmFace {
  stream(options: Record<string, unknown>): AsyncIterable<unknown>
}

/** The slice of `agentDefaultModel` used here. */
export interface DshDefaultModelFace {
  currentSelection(): DshModelSelection
}

interface StreamChunk {
  type?: string
  text?: string
  reason?: { kind?: string; failure?: { message?: string } }
  usage?: { inputTokens?: number; cacheReadTokens?: number; outputTokens?: number; cost?: number; currency?: string }
}

/** The Host-model text engine. */
export class DshTextProvider implements TextProvider {
  readonly name = 'dsh'
  private readonly llm: DshLlmFace
  private readonly selection: () => DshModelSelection | undefined

  constructor(options: { llm: DshLlmFace; selection: () => DshModelSelection | undefined }) {
    this.llm = options.llm
    this.selection = options.selection
  }

  async complete(request: TextRequest): Promise<TextResult> {
    const selection = this.selection()
    if (selection === undefined || selection.provider.length === 0 || selection.model.length === 0) {
      throw new ProviderError('no-model', 'DSH 还没有默认模型；请在设置里选择模型，或改用自定义文本 API')
    }
    const options: Record<string, unknown> = {
      provider: selection.provider,
      model: selection.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.user }] }],
      ...(request.system === undefined || request.system.trim().length === 0 ? {} : { system: request.system }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      // The effort is the model selection's alone: naming a level a model does
      // not declare is a hard request error, so generation never overrides it.
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }

    let text = ''
    let reasoning = ''
    let truncated = false
    let usage: TextResult['usage']
    try {
      for await (const raw of this.llm.stream(options)) {
        const chunk = raw as StreamChunk
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          request.onProgress?.(text.length)
        } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
          reasoning += chunk.text
        } else if (chunk.type === 'usage' && chunk.usage !== undefined) {
          usage = {
            ...(chunk.usage.inputTokens === undefined ? {} : { inputTokens: chunk.usage.inputTokens }),
            ...(chunk.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: chunk.usage.cacheReadTokens }),
            ...(chunk.usage.outputTokens === undefined ? {} : { outputTokens: chunk.usage.outputTokens }),
            ...(chunk.usage.cost === undefined ? {} : { cost: chunk.usage.cost }),
            ...(chunk.usage.currency === undefined ? {} : { currency: chunk.usage.currency }),
          }
        } else if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
          throw new ProviderError(
            chunk.reason.kind === 'aborted' ? 'aborted' : 'llm',
            chunk.reason.failure?.message ?? 'DSH 模型调用失败',
          )
        } else if (chunk.type === 'finish' && chunk.reason?.kind === 'max-tokens') {
          // A reasoning model spends the same output budget on its thinking: a
          // small maxTokens can be used up before the first answer token.
          if (text.trim().length === 0) {
            throw new ProviderError(
              'max-tokens',
              '模型把输出预算用在了思考过程上，没有返回正文；请提高最大输出长度，或把推理强度调低',
            )
          }
          // Partial answer: keep it, but tell the caller it stopped at the cap.
          truncated = true
        }
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError('llm', `DSH 模型调用失败：${(error as Error).message}`)
    }
    if (text.trim().length === 0) {
      throw new ProviderError(
        'empty',
        reasoning.trim().length === 0
          ? 'DSH 模型返回了空内容'
          : '模型只返回了思考过程，没有给出正文；请提高最大输出长度，或把推理强度调低',
      )
    }
    return {
      text,
      model: selection.model,
      ...(truncated ? { truncated: true } : {}),
      ...(usage === undefined ? {} : { usage }),
    }
  }
}
