/**
 * End-to-end check of the stage-1 loop: goal facts, the crop list, independent
 * the crop list, attempts and the knowledge-space closure.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ensureKnowledge, writeKnowledge } from '../../../src/core/knowledge.ts'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { addDays } from '../../../src/core/time.ts'
import { StudyService } from '../../../src/host/service.ts'
import { QuizSessionService } from '../../../src/host/quizSessions.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/plan', import.meta.url))
await rm(root, { recursive: true, force: true })
const service = new StudyService(new LibraryPaths(root))
const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
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
const knowledge = await ensureKnowledge(service.paths)
for (const step of required) {
  knowledge.concepts[conceptOf(step)] = {
    mastery: 1,
    peak: 1,
    streak: 0,
    attempts: 4,
    correct: 4,
    lastAt: new Date().toISOString(),
    due: '2027-06-01',
    srs: { S: 200, D: 3, reps: 4, lapses: 0, lastRating: 4 },
    evidence: {},
  }
}
await writeKnowledge(service.paths, knowledge)

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
console.log('plan check: ok')
