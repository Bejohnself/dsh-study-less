import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { writeJsonAtomic } from '../src/core/store.ts'
import { writeKnowledge } from '../src/core/knowledge.ts'
import { writePlan } from '../src/core/plans.ts'
import { addDays, localDate } from '../src/core/time.ts'
import { StudyService } from '../src/host/service.ts'
import type { PlanRecord } from '../src/core/types.ts'

const root = await mkdtemp(join(tmpdir(), 'study-today-place-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)
const today = localDate()

async function seed(): Promise<void> {
  const at = `${today}T10:00:00+08:00`
  const structure = [
    { uid: 'u1', kind: 'section', title: '6.1 考点', pageStart: 1, pageEnd: 2 },
    { uid: 'u2', kind: 'section', title: '6.2 题型', pageStart: 3, pageEnd: 4 },
  ]
  await mkdir(dirname(paths.manifestFile('m1')), { recursive: true })
  await writeJsonAtomic(paths.manifestFile('m1'), {
    version: 1,
    id: 'm1',
    title: '数列',
    type: 'book',
    authors: [],
    tags: [],
    identifiers: {},
    source: { kind: 'pdf', file: 'x.pdf', pages: 4 },
    structure,
    units: [],
    createdAt: today,
    updatedAt: today,
  })
  for (const [uid, title] of [['u1', '6.1 考点'], ['u2', '6.2 题型']]) {
    await mkdir(dirname(paths.unitMetaFile('m1', uid)), { recursive: true })
    await writeJsonAtomic(paths.unitMetaFile('m1', uid), {
      version: 1,
      material: 'm1',
      unit: uid,
      title,
      concepts: ['seq/construction'],
      pageRefs: [1],
    })
  }
  await mkdir(dirname(paths.conceptFile('seq/construction')), { recursive: true })
  await writeJsonAtomic(paths.conceptFile('seq/construction'), {
    id: 'seq/construction',
    name: '构造法',
    aliases: [],
    definition: '',
    occurrences: [
      { material: 'm1', unit: 'u1', page: 1, role: 'definition' },
      { material: 'm1', unit: 'u2', page: 3, role: 'definition' },
    ],
    prereqOf: [],
    related: [],
    updatedAt: at,
  })
  const plan: PlanRecord = {
    id: 'p1',
    goal: '学会构造法',
    status: 'active',
    deliverable: '能讲清构造',
    deadline: addDays(today, 30),
    steps: [
      { n: 1, kind: 'unit', target: 'm1:u1', why: '先见一次', coverage: 'read', level: 1 },
      { n: 2, kind: 'unit', target: 'm1:u2', why: '真正要求会用', coverage: 'read', level: 3 },
    ],
    createdAt: at,
    updatedAt: at,
  }
  await writePlan(paths, plan)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: at,
    concepts: {
      'seq/construction': {
        mastery: 0.8,
        peak: 0.9,
        streak: 0,
        attempts: 4,
        correct: 4,
        lastAt: at,
        srs: { S: 20, D: 3, reps: 4, lapses: 0, lastRating: 4 },
        evidence: {},
      },
    },
  })
}

test('a due concept opens the section that asks for the deepest level', async () => {
  await rm(root, { recursive: true, force: true })
  await seed()
  const service = new StudyService(paths)
  const today = await service.todayView()
  const due = today.knowledge?.due.find(entry => entry.conceptId === 'seq/construction')
  assert.ok(due !== undefined, 'the point is below its level-3 threshold')
  assert.equal(due.target, 0.85, 'the deepest goal level sets the target')
  assert.equal(due.unitId, 'u2', 'not the first page that mentions it')
  assert.equal(due.unitTitle, '6.2 题型', 'the review column names the section')
})
