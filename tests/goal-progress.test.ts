import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeKnowledge, type ConceptState } from '../src/core/knowledge.ts'
import { writeJsonAtomic } from '../src/core/store.ts'
import { addDays } from '../src/core/time.ts'
import { LibraryPaths } from '../src/core/paths.ts'
import { goalProgressOf } from '../src/host/service/plans.ts'
import type { StudyService } from '../src/host/service.ts'
import type { PlanRecord } from '../src/core/types.ts'

const root = await mkdtemp(join(tmpdir(), 'study-goal-progress-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)
const today = '2026-03-01'

const service = { paths, today: () => today } as unknown as StudyService

/** One section with its concepts: the single copy the goal reads. */
async function seedSection(concepts: string[], level: 1 | 2 | 3 | 4 = 3): Promise<void> {
  await writeJsonAtomic(paths.manifestFile('m1'), {
    version: 1,
    id: 'm1',
    title: '注意力',
    type: 'book',
    authors: [],
    tags: [],
    identifiers: {},
    source: { kind: 'pdf', file: 'x.pdf', pages: 10 },
    structure: [
      { uid: 'u1', kind: 'section', title: '缩放点积', pageStart: 1, pageEnd: 10 },
      { uid: 'u2', kind: 'section', title: '未抽点的一节', pageStart: 1, pageEnd: 10 },
    ],
    units: [],
    createdAt: today,
    updatedAt: today,
  })
  await writeJsonAtomic(paths.unitMetaFile('m1', 'u1'), {
    version: 1,
    material: 'm1',
    unit: 'u1',
    title: '缩放点积',
    concepts,
    pageRefs: [1],
  })
  planSection.level = level
}

const planSection: { level: 1 | 2 | 3 | 4 } = { level: 3 }

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'p1',
    goal: '两周内讲清注意力',
    status: 'active',
    deliverable: '推导并讲 20 分钟',
    deadline: '2026-04-01',
    steps: [
      { n: 1, kind: 'unit', target: 'm1:u1', why: '核心', coverage: 'read', level: planSection.level },
    ],
    createdAt: today,
    updatedAt: today,
    ...overrides,
  }
}

/** S is stability in days: the gate reads it, not the calendar due date. */
function state(mastery: number, rounds = 0): ConceptState {
  const evidence: ConceptState['evidence'] = {}
  for (let index = 0; index < rounds; index += 1) {
    const day = addDays(today, -(rounds - index))
    evidence[`q-${String(index)}`] = {
      verdict: 'pass',
      difficulty: 2,
      at: `${day}T10:00:00+08:00`,
      review: true,
    }
  }
  return {
    mastery,
    peak: mastery,
    streak: 0,
    attempts: 3,
    correct: 3,
    lastAt: `${today}T10:00:00+08:00`,
    due: '2026-12-01',
    srs: { S: 80, D: 3, reps: 3, lapses: 0, lastRating: 4 },
    evidence,
  }
}

test('a goal closes only when every concept is at its level and safe through the deadline', async () => {
  await seedSection(['attn/scaled', 'attn/multi'], 3)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, 7),
      'attn/multi': state(0.9, 7),
    },
  })
  const ready = await goalProgressOf(service, plan())
  assert.equal(ready.ready, true, ready.reasons.join(' / '))
  assert.equal(ready.passed, 2)
  assert.equal(ready.total, 2)
})

test('a concept below its level blocks closure', async () => {
  await seedSection(['attn/scaled', 'attn/multi'], 3)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, 7),
      'attn/multi': state(0.6, 7),
    },
  })
  const progress = await goalProgressOf(service, plan())
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('没到档位')))
})

test('a concept that would drop before the deadline blocks closure', async () => {
  await seedSection(['attn/scaled', 'attn/multi'], 3)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      // Only three spaced reviews: the half-life is still short of the deadline.
      'attn/scaled': state(0.9, 3),
      'attn/multi': state(0.9, 7),
    },
  })
  const progress = await goalProgressOf(service, plan())
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('会在期限前掉档')))
})

test('a required section without knowledge points blocks closure and is named', async () => {
  await seedSection(['attn/scaled'], 3)
  await writeJsonAtomic(paths.unitMetaFile('m1', 'u2'), {
    version: 1,
    material: 'm1',
    unit: 'u2',
    title: '未抽点的一节',
    concepts: [],
    pageRefs: [],
  })
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: { 'attn/scaled': state(0.9) },
  })
  const progress = await goalProgressOf(
    service,
    plan({
      steps: [
        { n: 1, kind: 'unit', target: 'm1:u1', why: '核心', coverage: 'read', level: 3 },
        { n: 2, kind: 'unit', target: 'm1:u2', why: '也要读', coverage: 'read', level: 3 },
      ],
    }),
  )
  assert.equal(progress.ready, false)
  assert.equal(progress.missingSections, 1)
  assert.ok(progress.reasons.some(reason => reason.includes('未抽点的一节')))
})

test('a goal with a missing deadline cannot close', async () => {
  await seedSection(['attn/scaled', 'attn/multi'], 3)
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, 7),
      'attn/multi': state(0.9, 7),
    },
  })
  const progress = await goalProgressOf(service, plan({ deadline: undefined }))
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('期限')))
})
