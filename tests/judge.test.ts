import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVerdict } from '../src/host/generation/normalize.ts'

/** A pass is only trusted above the confidence floor; unknown means partial. */
test('a low-confidence pass is downgraded to partial', () => {
  assert.equal(normalizeVerdict('pass', 0.9), 'pass')
  assert.equal(normalizeVerdict('pass', 0.4), 'partial')
  assert.equal(normalizeVerdict('PASS', undefined), 'pass')
  assert.equal(normalizeVerdict('maybe', 0.99), 'partial')
  assert.equal(normalizeVerdict(undefined, 0.99), 'partial')
  assert.equal(normalizeVerdict('fail', 0.2), 'fail')
})
