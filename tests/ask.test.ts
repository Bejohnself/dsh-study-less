import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ask } from '../src/host/generation/chat.ts'
import type { GenerationService } from '../src/host/generation.ts'
import type { StudySettings } from '../src/core/types.ts'
import type { TextProvider } from '../src/host/providers/types.ts'

function fakeService(
  capture: { system: string; user: string; maxTokens?: number }[],
  reply: { text: string; truncated?: boolean } = { text: '答案' },
): GenerationService {
  const provider: TextProvider = {
    name: 'fake',
    complete: async input => {
      capture.push({ system: input.system ?? '', user: input.user, maxTokens: input.maxTokens })
      return { text: reply.text, usage: {}, ...(reply.truncated === true ? { truncated: true } : {}) }
    },
  }
  return {
    requireSettings: async () => ({}) as StudySettings,
    deps: {
      service: {
        unitMaterial: async () => ({
          material: { title: '测试资料' },
          node: { title: '测试一节' },
          text: '这一节的原文。',
        }),
      },
      textProvider: () => provider,
      usage: { record: async () => ({}) },
    },
  } as unknown as GenerationService
}

test('a long selected passage is context, not part of the question length cap', async () => {
  const capture: { system: string; user: string }[] = []
  const quote = '选中的原文。'.repeat(400)
  const result = await ask(fakeService(capture), {
    material: 'm',
    unit: 'u',
    question: '这里为什么这样？',
    quote,
  })

  assert.equal(result.answer, '答案')
  assert.equal(capture.length, 1)
  assert.match(capture[0]!.user, /## 读者选中的原文/)
  assert.match(capture[0]!.user, /选中的原文。/)
  assert.ok(capture[0]!.user.endsWith('## 读者的问题\n这里为什么这样？'))
})

test('the typed question keeps its 400-character cap', async () => {
  const capture: { system: string; user: string }[] = []
  await assert.rejects(
    ask(fakeService(capture), { material: 'm', unit: 'u', question: '问'.repeat(401) }),
    /问题太长/,
  )
  assert.equal(capture.length, 0)
})

test('the answer budget grows with the selected passage, so a translation is not cut off', async () => {
  const capture: { system: string; user: string; maxTokens?: number }[] = []
  await ask(fakeService(capture), {
    material: 'm',
    unit: 'u',
    question: '把这段翻成中文',
    quote: '选'.repeat(400),
  })
  const short = capture[0]!.maxTokens ?? 0
  assert.ok(short >= 800, `a plain answer should keep some room, got ${short}`)

  capture.length = 0
  await ask(fakeService(capture), {
    material: 'm',
    unit: 'u',
    question: '把这段翻成中文',
    quote: '选'.repeat(1_600),
  })
  const long = capture[0]!.maxTokens ?? 0
  assert.ok(long > short, 'a longer passage gets a longer budget')
  assert.ok(long <= 8_192, 'the budget stays inside the settings ceiling')
})

test('the ask prompt allows a full translation instead of capping every answer at 120 characters', async () => {
  const capture: { system: string; user: string; maxTokens?: number }[] = []
  await ask(fakeService(capture), { material: 'm', unit: 'u', question: '翻译这一段', quote: '原文。' })
  const system = capture[0]!.system
  assert.ok(!system.includes('不超过 120 字'), 'the old hard cap is gone')
  assert.match(system, /翻译/)
  assert.match(system, /不要写到一半停住/)
})

test('a partial answer keeps its text and says it was cut off', async () => {
  const capture: { system: string; user: string; maxTokens?: number }[] = []
  const result = await ask(fakeService(capture, { text: '翻到一半', truncated: true }), {
    material: 'm',
    unit: 'u',
    question: '翻译这段',
    quote: '原文。',
  })
  assert.equal(result.answer, '翻到一半')
  assert.equal(result.truncated, true)
})

test('a quick action runs as an instruction, not a question', async () => {
  const capture: { system: string; user: string; maxTokens?: number }[] = []
  const result = await ask(fakeService(capture), {
    material: 'm',
    unit: 'u',
    action: '把这段翻成中文，保留术语',
    quote: '原文。',
  })
  assert.equal(result.answer, '答案')
  assert.equal(capture.length, 1)
  assert.match(capture[0]!.system, /按读者的要求/)
  assert.match(capture[0]!.user, /## 读者的要求\n把这段翻成中文，保留术语$/)
  assert.equal(capture[0]!.user.includes('## 读者的问题'), false)
})

test('an empty question with no action is refused', async () => {
  await assert.rejects(
    ask(fakeService([]), { material: 'm', unit: 'u', question: '   ' }),
    /问题或动作不能为空/,
  )
})
