import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assessDifficulty,
  difficultyOf,
  nextDifficulty,
  gradeQuizItem,
  isObjectiveItem,
  looksCopiedFromRubric,
  needsWrittenJudge,
  sameQuizScope,
} from '../src/core/quiz.ts'
import type { QuizItem, QuizSessionScope } from '../src/core/types.ts'

const item = (overrides: Partial<QuizItem> = {}): QuizItem => ({
  id: 'q',
  type: 'choice',
  question: 'q',
  concepts: ['a'],
  origin: 'generated',
  choices: ['A', 'B'],
  answerIndex: 0,
  ...overrides,
})

test('a choice is graded locally; everything else needs a judge', () => {
  assert.equal(isObjectiveItem(item()), true)
  assert.deepEqual(gradeQuizItem(item(), 0), { correct: true })
  assert.deepEqual(gradeQuizItem(item(), 1), { correct: false })
  assert.deepEqual(gradeQuizItem(item(), 'A'), { correct: true })
})

test('evidence items are written answers, not page-number checks', () => {
  const evidence = item({
    type: 'evidence',
    question: '原文在哪一页提醒极限并非无条件成立？',
    page: 420,
    rubric: ['指出 p420'],
  })
  assert.equal(isObjectiveItem(evidence), false)
  assert.deepEqual(gradeQuizItem(evidence, '420'), { correct: null, reason: 'manual' })
})

test('a cloze answer is a written answer, but an equal spelling is settled locally', () => {
  const cloze = item({
    type: 'cloze',
    question: '补全求和项',
    answer: '$\\frac{1}{2}\\sum_{k=0}^{N-1} g_k$',
  })
  assert.equal(isObjectiveItem(cloze), false)
  assert.equal(needsWrittenJudge(cloze), true)
  assert.deepEqual(gradeQuizItem(cloze, '$\\dfrac{1}{2} \\sum_{k=0}^{N-1} g_k$'), { correct: true })
  assert.deepEqual(gradeQuizItem(cloze, '$\\sum g_k$'), { correct: false })
})

test('difficulty is judged from the question shape, not the author tag', () => {
  const hard = '设 {c_n} 是首项为 1 的「M-数列」，且 c_2+c_3=6。(1) 判断 a_1…a_10 是否为 (2,9)-可分数列；若是，写出一种分组。(2) 证明：对任意 n，sum 1/(a_k+1)^2 < 2。'
  assert.equal(assessDifficulty({ question: hard, concepts: ['dp/seq'] }), 3, '两问加证明，多难都该是难档')
  assert.equal(assessDifficulty({ question: '(1) 求 a 的值 (2) 画出图像', concepts: ['dp/a'] }), 2)
  assert.equal(assessDifficulty({ question: '为什么要先缩放？', concepts: ['dp/a'] }), 2)
  assert.equal(assessDifficulty({ question: '缩放因子是什么？', concepts: ['dp/a'] }), 1)
  assert.equal(
    assessDifficulty({ question: '把三个点放在一起看', rubric: ['一', '二', '三', '四'], concepts: ['a', 'b', 'c'] }),
    2,
    '要点多算一项信号',
  )
})

test('difficulty follows how far a point is from its threshold', () => {
  const near = [{ mastery: 0.72, threshold: 0.75 }]
  assert.equal(nextDifficulty([{ mastery: 0.5, threshold: 0.75 }], 0.9), 1, '刚起步先出容易题')
  assert.equal(nextDifficulty([{ mastery: 0.63, threshold: 0.75 }], 0.9), 2)
  assert.equal(nextDifficulty(near, 0.1), 3, '快到时偶尔上难档')
  assert.equal(nextDifficulty(near, 0.9), 2, '大部分时候仍是普通题，不靠难题结案')
  assert.equal(nextDifficulty([{ mastery: 0.9, threshold: 0.75 }], 0.1), 3)
  assert.equal(nextDifficulty([]), 2, '没有知识点时保持中性档')
})

test('difficulty defaults to normal', () => {
  assert.equal(difficultyOf(item()), 2)
  assert.equal(difficultyOf(item({ difficulty: 3 })), 3)
})

test('a rebuttal that pastes the rubric is detected', () => {
  const rubric = [
    '先令 $k\\to\\infty$ 并假定 $J_k\\to J^*$。',
    '需要允许极限与 $\\min$、期望交换，或引用值迭代收敛定理；不能无条件交换。',
  ]
  assert.equal(looksCopiedFromRubric(rubric.join(''), rubric), true)
  assert.equal(
    looksCopiedFromRubric('我这次补的是：先取极限，再说明 min 与期望交换需要额外条件，否则不能直接交换。', rubric),
    false,
  )
})

test('sessions only match the same section', () => {
  const unit: QuizSessionScope = { kind: 'unit', material: 'm', unit: 'u' }
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'u' }), true)
  assert.equal(sameQuizScope(unit, { kind: 'unit', material: 'm', unit: 'other' }), false)
})