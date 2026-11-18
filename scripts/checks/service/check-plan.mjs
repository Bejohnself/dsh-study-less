/**
 * End-to-end check of the stage-1 loop: goal facts, the crop list, independent
 * attempts, sufficiency questions and the closure gate.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { upsertJudgementCard } from '../../../src/core/cards.ts'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { addDays } from '../../../src/core/time.ts'
import { StudyService } from '../../../src/host/service.ts'

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
assert.equal(created.plan.meta.deliverable, '能独立推导 scaled dot-product attention 并讲给同事 20 分钟')
console.log('boundary:', JSON.stringify(created.boundary))
console.log('gate closed before evidence:', created.gate.ready, '|', created.gate.reasons.join(' / '))
assert.equal(created.gate.ready, false)
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
assert.equal(withAttempts.gate.independent, 3)
assert.equal(withAttempts.gate.unverified, 1)
assert.equal(withAttempts.stuck.length, 1)
assert.equal(withAttempts.stuck[0]?.count, 3)
console.log('attempts:', withAttempts.attempts.length, 'stuck:', JSON.stringify(withAttempts.stuck[0]))

const questions = ['能白板推出 Eq.1 吗？', '能说清为什么要除以 sqrt(d) 吗？', '能解释 softmax 的行与列吗？', '能用一句话说明 multi-head 的作用吗？', '能指出论文的一条假设吗？']
await service.updatePlan(pid, { replaceSufficiency: questions.map(q => ({ q })) })
let detail = await service.planView(pid)
// 自评通过必须留下答案：gate 会拦「通过但没写答案」。
for (const item of detail.sufficiency.slice(0, 3)) {
  detail = await service.updatePlan(pid, {
    toggleSufficiency: { id: item.id, passed: true, answer: '自评答案：' + item.q },
  })
}
assert.equal(detail.gate.passed, 3)
assert.equal(detail.gate.asked, 5)
assert.equal(detail.gate.ready, false, '3/5 is below the 80% threshold')
assert.match(detail.gate.reasons.join(' '), /判定通过 3\/5/)

await assert.rejects(() => service.closePlan(pid), /结案门/)

// 标为「没过」会写一张最小卡；改成「通过」就退役。
const failed = detail.sufficiency[4]
await service.updatePlan(pid, { toggleSufficiency: { id: failed.id, passed: false } })
const tomorrow = addDays(service.today(), 1)
const dueTomorrow = await service.dueCardList(tomorrow)
assert.equal(dueTomorrow.length, 1)
assert.equal(dueTomorrow[0]?.prompt, failed.q)
assert.ok(dueTomorrow[0]?.goal !== undefined)
console.log('card written:', dueTomorrow[0]?.id, '| due', dueTomorrow[0]?.due)
assert.ok(Array.isArray((await service.todayView()).dueCards), 'Today carries the card queue')

const reviewed = await service.reviewCard(dueTomorrow[0].id, 3)
assert.ok(reviewed.due > tomorrow, 'reviewing pushes the card forward')
let cardView = await service.planView(pid)
assert.equal(cardView.cards.length, 1)
assert.equal(cardView.cards[0]?.reps, 1)
await service.updatePlan(pid, { toggleSufficiency: { id: failed.id, passed: true, answer: '自评答案：' + failed.q } })
cardView = await service.planView(pid)
assert.equal(cardView.cards.length, 0, 'a passed question retires its card')
console.log('card retired on pass: ok')
for (const item of detail.sufficiency.slice(3)) {
  detail = await service.updatePlan(pid, {
    toggleSufficiency: { id: item.id, passed: true, answer: '自评答案：' + item.q },
  })
}
assert.equal(detail.gate.passed, 5, '5/5 clears the threshold')
const ready = await service.planView(pid)
assert.equal(ready.gate.ready, true)
console.log('gate reasons when ready:', ready.gate.reasons.length)

// 结案要把还挂着的卡一并归档：不再有东西回来找你。
await upsertJudgementCard(service.paths, { planId: pid, questionId: 'q-leftover', prompt: '结案前遗留的一张卡' })
assert.equal((await service.dueCardList(addDays(service.today(), 30))).length, 1)
const closed = await service.closePlan(pid, '白板推完了 5 道判定题')
assert.equal((await service.dueCardList(addDays(service.today(), 30))).length, 0, 'closing retires the goal cards')
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
console.log('plan check: ok')
