/**
 * 过关测试：独立的一页，不再用悬浮抽屉。
 *
 * The page is intentionally thin: the session itself lives on the Host and is
 * owned by QuizRunner. Opening this page resumes the unit's active session;
 * leaving it only pauses the run.
 */
import type { ReactElement } from 'react'
import type { TocRow } from '../../core/views.ts'
import { QuizRunner } from '../components/quiz.tsx'

/** One unit's adaptive practice, full page. */
export function PracticePage({
  mid,
  unit,
  onBack,
  onChanged,
}: {
  mid: string
  unit: TocRow
  onBack: () => void
  onChanged?: () => void
}): ReactElement {
  return (
    <div className="study-practice">
      <div className="study-practice-head">
        <button type="button" className="study-back" onClick={onBack} aria-label="返回原文">
          ←
        </button>
        <div className="study-practice-title">
          <h2>{unit.title}</h2>
          <span className="study-reader-sub">
            过关测试 · p{unit.pageStart}–p{unit.pageEnd} · 一次一题，关了还能接着答
          </span>
        </div>
      </div>
      <div className="study-practice-body">
        <QuizRunner scope={{ kind: 'unit', mid, uid: unit.uid }} onChanged={onChanged} />
      </div>
    </div>
  )
}