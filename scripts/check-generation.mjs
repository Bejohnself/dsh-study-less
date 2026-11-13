/**
 * End-to-end check of inline generation with a fake text engine.
 *
 * Uses a throwaway data root so the real study library is untouched. The fake
 * engine returns the same JSON contracts a real model must satisfy, so this also
 * exercises the validation + repair path and the job lifecycle.
 */
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../src/core/paths.ts'
import { settingsView } from '../src/core/settings.ts'
import { GenerationService } from '../src/host/generation.ts'
import { InsightService } from '../src/host/insights.ts'
import { JobQueue } from '../src/host/jobs.ts'
import { StudyService } from '../src/host/service.ts'
import { SettingsService } from '../src/host/settings.ts'

const root = fileURLToPath(new URL('../.test-generation', import.meta.url))
await rm(root, { recursive: true, force: true })
const paths = new LibraryPaths(root)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
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
            { kind: 'unit', target: `${materialId}:${unitId}`, why: '先建立该单元的基本机制' },
            { kind: 'paper-pass', target: `${materialId}:p1`, why: '再用第一遍把论文主张串起来' },
            { kind: 'drill', concepts: ['invented/concept'], why: '模型编造的概念应被忽略' },
          ],
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
const generation = new GenerationService(paths, { service, insights, settings, jobs, textProvider: () => fake })

const imported = await service.import({ filePath: fileURLToPath(new URL('../samples/attention.pdf', import.meta.url)) })
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

const plan = await generation.generatePlan({ goal: '测试路径', materials: [materialId], depth: 'deep' })
const planJob = await wait(plan.jobId)
console.log('plan job:', planJob.status, planJob.error ?? planJob.message)
const planView = await service.planView(plan.planId)
console.log('plan steps:', planView.steps.length, planView.steps.map(step => step.kind).join(','))

const unitJob = await generation.generateUnit({ material: materialId, unit: unitId })
const unitDone = await wait(unitJob.jobId)
console.log('unit job:', unitDone.status, unitDone.error ?? unitDone.message, JSON.stringify(unitDone.result ?? {}).slice(0, 220))
const unitView = await service.unit(materialId, unitId)
console.log('notes:', unitView.notes === null ? 'none' : `${unitView.notes.length} chars`, 'quiz:', unitView.quiz?.items.length ?? 0, 'insights:', unitView.insights.length)
console.log('insight cards:', (await insights.cards()).length)
console.log('settings masked:', settingsView(await settings.current()).text)
console.log('settings file mode checked separately; view has no apiKey field')
