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
  planId,
  concept,
  onBack,
  onChanged,
}: {
  mid: string
  unit: TocRow
  /** Set when the reader was opened from a goal: practice its mastery points. */
  planId?: string
  /** Set when the today panel sent the reader to review one due concept. */
  concept?: string
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
            {concept !== undefined ? '到期复习 · 只看这一个知识点' : planId === undefined ? '过关测试' : '过关测试 · 按目标的掌握点出题'} · p{unit.pageStart}–p{unit.pageEnd} ·
            一次一题，关了还能接着答
          </span>
        </div>
      </div>
      <div className="study-practice-body">
        <QuizRunner scope={{ kind: 'unit', mid, uid: unit.uid, ...(concept === undefined ? {} : { concept }) }} onChanged={onChanged} />
      </div>
    </div>
  )
}