/**
 * Engine work one practice session outsources.
 *
 * Opening a bank on demand, topping a spent bank up with new questions on the
 * points still open, and the judge input of one answer. None of this is session
 * state: the service owns that. The section-pass decision is not
 * here on purpose — it reads the one ledger (`knowledge.json`), not a model.
 */
import type { QuizBank, QuizItem, QuizSessionScope } from '../core/types.ts'
import type { QuizJudgePromptInput } from './generate/prompts.ts'
import type { JudgeResult } from './generation.ts'
import { answerTextOf } from './quizSessionViews.ts'
import type { StudyService } from './service.ts'

/** The slice of the generation service that practice sessions use. */
export interface QuizEngine {
  textReady(): Promise<boolean>
  judgeQuizAnswer(input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult>
  /** Extract the knowledge points of a unit when it has none yet. */
  extractConcepts(input: { material: string; unit: string }): Promise<
    Array<{ id: string; name: string; definition?: string; page?: number }>
  >
  /** Write extra questions for the points still open in a session. */
  moreQuizItems(input: {
    material: string
    unit: string
    count: number
    focus?: readonly string[]
    avoid?: readonly string[]
  }): Promise<QuizItem[]>
}

/** Human-readable scope, shared by the answer judge and the prompts. */
export function contextOf(scope: QuizSessionScope): string {
  return scope.kind === 'book'
    ? `自编书 ${scope.book} / 章节 ${scope.chapter ?? ''}`
    : `资料 ${scope.material} / 单元 ${scope.unit}`
}

/** Write the first question of a unit round on demand. */
export async function seedBank(
  svc: StudyService,
  engine: QuizEngine | undefined,
  scope: QuizSessionScope,
  targets: readonly string[],
): Promise<QuizBank | null> {
  if (scope.kind !== 'unit' || engine === undefined) return null
  if (!(await engine.textReady())) return null
  try {
    const produced = await engine.moreQuizItems({
      material: scope.material,
      unit: scope.unit,
      count: 1,
      ...(targets.length === 0 ? {} : { focus: targets }),
    })
    if (produced.length === 0) return null
    return await svc.writeQuiz(
      scope.material,
      scope.unit,
      produced.map((item, index) => ({ ...item, id: `q${String(index + 1)}` })),
    )
  } catch {
    return null
  }
}

/**
 * Write extra questions for the given points and append them to the bank.
 *
 * Best effort: without an engine, or on a model error, the section simply keeps
 * what it has. Returns how many were added.
 */
export async function appendQuestions(
  svc: StudyService,
  engine: QuizEngine | undefined,
  scope: QuizSessionScope,
  focus: readonly string[],
  avoid: readonly string[],
): Promise<number> {
  if (scope.kind !== 'unit' || engine === undefined || focus.length === 0) return 0
  if (!(await engine.textReady())) return 0
  try {
    const bank = await svc.quiz(scope.material, scope.unit)
    if (bank === null) return 0
    const produced = await engine.moreQuizItems({
      material: scope.material,
      unit: scope.unit,
      count: Math.min(3, Math.max(1, focus.length)),
      focus,
      ...(avoid.length === 0 ? {} : { avoid }),
    })
    if (produced.length === 0) return 0
    const ids = new Set(bank.items.map(item => item.id))
    const extra = produced.map((item, index) => {
      let id = `q${String(bank.items.length + index + 1)}`
      while (ids.has(id)) id = `${id}x`
      ids.add(id)
      return { ...item, id, origin: 'weakness' as const }
    })
    await svc.writeQuiz(scope.material, scope.unit, [...bank.items, ...extra])
    return extra.length
  } catch {
    return 0
  }
}

/** Everything the answer judge needs about one written answer. */
export async function judgeInputOf(
  svc: StudyService,
  scope: QuizSessionScope,
  item: QuizItem,
  answer: unknown,
): Promise<QuizJudgePromptInput> {
  const reference =
    scope.kind === 'unit' && item.page !== undefined
      ? await pageText(svc, scope.material, item.page)
      : undefined
  return {
    context: contextOf(scope),
    question: item.question,
    type: item.type as QuizJudgePromptInput['type'],
    rubric: item.rubric ?? [],
    answer: answerTextOf(item, answer),
    ...(item.page === undefined ? {} : { page: item.page }),
    ...(reference === undefined ? {} : { reference }),
    ...(item.type === 'cloze' && item.answer !== undefined ? { expected: item.answer } : {}),
  }
}

/** One page of the original text, for fact-checking a written answer. */
async function pageText(svc: StudyService, material: string, page: number): Promise<string | undefined> {
  const { pages } = await svc.readPages(material, page, page)
  const text = pages[0]?.text.trim()
  return text === undefined || text.length === 0 ? undefined : text
}
