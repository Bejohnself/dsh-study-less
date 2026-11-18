import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { gateStatus } from '../src/core/planGate.ts'
import { readPlan, writePlan } from '../src/core/plans.ts'
import { readProgress } from '../src/core/progress.ts'
import { normalizeMasteryQuizItems } from '../src/host/generation/normalize.ts'
import { QuizSessionService, type QuizEngine } from '../src/host/quizSessions.ts'
import type { StudyService } from '../src/host/service.ts'
import type { PlanRecord, QuizItem } from '../src/core/types.ts'
import type { MasteryQuizPromptInput } from '../src/host/generate/prompts.ts'

const root = await mkdtemp(join(tmpdir(), 'study-mastery-quiz-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)

const service = {
  unit: async () => ({
    material: { title: '样张' },
    unit: { uid: 'u1', title: '无界代价', pageStart: 1, pageEnd: 4 },
    notes: null,
  }),
  unitMaterial: async () => ({ text: '[p1]\n这一节讲无界代价。', truncated: false, concepts: [] }),
  concepts: async () => [],
  readPages: async () => ({ pages: [], truncated: false }),
} as unknown as StudyService

async function seedPlan(): Promise<PlanRecord> {
  const now = new Date().toISOString()
  const plan: PlanRecord = {
    id: 'p1',
    goal: '读懂无界代价下的 DP 收敛',
    status: 'active',
    steps: [],
    mastery: [
      { id: 'm1', title: '极限与 min 交换的条件', standard: '能写出交换成立的条件并给出反例', target: 'm1:u1' },
      { id: 'm2', title: '另一个掌握点', standard: '能白板推出结论', target: 'm1:u1' },
    ],
    createdAt: now,
    updatedAt: now,
  }
  await writePlan(paths, plan)
  return plan
}

function fakeJudge(verdict: 'pass' | 'fail'): { judge: QuizEngine; generated: MasteryQuizPromptInput[] } {
  const generated: MasteryQuizPromptInput[] = []
  const judge: QuizEngine = {
    textReady: async () => true,
    masteryQuiz: async input => {
      generated.push(input)
      const items: QuizItem[] = input.points.map((point, index) => ({
        id: `mp-${point.id}-${String(index + 1)}`,
        type: 'recall',
        question: `关于「${point.title}」，写出你的推导。`,
        concepts: [...point.concepts],
        origin: 'generated',
        rubric: ['给出条件', '给出反例'],
        masteryPoint: point.id,
        difficulty: 2,
      }))
      return { items }
    },
    judgeQuizAnswer: async () => ({
      verdict,
      missing: verdict === 'pass' ? [] : ['缺反例'],
      confidence: 0.9,
      engine: 'fake',
    }),
    sectionPassed: async () => ({
      verdict,
      missing: verdict === 'pass' ? [] : ['缺反例'],
      confidence: 0.9,
      engine: 'fake',
    }),
    moreQuizItems: async () => [],
  }
  return { judge, generated }
}

test('a plan round generates one question per open mastery point', async () => {
  await seedPlan()
  const { judge, generated } = fakeJudge('pass')
  const sessions = new QuizSessionService(paths, service, undefined, judge)
  const started = await sessions.start({ plan: 'p1', material: 'm1', unit: 'u1' })
  assert.deepEqual(generated[0]?.points.map(point => point.id), ['m1', 'm2'])
  assert.equal(started.session.limit, 2)
  assert.equal(started.item?.masteryPoint, 'm1')
})

test('a pass writes exactly one mastery variable: the plan point', async () => {
  const sessions = new QuizSessionService(paths, service, undefined, fakeJudge('pass').judge)
  const started = await sessions.start({ plan: 'p1', material: 'm1', unit: 'u1' })
  assert.equal(started.item?.id, 'mp-m1-1')
  const answered = await sessions.answer(started.session.id, 'mp-m1-1', '条件成立时才能交换，反例是……')
  assert.equal(answered.feedback.judged?.verdict, 'pass')
  assert.ok(answered.next !== undefined, 'the second point still has a question')

  const plan = await readPlan(paths, 'p1')
  assert.ok(plan?.mastery?.find(point => point.id === 'm1')?.passedAt !== undefined)
  assert.equal(plan?.mastery?.find(point => point.id === 'm2')?.passedAt, undefined)
  if (plan !== null) {
    const gate = gateStatus(plan)
    assert.equal(gate.masteryPassed, 1)
    assert.equal(gate.masteryTotal, 2)
    assert.ok(gate.reasons.some(reason => reason.startsWith('掌握点 1/2')))
  }

  const progress = await readProgress(paths)
  assert.deepEqual(progress.concepts, {}, 'plan practice must not write concept mastery')
})

test('a failed plan answer leaves the point open', async () => {
  const sessions = new QuizSessionService(paths, service, undefined, fakeJudge('fail').judge)
  // m1 passed in the previous test; restart so this round only asks m2.
  const started = await sessions.start({ plan: 'p1', material: 'm1', unit: 'u1', restart: true })
  assert.equal(started.item?.masteryPoint, 'm2')
  await sessions.answer(started.session.id, started.item!.id, '只写了结论')
  const plan = await readPlan(paths, 'p1')
  assert.equal(plan?.mastery?.find(point => point.id === 'm2')?.passedAt, undefined)
})

test('mastery questions must name a known point and carry a rubric', () => {
  const items = normalizeMasteryQuizItems(
    {
      items: [
        { point: 'm1', type: 'recall', question: '写出交换成立的条件。', rubric: ['条件'], concepts: ['c1'], page: 2 },
        { point: 'unknown', type: 'recall', question: '不该出现的题', rubric: ['x'] },
        { point: 'm2', type: 'recall', question: '没有评分要点', rubric: [] },
      ],
    },
    { points: [{ id: 'm1', title: '极限', concepts: ['c1'] }, { id: 'm2', title: '收敛', concepts: [] }], range: { pageStart: 1, pageEnd: 4 } },
  )
  assert.equal(items.length, 1)
  assert.equal(items[0]?.masteryPoint, 'm1')
  assert.equal(items[0]?.page, 2)
})
