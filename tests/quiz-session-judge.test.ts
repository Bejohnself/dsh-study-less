import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { readKnowledge, writeKnowledge } from '../src/core/knowledge.ts'
import { deletePlan, writePlan } from '../src/core/plans.ts'
import { addDays, localDate } from '../src/core/time.ts'
import type { PlanRecord, QuizItem, QuizJudgeVerdict } from '../src/core/types.ts'
import type { QuizJudgePromptInput } from '../src/host/generate/prompts.ts'
import { QuizSessionService, type QuizEngine } from '../src/host/quizSessions.ts'
import type { StudyService } from '../src/host/service.ts'

const root = await mkdtemp(join(tmpdir(), 'study-quiz-session-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Section concepts, as the unit record carries them (`seedGoal` fills this in). */
const sectionConcepts = new Map<string, string[]>()

/** The desk's test clock: mutable so a test can advance it a day. */
let clockToday = localDate()

const service = {
  today: () => clockToday,
  hasNotes: async () => true,
  concepts: async () => [],
  writeConcepts: async () => undefined,
  unit: async (material: string, unit: string) => ({
    unit: { uid: unit, title: unit, concepts: sectionConcepts.get(`${material}:${unit}`) ?? [] },
  }),
  readPages: async () => ({ pages: [{ page: 1, text: '原文提醒：极限并非无条件成立。' }], truncated: false }),
} as unknown as StudyService

interface EngineOptions {
  /** The n-th question the model writes; returning nothing means it wrote none. */
  question?: (n: number, focus: readonly string[]) => QuizItem | undefined
  /** Scripted verdicts, in order; the last one repeats. */
  verdicts?: QuizJudgeVerdict[]
  /** Throw at this question number, to simulate a model failure. */
  failAt?: number
  ready?: boolean
}

/** A model stand-in that writes one question per call and records its inputs. */
function engineOf(options: EngineOptions = {}): {
  engine: QuizEngine
  calls: QuizJudgePromptInput[]
  generated: string[]
  focuses: string[][]
  difficulties: Array<1 | 2 | 3 | undefined>
} {
  const calls: QuizJudgePromptInput[] = []
  const generated: string[] = []
  const focuses: string[][] = []
  const difficulties: Array<1 | 2 | 3 | undefined> = []
  const engine: QuizEngine = {
    textReady: async () => options.ready !== false,
    judgeQuizAnswer: async input => {
      calls.push(input)
      const verdicts = options.verdicts ?? ['pass']
      const verdict = verdicts[Math.min(calls.length - 1, verdicts.length - 1)] ?? 'pass'
      return {
        verdict,
        missing: verdict === 'pass' ? [] : ['缺边界条件'],
        advice: '补上适用条件',
        confidence: 0.9,
        engine: 'fake',
      }
    },
    extractConcepts: async () => [],
    moreQuizItems: async input => {
      const n = generated.length + 1
      focuses.push([...(input.focus ?? [])])
      difficulties.push(input.difficulty)
      if (options.failAt === n) throw new Error('模型超时')
      const item = options.question?.(n, input.focus ?? [])
      if (item === undefined) return { items: [] }
      generated.push(item.question)
      return {
        items: [{ ...item, concepts: input.focus ?? item.concepts }],
        usage: { inputTokens: 120, outputTokens: 30, cost: 0.001, currency: 'USD', priceSource: 'user' as const },
      }
    },
  }
  return { engine, calls, generated, focuses, difficulties }
}

/** A fresh objective question for whichever point the run picked. */
function choiceQuestion(n: number, focus: readonly string[]): QuizItem {
  return {
    id: `q${String(n)}`,
    type: 'choice',
    question: `第 ${String(n)} 题：这一步为什么成立？`,
    choices: ['因为是定义', '因为可以取极限'],
    answerIndex: 0,
    concepts: [...focus],
    origin: 'generated',
    difficulty: 2,
  }
}

/** A written question covering every point the run picked. */
function writtenQuestion(n: number, focus: readonly string[]): QuizItem {
  return {
    id: `w${String(n)}`,
    type: 'recall',
    // 「为什么」让结构判定落在中档，题目内容本身不含多问或证明。
    question: `第 ${String(n)} 题：为什么 ${focus.join('、')} 要放在一起看？`,
    rubric: focus.map(id => `交代 ${id} 的条件`),
    concepts: [...focus],
    origin: 'generated',
    page: 1,
  }
}

/**
 * Answer, then write the next question — the two calls the page makes.
 *
 * `next` is only asked for while the run is still open; a finished run returns
 * the summary from `answer` and has nothing left to write.
 */
async function answerNext(
  sessions: QuizSessionService,
  sid: string,
  itemId: string,
  answer: unknown,
): Promise<{ answered: Awaited<ReturnType<QuizSessionService['answer']>>; item?: QuizItem }> {
  const answered = await sessions.answer(sid, itemId, answer)
  if (answered.summary !== undefined) return { answered }
  const view = await sessions.next(sid)
  return { answered, ...(view.item === undefined ? {} : { item: view.item }) }
}

/** Pin Math.random for one test: the difficulty ladder rolls for hard questions. */
async function withRoll<T>(value: number, run: () => Promise<T>): Promise<T> {
  const original = Math.random
  Math.random = () => value
  try {
    return await run()
  } finally {
    Math.random = original
  }
}

const paths = new LibraryPaths(root)

/**
 * Each test gets a clean desk: the ledger is the only thing that carries
 * progress, so leaving it behind would leak the previous test's answers.
 */
beforeEach(async () => {
  clockToday = localDate()
  await rm(paths.knowledgeFile, { force: true })
  await rm(paths.quizSessionsDir, { recursive: true, force: true })
  await rm(paths.plansDir, { recursive: true, force: true })
})

/** An active goal that puts one unit's concept in scope. */
async function seedGoal(target: string, concepts: string[], level: 1 | 2 | 3 | 4 = 2): Promise<void> {
  const now = new Date().toISOString()
  const goal: PlanRecord = {
    id: 'p-active',
    goal: '测试目标',
    status: 'active',
    steps: [{ n: 1, kind: 'unit', target, why: '练习', coverage: 'read', level }],
    createdAt: now,
    updatedAt: now,
  }
  sectionConcepts.set(target, concepts)
  await writePlan(paths, goal)
}

test('without a model the page says so instead of pretending to run', async () => {
  await seedGoal('m0:u0', ['dp/basics'])
  const sessions = new QuizSessionService(paths, service)
  const index = await sessions.index({ material: 'm0', unit: 'u0' })
  assert.equal(index.canGenerate, false)
  await assert.rejects(() => sessions.start({ material: 'm0', unit: 'u0' }), /还没有可用的模型/)
})

test('判分与出题分开：answer 只给反馈，next 才写下一道', async () => {
  await seedGoal('m1:u1', ['dp/basics'])
  const { engine, generated } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm1', unit: 'u1' })
  assert.equal(started.item?.concepts[0], 'dp/basics')
  assert.equal(started.usage?.inputTokens, 120, '出题用量随题目一起返回')

  const answered = await sessions.answer(started.session.id, started.item!.id, 0)
  assert.equal(answered.summary, undefined)
  assert.equal(answered.points[0]?.atTarget, false, '一题不能直接过档')
  assert.equal(generated.length, 1, '判分这一下没有再调模型出题')

  const next = await sessions.next(started.session.id)
  assert.notEqual(next.item, undefined, 'next 单独出下一道')
  assert.equal(generated.length, 2)

  let view = next
  while (view.session.status === 'active') {
    const step = await answerNext(sessions, view.session.id, view.item!.id, 0)
    assert.notEqual(step.answered.summary?.verdict === undefined && step.item === undefined, true)
    if (step.answered.summary !== undefined) {
      view = { ...view, session: step.answered.session, summary: step.answered.summary, item: undefined }
      break
    }
    view = { ...view, item: step.item }
  }
  assert.equal(view.session.status, 'done')
  assert.equal(view.session.endedReason, 'completed')
  assert.equal(view.summary?.verdict, 'passed')
  assert.deepEqual(view.summary?.atTarget, { passed: 1, total: 1 })
  assert.equal(view.summary?.count, 4, '四次答对才把掌握度推过 0.75')
  assert.equal(generated.length, 4, '每题都是当场写的，没有题库可复用')

  const saved = JSON.parse(
    await readFile(join(paths.quizSessionsDir, `${started.session.id}.json`), 'utf8'),
  ) as Record<string, unknown>
  assert.equal('history' in saved, false, '答过的题不落盘')
  assert.equal('asked' in saved, false)
  assert.equal('limit' in saved, false)
  assert.equal(saved.count, 4)
  assert.equal('current' in saved, false, '到档后当前题也清掉')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('同一道题再答一次不会多算一次进步', async () => {
  await seedGoal('m2:u2', ['dp/dedupe'])
  const same = (n: number, focus: readonly string[]): QuizItem => ({
    ...choiceQuestion(n, focus),
    question: '这一步为什么成立？',
  })
  const { engine } = engineOf({ question: same })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm2', unit: 'u2' })
  const first = await answerNext(sessions, started.session.id, started.item!.id, 0)
  const oneAnswer = (await readKnowledge(paths)).concepts['dp/dedupe']?.mastery ?? 0
  assert.notEqual(first.item, undefined, '同一个知识点还会继续出题')
  await sessions.answer(started.session.id, first.item!.id, 0)
  const twice = (await readKnowledge(paths)).concepts['dp/dedupe']?.mastery ?? 0
  assert.equal(twice, oneAnswer, '题干指纹相同，第二次不加证据')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('一题最多带三个未到档知识点，写对了一起记', async () => {
  const concepts = ['dp/a', 'dp/b', 'dp/c', 'dp/d', 'dp/e']
  await seedGoal('m20:u20', concepts)
  const { engine, focuses } = engineOf({ question: writtenQuestion, verdicts: ['pass'] })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm20', unit: 'u20' })
  assert.deepEqual(focuses[0], concepts.slice(0, 3), '先推 id 靠前、离到档最近的那三个')
  assert.equal(started.item?.concepts.length, 3, '题目挂上这三个知识点')
  const answered = await sessions.answer(started.session.id, started.item!.id, '三者一起答')
  const next = await sessions.next(started.session.id)
  assert.notEqual(next.item, undefined)
  assert.equal(answered.feedback.judged?.verdict, 'pass')
  const knowledge = await readKnowledge(paths)
  for (const id of started.item!.concepts) {
    assert.equal(knowledge.concepts[id]?.mastery, 0.59, `${id} 一起记了一次证据（结构判定为中档，学习率 0.18）`)
  }
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('难度跟着离阈值多远走：越接近到档越难', async () => {
  await seedGoal('m24:u24', ['dp/ladder'])
  const { engine, difficulties } = engineOf({ question: writtenQuestion, verdicts: ['pass'] })
  const sessions = new QuizSessionService(paths, service, engine)
  await withRoll(0.1, async () => {
    let view = await sessions.start({ material: 'm24', unit: 'u24' })
    assert.equal(view.item?.difficulty, 2, '入账的是复核后的难度（题干是中档结构）')
    while (view.session.status === 'active') {
      const step = await answerNext(sessions, view.session.id, view.item!.id, '答')
      if (step.answered.summary !== undefined) break
      view = { ...view, item: step.item! }
    }
  })
  assert.deepEqual(difficulties, [1, 1, 2, 3], '要写的难度越接近阈值越高')
  const evidence = Object.values((await readKnowledge(paths)).concepts['dp/ladder']?.evidence ?? {})
  assert.deepEqual(evidence.map(entry => entry.difficulty), [2, 2, 2, 2], '入账的是复核后的难度，不是出题时要求的档')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('出题模型自标的难度不算数，出题后按题干结构复核', async () => {
  await seedGoal('m27:u27', ['dp/hard'])
  const hard = (n: number, focus: readonly string[]): QuizItem => ({
    id: `h${String(n)}`,
    type: 'recall',
    question: '设 {c_n} 是首项为 1 的数列。(1) 判断 a_1…a_10 是否为可分数列，并写出一种分组。(2) 证明：对任意 n，结论成立。',
    rubric: ['给出分组', '完成证明'],
    concepts: [...focus],
    origin: 'generated',
    page: 1,
    // 模型把它标成易档，结构复核不该采信。
    difficulty: 1,
  })
  const { engine } = engineOf({ question: hard, verdicts: ['pass'] })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm27', unit: 'u27' })
  assert.equal(started.item?.difficulty, 3, '两问加证明，按结构判为难')
  await sessions.answer(started.session.id, started.item!.id, '答')
  const evidence = Object.values((await readKnowledge(paths)).concepts['dp/hard']?.evidence ?? {})
  assert.equal(evidence[0]?.difficulty, 3, '证据里记的是复核后的难度')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('快到阈值时难题只占一部分，普通题一样能结案', async () => {
  await seedGoal('m26:u26', ['dp/spice'])
  const { engine, difficulties } = engineOf({ question: writtenQuestion, verdicts: ['pass'] })
  const sessions = new QuizSessionService(paths, service, engine)
  await withRoll(0.9, async () => {
    let view = await sessions.start({ material: 'm26', unit: 'u26' })
    while (view.session.status === 'active') {
      const step = await answerNext(sessions, view.session.id, view.item!.id, '答')
      if (step.answered.summary !== undefined) break
      view = { ...view, item: step.item! }
    }
  })
  assert.deepEqual(difficulties, [1, 1, 2, 2], '这一轮没掷到难档，也不会卡住结案')
  const knowledge = await readKnowledge(paths)
  assert.ok((knowledge.concepts['dp/spice']?.mastery ?? 0) >= 0.75, '难度 2 一样能到档')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('答错会把难度退回去', async () => {
  await seedGoal('m25:u25', ['dp/stepdown'])
  // 先答对两题把掌握度推到 0.63，再答错一题，下一题该比错之前更容易。
  const { engine, difficulties } = engineOf({ question: writtenQuestion, verdicts: ['pass', 'pass', 'fail'] })
  const sessions = new QuizSessionService(paths, service, engine)
  let view = await sessions.start({ material: 'm25', unit: 'u25' })
  view = { ...view, item: (await answerNext(sessions, view.session.id, view.item!.id, '答')).item! }
  view = { ...view, item: (await answerNext(sessions, view.session.id, view.item!.id, '答')).item! }
  const wrong = await answerNext(sessions, view.session.id, view.item!.id, '没想明白')
  assert.notEqual(wrong.item, undefined)
  assert.deepEqual(difficulties, [1, 1, 2, 1], '错一题后退回容易档')
  assert.ok((difficulties[3] ?? 3) < (difficulties[2] ?? 3))
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('选择题只记主考点：一次点选证明不了三个知识点', async () => {
  await seedGoal('m23:u23', ['dp/a', 'dp/b', 'dp/c'])
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm23', unit: 'u23' })
  const primary = started.item!.concepts[0]
  assert.equal(started.item?.concepts.length, 3)
  await sessions.answer(started.session.id, started.item!.id, 0)
  const knowledge = await readKnowledge(paths)
  assert.equal(knowledge.concepts[primary!]?.mastery, 0.59)
  for (const id of started.item!.concepts.slice(1)) {
    assert.equal(knowledge.concepts[id], undefined, `${id} 不该因为一次点选到档`)
  }
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('答错只扣主考点，不把一题算成三个错', async () => {
  await seedGoal('m21:u21', ['dp/a', 'dp/b', 'dp/c'])
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm21', unit: 'u21' })
  const primary = started.item!.concepts[0]
  assert.equal(started.item?.concepts.length, 3)
  await sessions.answer(started.session.id, started.item!.id, 1)
  const knowledge = await readKnowledge(paths)
  assert.equal(knowledge.concepts[primary!]?.mastery, 0.45, '主考点扣一成')
  for (const id of started.item!.concepts.slice(1)) {
    assert.equal(knowledge.concepts[id], undefined, `${id} 没被这道错题连坐`)
  }
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('十二个知识点、十三道题，练到一半以上到档', async () => {
  const concepts = Array.from({ length: 12 }, (_, index) => `dp/p${String(index + 1)}`)
  await seedGoal('m22:u22', concepts)
  // Written questions, two failed like the reader's own run.
  const verdicts: QuizJudgeVerdict[] = Array.from({ length: 13 }, (_, index) =>
    index === 3 || index === 8 ? 'fail' : 'pass',
  )
  const { engine, focuses } = engineOf({ question: writtenQuestion, verdicts })
  const sessions = new QuizSessionService(paths, service, engine)
  let view = await withRoll(0.9, async () => sessions.start({ material: 'm22', unit: 'u22' }))
  for (let round = 1; round <= 13; round += 1) {
    const wrong = round === 4 || round === 9
    const step = await answerNext(sessions, view.session.id, view.item!.id, wrong ? '没想明白' : '三者一起答')
    assert.notEqual(step.item, undefined, `第 ${String(round)} 题后没有断流`)
    view = { ...view, ...step.answered, item: step.item! }
  }
  assert.equal(focuses.every(focus => focus.length === 3), true, '满节时每题带三个知识点')
  const knowledge = await readKnowledge(paths)
  const atTarget = concepts.filter(id => (knowledge.concepts[id]?.mastery ?? 0) >= 0.75)
  assert.ok(atTarget.length >= 6, `13 题后应有至少 6 个知识点到档，实际 ${String(atTarget.length)} 个`)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('答错后仍在同一节继续出题，不会被题库卡住', async () => {
  await seedGoal('m3:u3', ['dp/wrong'])
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm3', unit: 'u3' })
  const answered = await sessions.answer(started.session.id, started.item!.id, 1)
  assert.equal(answered.session.status, 'active')
  assert.equal(answered.feedback.correct, false)
  const next = await sessions.next(started.session.id)
  assert.notEqual(next.item, undefined, '答错也要有下一道')
  assert.equal(next.item?.concepts[0], 'dp/wrong')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('出题失败时不结束这次练习，按钮可以再点一次', async () => {
  await seedGoal('m4:u4', ['dp/fail'])
  const { engine } = engineOf({ question: choiceQuestion, failAt: 2 })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm4', unit: 'u4' })
  const answered = await sessions.answer(started.session.id, started.item!.id, 1)
  assert.equal(answered.session.status, 'active')
  await assert.rejects(() => sessions.next(started.session.id), /出题失败：模型超时/)
  const stillOpen = await sessions.get(started.session.id)
  assert.equal(stillOpen.session.status, 'active', '答过的已入账，练习没被结束')
  assert.equal(stillOpen.item, undefined, '没有题在等，按钮就是重试')
  assert.equal(stillOpen.points[0]?.mastery === 0.5, false, '答过的那题仍然记了证据')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a written answer is judged by the model and updates concept mastery', async () => {
  await seedGoal('m5:u5', ['dp/unbounded-cost'])
  const { engine, calls } = engineOf({
    verdicts: ['partial'],
    question: (_n, focus) => ({
      id: 'q1',
      type: 'recall',
      question: '为什么不能把有限阶段 DP 的结论机械外推到无界代价问题？',
      rubric: ['指出需要极限与 min、期望交换的条件', '指出无界代价可能出现例外'],
      concepts: [...focus],
      origin: 'generated',
      page: 1,
      difficulty: 2,
    }),
  })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm5', unit: 'u5' })
  const answered = await sessions.answer(started.session.id, started.item!.id, '因为可以取极限，所以直接推。')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.page, 1)
  assert.equal(answered.feedback.judged?.verdict, 'partial')
  assert.equal(answered.feedback.correct, false)
  assert.deepEqual(answered.feedback.judged?.missing, ['缺边界条件'])

  const entry = (await readKnowledge(paths)).concepts['dp/unbounded-cost']
  // partial on a normal question: 0.5 + 0.18 × 0.5 × (1 − 0.5)
  assert.equal(entry?.mastery, 0.545)
  assert.equal(Object.keys(entry?.evidence ?? {}).length, 1)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('judging failure keeps the question on screen instead of losing the answer', async () => {
  await seedGoal('m6:u6', ['dp/judge'])
  const engine = {
    textReady: async () => true,
    judgeQuizAnswer: async () => {
      throw new Error('网关 502')
    },
    extractConcepts: async () => [],
    moreQuizItems: async (input: { focus?: readonly string[] }) => ({
      items: [
        {
          id: 'q1',
          type: 'recall' as const,
          question: '为什么这里不能直接取极限？',
          rubric: ['指出需要极限与期望交换的条件'],
          concepts: [...(input.focus ?? [])],
          origin: 'generated' as const,
          page: 1,
          difficulty: 2 as const,
        },
      ],
    }),
  } satisfies QuizEngine
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm6', unit: 'u6' })
  await assert.rejects(() => sessions.answer(started.session.id, started.item!.id, '写了一半'), /判分失败：网关 502/)
  const again = await sessions.get(started.session.id)
  assert.equal(again.session.status, 'active')
  assert.equal(again.item?.id, started.item!.id, '题目还在，可以重新提交')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('an appeal re-judges the answer just submitted', async () => {
  await seedGoal('m7:u7', ['dp/appeal'])
  const { engine, calls } = engineOf({
    verdicts: ['fail', 'pass'],
    question: (_n, focus) => ({
      id: 'q1',
      type: 'recall',
      question: '为什么这里不能直接取极限？',
      rubric: ['指出需要极限与期望交换的条件'],
      concepts: [...focus],
      origin: 'generated',
      page: 1,
      difficulty: 2,
    }),
  })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm7', unit: 'u7' })
  const answer = '先验证极限与 min 可交换，再讨论无界代价的例外。'
  const first = await sessions.answer(started.session.id, started.item!.id, answer)
  assert.equal(first.feedback.judged?.verdict, 'fail')
  const reason = '我补充了极限与 min 交换的条件，这属于评分要点'
  const appealed = await sessions.appeal(started.session.id, started.item!.id, reason, 'correct')
  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.answer, answer)
  assert.equal(calls[1]?.rebuttal, reason)
  assert.equal(calls[1]?.claim, 'correct')
  assert.equal(calls[1]?.previousVerdict, 'fail')
  assert.equal(appealed.last?.judged?.verdict, 'pass')
  assert.equal(appealed.last?.appeals?.length, 1)
  // The appeal rewrites that one entry, so the fail is gone and the won pass
  // counts at 0.7: 0.5 + 0.18 × 0.7 × (1 − 0.5).
  const ledged = (await readKnowledge(paths)).concepts['dp/appeal']
  assert.equal(ledged?.mastery, 0.563)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('only the latest answer can be appealed', async () => {
  await seedGoal('m8:u8', ['dp/appeal-window'])
  const { engine } = engineOf({
    verdicts: ['fail'],
    question: (n, focus) => ({
      id: `q${String(n)}`,
      type: 'recall',
      question: `第 ${String(n)} 题：为什么这里不能直接取极限？`,
      rubric: ['指出需要极限与期望交换的条件'],
      concepts: [...focus],
      origin: 'generated',
      page: 1,
      difficulty: 2,
    }),
  })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm8', unit: 'u8' })
  const firstItem = started.item!
  const first = await answerNext(sessions, started.session.id, firstItem.id, '第一个答案')
  await sessions.answer(started.session.id, first.item!.id, '第二个答案')
  await assert.rejects(
    () => sessions.appeal(started.session.id, firstItem.id, '我认为我答对了'),
    /只有刚答完的那道题/,
  )
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a rebuttal copied from the rubric is refused before calling the model', async () => {
  await seedGoal('m9:u9', ['dp/copied'])
  const { engine, calls } = engineOf({
    verdicts: ['fail'],
    question: (_n, focus) => ({
      id: 'q1',
      type: 'recall',
      question: '为什么这里不能直接取极限？',
      rubric: ['指出需要极限与期望交换的条件，不能无条件交换'],
      concepts: [...focus],
      origin: 'generated',
      page: 1,
      difficulty: 2,
    }),
  })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm9', unit: 'u9' })
  await sessions.answer(started.session.id, started.item!.id, '答案')
  assert.equal(calls.length, 1)
  const copied = '指出需要极限与期望交换的条件，不能无条件交换'
  await assert.rejects(() => sessions.appeal(started.session.id, started.item!.id, copied), /不能直接抄评分要点/)
  assert.equal(calls.length, 1)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a section whose points already passed does not reopen a run', async () => {
  await seedGoal('m10:u10', ['dp/closed'])
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: new Date().toISOString(),
    concepts: {
      'dp/closed': {
        mastery: 1,
        peak: 1,
        streak: 0,
        attempts: 6,
        correct: 6,
        due: '2027-01-01',
        srs: { S: 30, D: 3, reps: 6, lapses: 0, lastRating: 4 },
        evidence: {},
      },
    },
  })
  await assert.rejects(() => sessions.start({ material: 'm10', unit: 'u10' }), /达成了/)
  assert.equal((await sessions.index({ material: 'm10', unit: 'u10' })).ready, true)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('the goal level sets the threshold a point must clear', async () => {
  /** Two passing answers: enough for a level 1 goal, not for a level 4 one. */
  const passTwice = async (material: string, unit: string): Promise<void> => {
    const { engine } = engineOf({ question: choiceQuestion })
    const sessions = new QuizSessionService(paths, service, engine)
    const started = await sessions.start({ material, unit })
    const first = await answerNext(sessions, started.session.id, started.item!.id, 0)
    assert.notEqual(first.item, undefined)
    await sessions.answer(started.session.id, first.item!.id, 0)
  }

  await seedGoal('m11:u11', ['dp/level'], 1)
  await passTwice('m11', 'u11')
  const relaxed = await new QuizSessionService(paths, service).index({ material: 'm11', unit: 'u11' })
  assert.equal(relaxed.points[0]?.threshold, 0.6, 'level 1 asks 了解')
  assert.equal(relaxed.points[0]?.atTarget, true)
  await deletePlan(paths, 'p-active').catch(() => undefined)

  await rm(paths.knowledgeFile, { force: true })

  await seedGoal('m12:u12', ['dp/level'], 4)
  await passTwice('m12', 'u12')
  const capped = await new QuizSessionService(paths, service).index({ material: 'm12', unit: 'u12' })
  assert.equal(capped.points[0]?.threshold, 0.95, 'level 4 asks 创新')
  assert.equal(capped.points[0]?.atTarget, false, 'two passes are not enough for 创新')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a due concept can be reviewed on its own even when already at target', async () => {
  await seedGoal('m13:u13', ['dp/review'])
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: '2026-03-01',
    concepts: {
      'dp/review': {
        mastery: 0.95,
        peak: 0.95,
        streak: 0,
        attempts: 4,
        correct: 4,
        due: '2026-02-20',
        srs: { S: 20, D: 3, reps: 4, lapses: 0, lastRating: 4 },
        evidence: {},
      },
    },
  })
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const started = await sessions.start({ material: 'm13', unit: 'u13', concept: 'dp/review' })
  assert.equal(started.session.review, true)
  assert.deepEqual(started.session.atTarget, { passed: 1, total: 1 }, 'only the due concept is in scope')
  const answered = await sessions.answer(started.session.id, started.item!.id, 0)
  assert.equal(answered.session.status, 'done')
  assert.equal(answered.summary?.verdict, 'passed')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('the review page reads the desk clock, so a shifted day decays the point and still opens a run', async () => {
  await seedGoal('m14:u14', ['dp/clock'])
  const today = localDate()
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: new Date().toISOString(),
    concepts: {
      'dp/clock': {
        mastery: 1,
        peak: 1,
        streak: 0,
        attempts: 4,
        correct: 4,
        lastAt: new Date().toISOString(),
        due: today,
        srs: { S: 30, D: 3, reps: 4, lapses: 0, lastRating: 4 },
        evidence: {},
      },
    },
  })
  const { engine } = engineOf({ question: choiceQuestion })
  const sessions = new QuizSessionService(paths, service, engine)
  const due = await sessions.index({ material: 'm14', unit: 'u14' })
  assert.equal(due.points[0]?.mastery, 1, 'on the due day nothing has decayed yet')

  clockToday = addDays(today, 1)
  const later = await sessions.index({ material: 'm14', unit: 'u14' })
  assert.ok((later.points[0]?.mastery ?? 1) < 1, 'the next day the page shows the decayed estimate, not yesterday\'s')
  assert.equal(later.ready, true, 'still at target: this is review, not a fresh pass')

  const review = await sessions.index({ material: 'm14', unit: 'u14', concept: 'dp/clock' })
  assert.equal(review.review, true, 'the page knows this run reviews one due concept')
  assert.deepEqual(review.points.map(point => point.id), ['dp/clock'], 'and lists exactly that point')
  const started = await sessions.start({ material: 'm14', unit: 'u14', concept: 'dp/clock' })
  assert.notEqual(started.item, undefined, 'a due point at target still gets a question')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a section outside any goal is refused instead of running as free practice', async () => {
  const sessions = new QuizSessionService(paths, service, engineOf({ question: choiceQuestion }).engine)
  const index = await sessions.index({ material: 'm14', unit: 'u14' })
  assert.equal(index.blocked, 'no-goal')
  await assert.rejects(() => sessions.start({ material: 'm14', unit: 'u14' }), /还没有学习目标/)
})

test('a section the goal does not cover is refused with the reason', async () => {
  await seedGoal('m15:u15', ['dp/other'])
  const sessions = new QuizSessionService(paths, service, engineOf({ question: choiceQuestion }).engine)
  assert.equal((await sessions.index({ material: 'm16', unit: 'u16' })).blocked, 'outside-goal')
  await assert.rejects(() => sessions.start({ material: 'm16', unit: 'u16' }), /不在当前目标里/)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('a goal section without knowledge points refuses to run and names the fix', async () => {
  await seedGoal('m17:u17', [])
  const sessions = new QuizSessionService(paths, service, engineOf({ question: choiceQuestion }).engine)
  const index = await sessions.index({ material: 'm17', unit: 'u17' })
  assert.equal(index.needsConcepts, true)
  assert.equal(index.blocked, undefined)
  await assert.rejects(() => sessions.start({ material: 'm17', unit: 'u17' }), /还没有知识点/)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('an old session file is closed instead of resumed', async () => {
  await seedGoal('m18:u18', ['dp/legacy'])
  const sessions = new QuizSessionService(paths, service, engineOf({ question: choiceQuestion }).engine)
  const started = await sessions.start({ material: 'm18', unit: 'u18' })
  const file = join(paths.quizSessionsDir, `${started.session.id}.json`)
  const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  await writeFile(file, JSON.stringify({ ...record, version: 2, current: undefined, currentId: 'q1', asked: ['q1'], limit: 8, history: [] }))
  const index = await sessions.index({ material: 'm18', unit: 'u18' })
  assert.equal(index.active, null, 'a batch-era run is not offered as a continuation')
  const saved = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  assert.equal(saved.status, 'done')
  assert.equal(saved.endedReason, 'replaced')
  await deletePlan(paths, 'p-active').catch(() => undefined)
})

test('finishing early records nothing and reports the gap', async () => {
  await seedGoal('m19:u19', ['dp/finish'])
  const sessions = new QuizSessionService(paths, service, engineOf({ question: choiceQuestion }).engine)
  const started = await sessions.start({ material: 'm19', unit: 'u19' })
  const closed = await sessions.finish(started.session.id)
  assert.equal(closed.session.endedReason, 'finished')
  assert.equal(closed.summary?.verdict, 'incomplete')
  assert.equal(closed.summary?.gap[0]?.id, 'dp/finish')
  assert.equal((await readKnowledge(paths)).concepts['dp/finish'], undefined)
  await deletePlan(paths, 'p-active').catch(() => undefined)
})
