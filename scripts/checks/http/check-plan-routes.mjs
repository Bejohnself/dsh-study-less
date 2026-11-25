/**
 * Route-level check of the stage-1 loop: the browser's crop list, attempts,
 * attempts and the knowledge-space closure all travel through /plan/*.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { ensureKnowledge, writeKnowledge } from '../../../src/core/knowledge.ts'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { addDays, localDate } from '../../../src/core/time.ts'
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
  // The single-goal rule means a leftover open plan from check-plan would block
  // creation here; this check only needs the imported sample.
  for (const plan of await service.planList()) {
    if (plan.status !== 'done') await service.deletePlan(plan.id)
  }
  // This check shares check-plan's library; that run leaves concepts at target,
  // which would let this goal close before its own gate is exercised.
  await rm(service.paths.knowledgeFile, { force: true })
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
  assert.equal(view.steps[0].coverage, 'read', 'old plans read as read')
  console.log('detail:', 'total', view.total, '| boundary', JSON.stringify(view.boundary))

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
  console.log('attempts:', attempt.body.value.attempts.length)

  // Closing reads the knowledge space: concepts live on the sections, so give
  // each required section one and put every concept of it at target.
  for (const [index, section] of sections.entries()) {
    const unit = await service.unit(mid, section.uid)
    if ((unit.unit.concepts ?? []).length === 0) {
      await service.writeConcepts(mid, section.uid, [{ id: `route/section-${index + 1}`, name: `第 ${index + 1} 节` }])
    }
  }
  const knowledge = await ensureKnowledge(service.paths)
  for (const section of sections) {
    const unit = await service.unit(mid, section.uid)
    for (const conceptId of unit.unit.concepts ?? []) {
      const evidence = {}
      for (let index = 0; index < 8; index += 1) {
        evidence[`route-review-${String(index)}`] = {
          verdict: 'pass',
          difficulty: 2,
          at: `${addDays(localDate(), -(8 - index))}T10:00:00+08:00`,
          review: true,
        }
      }
      knowledge.concepts[conceptId] = {
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
  }
  await writeKnowledge(service.paths, knowledge)
  const closed = await call('/plan/close', { pid, note: '白板推完了两问' })
  assert.equal(closed.status, 200)
  assert.equal(closed.body.value.plan.status, 'done')
  assert.equal(closed.body.value.plan.meta.closureNote, '白板推完了两问')
  console.log('closed:', closed.body.value.plan.meta.closedAt)

  // The reading page's archive reads /plans and then each closed detail; the
  // closed goal must stay in the list instead of vanishing with Today.
  const listed = await call('/plans')
  assert.ok(
    listed.body.value.some(plan => plan.id === pid && plan.status === 'done'),
    'a closed goal stays listed for the archive',
  )

  const reopened = await call('/plan/update', { pid, setStatus: 'active' })
  assert.equal(reopened.body.value.plan.meta.closedAt, undefined)
  console.log('reopened: ok')
} finally {
  server.close()
}
