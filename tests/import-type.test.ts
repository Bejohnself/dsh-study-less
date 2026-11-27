import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferType } from '../src/host/import.ts'

test('a long paper is still classified as a paper', () => {
  assert.equal(inferType(['Abstract', '1 Introduction', '2 Method'], ''), 'paper')
})

test('a paper can be recognised by its first page even without a usable outline', () => {
  assert.equal(inferType([], 'arXiv: 2601.00001\nAbstract\nThis paper studies...'), 'paper')
  assert.equal(inferType([], 'https://doi.org/10.1000/example'), 'paper')
})

test('a book without paper markers stays a book', () => {
  assert.equal(inferType(['第一章 绪论', '第二章 方法'], '第一章 绪论\n这是一本教材。'), 'book')
})

test('a numbered book section called Introduction stays a book', () => {
  // Vol. 1 of Bellman's DP book has "1.1.Introduction" and "7.Introduction to
  // Infinite Horizon Problems"; only a paper opens with a top-level Abstract
  // or a single "1 Introduction".
  const outline = [
    '1.The Dynamic Programming Algorithm',
    '1.1.Introduction',
    '7.Introduction to Infinite Horizon Problems',
  ]
  assert.equal(inferType(outline, 'Dynamic Programming and Optimal Control Volume 1'), 'book')
})
