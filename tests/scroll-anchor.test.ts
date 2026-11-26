import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorAt, anchorDelta, readingLine } from '../src/client/components/reader/scrollAnchor.ts'

/** 阅读线：短窗口按比例，长窗口封顶。 */
test('the reading line follows the viewport but stops at 280px', () => {
  assert.equal(readingLine(500), 160)
  assert.equal(readingLine(1000), 280)
  assert.equal(readingLine(2000), 280)
})

/** 线落在两页之间时算下一页：线没有越过的那一页已经读过去了。 */
test('the anchor is the page the reading line crosses', () => {
  const boxes = [
    { page: 6, top: 100, height: 800 },
    { page: 7, top: 910, height: 800 },
  ]
  assert.deepEqual(anchorAt(boxes, 280), { page: 6, fraction: 0.225 })
  assert.deepEqual(anchorAt(boxes, 950), { page: 7, fraction: 0.05 })
})

/** 线在全部页框之下（本节还没铺满屏幕）时停在最后一页，比例不越界。 */
test('a line below every page falls back to the last one', () => {
  const boxes = [{ page: 3, top: 0, height: 200 }]
  assert.deepEqual(anchorAt(boxes, 280), { page: 3, fraction: 1 })
  assert.equal(anchorAt([], 280), null)
})

/** 换了容器后同一个锚点要落回同一条线上，页框高度变了也一样。 */
test('the delta puts the anchor back on the line after the page box changes size', () => {
  const line = 280
  const anchor = { page: 7, fraction: 0.25 }
  // 换容器前：页框 top=400、heigh=800 → 加 320 后线正好压在 1/4 处。
  assert.equal(anchorDelta(anchor, { page: 7, top: 400, height: 800 }, line), 320)
  // 换容器后页框变矮：恢复位置按比例走，不按旧像素（30px 处是页内 1/4）。
  assert.equal(anchorDelta(anchor, { page: 7, top: 0, height: 1000 }, line), -30)
})