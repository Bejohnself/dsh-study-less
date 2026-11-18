import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStudyTools } from '../src/host/tools.ts'

/** The 20 tools the desk announces, in registration order. */
const EXPECTED = [
  'study_library',
  'study_import_book',
  'study_structure_set',
  'study_unit_material',
  'study_unit_write',
  'study_unit_verify',
  'study_concept_link',
  'study_today',
  'study_plans',
  'study_plan_create',
  'study_plan_update',
  'study_concept',
  'study_due',
  'study_review',
  'study_generate',
  'study_jobs',
  'study_delete',
  'study_quiz',
  'study_book',
  'study_insight',
]

const extras = {
  generation: {} as never,
  insights: {} as never,
  jobs: {} as never,
  quizSessions: {} as never,
  books: {} as never,
}

test('every tool is registered exactly once', () => {
  const tools = buildStudyTools({} as never, extras)
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...EXPECTED].sort())
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length)
})

test('each tool carries schema and executor', () => {
  const tools = buildStudyTools({} as never, extras)
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.description.length > 0)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
  }
})

test('optional services drop their tools instead of failing', () => {
  const tools = buildStudyTools({} as never)
  const names = tools.map(tool => tool.name)
  assert.equal(names.includes('study_generate'), false)
  assert.equal(names.includes('study_quiz'), false)
  assert.equal(names.includes('study_library'), true)
})
