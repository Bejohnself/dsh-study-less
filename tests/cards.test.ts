import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueCards, judgementCardId, overdueDays } from '../src/core/cards.ts'
import { initialCard } from '../src/core/srs.ts'
import type { CardRecord } from '../src/core/types.ts'

function card(patch: Partial<CardRecord> = {}): CardRecord {
  return {
    version: 1,
    id: 'j-p-q',
    kind: 'judgement',
    planId: 'p',
    prompt: '能白板推出 Eq.12 吗？',
    srs: initialCard(3),
    history: [],
    due: '2026-03-02',
    state: 'new',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...patch,
  }
}

test('a judgement card id is stable per goal and question', () => {
  assert.equal(judgementCardId('g-1', 'q-ab12'), 'j-g-1-q-ab12')
  assert.equal(judgementCardId('g-1', 'q-ab12'), judgementCardId('g-1', 'q-ab12'))
})

test('only cards due on or before today enter the queue', () => {
  const cards = [
    card({ id: 'a', due: '2026-03-01' }),
    card({ id: 'b', due: '2026-03-02' }),
    card({ id: 'c', due: '2026-03-09' }),
    card({ id: 'd', due: undefined }),
    card({ id: 'e', due: '2026-03-01', state: 'suspended' }),
  ]
  const due = dueCards(cards, '2026-03-02')
  assert.deepEqual(
    due.map(item => item.id),
    ['a', 'b', 'd'],
  )
})

test('overdue days never go negative', () => {
  assert.equal(overdueDays('2026-03-01', '2026-03-04'), 3)
  assert.equal(overdueDays('2026-03-09', '2026-03-04'), 0)
  assert.equal(overdueDays(undefined, '2026-03-04'), 0)
})
