import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeStructured, completeStructuredJson } from '../src/host/generation/shared.ts'
import { ProviderError, type TextProvider, type TextRequest, type TextResult } from '../src/host/providers/types.ts'

/** A provider that answers each call with the next text. */
function providerWithTexts(texts: string[], seen: TextRequest[]): TextProvider {
  let calls = 0
  return {
    name: 'stub',
    async complete(request: TextRequest): Promise<TextResult> {
      seen.push(request)
      const text = texts[Math.min(calls, texts.length - 1)] ?? '{}'
      calls += 1
      return { text }
    },
  }
}

/** A provider that fails the first call, so the retry path is observable. */
function providerWith(first: Error | null, seen: TextRequest[]): TextProvider {
  let calls = 0
  return {
    name: 'stub',
    async complete(request: TextRequest): Promise<TextResult> {
      seen.push(request)
      calls += 1
      if (calls === 1 && first !== null) throw first
      return { text: '{"ok":true}' }
    },
  }
}

test('a budget-starved structured call retries with a bigger cap', async () => {
  const seen: TextRequest[] = []
  const provider = providerWith(
    new ProviderError('max-tokens', '模型把输出预算用在了思考过程上，没有返回正文'),
    seen,
  )
  const result = await completeStructured(provider, { user: 'q', maxTokens: 2_048 })
  assert.equal(result.text, '{"ok":true}')
  assert.equal(seen.length, 2, 'the call was retried once')
  // Only the budget changes: the reasoning level belongs to the model selection,
  // and naming one a model does not declare is a hard request error.
  assert.equal('reasoningEffort' in seen[0]!, false)
  assert.equal('reasoningEffort' in seen[1]!, false)
  assert.ok((seen[1]!.maxTokens ?? 0) > (seen[0]!.maxTokens ?? 0), 'the retry gets a bigger budget')
})

test('an empty answer is retried the same way; other failures are thrown as-is', async () => {
  const seen: TextRequest[] = []
  const empty = await completeStructured(providerWith(new ProviderError('empty', 'DSH 模型返回了空内容'), seen), {
    user: 'q',
  })
  assert.equal(empty.text, '{"ok":true}')
  assert.equal(seen.length, 2)
  assert.ok((seen[1]!.maxTokens ?? 0) >= 8_192, 'the retry has a floor well above the default')

  const fatal: TextRequest[] = []
  await assert.rejects(
    () => completeStructured(providerWith(new ProviderError('no-model', '没有可用模型'), fatal), { user: 'q' }),
    /没有可用模型/,
  )
  assert.equal(fatal.length, 1, 'a real failure is not retried')
})
test('a silently truncated JSON answer is retried with a bigger budget', async () => {
  const seen: TextRequest[] = []
  // The gateway cut the answer without reporting a cap, so the text is prose
  // that simply stops mid-string: only a second call with more room can fix it.
  const provider = providerWithTexts(['{"items":[{"question":"半截', '{"items":[]}'], seen)
  const result = await completeStructuredJson(provider, { user: 'q', maxTokens: 8_192 }, parsed => parsed)
  assert.equal(seen.length, 2, 'the parse failure was retried once')
  assert.ok((seen[1]!.maxTokens ?? 0) > (seen[0]!.maxTokens ?? 0), 'the retry gets a bigger budget')
  assert.deepEqual(result.value, { items: [] })
  assert.equal(result.attempts, 2)
})

test('a truncated answer that stays truncated is reported, not retried forever', async () => {
  const seen: TextRequest[] = []
  const provider = providerWithTexts(['{"items":[{"q":', '{"items":[{"q":'], seen)
  await assert.rejects(
    () => completeStructuredJson(provider, { user: 'q' }, parsed => parsed),
    /JSON|模型没有返回/,
  )
  assert.equal(seen.length, 2, 'one retry only')
})
