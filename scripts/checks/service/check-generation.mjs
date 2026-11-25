/**
 * End-to-end check of inline generation with a fake text engine.
 *
 * Uses a throwaway data root so the real study library is untouched. The fake
 * engine returns the same JSON contracts a real model must satisfy, so this also
 * exercises the validation + repair path and the job lifecycle.
 */
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { settingsView } from '../../../src/core/settings.ts'
import { BookService } from '../../../src/host/books.ts'
import { GenerationService } from '../../../src/host/generation.ts'
import { UsageService } from '../../../src/host/usage.ts'
import { InsightService } from '../../../src/host/insights.ts'
import { JobQueue } from '../../../src/host/jobs.ts'
import { QuizSessionService } from '../../../src/host/quizSessions.ts'
import { StudyService } from '../../../src/host/service.ts'
import { SettingsService } from '../../../src/host/settings.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/generation', import.meta.url))
await rm(root, { recursive: true, force: true })
const paths = new LibraryPaths(root)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const usage = new UsageService(paths, settings)
const insights = new InsightService(paths)
const jobs = new JobQueue(paths, { concurrency: () => 1 })
await jobs.recover()

let materialId = ''
let unitId = ''
let pageStart = 1

const longNotes = [
  '## 本节目标',
  '把这一节的机制讲清楚，并说明它在整章里的位置。',
  '## 前置知识',
  '需要知道基本的向量与概率。',
  '## 核心概念',
  '注意力权重与缩放点积。',
  '## 逐步讲解',
  '先从查询与键的内积说起，再解释缩放的必要性。'.repeat(12),
  '## 类比',
  '像在图书馆里按关键词检索，但每个词都带权重。',
  '## 常见误区',
  '误区一：把缩放当成可有可无的常数。误区二：忽略掩码。',
  '## 自测',
  '1. 为什么除以根号 d？2. 多头在做什么？',
  '## 出处',
  `原始材料 p${pageStart}。`,
].join('\n')

const fake = {
  name: 'fake',
  async complete(request) {
    const text = String(request.user ?? '')
    if (text.includes('编排跨资料路径')) {
      return {
        text: JSON.stringify({
          steps: [
            { kind: 'unit', target: `${materialId}:${unitId}`, coverage: 'read', level: 3, why: '先建立该单元的基本机制' },
            { kind: 'unit', target: `${materialId}:invented-unit`, coverage: 'read', level: 2, why: '模型编造的单元应被忽略' },
          ],
        }),
      }
    }
    if (text.includes('主题/概念')) {
      return {
        text: JSON.stringify({
          concepts: [{ id: 'test/concept', name: '测试概念', definition: '用于端到端检查的概念', page: pageStart }],
        }),
      }
    }
    if (text.includes('写一份精读稿')) {
      return {
        text: JSON.stringify({
          notes: longNotes,
          pageRefs: [pageStart],
          concepts: [{ id: 'test/concept', name: '测试概念', definition: '用于端到端检查的概念' }],
        }),
      }
    }
    if (text.includes('这一节要考的掌握点')) {
      return {
        text: JSON.stringify({
          items: [
            {
              point: 'm1',
              type: 'apply',
              question: '为什么缩放点积要除以根号 d_k？',
              rubric: ['指出内积的方差随维度增长', '说明不缩放会让 softmax 饱和'],
              concepts: [],
              page: pageStart,
              difficulty: 2,
            },
          ],
        }),
      }
    }
    if (text.includes('【用户写下的答案】')) {
      return { text: JSON.stringify({ verdict: 'pass', missing: [], advice: '可以', confidence: 0.9 }) }
    }
    if (text.includes('练习题')) {
      return {
        text: JSON.stringify({
          items: [
            {
              type: 'choice',
              question: '缩放点积里除以什么？',
              choices: ['根号 d_k', 'd_k', '常数 2'],
              answerIndex: 0,
              concepts: ['test/concept'],
              page: pageStart,
            },
          ],
        }),
      }
    }
    if (text.includes('编译成一本自编书的大纲')) {
      return {
        text: JSON.stringify({
          title: '测试自编书',
          subtitle: '从生成到阅读',
          audience: '测试读者',
          parts: [
            {
              title: '第一部分',
              chapters: [
                {
                  title: '第一章：基本机制',
                  summary: '建立基本机制，并说明为什么下一步需要它。',
                  objectives: ['能复述机制'],
                  prerequisites: ['基础'],
                  narrativeRole: '全书起点',
                  sourceUnits: [`${materialId}:${unitId}`],
                },
              ],
            },
          ],
        }),
      }
    }
    if (text.includes('正在写《')) {
      return {
        text: JSON.stringify({
          summary: '本章建立了基本机制，并给下一章留下问题。',
          body: '## 从一个问题开始\n\n为什么要先学这个？因为下一步需要它。\n\n## 逐步推导\n\n' + '推导过程。'.repeat(200) + '\n\n## 本章小结\n\n- 机制一\n- 机制二\n- 机制三',
          transition: '下一章我们把机制用到具体例子上。',
          sourceRefs: [{ material: materialId, unit: unitId, page: pageStart }],
          concepts: [{ id: 'book/check', name: '书稿检查', definition: '用于测试自编书' }],
          exercises: [
            { type: 'choice', question: '机制的核心是？', choices: ['A', 'B'], answerIndex: 0, concepts: ['book/check'], page: pageStart, difficulty: 2, explanation: 'A 正确。' },
          ],
        }),
      }
    }
    if (text.includes('统稿检查')) {
      return { text: JSON.stringify({ verdict: 'pass', issues: [], bridges: [] }) }
    }
    if (text.includes('大道至简')) {
      return {
        text: JSON.stringify({
          insights: [
            {
              title: '注意力就是加权检索',
              oneLiner: '查询决定看哪里，键决定看什么，值带回内容。',
              body: '把注意力看成一次软检索：每个位置按相关度取回其他位置的内容。',
              concepts: ['test/concept'],
              sources: [{ page: pageStart, quote: 'soft retrieval' }],
              kind: 'principle',
              tags: ['注意力'],
            },
          ],
        }),
      }
    }
    return { text: 'OK' }
  },
}

await settings.patch({ text: { kind: 'dsh', model: 'fake' }, study: { autoQuiz: true, autoInsight: true } })
const books = new BookService(paths, service)
const generation = new GenerationService(paths, { service, insights, settings, jobs, books, usage, textProvider: () => fake })
const quizSessions = new QuizSessionService(paths, service, generation)

const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
materialId = imported.manifest.id
const node = imported.manifest.structure.find(candidate => candidate.kind === 'section') ?? imported.manifest.structure[0]
unitId = node.uid
pageStart = node.pageStart
console.log('imported', materialId, unitId, 'p', pageStart)

const wait = async jobId => {
  for (let index = 0; index < 200; index += 1) {
    const job = await jobs.get(jobId)
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`job ${jobId} did not finish`)
}

const bareQuiz = await generation.generateQuiz({ material: materialId, unit: unitId })
const bareDone = await wait(bareQuiz.jobId)
const bareBank = await service.quiz(materialId, unitId)
console.log('quiz without notes:', bareDone.status, bareDone.error ?? 'ok', 'items', bareBank?.items.length ?? 0)

// Goal creation extracts the section's knowledge points itself. Without them
// the route would only be a copy of the table of contents.
const plan = await generation.generatePlan({ goal: '测试路径', materials: [materialId], depth: 'deep', deadline: '2026-12-31' })
const planJob = await wait(plan.jobId)
if (planJob.status !== 'done') throw new Error('plan job failed: ' + String(planJob.error))
console.log('plan job:', planJob.status, planJob.message)
const planView = await service.planView(plan.planId)
console.log('plan steps:', planView.steps.length, planView.steps.map(step => step.kind).join(','))
console.log('plan sections:', planView.sections.length, 'levels', planView.sections.map(section => section.level).join(','))
const firstPoint = planView.sections[0]
if (firstPoint === undefined || typeof firstPoint.mastery !== 'number' || typeof firstPoint.threshold !== 'number' || !Array.isArray(firstPoint.conceptStates)) {
  throw new Error('plan sections are missing visual progress fields')
}
if (firstPoint.level !== 3) throw new Error('the section level was not carried through')
if (!firstPoint.concepts.includes('test/concept')) {
  throw new Error('goal creation did not extract the section knowledge points')
}
if (planView.goalProgress.missingSections !== 0) {
  throw new Error('a required section still has no knowledge points')
}
const firstStepProgress = planView.steps.find(step => step.target?.unitId === unitId)?.progress
if (firstStepProgress === undefined || firstStepProgress.total === 0) {
  throw new Error('plan step is missing progress for the visual route')
}
console.log('plan visual data:', `${Math.round(firstPoint.mastery * 100)}%`, firstStepProgress.passed + '/' + firstStepProgress.total)

const planQuiz = await quizSessions.start({ material: materialId, unit: unitId })
if (planQuiz.session.atTarget?.total !== 1) throw new Error('goal section run has no target point')
if (planQuiz.points[0]?.threshold !== 0.85) throw new Error('the section threshold was not carried into the run')
console.log('goal section quiz start:', JSON.stringify(planQuiz.session.atTarget), 'item', planQuiz.item?.id, 'cost', planQuiz.usage?.inputTokens)
const planAnswer = await quizSessions.answer(
  planQuiz.session.id,
  planQuiz.item.id,
  '内积的方差随 d_k 增长，不缩放会让 softmax 梯度饱和。',
)
if (planAnswer.session.endedReason === 'completed') throw new Error('one answer must not pass a ledger threshold')
if (planAnswer.points[0]?.atTarget !== false) throw new Error('a single answer marked the point at target')
const afterMastery = await service.planView(plan.planId)
console.log(
  'goal section answer:',
  planAnswer.feedback.judged?.verdict,
  'at target:',
  JSON.stringify(planAnswer.session.atTarget),
  'concepts at target:',
  afterMastery.sections.every(section => section.conceptStates.every(state => state.atTarget)),
)

const outline = await generation.generateBookOutline(plan.planId)
const outlineDone = await wait(outline.jobId)
console.log('book outline:', outlineDone.status, outlineDone.error ?? 'ok')
const bookView = await books.list(plan.planId)
const bookId = bookView[0]?.id
console.log('book list:', bookView.length, bookId)
const chapterJob = await generation.generateBookChapter(bookId, 'ch-1')
const chapterDone = await wait(chapterJob.jobId)
console.log('book chapter:', chapterDone.status, chapterDone.error ?? 'ok')
const chapterView = await books.chapter(bookId, 'ch-1')
console.log('chapter content:', chapterView.content.length, 'quiz', chapterView.quiz?.items.length ?? 0)
console.log('book export:', (await books.exportMarkdown(bookId)).length)
const unitJob = await generation.generateUnit({ material: materialId, unit: unitId })
const unitDone = await wait(unitJob.jobId)
console.log('unit job:', unitDone.status, unitDone.error ?? unitDone.message, JSON.stringify(unitDone.result ?? {}).slice(0, 220))
const unitView = await service.unit(materialId, unitId)
console.log('notes:', unitView.notes === null ? 'none' : `${unitView.notes.length} chars`, 'quiz:', unitView.quiz?.items.length ?? 0, 'insights:', unitView.insights.length)
console.log('insight cards:', (await insights.cards()).length)
console.log('settings masked:', settingsView(await settings.current()).text)
console.log('settings file mode checked separately; view has no apiKey field')
