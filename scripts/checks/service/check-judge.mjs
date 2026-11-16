/**
 * End-to-end check of the AI-judged sufficiency flow with a stub engine:
 * pass retires the card, partial/fail writes one, and no engine falls back.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { StudyService } from '../../../src/host/service.ts'
import { GenerationService } from '../../../src/host/generation.ts'
import { InsightService } from '../../../src/host/insights.ts'
import { BookService } from '../../../src/host/books.ts'
import { JobQueue } from '../../../src/host/jobs.ts'
import { SettingsService } from '../../../src/host/settings.ts'
import { addDays } from '../../../src/core/time.ts'

const rootPath = fileURLToPath(new URL('../../../.tmp/checks/judge', import.meta.url))
await rm(rootPath, { recursive: true, force: true })
const paths = new LibraryPaths(rootPath)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const insights = new InsightService(paths)
const books = new BookService(paths, service)
const jobs = new JobQueue(paths, { concurrency: () => 1 })

/** A stub engine that answers with the queued JSON objects. */
const replies = []
const stub = {
  name: 'stub',
  async complete() {
    const next = replies.shift()
    if (next === undefined) throw new Error('stub has no reply left')
    return { text: JSON.stringify(next), model: 'stub-1' }
  },
}
const generation = new GenerationService(paths, {
  service,
  books,
  insights,
  settings,
  jobs,
  textProvider: () => stub,
})

const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
const mid = imported.manifest.id
const state = await service.materialState(mid)
const created = await service.createPlan({
  goal: '搞懂注意力',
  deliverable: '能独立推出 scaled dot-product attention',
  steps: state.toc
    .filter(row => row.kind === 'section')
    .slice(0, 2)
    .map(row => ({ kind: 'unit', target: mid + ':' + row.uid, why: '推导依赖它' })),
})
const pid = created.plan.id
const questions = await service.updatePlan(pid, {
  replaceSufficiency: [{ q: '能写出 Eq.1 的推导吗？' }, { q: '为什么除以 sqrt(d)？' }],
})
const first = questions.sufficiency[0]
const second = questions.sufficiency[1]

// 1. pass → no card.
replies.push({ verdict: 'pass', missing: [], advice: '', confidence: 0.9 })
const judged = await generation.judgeAnswer({
  goal: '搞懂注意力',
  deliverable: '能独立推出 scaled dot-product attention',
  boundary: ['模型结构（必读）'],
  question: first.q,
  answer: 'QK^T 除以 sqrt(d) 再 softmax，然后乘 V。',
})
assert.equal(judged.verdict, 'pass')
const afterPass = await service.recordJudgement(pid, first.id, {
  answer: 'QK^T 除以 sqrt(d) 再 softmax，然后乘 V。',
  verdict: judged.verdict,
  missing: judged.missing,
  judgedBy: { engine: judged.engine, model: judged.model },
})
assert.equal(afterPass.sufficiency[0].verdict, 'pass')
assert.equal(afterPass.cards.length, 0)
console.log('pass:', afterPass.sufficiency[0].verdict, '| cards', afterPass.cards.length)

// 2. partial → one card with the feedback attached.
replies.push({ verdict: 'partial', missing: ['没有说明方差随 d 增长'], advice: '补一句方差论证', confidence: 0.8 })
const partial = await generation.judgeAnswer({
  goal: '搞懂注意力',
  boundary: [],
  question: second.q,
  answer: '因为数值稳定。',
})
assert.equal(partial.verdict, 'partial')
const afterPartial = await service.recordJudgement(pid, second.id, {
  answer: '因为数值稳定。',
  verdict: partial.verdict,
  missing: partial.missing,
  ...(partial.advice === undefined ? {} : { advice: partial.advice }),
  judgedBy: { engine: partial.engine },
})
assert.equal(afterPartial.cards.length, 1)
assert.match(afterPartial.cards[0].detail ?? '', /方差随 d 增长/)
const dueTomorrow = await service.dueCardList(addDays(service.today(), 1))
assert.equal(dueTomorrow.length, 1)
console.log('partial:', partial.verdict, '| card detail has the missing items')

// 3. low confidence downgrades to partial even when the model says pass.
replies.push({ verdict: 'pass', missing: [], confidence: 0.3 })
const shaky = await generation.judgeAnswer({ goal: 'g', boundary: [], question: 'q', answer: 'a' })
assert.equal(shaky.verdict, 'partial')
console.log('low confidence:', shaky.verdict)

// 4a. overruling a negative verdict without a reason is refused.
await assert.rejects(
  () => service.updatePlan(pid, { toggleSufficiency: { id: second.id, passed: true } }),
  /必须写清为什么/,
)
// 4b. a pass with no written answer blocks the gate.
const third = await service.updatePlan(pid, {
  replaceSufficiency: [
    { q: first.q },
    { q: second.q },
    { q: '位置编码为什么用正弦？' },
  ],
})
const thirdId = third.sufficiency[2].id
const bare = await service.updatePlan(pid, { toggleSufficiency: { id: thirdId, passed: true } })
assert.match(bare.gate.reasons.join(' '), /没有留下答案/)
console.log('pass without answer:', bare.gate.ready, bare.gate.reasons.join(' / '))

// 4c. overruling with a reason and an answer retires the card.
const selfPassed = await service.updatePlan(pid, {
  toggleSufficiency: { id: second.id, passed: true, reason: '课上只要求结论', answer: '因为数值稳定。' },
})
assert.equal(selfPassed.cards.length, 0, 'overruling retires the card')
assert.equal(selfPassed.gate.selfJudged, 2, 'the un-answered third question counts as self judged')
const cleaned = await service.updatePlan(pid, { toggleSufficiency: { id: thirdId, passed: false } })
assert.equal(cleaned.gate.passed, 2)
assert.equal(cleaned.gate.aiJudged, 1)
assert.equal(cleaned.gate.selfJudged, 1)
assert.equal(cleaned.cards.length, 1, 'the failed third question keeps its own card')
assert.ok(
  cleaned.cards.every(card => !card.prompt.includes('sqrt')),
  'the overruled question no longer holds a card',
)
console.log('self pass:', JSON.stringify({ passed: cleaned.gate.passed, ai: cleaned.gate.aiJudged, self: cleaned.gate.selfJudged, cards: cleaned.cards.length }))

// 5. no engine → the route reports it instead of failing.
const emptyDeps = new GenerationService(paths, { service, books, insights, settings, jobs })
assert.equal(await emptyDeps.textReady(), false)
console.log('no-engine textReady:', false)
console.log('judge check: ok')
