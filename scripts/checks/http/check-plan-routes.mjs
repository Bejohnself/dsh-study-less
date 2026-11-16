/**
 * Route-level check of the stage-1 loop: the browser's crop list, attempts,
 * sufficiency questions and the closure gate all travel through /plan/*.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { StudyService } from '../../../src/host/service.ts'
import { makeStudyRoutes } from '../../../src/host/routes.ts'

const service = new StudyService(new LibraryPaths('.tmp/checks/plan'))
const routes = makeStudyRoutes(service)
const server = createServer((req, res) => {
  void routes[0].handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const base = 'http://127.0.0.1:' + String(address.port) + '/study-api'
const call = async (path, body) => {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

try {
  const library = await call('/library')
  const mid = library.body.value[0].id
  const material = await call('/material?mid=' + encodeURIComponent(mid))
  const sections = material.body.value.toc.filter(row => row.kind === 'section').slice(0, 3)
  assert.ok(sections.length >= 3, 'sample needs three sections')
  const created = await call('/plan/create', {
    goal: '搞懂注意力的推导',
    deliverable: '能独立推导第 3 节',
    deadline: '2026-12-20',
    audience: '组会',
    steps: sections.map(section => ({ kind: 'unit', target: mid + ':' + section.uid, why: '目标依赖这一节' })),
  })
  assert.equal(created.status, 200)
  const pid = created.body.value.plan.id
  assert.equal(created.body.value.plan.meta.deliverable, '能独立推导第 3 节')
  console.log('created:', pid, '| total', created.body.value.total)

  const detail = await call('/plan?pid=' + encodeURIComponent(pid))
  assert.equal(detail.status, 200)
  const view = detail.body.value
  assert.ok(view.boundary !== undefined, 'plan view carries the crop list')
  assert.ok(view.gate !== undefined, 'plan view carries the closure gate')
  assert.equal(view.steps[0].coverage, 'read', 'old plans read as read')
  console.log('detail:', 'total', view.total, '| boundary', JSON.stringify(view.boundary), '| gate', view.gate.ready)

  const meta = await call('/plan/update', { pid, setMeta: { deliverable: '能独立推导第 3 节', deadline: '2026-12-20', audience: '组会' } })
  assert.equal(meta.status, 200)
  assert.equal(meta.body.value.plan.meta.deliverable, '能独立推导第 3 节')
  console.log('meta:', meta.body.value.plan.meta)

  const badCrop = await call('/plan/update', { pid, setCoverage: { n: 2, coverage: 'skip' } })
  assert.equal(badCrop.status, 400)
  assert.equal(badCrop.body.error.code, 'invalid')
  console.log('skip without reason:', badCrop.status, badCrop.body.error.message)

  const crop = await call('/plan/update', { pid, setCoverage: { n: 2, coverage: 'skip', reason: '与目标无关' } })
  assert.equal(crop.status, 200)
  assert.equal(crop.body.value.steps[1].coverage, 'skip')
  assert.equal(crop.body.value.steps[1].skipReason, '与目标无关')
  assert.equal(crop.body.value.total, view.total - 1, 'skipped ranges leave the denominator')
  console.log('crop:', crop.body.value.steps[1].coverage, '| total now', crop.body.value.total)

  const badMove = await call('/plan/update', { pid, addAttempt: { move: 'nope', what: 'x', provenance: 'independent' } })
  assert.equal(badMove.status, 200)
  assert.equal(badMove.body.value.attempts.length, 0, 'an unknown move is dropped, not stored')
  console.log('unknown move dropped:', badMove.body.value.attempts.length)

  let attempt = badMove
  for (const index of [1, 2, 3]) {
    attempt = await call('/plan/update', {
      pid,
      addAttempt: { move: 'assumption', what: '改了假设 ' + String(index), stuck: '约束写不进奖励', provenance: 'independent' },
    })
  }
  assert.equal(attempt.body.value.attempts.length, 3)
  assert.equal(attempt.body.value.gate.independent, 3)
  assert.equal(attempt.body.value.stuck[0].count, 3)
  console.log('attempts:', attempt.body.value.attempts.length, '| stuck', attempt.body.value.stuck[0].count)

  const questions = await call('/plan/update', {
    pid,
    replaceSufficiency: [{ q: '能推出 Eq.1 吗？' }, { q: '能解释 sqrt(d) 吗？' }],
  })
  assert.equal(questions.status, 200)
  assert.equal(questions.body.value.gate.asked, 2)
  const firstId = questions.body.value.sufficiency[0].id
  const passed = await call('/plan/update', {
    pid,
    toggleSufficiency: { id: firstId, passed: true, answer: '自评答案：QK^T 除以 sqrt(d) 再 softmax' },
  })
  assert.equal(passed.body.value.gate.passed, 1)
  assert.equal(passed.body.value.gate.ready, false)
  console.log('gate before closing:', passed.body.value.gate.passed + '/' + passed.body.value.gate.asked, '|', passed.body.value.gate.reasons.join(' / '))

  const refused = await call('/plan/close', { pid })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.error.code, 'invalid')
  console.log('close refused:', refused.status, refused.body.error.message)

  const secondId = passed.body.value.sufficiency[1].id
  // 标为「没过」会写一张卡；/cards 与 /card/review 是它的两个出口。
  const failed = await call('/plan/update', { pid, toggleSufficiency: { id: secondId, passed: false } })
  assert.equal(failed.status, 200)
  assert.equal(failed.body.value.cards.length, 1, 'a failed question writes one card')
  assert.equal(failed.body.value.cards[0].prompt, '能解释 sqrt(d) 吗？')
  const cardsToday = await call('/cards')
  assert.equal(cardsToday.status, 200)
  assert.ok(Array.isArray(cardsToday.body.value), 'the due list is an array today')
  const cardId = failed.body.value.cards[0].id
  const reviewed = await call('/card/review', { cid: cardId, rating: 3 })
  assert.equal(reviewed.status, 200)
  assert.equal(reviewed.body.value.card.reps, 1)
  assert.ok(reviewed.body.value.due > new Date().toISOString().slice(0, 10))
  console.log('card:', cardId, '| reviewed reps', reviewed.body.value.card.reps, '| due', reviewed.body.value.due)
  // 通过必须留下答案，否则结案门会拦住。
  const bareRetry = await call('/plan/update', { pid, toggleSufficiency: { id: secondId, passed: true } })
  assert.equal(bareRetry.body.value.gate.ready, false, 'a pass without an answer cannot close the goal')
  console.log('pass without answer:', bareRetry.body.value.gate.reasons.join(' / '))
  const retried = await call('/plan/update', {
    pid,
    toggleSufficiency: { id: secondId, passed: true, answer: '自评答案：因为方差随 d 增长' },
  })
  assert.equal(retried.body.value.cards.length, 0, 'passing retires the card')
  console.log('card retired on pass: ok')
  const closed = await call('/plan/close', { pid, note: '白板推完了两问' })
  assert.equal(closed.status, 200)
  assert.equal(closed.body.value.plan.status, 'done')
  assert.equal(closed.body.value.plan.meta.closureNote, '白板推完了两问')
  console.log('closed:', closed.body.value.plan.meta.closedAt)

  const reopened = await call('/plan/update', { pid, setStatus: 'active' })
  assert.equal(reopened.body.value.plan.meta.closedAt, undefined)
  console.log('reopened: ok')
} finally {
  server.close()
}
