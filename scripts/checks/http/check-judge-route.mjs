/**
 * Route check of /plan/judge: a judged answer, a negative verdict writing a card,
 * an empty answer, and the no-engine fallback.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { StudyService } from '../../../src/host/service.ts'
import { GenerationService } from '../../../src/host/generation.ts'
import { InsightService } from '../../../src/host/insights.ts'
import { BookService } from '../../../src/host/books.ts'
import { JobQueue } from '../../../src/host/jobs.ts'
import { SettingsService } from '../../../src/host/settings.ts'
import { makeStudyRoutes } from '../../../src/host/routes.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/judge-route', import.meta.url))
await rm(root, { recursive: true, force: true })
const paths = new LibraryPaths(root)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const insights = new InsightService(paths)
const books = new BookService(paths, service)
const jobs = new JobQueue(paths, { concurrency: () => 1 })

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
  deliverable: '能独立推导 Eq.1',
  steps: state.toc
    .filter(row => row.kind === 'section')
    .slice(0, 2)
    .map(row => ({ kind: 'unit', target: mid + ':' + row.uid, why: '推导依赖它' })),
})
const pid = created.plan.id
const view = await service.updatePlan(pid, { replaceSufficiency: [{ q: '能写出 Eq.1 吗？' }, { q: '为什么除以 sqrt(d)？' }] })
let q1 = view.sufficiency[0].id
let q2 = view.sufficiency[1].id

const routes = makeStudyRoutes(service, { generation, settings, insights, books, jobs })
const server = createServer((req, res) => {
  void routes[0].handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const base = 'http://127.0.0.1:' + String(address.port) + '/study-api'
const post = async (path, body) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

try {
  replies.push({ verdict: 'pass', missing: [], confidence: 0.9 })
  const passed = await post('/plan/judge', { pid, qid: q1, answer: 'QK^T 除以 sqrt(d)，softmax 后乘 V。' })
  assert.ok(passed.body.error === undefined, JSON.stringify(passed.body))
  assert.equal(passed.status, 200)
  assert.equal(passed.body.value.judged, true)
  assert.equal(passed.body.value.verdict, 'pass')
  assert.equal(passed.body.value.plan.sufficiency[0].verdict, 'pass')
  assert.equal(passed.body.value.plan.cards.length, 0)
  console.log('judged pass:', passed.body.value.verdict, '| cards', passed.body.value.plan.cards.length)

  replies.push({ verdict: 'partial', missing: ['没说方差'], advice: '补方差论证', confidence: 0.8 })
  const partial = await post('/plan/judge', {
    pid,
    qid: q2,
    answer: '因为数值稳定。',
    ref: mid + ':' + state.toc.filter(row => row.kind === 'section')[0].uid,
  })
  assert.equal(partial.status, 200)
  assert.equal(partial.body.value.verdict, 'partial')
  assert.equal(partial.body.value.plan.cards.length, 1)
  assert.match(partial.body.value.plan.cards[0].detail ?? '', /方差/)
  console.log('judged partial:', partial.body.value.verdict, '| card written')

  // 出题：模型写题，用户只作答。
  replies.push({
    verdict: undefined,
    questions: [
      { q: '能白板推出 Eq.1 里 softmax 的位置吗？', ref: mid + ':' + state.toc.filter(row => row.kind === 'section')[0].uid, why: '验证能不能独立复现' },
      { q: '去掉 sqrt(d) 后训练会怎样？', why: '验证对假设的理解' },
      { q: '短', why: '太短应被丢弃' },
      { q: '这条题指向不存在的范围，应保留但去掉 ref', ref: 'nope:nope', why: '验证 ref 校验' },
    ],
  })
  const written = await post('/plan/questions', { pid })
  assert.equal(written.status, 200)
  assert.equal(written.body.value.generated, true)
  const asked = written.body.value.plan.sufficiency
  assert.equal(asked.length, 3, 'too-short questions are dropped')
  assert.equal(asked[0].ref, mid + ':' + state.toc.filter(row => row.kind === 'section')[0].uid)
  assert.equal(asked[0].why, '验证能不能独立复现')
  assert.equal(asked[2].ref, undefined, 'an unknown ref is dropped, the question stays')
  console.log('questions generated:', asked.length, '| first ref kept:', asked[0].ref !== undefined)
  // Regeneration replaces the list, so the judge targets the new ids.
  q1 = asked[0].id
  q2 = asked[1].id

  const empty = await post('/plan/judge', { pid, qid: q2, answer: '   ' })
  assert.equal(empty.status, 400)
  console.log('empty answer:', empty.status, empty.body.error.message)

  const unknown = await post('/plan/judge', { pid, qid: 'q-nope', answer: 'x' })
  assert.equal(unknown.status, 404)
  console.log('unknown question:', unknown.status)

  // No generation service at all: the panel must get a clear refusal, not a crash.
  const bare = makeStudyRoutes(service)
  const bareServer = createServer((req, res) => {
    void bare[0].handler(req, res)
  })
  await new Promise(resolve => bareServer.listen(0, '127.0.0.1', resolve))
  const bareAddress = bareServer.address()
  const bareBase = 'http://127.0.0.1:' + String(bareAddress.port) + '/study-api'
  const denied = await fetch(bareBase + '/plan/judge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid, qid: q1, answer: 'x' }),
  })
  assert.equal(denied.status, 415)
  bareServer.close()
  console.log('no generation service:', denied.status)

  // Without a configured engine the route reports judged:false instead of failing.
  const engineFree = new GenerationService(paths, { service, books, insights, settings, jobs })
  const routesFree = makeStudyRoutes(service, { generation: engineFree, settings, insights, books, jobs })
  const freeServer = createServer((req, res) => {
    void routesFree[0].handler(req, res)
  })
  await new Promise(resolve => freeServer.listen(0, '127.0.0.1', resolve))
  const freeAddress = freeServer.address()
  const freeBase = 'http://127.0.0.1:' + String(freeAddress.port) + '/study-api'
  const fallback = await fetch(freeBase + '/plan/judge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid, qid: q1, answer: 'x' }),
  })
  const fallbackBody = await fallback.json()
  assert.equal(fallback.status, 200)
  assert.equal(fallbackBody.value.judged, false)
  assert.equal(fallbackBody.value.reason, 'no-engine')
  freeServer.close()
  console.log('no engine fallback:', fallbackBody.value.reason)
  console.log('judge route check: ok')
} finally {
  server.close()
}
