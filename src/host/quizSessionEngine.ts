/**
 * Engine work one practice session outsources.
 *
 * Writing the next question, and the judge input of one answer. None of this is
 * session state: the service owns that. The section-pass decision is not here on
 * purpose — it reads the one ledger (`knowledge.json`), not a model.
 */
import type { QuizItem, UsageAmount } from '../core/types.ts'
import type { QuizJudgePromptInput } from './generate/prompts.ts'
import type { JudgeResult } from './generation.ts'
import { answerTextOf } from './quizSessionViews.ts'
import { assessDifficulty } from '../core/quiz.ts'
import { StudyError, type StudyService } from './service.ts'

/** The slice of the generation service that practice sessions use. */
export interface QuizEngine {
  textReady(): Promise<boolean>
  judgeQuizAnswer(input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult>
  /** Extract the knowledge points of a unit when it has none yet. */
  extractConcepts(input: { material: string; unit: string }): Promise<
    Array<{ id: string; name: string; definition?: string; page?: number }>
  >
  /** Write questions for the given knowledge points; practice asks for one. */
  moreQuizItems(input: {
    material: string
    unit: string
    count: number
    focus?: readonly string[]
    avoid?: readonly string[]
    difficulty?: 1 | 2 | 3
  }): Promise<{ items: QuizItem[]; usage?: UsageAmount }>
}

/** Human-readable scope, shared by the answer judge and the prompts. */
export function contextOf(scope: {material: string; unit: string}): string {
  return `资料 ${scope.material} / 单元 ${scope.unit}`
}

/** The message every practice page shows when no model is configured. */
export const NO_ENGINE_MESSAGE = '还没有可用的模型：过关测试每次要现场出题、作答由模型判分，先在设置里配置文本引擎'

/** Whether the text engine can write and judge questions right now. */
export async function engineReady(engine: QuizEngine | undefined): Promise<boolean> {
  return engine !== undefined && (await engine.textReady())
}

/**
 * Write the one question the run asks next.
 *
 * It targets the knowledge points the run picked (up to three), and is never
 * stored as a bank: the next answer decides what to ask after it. A model
 * failure is surfaced, never swallowed — a silent empty result used to look
 * like a dead button.
 */
export async function questionFor(
  engine: QuizEngine | undefined,
  scope: {material: string; unit: string},
  conceptIds: readonly string[],
  options: {avoid?: string; difficulty?: 1 | 2 | 3} = {},
): Promise<{ item: QuizItem; usage?: UsageAmount }> {
  if (!(await engineReady(engine))) throw new StudyError('unsupported', NO_ENGINE_MESSAGE)
  let produced: { items: QuizItem[]; usage?: UsageAmount }
  try {
    produced = await engine!.moreQuizItems({
      material: scope.material,
      unit: scope.unit,
      count: 1,
      focus: conceptIds,
      ...(options.avoid === undefined || options.avoid.length === 0 ? {} : { avoid: [options.avoid] }),
      ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
    })
  } catch (error) {
    throw new StudyError('unsupported', `出题失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const item = produced.items[0]
  if (item === undefined) throw new StudyError('unsupported', '模型这次没出到题，稍后再试')
  return {
    // Ids only have to be unique inside one run: nothing is looked up later.
    // Difficulty is judged here, after the question exists: the author's tag is
    // anchored by the level we asked it to write at, so it is not trusted.
    item: {
      ...item,
      id: `q-${crypto.randomUUID().slice(0, 8)}`,
      origin: 'weakness',
      difficulty: assessDifficulty(item),
    },
    ...(produced.usage === undefined ? {} : { usage: produced.usage }),
  }
}

/** Everything the answer judge needs about one written answer. */
export async function judgeInputOf(
  svc: StudyService,
  scope: {material: string; unit: string},
  item: QuizItem,
  answer: unknown,
): Promise<QuizJudgePromptInput> {
  const reference = item.page === undefined ? undefined : await pageText(svc, scope.material, item.page)
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