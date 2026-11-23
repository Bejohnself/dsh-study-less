/**
 * Conversational generation: ask, questions and judging a written answer.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { judgePrompt, parseJsonObject, questionsPrompt, quizJudgePrompt } from '../generate/prompts.ts'
import { textProviderFrom } from '../providers/index.ts'
import { normalizeVerdict } from './normalize.ts'
import type { QuizItem } from '../../core/types.ts'
import type { QuizJudgePromptInput } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService, JudgeResult } from '../generation.ts'
import type { GeneratedQuestion } from './shared.ts'
import type { UsageCallView } from '../../core/views.ts'
import { asRecord } from './normalize.ts'
import { ACTION_SYSTEM, ASK_SYSTEM, JUDGE_TIMEOUT_MS, QUESTION_TIMEOUT_MS, completeStructured } from './shared.ts'

export async function ask(svc: GenerationService, input: { material: string; unit: string; page?: number; question?: string; quote?: string; action?: string }): Promise<{ answer: string; truncated?: boolean; usage: UsageCallView }> {
  const question = (input.question ?? '').trim()
  // A quick action is a one-shot instruction, not a question: it gets its own
  // system prompt so "translate this" is not squeezed into a 120-character answer.
  const action = (input.action ?? '').trim()
  if (question.length === 0 && action.length === 0) throw new StudyError('invalid', '问题或动作不能为空')
  if (question.length > 400) throw new StudyError('invalid', '问题太长，改短一点再问')
  if (action.length > 400) throw new StudyError('invalid', '动作太长，改短一点再试')
  // The selected passage is context, not part of the question. It gets its own
  // bounded block so selecting a long paragraph cannot trip the 400-char cap.
  const quote = input.quote?.trim().slice(0, 4_000) ?? ''
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const material = await svc.deps.service.unitMaterial(input.material, input.unit, 8_000)
  // 400 tokens used to cut ordinary answers off mid-sentence, and a translation
  // needs roughly one token per source character. Scale with the passage, keep a
  // floor so a plain question still has room, and stop at the same ceiling the
  // settings form allows.
  const maxTokens = Math.max(800, Math.min(8_192, 512 + quote.length * 2))
  const at = input.page === undefined ? '' : `（正在读 p${String(input.page)}）`
  const result = await provider.complete({
    system: action.length > 0 ? ACTION_SYSTEM : ASK_SYSTEM,
    user: [
      `《${material.material.title}》·「${material.node.title}」${at}`,
      '',
      '## 这一节的原文',
      material.text,
      ...(quote.length === 0 ? [] : ['', '## 读者选中的原文', quote]),
      '',
      action.length > 0 ? '## 读者的要求' : '## 读者的问题',
      action.length > 0 ? action : question,
    ].join('\n'),
    maxTokens,
    temperature: 0.3,
  })
  return {
    answer: result.text.trim(),
    ...(result.truncated === true ? { truncated: true } : {}),
    usage: await svc.deps.usage.record(result.usage),
  }
}

export async function judgeQuizAnswer(svc: GenerationService, input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
  return runJudge(svc, quizJudgePrompt(input), signal, '判分超时：稍后重试，或先自评')
}

/** One model call shared by both judges; the prompts differ, the parsing does not. */
async function runJudge(
  svc: GenerationService,
  prompt: { system: string; user: string },
  signal: AbortSignal | undefined,
  timeoutMessage: string,
): Promise<JudgeResult> {
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await completeStructured(provider, {
      system: prompt.system,
      user: prompt.user,
      temperature: 0,
      maxTokens: 2_048,
      signal: controller.signal,
    })
    const usage = await svc.deps.usage.record(result.usage)
    const parsed = asRecord(parseJsonObject(result.text))
    const verdict = normalizeVerdict(parsed.verdict, parsed.confidence)
    const missing = Array.isArray(parsed.missing)
      ? parsed.missing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6)
      : []
    const advice = typeof parsed.advice === 'string' && parsed.advice.trim().length > 0 ? parsed.advice.trim() : undefined
    return {
      verdict,
      missing,
      ...(advice === undefined ? {} : { advice }),
      confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : 1,
      engine: provider.name,
      ...(result.model === undefined ? {} : { model: result.model }),
      usage,
    }
  } catch (error) {
    if (controller.signal.aborted) throw new StudyError('unsupported', timeoutMessage)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function testEngine(svc: GenerationService, kind: 'text' | 'image' | 'animation' | 'embedding'): Promise<Record<string, unknown>> {
  const settings = await svc.deps.settings.current()
  const started = Date.now()
  try {
    if (kind === 'text') {
      const provider = textProviderFrom(settings, svc.deps)
      const result = await provider.complete({ system: '只回复两个字：可用', user: '测试连接' })
      await svc.deps.usage.record(result.usage)
      return {
        ok: true,
        engine: provider.name,
        ...(result.model === undefined ? {} : { model: result.model }),
        latencyMs: Date.now() - started,
        reply: result.text.slice(0, 60),
      }
    }
    if (kind === 'embedding') {
      const { embeddingProviderFrom } = await import('../providers/index.ts')
      const provider = embeddingProviderFrom(settings)
      const vectors = await provider.embed(['study desk'])
      return { ok: true, engine: provider.name, latencyMs: Date.now() - started, dimensions: vectors[0]?.length ?? 0 }
    }
    return { ok: false, engine: kind, message: '该能力将在后续阶段接入；当前只启用文本引擎。' }
  } catch (error) {
    return {
      ok: false,
      engine: kind,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
