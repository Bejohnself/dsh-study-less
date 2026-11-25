import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LibraryPaths } from '../src/core/paths.ts'
import { addDays, localDate } from '../src/core/time.ts'
import { StudyService } from '../src/host/service.ts'

test('the test clock shifts today, then resets without touching stored dates', () => {
  const service = new StudyService(new LibraryPaths('.tmp/unit-clock'))
  const real = localDate()
  assert.equal(service.today(), real)
  assert.deepEqual(service.clockState(), { offsetDays: 0, today: real })

  const first = service.advanceDay()
  assert.equal(first.offsetDays, 1)
  assert.equal(first.today, addDays(real, 1))
  assert.equal(service.today(), addDays(real, 1))

  service.advanceDay()
  assert.equal(service.today(), addDays(real, 2))

  assert.deepEqual(service.resetClock(), { offsetDays: 0, today: real })
})

test('an injected test clock wins over the manual one', () => {
  const service = new StudyService(new LibraryPaths('.tmp/unit-clock'), { today: () => '2001-01-01' })
  service.advanceDay()
  assert.equal(service.today(), '2001-01-01')
})