/**
 * Quiz grading rules.
 *
 * The run itself lives in the Host: it asks one question at a time for the
 * section's weakest knowledge point and stops when the ledger says every point
 * reached its threshold. This module only decides what an answer proves.
 */
import { START_MASTERY } from './knowledge.ts'
import type { QuizItem, QuizSessionScope } from './types.ts'

/** Whether an item can be graded without asking the reader to self-assess. */
export function isObjectiveItem(item: QuizItem): boolean {
  return item.type === 'choice'
}

/** Whether an item takes a written answer that a model should judge. */
export function needsWrittenJudge(item: QuizItem): boolean {
  return item.type !== 'choice'
}

/**
 * Normalize a free-text answer for comparison.
 *
 * LaTeX is folded to the form KaTeX would render (`\dfrac` == `\frac`, `\left`
 * and spacing macros are noise), so two spellings of the same formula are not
 * graded differently. Folding stops here: a model judge decides meaning.
 */
export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\\[dt]?frac/g, 'frac')
    .replace(/\\left|\\right|\\!|\\,|\\;|\\quad|\\qquad/g, '')
    .replace(/\$+/g, '')
    .replace(/[\s,，。、;；:：!！?？"'“”‘’()（）[\]【】]/g, '')
    .trim()
}

/**
 * Whether a rebuttal is mostly copied from the rubric or explanation.
 *
 * A reader may quote a line and explain it, so this only fires when most of the
 * rebuttal's character n-grams also sit in the scoring material. That catches
 * pasting the whole rubric while leaving paraphrases alone.
 */
export function looksCopiedFromRubric(rebuttal: string, source: readonly string[]): boolean {
  const text = normalizeAnswer(rebuttal)
  if (text.length < 12) return false
  const material = normalizeAnswer(source.join(''))
  if (material.length < 12) return false

  const size = 4
  const sourceGrams = new Set<string>()
  for (let index = 0; index + size <= material.length; index += 1) {
    sourceGrams.add(material.slice(index, index + size))
  }
  let total = 0
  let shared = 0
  for (let index = 0; index + size <= text.length; index += 1) {
    total += 1
    if (sourceGrams.has(text.slice(index, index + size))) shared += 1
  }
  return total > 0 && shared / total >= 0.75
}

/** Grading outcome: objective verdict, or null when a human/agent must grade. */
export type GradeVerdict = { correct: boolean } | { correct: null; reason: 'manual' }

/** Grade an objectively gradable item. */
export function gradeQuizItem(item: QuizItem, answer: unknown): GradeVerdict {
  switch (item.type) {
    case 'choice': {
      const index =
        typeof answer === 'number'
          ? answer
          : typeof answer === 'string' && item.choices !== undefined
            ? item.choices.findIndex(choice => normalizeAnswer(choice) === normalizeAnswer(answer))
            : -1
      return { correct: index === item.answerIndex }
    }
    case 'cloze': {
      if (typeof answer !== 'string' || item.answer === undefined) return { correct: false }
      // A fast path only: an equal spelling is right without a model call. A
      // different spelling (LaTeX variants, synonyms) goes to the judge, so
      // this never decides "wrong" on its own.
      return { correct: normalizeAnswer(answer) === normalizeAnswer(item.answer) }
    }
    case 'evidence': {
      // Locating a page is only half the answer; a page match alone must not
      // grade an explanation. The model judge (or the reader) decides.
      return { correct: null, reason: 'manual' }
    }
    case 'recall':
    case 'apply':
      return { correct: null, reason: 'manual' }
    default:
      return { correct: null, reason: 'manual' }
  }
}

/**
 * Difficulty the next question should aim at.
 *
 * Measured by how much of the climb to the threshold is left: a fresh point
 * (half its span gone) gets an easy question, one about to pass gets a hard
 * one. A wrong answer drops mastery, so the next question steps back down.
 */
export function nextDifficulty(
  points: ReadonlyArray<{ mastery: number; threshold: number }>,
  roll: number = Math.random(),
): 1 | 2 | 3 {
  const open = points.filter(point => point.mastery < point.threshold)
  const pool = open.length > 0 ? open : points
  if (pool.length === 0) return 2
  const left = pool.map(point => {
    const span = point.threshold - START_MASTERY
    return span <= 0 ? 0 : (point.threshold - point.mastery) / span
  })
  const ratio = left.reduce((sum, value) => sum + value, 0) / left.length
  if (ratio > 0.6) return 1
  if (ratio > 0.25) return 2
  // Hard is a spice, not a requirement: close to the threshold most questions
  // stay normal, so passing a section never depends on slow, long hard ones.
  return roll < 0.35 ? 3 : 2
}

/**
 * Difficulty of a written question, judged from its shape.
 *
 * The authoring model is told which level to write at, so asking it to rate the
 * same question anchors the answer — its tag is therefore not what gets
 * recorded. Shape is the part we can check without another model call: two
 * numbered parts or a proof make a question hard however it was tagged. A
 * calibration that needs semantics can replace this function with a blind judge
 * later; the caller only needs a 1–3.
 */
export function assessDifficulty(item: {
  question: string
  rubric?: readonly string[]
  concepts: readonly string[]
}): 1 | 2 | 3 {
  const question = item.question.trim()
  const multiPart = /[（(]\s*[1１]\s*[)）][\s\S]*[（(]\s*[2２]\s*[)）]/.test(question)
  const proof = /证明|求证|反例/.test(question)
  const reasoning = /为什么|比较|区别|条件|构造|举出|推导/.test(question)
  const long = question.length >= 160
  const rubric = (item.rubric ?? []).length
  const score =
    (multiPart ? 2 : 0) + (proof ? 2 : 0) + (reasoning ? 1 : 0) + (long ? 1 : 0) + (rubric >= 4 ? 1 : 0)
  if (score >= 3) return 3
  if (score >= 1) return 2
  return 1
}

/** The effective difficulty of an item (absent means normal). */
export function difficultyOf(item: QuizItem): 1 | 2 | 3 {
  return item.difficulty ?? 2
}

/** Whether two sessions measure the same scope. */
export function sameQuizScope(a: QuizSessionScope, b: QuizSessionScope): boolean {
  if (a.kind === 'unit' && b.kind === 'unit') {
    return a.material === b.material && a.unit === b.unit
  }
  return false
}
