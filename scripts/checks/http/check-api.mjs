/**
 * HTTP smoke test for the 0.2 API surface.
 *
 * Runs against a throwaway root and a fake text engine, so it checks routing,
 * masking, jobs and quiz submission without touching the real library.
 */
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { BookService } from '../../../src/host/books.ts'
import { GenerationService } from '../../../src/host/generation.ts'
import { UsageService } from '../../../src/host/usage.ts'
import { InsightService } from '../../../src/host/insights.ts'
import { JobQueue } from '../../../src/host/jobs.ts'
import { QuizSessionService } from '../../../src/host/quizSessions.ts'
import { makeStudyRoutes } from '../../../src/host/routes.ts'
import { StudyService } from '../../../src/host/service.ts'
import { SettingsService } from '../../../src/host/settings.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/api', import.meta.url))
await rm(root, { recursive: true, force: true })
const paths = new LibraryPaths(root)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const usage = new UsageService(paths, settings)
const insights = new InsightService(paths)
const books = new BookService(paths, service)
const jobs = new JobQueue(paths, { concurrency: () => 1 })
await jobs.recover()

let mid = ''
let uid = ''
let page = 1
const notes = [
  '## 本节目标',
  '说明机制。',
  '## 前置知识',
  '基础数学。',
  '## 核心概念',
  '加权检索。',
  '## 逐步讲解',
  '先讲查询与键的内积，再解释缩放。'.repeat(20),
  '## 类比',
  '像按关键词检索。',
  '## 常见误区',
  '误区一：忽略缩放。误区二：忽略掩码。',
  '## 自测',
  '为什么缩放？',
  '## 出处',
  `p${page}。`,
].join('\n')

const fake = {
  name: 'fake',
  async complete(request) {
    const text = String(request.user ?? '')
    if (text.includes('写一份精读稿')) {
      return { text: JSON.stringify({ notes, pageRefs: [page], concepts: [{ id: 'api/check', name: '接口检查' }, { id: 'api/check-2', name: '接口检查二' }] }) }
    }
    if (text.includes('练习题')) {
      return {
        text: JSON.stringify({
          items: [
            { type: 'choice', question: '除以什么？', choices: ['根号 d', 'd'], answerIndex: 0, concepts: ['api/check'], page, difficulty: 1 },
            { type: 'choice', question: '为什么要缩放？', choices: ['稳定内积', '加快训练'], answerIndex: 0, concepts: ['api/check'], page, difficulty: 2 },
            { type: 'choice', question: 'softmax 前做什么？', choices: ['掩码', '归一化'], answerIndex: 0, concepts: ['api/check'], page, difficulty: 3 },
          ],
        }),
      }
    }
    if (text.includes('大道至简')) {
      return {
        text: JSON.stringify({
          insights: [
            {
              title: '加权检索',
              oneLiner: '按相关度取回内容。',
              body: '把注意力看成一次软检索：每个位置按相关度取回其他位置的内容，并加权求和。',
              concepts: ['api/check'],
              sources: [{ page }],
              kind: 'principle',
            },
          ],
        }),
      }
    }
    return { text: 'OK' }
  },
}

await settings.patch({ text: { kind: 'dsh', model: 'fake' }, study: { autoQuiz: true, autoInsight: true } })
const generation = new GenerationService(paths, { service, insights, settings, jobs, books, usage, textProvider: () => fake })
const quizSessions = new QuizSessionService(paths, service, generation)
const imported = await service.import({ filePath: fileURLToPath(new URL('../../../tests/fixtures/attention.pdf', import.meta.url)) })
mid = imported.manifest.id
const node = imported.manifest.structure.find(candidate => candidate.kind === 'section') ?? imported.manifest.structure[0]
uid = node.uid
page = node.pageStart

const plan = await service.createPlan({
  goal: '删除检查',
  steps: [{ kind: 'unit', target: `${mid}:${uid}`, why: '检查删除路径' }],
})
const planId = plan.plan.id
const book = await books.create({
  version: 1,
  id: 'book-api-check',
  planId,
  title: '接口检查书',
  goal: '检查书路由',
  status: 'outline',
  sourceMaterials: [mid],
  parts: [{ id: 'part-1', title: '第一部分', chapterIds: ['ch-1'] }],
  chapters: [{
    id: 'ch-1',
    order: 1,
    title: '第一章',
    summary: '摘要',
    objectives: ['目标'],
    prerequisites: [],
    narrativeRole: '起点',
    sourceRefs: [{ material: mid, unit: uid, pageStart: page, pageEnd: page }],
    concepts: [],
    status: 'outline',
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const routes = makeStudyRoutes(service, { settings, insights, generation, jobs, quizSessions, books, usage })
const server = createServer((req, res) => {
  void routes[0].handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}/study-api`
const call = async (path, init) => {
  const response = await fetch(base + path, init)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}
const postJson = (path, body) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const wait = async jobId => {
  for (let index = 0; index < 200; index += 1) {
    const result = await call(`/jobs/${jobId}`)
    const job = result.body?.value
    if (job?.status === 'done' || job?.status === 'failed') return job
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('job timeout')
}

try {
  const health = await call('/health')
  console.log('health:', health.status, health.body.version)
  const view = await call('/settings')
  console.log('settings:', view.status, view.body.value.text.kind, 'keySet', view.body.value.text.apiKeySet)
  const saved = await postJson('/settings', { study: { autoQuiz: false } })
  console.log('settings save:', saved.status, saved.body.value.study.autoQuiz)
  await postJson('/settings', { study: { autoQuiz: true } })
  const usageView = await call('/usage')
  console.log('usage:', usageView.status, usageView.body.value.totals.calls)
  const restartUnsupported = await postJson('/plugin/restart', {})
  console.log('plugin restart unsupported:', restartUnsupported.status)
  if (restartUnsupported.status !== 501) throw new Error('restart route should degrade to 501 without a loader')

  // Test clock: one click moves "today", the today panel shows the new date.
  const clockStart = await call('/clock')
  const clockNext = await postJson('/clock', {})
  const clockToday = await call('/today')
  if (clockNext.body.value.offsetDays !== 1 || clockToday.body.value.clockOffsetDays !== 1) {
    throw new Error('clock routes did not advance one day')
  }
  if (clockToday.body.value.date !== clockNext.body.value.today) throw new Error('today panel ignored the test clock')
  const clockReset = await postJson('/clock', { reset: true })
  if (clockReset.body.value.offsetDays !== 0 || clockStart.body.value.offsetDays !== 0) {
    throw new Error('clock reset did not return to the real date')
  }
  console.log('clock:', clockStart.body.value.today, '->', clockNext.body.value.today, '->', clockReset.body.value.today)

  const frozen = [
    await call('/books'),
    await call(`/book?bid=${book.id}`),
    await call(`/book/chapter?bid=${book.id}&cid=ch-1`),
    { status: (await fetch(`${base}/book/export?bid=${book.id}`)).status },
    await call('/insights'),
    await call('/concepts'),
    await call('/concept?cid=api/check'),
    await postJson('/generate/insight', { mid, uid }),
    await postJson('/generate/book/outline', { pid: planId }),
  ]
  const frozenStatuses = frozen.map(result => result.status)
  console.log('frozen routes:', frozenStatuses.join(','))
  if (frozenStatuses.some(status => status !== 404)) throw new Error('a frozen route is still served')

  const unitJob = await postJson('/generate/unit', { mid, uid })
  console.log('generate unit:', unitJob.status, unitJob.body.value.jobId)
  const finished = await wait(unitJob.body.value.jobId)
  console.log('unit job:', finished.status, finished.error ?? finished.result?.quizItems)
  const unit = await call(`/unit?mid=${mid}&uid=${uid}`)
  console.log('unit read:', unit.status, 'notes', unit.body.value.notes?.length, 'quiz', unit.body.value.quiz?.items?.length, 'insights', unit.body.value.insights?.length)

  // The plan page fills one section's knowledge points through this route.
  await service.writeConcepts(mid, uid, [{ id: 'test/concept', name: '测试概念' }])
  const planConcepts = await postJson('/plan/concepts', { pid: planId, target: `${mid}:${uid}` })
  if (planConcepts.status !== 200 || planConcepts.body.value.plan === undefined) {
    throw new Error('plan concepts route failed: ' + JSON.stringify(planConcepts.body))
  }
  const planConceptsBad = await postJson('/plan/concepts', { pid: planId, target: `${mid}:nope` })
  if (planConceptsBad.status === 200) throw new Error('plan concepts accepted an unknown step')
  console.log('plan concepts:', planConcepts.status, planConcepts.body.value.extracted)

  const submit = await postJson('/quiz/submit', { mid, uid, answers: [{ itemId: 'q1', answer: 0 }] })
  console.log('quiz submit:', submit.status, submit.body.value.score, submit.body.value.ratingSuggestion)

  const sessionStart = await postJson('/quiz/session/start', { mid, uid })
  if (sessionStart.body?.value === undefined) {
    throw new Error('quiz session start failed: ' + JSON.stringify(sessionStart.body))
  }
  const sid = sessionStart.body.value.session.id
  const firstId = sessionStart.body.value.item?.id
  if (sessionStart.status !== 200 || firstId === undefined) throw new Error('quiz session start failed')
  if (!Array.isArray(sessionStart.body.value.points)) throw new Error('quiz session start has no points')
  if (sessionStart.body.value.session.count !== 0) throw new Error('a new run must start at question one')
  if ('limit' in sessionStart.body.value.session) throw new Error('a run has no question cap any more')
  if ('answerIndex' in (sessionStart.body.value.item ?? {})) throw new Error('quiz session leaked answerIndex')
  if (sessionStart.body.value.usage === undefined) throw new Error('the question cost was not reported')
  console.log('quiz session start:', sessionStart.status, 'item', firstId, 'points', sessionStart.body.value.points.length)

  const sessionAnswer = await postJson('/quiz/session/answer', { sid, itemId: firstId, answer: 0 })
  if (sessionAnswer.status !== 200) throw new Error('quiz session answer failed: ' + JSON.stringify(sessionAnswer.body))
  if ('history' in sessionAnswer.body.value) throw new Error('answered questions are not stored')
  if ('next' in sessionAnswer.body.value) throw new Error('answer must not write the next question')
  const ended = sessionAnswer.body.value.summary !== undefined
  console.log('quiz session answer:', sessionAnswer.status, 'ended', ended)

  // Grading and writing the next question are separate calls, so the feedback
  // lands without waiting on a second model call.
  const nextCall = await postJson('/quiz/session/next', { sid })
  const nextId = nextCall.body.value.item?.id
  if (ended) {
    if (nextCall.status === 200) throw new Error('a finished run wrote another question')
  } else if (nextCall.status !== 200 || nextId === undefined) {
    throw new Error('quiz session next failed: ' + JSON.stringify(nextCall.body))
  }
  if (!ended) {
    const again = await postJson('/quiz/session/next', { sid })
    if (again.body.value.item?.id !== nextId) throw new Error('next is not idempotent while a question waits')
  }
  console.log('quiz session next:', nextCall.status, 'item', nextId)

  const sessionView = await call(`/quiz/session?sid=${sid}`)
  if (ended) {
    if (sessionView.body.value.session.status !== 'done') throw new Error('session view is not closed')
  } else if (sessionView.body.value.item?.id !== nextId) {
    throw new Error('session view current item mismatch')
  }
  if ('history' in sessionView.body.value) throw new Error('session view still carries a history')

  const sessionIndex = await call(`/quiz/sessions?mid=${mid}&uid=${uid}`)
  if (!ended && sessionIndex.body.value.active?.session?.id !== sid) throw new Error('session index active mismatch')
  if ('recent' in sessionIndex.body.value) throw new Error('the recent list is gone')
  console.log('quiz index:', sessionIndex.status, 'active', sessionIndex.body.value.active?.session?.id === sid)

  if (!ended) {
    const resumed = await postJson('/quiz/session/start', { mid, uid })
    if (resumed.body.value.session.id !== sid) throw new Error('start did not resume the active session')
    console.log('quiz session resume:', resumed.body.value.session.id === sid)

    const restarted = await postJson('/quiz/session/start', { mid, uid, restart: true })
    const sid2 = restarted.body.value.session.id
    if (sid2 === sid) throw new Error('restart reused the old session')
    const oldView = await call(`/quiz/session?sid=${sid}`)
    if (oldView.body.value.session.status !== 'done' || oldView.body.value.session.endedReason !== 'replaced') {
      throw new Error('old session was not marked replaced')
    }
    console.log('quiz session restart:', sid2 !== sid)

    const finishedSession = await postJson('/quiz/session/finish', { sid: sid2 })
    if (finishedSession.body.value.session.status !== 'done' || finishedSession.body.value.session.endedReason !== 'finished') {
      throw new Error('finish did not close the session')
    }
    console.log('quiz session finish:', finishedSession.body.value.session.endedReason)

    // No bank means no "the bank changed" state: a fresh start just writes a
    // new question for the same open points.
    const again = await postJson('/quiz/session/start', { mid, uid })
    if (again.body.value.session.status !== 'active' || again.body.value.item === undefined) {
      throw new Error('a new run could not write its first question')
    }
    await postJson('/quiz/session/finish', { sid: again.body.value.session.id })
    console.log('quiz session restart after finish:', again.body.value.session.id !== sid2)
  }
  const archived = await postJson('/material/archive', { mid, archived: true })
  console.log('archive:', archived.status, archived.body.value.archived)
  const shelf = await call('/library')
  console.log('shelf excludes archived:', shelf.body.value.length)
  const all = await call('/library?archived=1')
  console.log('shelf includes archived:', all.body.value.length)

  const retry = await postJson('/plan/retry-chat', { pid: planId })
  console.log('retry chat prompt:', retry.status, retry.body.value.prompted, retry.body.value.prompt.length > 100)

  await postJson('/plan/delete', { pid: planId })
  const plans = await call('/plans')
  console.log('plans after delete:', plans.body.value.length)

  const deleted = await postJson('/material/delete', { mid })
  console.log('material delete:', deleted.status)
  const afterDelete = await call('/library?archived=1')
  console.log('shelf after delete:', afterDelete.body.value.length)
  const conceptsAfter = await call('/concepts')
  const insightsAfter = await call('/insights')
  console.log('frozen after delete:', conceptsAfter.status, insightsAfter.status)
  if (conceptsAfter.status !== 404 || insightsAfter.status !== 404) throw new Error('frozen notes routes are still served')
} finally {
  server.close()
}
