import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { readKnowledge } from '../src/core/knowledge.ts'
import { readProgress } from '../src/core/progress.ts'
import type { QuizBank, QuizJudgeVerdict } from '../src/core/types.ts'
import type { QuizJudgePromptInput } from '../src/host/generate/prompts.ts'
import { QuizSessionService, type QuizEngine } from '../src/host/quizSessions.ts'
import type { StudyService } from '../src/host/service.ts'

const root = await mkdtemp(join(tmpdir(), 'study-quiz-judge-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const bank: QuizBank = {
  version: 1,
  unit: 'u1',
  updatedAt: '2026-01-01T00:00:00.000Z',
  items: [
    {
      id: 'q1',
      type: 'recall',
      question: '为什么不能把有限阶段 DP 的结论机械外推到无界代价问题？',
      rubric: ['指出需要极限与 min、期望交换的条件', '指出无界代价可能出现例外'],
      concepts: ['dp/unbounded-cost'],
      origin: 'generated',
      page: 1,
      difficulty: 2,
    },
  ],
}

const service = {
  quiz: async () => bank,
  hasNotes: async () => true,
  concepts: async () => [],
  readPages: async () => ({ pages: [{ page: 1, text: '原文提醒：极限并非无条件成立。' }], truncated: false }),
} as unknown as StudyService

/** A judge that returns the scripted verdicts in order and records its inputs. */
function scriptedJudge(verdicts: QuizJudgeVerdict[]): { judge: QuizEngine; calls: QuizJudgePromptInput[] } {
  const calls: QuizJudgePromptInput[] = []
  const judge: QuizEngine = {
    textReady: async () => true,
    masteryQuiz: async () => ({ items: [] }),
    judgeQuizAnswer: async input => {
      calls.push(input)
      const verdict = verdicts[Math.min(calls.length - 1, verdicts.length - 1)] ?? 'partial'
      return {
        verdict,
        missing: verdict === 'pass' ? [] : ['缺边界条件'],
        advice: '补上适用条件',
        confidence: 0.9,
        engine: 'fake',
      }
    },
    sectionPassed: async () => ({
      verdict: 'pass',
      missing: [],
      confidence: 0.9,
      engine: 'fake',
    }),
    extractConcepts: async () => [],
    moreQuizItems: async () => [],
  }
  return { judge, calls }
}

const paths = new LibraryPaths(root)
const sidOf = (view: { session: { id: string } }): string => view.session.id

test('a written answer is judged by the model and updates concept mastery', async () => {
  const sessions = new QuizSessionService(paths, service, undefined, scriptedJudge(['partial']).judge)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  const answered = await sessions.answer(sid, 'q1', '因为可以取极限，所以直接推。')
  assert.equal(answered.feedback.judged?.verdict, 'partial')
  assert.equal(answered.feedback.correct, false)
  assert.deepEqual(answered.feedback.judged?.missing, ['缺边界条件'])
  assert.equal(answered.history[0]?.judged?.engine, 'fake')

  const progress = await readProgress(paths)
  assert.equal(progress.concepts['dp/unbounded-cost']?.mastery, 0.375)

  const knowledge = await readKnowledge(paths)
  assert.ok(knowledge.concepts['dp/unbounded-cost'] !== undefined, 'practice writes the knowledge space')
  assert.equal(Object.keys(knowledge.concepts['dp/unbounded-cost']?.evidence ?? {}).length, 1)
})

test('an appeal is re-judged from the original answer and the rebuttal', async () => {
  const { judge, calls } = scriptedJudge(['fail', 'pass'])
  const sessions = new QuizSessionService(paths, service, undefined, judge)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  const answer = '先验证极限与 min 可交换，再讨论无界代价的例外。'
  await sessions.answer(sid, 'q1', answer)
  const reason = '我补充了极限与 min 交换的条件，这属于评分要点'
  const appealed = await sessions.appeal(sid, 'q1', reason, 'correct')
  const entry = appealed.history[0]

  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.answer, answer)
  assert.equal(calls[1]?.rebuttal, reason)
  assert.equal(calls[1]?.claim, 'correct')
  assert.equal(calls[1]?.previousVerdict, 'fail')
  assert.equal(entry?.correct, true)
  assert.equal(entry?.judged?.verdict, 'pass')
  assert.equal(entry?.appeals?.length, 1)
  assert.equal(entry?.appeals?.[0]?.from, 'fail')
  assert.equal(entry?.appeals?.[0]?.verdict, 'pass')
  assert.equal(entry?.appeals?.[0]?.reason, reason)
  assert.equal(appealed.summary?.correct, 1)
})

test('without an engine the answer falls back to self-grade', async () => {
  const sessions = new QuizSessionService(paths, service)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  const pending = await sessions.answer(sid, 'q1', '写了一半')
  assert.equal(pending.feedback.needsSelfGrade, true)
  assert.equal(pending.feedback.judgeUnavailable, '没有可用的文本引擎')
  assert.equal(pending.history.length, 0)

  const graded = await sessions.answer(sid, 'q1', '写了一半', 'correct')
  assert.equal(graded.history[0]?.correct, true)
  assert.equal(graded.history[0]?.selfGrade, 'correct')
})

test('appeals are unlimited and the last re-judged verdict wins', async () => {
  const { judge, calls } = scriptedJudge(['fail', 'pass', 'fail'])
  const sessions = new QuizSessionService(paths, service, undefined, judge)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  await sessions.answer(sid, 'q1', '初始答案')
  await sessions.appeal(sid, 'q1', '第一次补充：给出交换条件', 'correct')
  const second = await sessions.appeal(sid, 'q1', '第二次申诉：只是坚持原结论', 'correct')
  const entry = second.history[0]

  assert.equal(calls.length, 3)
  assert.equal(calls[2]?.previousVerdict, 'pass')
  assert.deepEqual(calls[2]?.previousRebuttals, ['第一次补充：给出交换条件'])
  assert.equal(entry?.appeals?.length, 2)
  assert.equal(entry?.judged?.verdict, 'fail')
  assert.equal(entry?.correct, false)
  assert.equal(second.summary?.correct, 0)
})

test('appeal without an engine is refused instead of taking the reader at their word', async () => {
  const { judge } = scriptedJudge(['fail'])
  const sessions = new QuizSessionService(paths, service, undefined, judge)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  await sessions.answer(sid, 'q1', '答案')
  const noEngine = new QuizSessionService(paths, service)
  await assert.rejects(() => noEngine.appeal(sid, 'q1', '我认为我答对了'), /需要可用的文本引擎/)
})

test('a rebuttal copied from the rubric is refused before calling the model', async () => {
  const { judge, calls } = scriptedJudge(['fail'])
  const sessions = new QuizSessionService(paths, service, undefined, judge)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  const sid = sidOf(started)
  await sessions.answer(sid, 'q1', '答案')
  assert.equal(calls.length, 1)
  const copied = [...(bank.items[0]?.rubric ?? [])].join('')
  await assert.rejects(() => sessions.appeal(sid, 'q1', copied), /不能直接抄评分要点/)
  assert.equal(calls.length, 1)
})


/* ---------------------------------------------- section completion ------ */

const choiceBank = (count: number, concept = 'dp/basics'): QuizBank => ({
  version: 1,
  unit: 'u2',
  updatedAt: '2026-02-01T00:00:00.000Z',
  items: Array.from({ length: count }, (_, index) => ({
    id: `c${String(index + 1)}`,
    type: 'choice' as const,
    question: `第 ${String(index + 1)} 题：这一步为什么成立？`,
    choices: ['因为是定义', '因为可以取极限'],
    answerIndex: 0,
    concepts: [concept],
    origin: 'generated' as const,
    difficulty: 1 as const,
  })),
})

const choiceService = (items: QuizBank['items']): StudyService =>
  ({
    quiz: async () => ({ ...choiceBank(items.length), items }),
    hasNotes: async () => true,
    concepts: async () => [],
    readPages: async () => ({ pages: [], truncated: false }),
  }) as unknown as StudyService

test('a two-question run is not rated, however correct it was', async () => {
  const sessions = new QuizSessionService(paths, choiceService(choiceBank(2).items))
  const started = await sessions.start({ material: 'm2', unit: 'u2' })
  const sid = sidOf(started)
  const first = await sessions.answer(sid, started.item!.id, 0)
  assert.equal(first.summary, undefined, 'two items are not a whole section run')
  const second = await sessions.answer(sid, first.next!.id, 0)
  assert.equal(second.summary?.verdict, 'incomplete')
  assert.equal(second.summary?.rating, undefined)
  assert.equal(second.session.endedReason, 'exhausted')
})

test('a full run that covers every point closes as passed', async () => {
  const sessions = new QuizSessionService(paths, choiceService(choiceBank(5).items))
  const started = await sessions.start({ material: 'm3', unit: 'u3' })
  const sid = sidOf(started)
  let current = started.item!.id
  let last = await sessions.answer(sid, current, 0)
  for (let index = 1; index < 5; index += 1) {
    current = last.next!.id
    last = await sessions.answer(sid, current, 0)
  }
  assert.equal(last.session.status, 'done')
  assert.equal(last.session.endedReason, 'completed')
  assert.equal(last.summary?.verdict, 'passed')
  assert.equal(last.summary?.rating, 4)
})
