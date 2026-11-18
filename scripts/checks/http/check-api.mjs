/**
 * HTTP smoke test for the 0.2 API surface.
 *
 * Runs against a throwaway root and a fake text engine, so it checks routing,
 * masking, jobs, quiz submission and insights without touching the real library.
 */
import { createServer } from 'node:http'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { BookService } from '../../../src/host/books.ts'
import { GenerationService } from '../../../src/host/generation.ts'
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
const insights = new InsightService(paths)
const books = new BookService(paths, service)
const quizSessions = new QuizSessionService(paths, service, books)
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
const generation = new GenerationService(paths, { service, insights, settings, jobs, books, textProvider: () => fake })
const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
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

const routes = makeStudyRoutes(service, { settings, insights, generation, jobs, quizSessions, books })
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

  const booksList = await call('/books')
  const bookView = await call(`/book?bid=${book.id}`)
  const bookChapter = await call(`/book/chapter?bid=${book.id}&cid=ch-1`)
  const bookExport = await fetch(`${base}/book/export?bid=${book.id}`)
  console.log('book routes:', booksList.status, bookView.status, bookChapter.status, bookExport.status)

  const unitJob = await postJson('/generate/unit', { mid, uid })
  console.log('generate unit:', unitJob.status, unitJob.body.value.jobId)
  const finished = await wait(unitJob.body.value.jobId)
  console.log('unit job:', finished.status, finished.error ?? finished.result?.quizItems)
  const unit = await call(`/unit?mid=${mid}&uid=${uid}`)
  console.log('unit read:', unit.status, 'notes', unit.body.value.notes?.length, 'quiz', unit.body.value.quiz?.items?.length, 'insights', unit.body.value.insights?.length)

  const submit = await postJson('/quiz/submit', { mid, uid, answers: [{ itemId: 'q1', answer: 0 }] })
  console.log('quiz submit:', submit.status, submit.body.value.score, submit.body.value.ratingSuggestion)

  const bankCount = unit.body.value.quiz?.items?.length ?? 0
  const sessionStart = await postJson('/quiz/session/start', { mid, uid })
  const sid = sessionStart.body.value.session.id
  const firstId = sessionStart.body.value.item?.id
  if (sessionStart.status !== 200 || firstId === undefined) throw new Error('quiz session start failed')
  // A session may ask more than the bank holds: it tops up on demand until the
  // section's points pass (or the cap), so only the cap bounds it.
  if (sessionStart.body.value.session.limit < bankCount || sessionStart.body.value.session.limit > 20) {
    throw new Error(`session limit ${sessionStart.body.value.session.limit} out of range for bank ${bankCount}`)
  }
  if ('answerIndex' in (sessionStart.body.value.item ?? {})) throw new Error('quiz session leaked answerIndex')
  console.log('quiz session start:', sessionStart.status, 'limit', sessionStart.body.value.session.limit, 'item', firstId)

  const sessionAnswer = await postJson('/quiz/session/answer', { sid, itemId: firstId, answer: 0 })
  if (sessionAnswer.status !== 200) throw new Error('quiz session answer failed')
  if (sessionAnswer.body.value.history?.length !== 1) throw new Error('quiz session history missing')
  if (sessionAnswer.body.value.summary !== undefined) throw new Error('quiz session ended too early')
  const nextId = sessionAnswer.body.value.next?.id
  if (nextId === undefined) throw new Error('quiz session has no next item')
  console.log('quiz session answer:', sessionAnswer.status, 'history', sessionAnswer.body.value.history.length, 'next', nextId)

  const sessionView = await call(`/quiz/session?sid=${sid}`)
  if (sessionView.body.value.item?.id !== nextId) throw new Error('session view current item mismatch')
  if (sessionView.body.value.history?.length !== 1) throw new Error('session view history mismatch')

  const sessionIndex = await call(`/quiz/sessions?mid=${mid}&uid=${uid}`)
  if (sessionIndex.body.value.active?.session?.id !== sid) throw new Error('session index active mismatch')
  if (sessionIndex.body.value.active?.history?.length !== 1) throw new Error('session index history mismatch')
  console.log('quiz index:', sessionIndex.status, 'active', sessionIndex.body.value.active?.session?.id === sid, 'recent', sessionIndex.body.value.recent?.length)

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
  if (oldView.body.value.history?.length !== 1) throw new Error('old session lost its history')
  if (restarted.body.value.item?.id !== firstId) throw new Error('question order is not stable across sessions')
  console.log('quiz session restart:', sid2 !== sid, 'orderStable', restarted.body.value.item?.id === firstId)

  const finishedSession = await postJson('/quiz/session/finish', { sid: sid2 })
  if (finishedSession.body.value.session.status !== 'done' || finishedSession.body.value.session.endedReason !== 'finished') {
    throw new Error('finish did not close the session')
  }
  const sessionIndex2 = await call(`/quiz/sessions?mid=${mid}&uid=${uid}`)
  if (!sessionIndex2.body.value.recent?.some(record => record.id === sid2 && record.endedReason === 'finished')) {
    throw new Error('recent did not include the finished session')
  }
  console.log('quiz session finish:', finishedSession.body.value.session.endedReason, 'recent', sessionIndex2.body.value.recent?.length)

  const activeSession = await postJson('/quiz/session/start', { mid, uid })
  const sid3 = activeSession.body.value.session.id
  const quizJob = await postJson('/generate/quiz', { mid, uid })
  const quizDone = await wait(quizJob.body.value.jobId)
  if (quizDone.status !== 'done') throw new Error('quiz regeneration failed')
  const stale = await call(`/quiz/session?sid=${sid3}`)
  if (stale.body.value.session.status !== 'done' || stale.body.value.session.endedReason !== 'bank-changed') {
    throw new Error('stale session was not closed after the bank changed')
  }
  console.log('quiz session bank change:', stale.body.value.session.endedReason)

  const insightJob = await postJson('/generate/insight', { mid, uid })
  const insightDone = await wait(insightJob.body.value.jobId)
  console.log('insight job:', insightDone.status)
  const list = await call('/insights')
  console.log('insights list:', list.status, list.body.value.length)
  const created = await postJson('/insight/create', {
    title: '手动洞察',
    oneLiner: '一句话',
    body: '手动创建的正文，需要足够长才能通过校验，并保留来源页码。',
    concepts: ['api/check'],
    sources: [{ material: mid, unit: uid, page }],
    kind: 'principle',
  })
  console.log('insight create:', created.status, created.body.value.id)
  const pin = await postJson('/insight/pin', { iid: created.body.value.id, pinned: true })
  console.log('insight pin:', pin.status, pin.body.value.pinned)

  const archived = await postJson('/material/archive', { mid, archived: true })
  console.log('archive:', archived.status, archived.body.value.archived)
  const shelf = await call('/library')
  console.log('shelf excludes archived:', shelf.body.value.length)
  const all = await call('/library?archived=1')
  console.log('shelf includes archived:', all.body.value.length)

  const retry = await postJson('/plan/retry-chat', { pid: planId })
  console.log('retry chat prompt:', retry.status, retry.body.value.prompted, retry.body.value.prompt.length > 100)

  const bookDelete = await postJson('/book/delete', { bid: book.id })
  console.log('book delete:', bookDelete.status, booksList.body.value.length)

  await postJson('/plan/delete', { pid: planId })
  const plans = await call('/plans')
  console.log('plans after delete:', plans.body.value.length)

  const deleted = await postJson('/material/delete', { mid })
  console.log('material delete:', deleted.status)
  const afterDelete = await call('/library?archived=1')
  console.log('shelf after delete:', afterDelete.body.value.length)
  const conceptsAfter = await call('/concepts')
  const insightsAfter = await call('/insights')
  console.log('concepts/insights after delete:', conceptsAfter.body.value.length, insightsAfter.body.value.length)
} finally {
  server.close()
}
