import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryPaths } from '../src/core/paths.ts'
import { readPlan, writePlan } from '../src/core/plans.ts'
import { writeJsonAtomic } from '../src/core/store.ts'
import { deletePlan } from '../src/host/service/plans.ts'
import type { StudyService } from '../src/host/service.ts'
import type { PlanRecord } from '../src/core/types.ts'

const root = await mkdtemp(join(tmpdir(), 'study-plan-delete-'))
after(async () => {
  await rm(root, { recursive: true, force: true })
})

const paths = new LibraryPaths(root)
const today = '2026-03-01'
const service = { paths, today: () => today } as unknown as StudyService

const plan: PlanRecord = {
  id: 'p1',
  goal: '两周内讲清注意力',
  status: 'active',
  deliverable: '讲 20 分钟',
  deadline: '2026-04-01',
  steps: [],
  bookId: 'b1',
  createdAt: today,
  updatedAt: today,
}

const session = (id: string, scope: unknown): Record<string, unknown> => ({
  version: 2,
  id,
  scope,
  status: 'active',
  limit: 1,
  asked: [],
  history: [],
  startedAt: today,
  updatedAt: today,
})

const exists = async (file: string): Promise<boolean> =>
  readFile(file).then(
    () => true,
    () => false,
  )

test('deleting a goal takes its practice sessions and its book', async () => {
  await writePlan(paths, plan)
  // A goal round owns its questions; a unit round belongs to the material.
  await writeJsonAtomic(
    paths.quizSessionFile('s-plan'),
    session('s-plan', { kind: 'plan', plan: 'p1', material: 'm1', unit: 'u1' }),
  )
  await writeJsonAtomic(paths.quizSessionFile('s-unit'), session('s-unit', { kind: 'unit', material: 'm1', unit: 'u1' }))
  await writeJsonAtomic(paths.bookFile('b1'), { id: 'b1', planId: 'p1' })
  await writeJsonAtomic(join(paths.bookDir('b1'), 'chapters', 'ch-1.md'), { text: 'x' })

  const result = await deletePlan(service, 'p1')

  assert.deepEqual(result, { deleted: true, sessions: 1, books: 1 })
  assert.equal(await readPlan(paths, 'p1'), null, 'the goal file is gone')
  assert.equal(await exists(paths.quizSessionFile('s-plan')), false, 'its practice session is gone')
  assert.equal(await exists(paths.quizSessionFile('s-unit')), true, 'a material practice session is untouched')
  assert.equal(await exists(join(paths.bookDir('b1'), 'book.json')), false, 'the book it generated is gone')
})

test('deleting a goal that produced nothing is still a clean delete', async () => {
  await writePlan(paths, { ...plan, id: 'p3', bookId: undefined })
  const result = await deletePlan(service, 'p3')
  assert.deepEqual(result, { deleted: true, sessions: 0, books: 0 })
  assert.equal(await readPlan(paths, 'p3'), null)
})

test('deleting a goal that does not exist is refused', async () => {
  await assert.rejects(() => deletePlan(service, 'missing'), /计划不存在/)
})