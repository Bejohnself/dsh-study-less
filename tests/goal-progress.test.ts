import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeKnowledge, type ConceptState } from '../src/core/knowledge.ts'
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

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    id: 'p1',
    goal: '两周内讲清注意力',
    status: 'active',
    deliverable: '推导并讲 20 分钟',
    deadline: '2026-04-01',
    steps: [],
    mastery: [
      { id: 'm1', title: '缩放点积', standard: '能推导', target: 'm1:u1', concepts: ['attn/scaled'], level: 3 },
      { id: 'm2', title: '多头', standard: '能改代码', target: 'm1:u1', concepts: ['attn/multi'], level: 2 },
    ],
    createdAt: today,
    updatedAt: today,
    ...overrides,
  }
}

function state(mastery: number, due: string): ConceptState {
  return {
    mastery,
    peak: mastery,
    streak: 0,
    attempts: 3,
    correct: 3,
    lastAt: `${today}T10:00:00+08:00`,
    due,
    srs: { S: 40, D: 3, reps: 3, lapses: 0, lastRating: 4 },
    evidence: {},
  }
}

test('a goal closes only when every concept is at its level and review is past the deadline rule', async () => {
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, '2026-12-01'),
      'attn/multi': state(0.8, '2026-12-01'),
    },
  })
  const ready = await goalProgressOf(service, plan())
  assert.equal(ready.ready, true, ready.reasons.join(' / '))
  assert.equal(ready.passed, 2)
  assert.equal(ready.total, 2)
})

test('a concept below its level blocks closure', async () => {
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, '2026-12-01'),
      'attn/multi': state(0.6, '2026-12-01'),
    },
  })
  const progress = await goalProgressOf(service, plan())
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('没到档位')))
})

test('a concept whose next review is too soon also blocks closure', async () => {
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, '2026-03-10'),
      'attn/multi': state(0.9, '2026-12-01'),
    },
  })
  const progress = await goalProgressOf(service, plan())
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('复习到期限之后')))
})

test('a goal with a missing deadline cannot close', async () => {
  await writeKnowledge(paths, {
    version: 1,
    updatedAt: today,
    concepts: {
      'attn/scaled': state(0.9, '2026-12-01'),
      'attn/multi': state(0.9, '2026-12-01'),
    },
  })
  const progress = await goalProgressOf(service, plan({ deadline: undefined }))
  assert.equal(progress.ready, false)
  assert.ok(progress.reasons.some(reason => reason.includes('期限')))
})
