/**
 * Engine work one practice session outsources.
 *
 * Target discovery, opening a bank on demand, topping it up when the pending
 * points have no question left, the section-pass confirmation and the judge
 * input of one answer. None of this is session state: the service owns that.
 */
import type { QuizBank, QuizItem, QuizSession, QuizSessionScope } from '../core/types.ts'
import type { MasteryQuizPromptInput, QuizJudgePromptInput, SectionJudgePromptInput } from './generate/prompts.ts'
import type { JudgeResult } from './generation.ts'
import { answerTextOf } from './quizSessionViews.ts'
import type { StudyService } from './service.ts'

/** The slice of the generation service that practice sessions use. */
export interface QuizEngine {
  textReady(): Promise<boolean>
  judgeQuizAnswer(input: QuizJudgePromptInput, signal?: AbortSignal): Promise<JudgeResult>
  /** Plan-scoped practice writes one question per open mastery point. */
  masteryQuiz(input: MasteryQuizPromptInput): Promise<{ items: QuizItem[] }>
  /** Confirm that every knowledge point of a section passed. */
  sectionPassed(input: SectionJudgePromptInput): Promise<JudgeResult>
  /** Write extra questions for the points still pending in a session. */
  moreQuizItems(input: {
    material: string
    unit: string
    count: number
    focus?: readonly string[]
    avoid?: readonly string[]
  }): Promise<QuizItem[]>
}

/** Human-readable scope, shared by the answer judge and the section judge. */
export function contextOf(scope: QuizSessionScope): string {
  return scope.kind === 'book'
    ? `自编书 ${scope.book} / 章节 ${scope.chapter ?? ''}`
    : `资料 ${scope.material} / 单元 ${scope.unit}`
}

/**
 * Knowledge points one section must pass.
 *
 * The unit's own concepts come first; a unit without any falls back to the
 * concepts its bank already carries. Book chapters have no target list and end
 * on the question cap instead. Ten points is the most one round can chase.
 */
export async function targetsOf(
  svc: StudyService,
  scope: QuizSessionScope,
  bank: QuizBank | null,
): Promise<string[]> {
  if (scope.kind !== 'unit') return []
  let concepts: string[] = []
  try {
    concepts = (await svc.unit(scope.material, scope.unit)).unit.concepts ?? []
  } catch {
    // A unit that cannot be read should not block practice: fall back to the
    // concepts the bank already carries.
  }
  if (concepts.length === 0 && bank !== null) concepts = bank.items.flatMap(item => item.concepts)
  return [...new Set(concepts)].slice(0, 10)
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
 * Best effort: without an engine, or on a model error, the session simply
 * continues with what it has and ends on the cap. Returns how many were added.
 */
export async function topUp(
  svc: StudyService,
  engine: QuizEngine | undefined,
  session: QuizSession,
  focus: readonly string[],
): Promise<number> {
  if (session.scope.kind !== 'unit' || engine === undefined || focus.length === 0) return 0
  if (!(await engine.textReady())) return 0
  const scope = session.scope
  try {
    const bank = await svc.quiz(scope.material, scope.unit)
    if (bank === null) return 0
    const produced = await engine.moreQuizItems({
      material: scope.material,
      unit: scope.unit,
      count: Math.min(3, Math.max(1, focus.length)),
      focus,
      avoid: session.history.map(entry => entry.question ?? '').filter(question => question.length > 0),
    })
    if (produced.length === 0) return 0
    const ids = new Set(bank.items.map(item => item.id))
    const extra = produced.map((item, index) => {
      let id = `q${String(bank.items.length + index + 1)}`
      while (ids.has(id)) id = `${id}x`
      ids.add(id)
      return { ...item, id, origin: 'weakness' as const }
    })
    const updated = await svc.writeQuiz(scope.material, scope.unit, [...bank.items, ...extra])
    session.bankUpdatedAt = updated.updatedAt
    return extra.length
  } catch {
    return 0
  }
}

/**
 * Confirm the section with the model before closing it.
 *
 * The deterministic pass (latest verdict per point) is necessary but not
 * sufficient: one lucky answer can cover a point. The model sees every
 * question/answer/verdict pair and decides whether the section is really done.
 * Without an engine there is nothing to ask, so the deterministic result
 * stands. At most three checks per session, two answers apart.
 */
export async function sectionConfirmed(
  svc: StudyService,
  engine: QuizEngine | undefined,
  session: QuizSession,
  targets: readonly string[],
): Promise<boolean> {
  if (targets.length === 0) return true
  if (engine === undefined || !(await engine.textReady())) return true
  const previous = session.sectionCheck
  if (previous?.verdict === 'pass') return true
  if (previous !== undefined && (previous.checks >= 3 || session.asked.length < previous.askedAt + 2)) {
    return false
  }
  const names = new Map((await svc.concepts()).map(concept => [concept.id, concept.name]))
  const digest = session.history
    .map(entry => {
      const verdict =
        entry.judged?.verdict ?? (entry.correct === true ? 'pass' : entry.correct === false ? 'fail' : '未判')
      return `- 问：${entry.question ?? entry.itemId}\n  答：${entry.answerText ?? '（没写）'}\n  判定：${verdict}`
    })
    .join('\n')
  try {
    const judged = await engine.sectionPassed({
      context: contextOf(session.scope),
      targets: targets.map(id => ({ id, name: names.get(id) ?? id })),
      digest,
    })
    session.sectionCheck = {
      verdict: judged.verdict,
      missing: judged.missing,
      at: new Date().toISOString(),
      checks: (previous?.checks ?? 0) + 1,
      askedAt: session.asked.length,
    }
    return judged.verdict === 'pass'
  } catch {
    // A section judgement is an extra check; a timeout must not trap the
    // reader in a run that already passed every point deterministically.
    return true
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
    (scope.kind === 'unit' || scope.kind === 'plan') && item.page !== undefined
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