/**
 * End-to-end check of the reading surface: blocks, guiding cards, merge.
 *
 * Uses a throwaway data root and a fake text engine. The fake answers with the
 * JSON contract a real model must satisfy, so this exercises the prompt shape,
 * the validator, the repair path and the unit view that the rail reads.
 *
 * The checks that matter here are the reading-surface rules (POSITIONING §3):
 * blocks tile the unit, one card per block, no explanation, and merging stays
 * contiguous.
 */
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { BookService } from '../../../src/host/books.ts'
import { GenerationService } from '../../../src/host/generation.ts'
import { InsightService } from '../../../src/host/insights.ts'
import { JobQueue } from '../../../src/host/jobs.ts'
import { SettingsService } from '../../../src/host/settings.ts'
import { StudyService } from '../../../src/host/service.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/blocks', import.meta.url))
await rm(root, { recursive: true, force: true })

const paths = new LibraryPaths(root)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const insights = new InsightService(paths)
const jobs = new JobQueue(paths, { concurrency: () => 1 })
await jobs.recover()
const books = new BookService(paths, service)

let mode = 'good'
let total = 1

/** Split the unit's paragraphs into two blocks (or one when there is only one). */
function blocksAnswer() {
  const bad = mode === 'bad'
  const middle = Math.floor((total - 1) / 2)
  const split = total > 1
  const blocks = [
    {
      id: 'b1',
      startPara: 0,
      endPara: split ? middle : total - 1,
      title: '要素',
      kind: 'predict',
      transition: bad ? '因为奖励可微，所以可以反向传播' : '上面把问题拆成了几个部件',
      question: '如果去掉奖励信号，智能体还能靠什么学？',
    },
  ]
  if (split) {
    blocks.push({
      id: 'b2',
      startPara: middle + 1,
      endPara: total - 1,
      title: '推导',
      kind: 'contrast',
      transition: '刚读完的部分给出了形式化的写法',
      question: '两种写法在最坏情况下差多少？',
    })
  }
  return JSON.stringify({ blocks })
}

const fake = {
  name: 'fake',
  async complete(request) {
    const text = String(request.user ?? '')
    // The repair round repeats the previous answer plus the issues, so it no
    // longer carries the prompt's wording; match on the contract instead.
    if (text.includes('引导卡') || text.includes('"blocks"')) return { text: blocksAnswer() }
    return { text: 'OK' }
  },
}

await settings.patch({ text: { kind: 'dsh', model: 'fake' } })
const generation = new GenerationService(paths, { service, insights, settings, jobs, books, textProvider: () => fake })

const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
const materialId = imported.manifest.id
const node =
  imported.manifest.structure.find(candidate => candidate.kind === 'section' && candidate.pageEnd > candidate.pageStart) ??
  imported.manifest.structure[0]
const unitId = node.uid
const paragraphs = await service.layout(materialId, node.pageStart, node.pageEnd)
total = paragraphs.length
console.log('layout:', paragraphs.length, 'paragraphs over p', node.pageStart, '-', node.pageEnd)

const wait = async jobId => {
  for (let index = 0; index < 400; index += 1) {
    const job = await jobs.get(jobId)
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`job ${jobId} did not finish`)
}

const check = (label, condition, detail) => {
  console.log(`${condition ? '✔' : '✘'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!condition) process.exitCode = 1
}

// 1. A good answer writes blocks that tile the unit.
const first = await generation.generateBlocks({ material: materialId, unit: unitId })
const firstDone = await wait(first.jobId)
check('blocks job done', firstDone.status === 'done', firstDone.error ?? '')

const view = await service.unit(materialId, unitId)
const blocks = view.blocks ?? []
check('unit view carries blocks', blocks.length >= 1, `${blocks.length} blocks`)
check('first block starts at the unit', blocks[0]?.startPara === 0, `#${blocks[0]?.startPara}`)
check('last block reaches the unit end', blocks.at(-1)?.endPara === total - 1, `#${blocks.at(-1)?.endPara}`)
check(
  'blocks tile without gaps',
  blocks.every((block, index) => index === 0 || block.startPara === (blocks[index - 1]?.endPara ?? -1) + 1),
)
check('page spans are derived', blocks.every(block => block.startPage >= node.pageStart && block.endPage <= node.pageEnd))
check('every block carries a card', blocks.every(block => block.prompt !== undefined))
check(
  'no card explains',
  blocks.every(block => !/因为|所以|也就是说|简单来说|本质上/u.test(block.prompt?.transition ?? '')),
)

// 2. Merging stays contiguous and shrinks the count by one.
if (blocks.length > 1) {
  const merged = await service.mergeBlock(materialId, unitId, blocks[1].id)
  check('merge removes one block', merged.blocks.length === blocks.length - 1, `${merged.blocks.length}`)
  check(
    'merge keeps the tiling',
    merged.blocks.every((block, index) => index === 0 || block.startPara === (merged.blocks[index - 1]?.endPara ?? -1) + 1) &&
      merged.blocks.at(-1)?.endPara === total - 1,
  )
  const afterMerge = await service.unit(materialId, unitId)
  check('merged state reaches the view', afterMerge.blocks?.length === merged.blocks.length)
}

// 3. An explaining transition is refused, and the job reports why.
mode = 'bad'
const bad = await generation.generateBlocks({ material: materialId, unit: unitId })
const badDone = await wait(bad.jobId)
check('bad card is refused', badDone.status === 'failed', badDone.error ?? '')
check(
  'refusal names the explaining transition',
  (badDone.issues ?? []).some(issue => issue.includes('只能指向刚读过的内容')),
  (badDone.issues ?? []).join(' | ').slice(0, 160),
)

// 4. The reading surface never writes progress.
const progress = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('progress.json', `file://${root}/`), 'utf8').catch(() => '{}'))
const state = progress.units?.[`${materialId}:${unitId}`]?.state
check('blocks do not touch progress', state === undefined, String(state))

// 5. Reading-surface files live next to the unit, not in the ledger.
const blocksFile = await (await import('node:fs/promises')).readFile(new URL(`file://${root}/materials/${materialId}/units/${unitId}/blocks.json`), 'utf8')
check('blocks.json exists beside the unit', blocksFile.includes('"version": 2'))

if (process.exitCode === undefined) console.log('blocks check: ok')