/**
 * End-to-end check of the stage-1 loop: goal facts, the crop list, independent
 * the crop list, attempts and the knowledge-space closure.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ensureKnowledge, writeKnowledge } from '../../../src/core/knowledge.ts'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { addDays, localDate } from '../../../src/core/time.ts'
import { StudyService } from '../../../src/host/service.ts'
import { QuizSessionService } from '../../../src/host/quizSessions.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/plan', import.meta.url))
await rm(root, { recursive: true, force: true })
const service = new StudyService(new LibraryPaths(root))
const imported = await service.import({ filePath: fileURLToPath(new URL('../../../tests/fixtures/attention.pdf', import.meta.url)) })
const mid = imported.manifest.id
const state = await service.materialState(mid)
const sections = state.toc.filter(row => row.kind === 'section').slice(0, 3)
assert.ok(sections.length >= 2, 'sample needs at least two sections')
console.log('sections:', sections.map(s => s.uid + '(' + s.pageStart + '-' + s.pageEnd + ')').join(', '))

const created = await service.createPlan({
  goal: '搞懂 Transformer 的注意力机制',
  deliverable: '能独立推导 scaled dot-product attention 并讲给同事 20 分钟',
  deadline: '2026-12-20',
  audience: '组会',
  steps: sections.map(section => ({
    kind: 'unit',
    target: mid + ':' + section.uid,
    why: '论文这一节的推导依赖它',
  })),
})
const pid = created.plan.id

// 页面在编排过程中每 3 秒重读计划，并按 generation.jobId 轮询任务。写步骤这一步
// 不能顺手把生成状态写成 done 并丢掉 jobId，否则轮询停住、「正在补第 k/n 节」一直挂着。
await service.setPlanGeneration(pid, { status: 'running', mode: 'inline', jobId: 'job-demo' })
const rewritten = await service.updatePlan(pid, {
  replaceSteps: sections.map(section => ({
    kind: 'unit',
    target: mid + ':' + section.uid,
    why: '论文这一节的推导依赖它',
    coverage: 'read',
  })),
})
assert.equal(rewritten.plan.generation?.jobId, 'job-demo', 'writing steps must keep the job the client polls')
assert.equal(rewritten.plan.generation?.status, 'running', 'the job writes its own terminal state')
console.log('generation survives a step write:', rewritten.plan.generation?.jobId)
await service.setPlanGeneration(pid, { status: 'done', mode: 'inline', jobId: 'job-demo' })

// 交给对话编排时没有任务可轮询：步骤写进来就是这次编排的终点。
await service.setPlanGeneration(pid, { status: 'queued', mode: 'chat' })
const chatWritten = await service.updatePlan(pid, {
  replaceSteps: sections.map(section => ({
    kind: 'unit',
    target: mid + ':' + section.uid,
    why: '论文这一节的推导依赖它',
    coverage: 'read',
  })),
})
assert.equal(chatWritten.plan.generation?.status, 'done', 'a chat route is finished by its steps')
assert.equal(chatWritten.plan.generation?.mode, 'chat')
// One goal at a time: a second creation is refused while this one is open.
await assert.rejects(
  () => service.createPlan({ goal: '第二个目标', deliverable: '随便交点什么', deadline: '2026-12-20', steps: [] }),
  /目前已有目标/,
)
assert.equal(created.plan.meta.deliverable, '能独立推导 scaled dot-product attention 并讲给同事 20 分钟')
console.log('boundary:', JSON.stringify(created.boundary))
assert.equal(created.total, sections.length)

const first = created.steps[0]
assert.equal(first.coverage, 'read')
await assert.rejects(
  () => service.updatePlan(pid, { setCoverage: { n: 2, coverage: 'skip' } }),
  /不读/,
)
const cropped = await service.updatePlan(pid, { setCoverage: { n: 2, coverage: 'skip', reason: '这一节讲位置编码，与目标无关' } })
assert.equal(cropped.steps[1]?.coverage, 'skip')
assert.equal(cropped.steps[1]?.skipReason, '这一节讲位置编码，与目标无关')
assert.equal(cropped.total, sections.length - 1, 'a skipped range leaves the denominator')
assert.ok(cropped.boundary.skipPages > 0)
console.log('after crop: min', cropped.boundary.minPages, 'of', cropped.boundary.totalPages, 'pages; total', cropped.total)

for (const index of [1, 2, 3]) {
  await service.updatePlan(pid, {
    addAttempt: {
      move: 'assumption',
      what: '把 Q/K 的点积替换成余弦相似度，看注意力分布怎么变',
      stuck: '约束写不进奖励函数',
      provenance: 'independent',
      result: '能推到最后一步，但归一化常数说不清',
    },
  })
}
await service.updatePlan(pid, {
  addAttempt: {
    move: 'ablation',
    what: '删掉 sqrt(d) 缩放',
    provenance: 'adopted-unverified',
  },
})
const withAttempts = await service.planView(pid)
assert.equal(withAttempts.attempts.length, 4)
console.log('attempts:', withAttempts.attempts.length)

// Concepts live on the section; the goal only says how deep each section goes.
// Reaching the gate therefore needs the knowledge space at level, not a
// duplicate list on the goal.
const required = cropped.steps.filter(step => step.coverage !== 'skip')
const conceptOf = (step) => `demo/section-${step.n}`
for (const step of required) {
  await service.writeConcepts(mid, step.target.unitId, [{ id: conceptOf(step), name: `第 ${step.n} 节` }])
}
const learnedState = () => {
  // At target and safely past the deadline: the spacing count, not an FSRS
  // stability, is what the close gate reads now.
  const evidence = {}
  for (let index = 0; index < 8; index += 1) {
    evidence[`demo-review-${String(index)}`] = {
      verdict: 'pass',
      difficulty: 2,
      at: `${addDays(localDate(), -(8 - index))}T10:00:00+08:00`,
      review: true,
    }
  }
  return {
    mastery: 1,
    peak: 1,
    streak: 0,
    attempts: 4,
    correct: 4,
    lastAt: new Date().toISOString(),
    srs: { S: 200, D: 3, reps: 4, lapses: 0, lastRating: 4 },
    evidence,
  }
}
// One section learned: the "next" pointer must stop pointing at it, even
// though its checkbox is still the reader's to tick.
const firstKnowledge = await ensureKnowledge(service.paths)
firstKnowledge.concepts[conceptOf(required[0])] = learnedState()
await writeKnowledge(service.paths, firstKnowledge)
const afterFirst = await service.planView(pid)
assert.equal(
  afterFirst.steps.find(step => step.current)?.n,
  required[1].n,
  'a section at target no longer holds the next pointer',
)
assert.equal(afterFirst.steps[0]?.done, true, 'a section at target counts as done without a tick')
assert.equal(afterFirst.done, 1, 'the counter reads the ledger too')
assert.equal(
  afterFirst.steps.find(step => step.n === required[1].n)?.done,
  false,
  'the section that is not learned yet is still open',
)
const todayAfterFirst = await service.todayView()
assert.equal(
  todayAfterFirst.next?.unitId,
  required[1].target.unitId,
  'the today suggestion moves to the next section too',
)
console.log('next pointer moves past the learned section:', required[1].target.unitId)

const knowledge = await ensureKnowledge(service.paths)
for (const step of required) knowledge.concepts[conceptOf(step)] = learnedState()
await writeKnowledge(service.paths, knowledge)

const todayAllLearned = await service.todayView()
assert.equal(todayAllLearned.next, null, 'every required section at target leaves 接着读 empty')
console.log('all sections at target: 接着读 is empty')

const closed = await service.closePlan(pid, '白板推完了 5 道判定题')
assert.equal(closed.plan.status, 'done')
assert.ok(closed.plan.meta.closedAt !== undefined)
assert.equal(closed.plan.meta.closureNote, '白板推完了 5 道判定题')
const today = await service.todayView()
assert.equal(today.plans.length, 0, 'a closed goal leaves the Today page')
console.log('closed at', closed.plan.meta.closedAt, '| today plans', today.plans.length)

const reopened = await service.updatePlan(pid, { setStatus: 'active' })
assert.equal(reopened.plan.status, 'active')
assert.equal(reopened.plan.meta.closedAt, undefined)
const after = await service.todayView()
assert.equal(after.plans.length, 1, 'the reopened goal is back on the today page')
assert.equal(after.plans[0]?.deliverable, created.plan.meta.deliverable)
assert.ok(after.knowledge !== undefined, 'today carries the knowledge space')
assert.ok(after.goal !== undefined, 'today carries the active goal block')
console.log('reopened plan is back on the today page | knowledge space present')

// The goal sets a depth per section; the concepts stay on the section. Practice
// is goal-only, so a covered section must be runnable and writing progress.
const goalStep = 1
const goalUnit = sections[0].uid
await service.updatePlan(pid, { setLevel: { n: goalStep, level: 3 } })
const sessions = new QuizSessionService(service.paths, service)
const quizIndex = await sessions.index({ material: mid, unit: goalUnit })
assert.equal(quizIndex.blocked, undefined, 'a goal section must be runnable, not blocked')
const linked = await service.planView(pid)
assert.equal(linked.sections[0]?.level, 3, 'the depth is read from the step')
assert.ok((linked.sections[0]?.concepts ?? []).length > 0, 'section concepts come from the unit itself')
console.log('goal section at 能讲, runnable:', linked.sections[0].concepts.join(', '))

// 页面上的「掌握 x%」是这一节知识点的平均；按最弱点算会把平均值压低。
// 加一个没练过的第二知识点（0.5），平均值与最弱值才分得开。
await service.writeConcepts(mid, goalUnit, [
  { id: conceptOf(required[0]), name: '第 1 节' },
  { id: `${conceptOf(required[0])}-extra`, name: '第 1 节 补充' },
])
const mixed = await service.planView(pid)
const linkedSection = mixed.sections[0]
const conceptStates = linkedSection.conceptStates
const mean = conceptStates.reduce((sum, state) => sum + state.mastery, 0) / conceptStates.length
assert.ok(
  Math.abs(linkedSection.mastery - mean) < 1e-9,
  `section mastery must be the mean (${mean.toFixed(3)}) but was ${linkedSection.mastery.toFixed(3)}`,
)
console.log('section mastery is the mean of its points:', linkedSection.mastery.toFixed(3))

console.log('plan check: ok')
