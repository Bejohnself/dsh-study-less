import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialCard, intervalDays, ratingFromScore, retrievability, reviewCard } from '../src/core/srs.ts'

test('initial stability rises with the first rating', () => {
  assert.ok(initialCard(1).S < initialCard(3).S)
  assert.ok(initialCard(3).S < initialCard(4).S)
})

test('review grows stability on success and shrinks it on failure', () => {
  const card = initialCard(3)
  const good = reviewCard(card, 3)
  const again = reviewCard(card, 1)
  assert.ok(good.S > card.S)
  assert.ok(again.S < card.S)
  assert.equal(again.lapses, card.lapses + 1)
})

test('interval is deterministic and lands near the target retention', () => {
  const first = intervalDays(10, { fuzzKey: 'unit-a' })
  const second = intervalDays(10, { fuzzKey: 'unit-a' })
  assert.equal(first, second)
  const retention = retrievability(10, first)
  assert.ok(Math.abs(retention - 0.9) < 0.04)
})

test('quiz score maps to a rating', () => {
  assert.equal(ratingFromScore(1), 4)
  assert.equal(ratingFromScore(0.8), 3)
  assert.equal(ratingFromScore(0.6), 2)
  assert.equal(ratingFromScore(0.1), 1)
})
