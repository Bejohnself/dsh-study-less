/**
 * Conversational generation: ask, questions and judging a written answer.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { judgePrompt, masteryQuizPrompt, parseJsonObject, questionsPrompt, quizJudgePrompt, sectionJudgePrompt } from '../generate/prompts.ts'
import { textProviderFrom } from '../providers/index.ts'
import { normalizeVerdict } from '../../core/planGate.ts'
import type { QuizItem } from '../../core/types.ts'
import type { JudgePromptInput, MasteryQuizPromptInput, QuestionPromptInput, QuizJudgePromptInput, SectionJudgePromptInput } from '../generate/prompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService, JudgeResult } from '../generation.ts'
import { asRecord, normalizeMasteryQuizItems } from './normalize.ts'
import { ASK_SYSTEM, JUDGE_TIMEOUT_MS, QUESTION_TIMEOUT_MS } from './shared.ts'

export async function ask(svc: GenerationService, input: { material: string; unit: string; page?: number; question: string }): Promise<{ answer: string }> {
  const question = input.question.trim()
  if (question.length === 0) throw new StudyError('invalid', '问题不能为空')
  if (question.length > 400) throw new StudyError('invalid', '问题太长，改短一点再问')
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const material = await svc.deps.service.unitMaterial(input.material, input.unit, 8_000)
  const at = input.page === undefined ? '' : `（正在读 p${String(input.page)}）`
  const result = await provider.complete({
    system: ASK_SYSTEM,
    user: [
      `《${material.material.title}》·「${material.node.title}」${at}`,
      '',
      '## 这一节的原文',
      material.text,
      '',
      '## 读者的问题',
      question,
    ].join('\n'),
    maxTokens: 400,
    temperature: 0.3,
  })
  return { answer: result.text.trim() }
}

export async function generateQuestions(svc: GenerationService, input: QuestionPromptInput, signal?: AbortSignal): Promise<{ questions: GeneratedQuestion[]; engine: string; model?: string }> {
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const prompt = questionsPrompt(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.4,
      maxTokens: 4096,
      signal: controller.signal,
    })
    const parsed = asRecord(parseJsonObject(result.text))
    const raw = Array.isArray(parsed.questions) ? parsed.questions : []
    const allowed = new Set(input.ranges.map(range => range.id))
    const questions: GeneratedQuestion[] = []
    for (const entry of raw) {
      const row = asRecord(entry)
      const q = typeof row.q === 'string' ? row.q.trim() : ''
      if (q.length < 6) continue
      const why = typeof row.why === 'string' && row.why.trim().length > 0 ? row.why.trim() : undefined
      const ref = typeof row.ref === 'string' && allowed.has(row.ref.trim()) ? row.ref.trim() : undefined
      questions.push({ q, ...(why === undefined ? {} : { why }), ...(ref === undefined ? {} : { ref }) })
      if (questions.length >= 8) break
    }
    if (questions.length === 0) throw new StudyError('invalid', '模型没有给出可用的判定题，稍后重试')
    return { questions, engine: provider.name, ...(result.model === undefined ? {} : { model: result.model }) }
  } catch (error) {
    if (controller.signal.aborted) throw new StudyError('unsupported', '出题超时：稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Write one question per open mastery point.
 *
 * Unlike the unit bank this is not queued: the session needs the questions
 * before it can show the first one, and the round is short. The result lives on
 * the session, so regenerating a unit bank never touches it.
 */
export async function generateMasteryQuiz(
  svc: GenerationService,
  input: MasteryQuizPromptInput,
  signal?: AbortSignal,
): Promise<{ items: QuizItem[]; engine: string; model?: string }> {
  if (input.points.length === 0) throw new StudyError('invalid', '这一节没有要考的掌握点')
  const settings = await svc.requireSettings()
  const provider = textProviderFrom(settings, svc.deps)
  const prompt = masteryQuizPrompt(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUESTION_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      temperature: 0.3,
      maxTokens: 4096,
      signal: controller.signal,
    })
    const items = normalizeMasteryQuizItems(parseJsonObject(result.text), {
      points: input.points,
      range: { pageStart: input.pageStart, pageEnd: input.pageEnd },
    })
    return { items, engine: provider.name, ...(result.model === undefined ? {} : { model: result.model }) }
  } catch (error) {
    if (controller.signal.aborted) throw new StudyError('unsupported', '出题超时：稍后重试')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function judgeAnswer(svc: GenerationService, input: JudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
  return runJudge(svc, judgePrompt(input), signal, '判定超时：稍后重试，或先自评')
}

export async function judgeQuizAnswer(svc: GenerationService, input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
  return runJudge(svc, quizJudgePrompt(input), signal, '判分超时：稍后重试，或先自评')
}

/** Confirm that every knowledge point of one section has been passed. */
export async function judgeSectionPassed(svc: GenerationService, input: SectionJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult> {
  return runJudge(svc, sectionJudgePrompt(input), signal, '结案判定超时：稍后再试')
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
    const result = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      temperature: 0,
      maxTokens: 2048,
      signal: controller.signal,
    })
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
      return {
        ok: true,
        engine: provider.name,
        ...(result.model === undefined ? {} : { model: result.model }),
        latencyMs: Date.now() - started,
        reply: result.text.slice(0, 60),
      }
    }
    if (kind === 'embedding') {
      const { embeddingProviderFrom } = await import('./providers/index.ts')
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
