/**
 * Visual read-only summaries of one goal: the section route and the mastery map.
 *
 * Both views sit behind a per-section 文字/图形 switch. The text view remains
 * the editing surface; these components only read the same PlanDetailView data
 * and open the corresponding section.
 */
import type { CSSProperties, ReactElement } from 'react'
import type { PlanSectionView, PlanStepView } from '../../core/views.ts'
import type { Coverage } from '../../core/types.ts'
import { InlineMarkdown } from './ui.tsx'

export type PlanViewMode = 'text' | 'visual'

export const ROUTE_VIEW_KEY = 'dsh-study:plan-route-view'
export const MASTERY_VIEW_KEY = 'dsh-study:plan-mastery-view'

/** One lane of the route. */
export interface RouteGroup {
  id: Coverage
  title: string
  hint: string
}

export const ROUTE_GROUPS: readonly RouteGroup[] = [
  { id: 'read', title: '必读', hint: '最小集：分母只算这些' },
  { id: 'skim', title: '略读', hint: '知道结论即可，不要求推导' },
  { id: 'skip', title: '不读', hint: '已知不需要，不进「未完成」' },
]

const LEVEL_LABEL = ['', '了解', '会用', '能讲', '创新']

/** Read the per-section view preference; a blocked storage falls back to text. */
export function readPlanView(key: string): PlanViewMode {
  try {
    return window.localStorage.getItem(key) === 'visual' ? 'visual' : 'text'
  } catch {
    return 'text'
  }
}

/** Persist the per-section view preference. */
export function writePlanView(key: string, value: PlanViewMode): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Persistence is optional; the switch still works for this render.
  }
}

/** A small segmented control used by both sections. */
export function PlanViewSwitch({
  value,
  onChange,
  label,
}: {
  value: PlanViewMode
  onChange: (value: PlanViewMode) => void
  label: string
}): ReactElement {
  return (
    <div className="study-segmented study-view-switch" role="group" aria-label={`${label}视图`}>
      {(['text', 'visual'] as const).map(mode => (
        <button
          key={mode}
          type="button"
          className={value === mode ? 'is-on' : ''}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {mode === 'text' ? '文字' : '图形'}
        </button>
      ))}
    </div>
  )
}

/** The section route as a row of book spines, filled by knowledge mastery. */
export function RouteMap({
  steps,
  onOpenUnit,
  planId,
}: {
  steps: readonly PlanStepView[]
  onOpenUnit: (mid: string, uid: string, planId?: string) => void
  planId: string
}): ReactElement {
  const current = steps.find(step => step.current === true)?.n
  return (
    <div className="study-route-map">
      {ROUTE_GROUPS.map(group => {
        const rows = steps.filter(step => step.coverage === group.id)
        return (
          <div key={group.id} className="study-route-lane">
            <div className="study-boundary-group-head">
              <span className={'study-coverage-pill is-' + group.id}>{group.title}</span>
              <span className="study-muted">{group.hint}</span>
            </div>
            {rows.length === 0 ? (
              <p className="study-muted">没有这一类的范围。</p>
            ) : (
              <div className="study-route-track">
                {rows.map(step => {
                  const span = step.target === undefined ? 1 : Math.max(1, step.target.pageEnd - step.target.pageStart + 1)
                  const width = Math.max(84, Math.min(170, 52 + Math.sqrt(span) * 10))
                  const pct = step.progress === undefined ? 0 : Math.floor(step.progress.mastery * 100)
                  const skip = step.coverage === 'skip'
                  const progress = step.progress === undefined ? '' : ` · ${step.progress.passed}/${step.progress.total} 个知识点达标`
                  return (
                    <button
                      key={step.n}
                      type="button"
                      className={
                        'study-spine is-' +
                        step.coverage +
                        (step.done ? ' is-done' : '') +
                        (step.n === current ? ' is-current' : '')
                      }
                      style={{ width: `${width}px` }}
                      disabled={step.target === undefined}
                      title={`${step.why}${progress}`}
                      aria-label={`${step.target?.title ?? step.why}，${group.title}，掌握 ${pct}%${progress}`}
                      onClick={() => {
                        if (step.target !== undefined) onOpenUnit(step.target.materialId, step.target.unitId, planId)
                      }}
                    >
                      <span className="study-spine-fill" style={{ height: skip ? '0%' : `${pct}%` }} />
                      <span className="study-spine-value">{skip ? '不读' : step.progress === undefined ? '—' : `${pct}%`}</span>
                      <span className="study-spine-title">{step.target?.title ?? step.why}</span>
                      <span className="study-spine-meta">
                        {step.target === undefined ? '' : `p${step.target.pageStart}–${step.target.pageEnd}`}
                        {step.done ? ' · 已到档' : ''}
                      </span>
                      {step.done ? <span className="study-spine-done">✓</span> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      <p className="study-route-legend">墨色越深，掌握越牢；书脊越宽，这一节页数越多。</p>
    </div>
  )
}

/** One seal per required section: ring + bar + target notch. */
export function MasterySeals({ points }: { points: readonly PlanSectionView[] }): ReactElement {
  if (points.length === 0) {
    return <p className="study-muted">还没有知识点目标。切到文字视图逐节补，或重新生成一次路径。</p>
  }
  return (
    <div className="study-seal-grid">
      {points.map(point => {
        const pct = Math.floor(Math.max(0, Math.min(1, point.mastery)) * 100)
        const targetPct = Math.round(Math.max(0, Math.min(1, point.threshold)) * 100)
        const total = point.conceptStates.length
        const atTarget = point.conceptStates.filter(state => state.atTarget).length
        const peakPct = point.peak === undefined ? null : Math.floor(Math.max(0, Math.min(1, point.peak)) * 100)
        return (
          <div
            key={point.target}
            className={'study-seal-card' + (point.atTarget ? ' is-passed' : '') + (total === 0 ? ' is-unlinked' : '')}
            style={{ '--seal': `${pct * 3.6}deg` } as CSSProperties}
            aria-label={`${point.title}，${LEVEL_LABEL[point.level]}，掌握 ${pct}%，目标 ${targetPct}%`}
          >
            <span className="study-seal-head">
              <span className="study-seal-title"><InlineMarkdown source={point.title} /></span>
              <span className="study-seal-level">{LEVEL_LABEL[point.level]}</span>
            </span>
            <span className="study-seal-main">
              <span className="study-seal-ring">
                <span className="study-seal-hole">{pct}%</span>
              </span>
              <span className="study-seal-info">
                <span className="study-seal-bar">
                  <span className="study-seal-fill" style={{ width: `${pct}%` }} />
                  <span className="study-seal-target" style={{ left: `${targetPct}%` }} />
                  {peakPct === null ? null : <span className="study-seal-peak" style={{ left: `${peakPct}%` }} />}
                </span>
                <span className="study-item-meta">
                  {total === 0 ? '未挂知识点' : `目标 ${targetPct}% · ${atTarget}/${total} 概念达标`}
                </span>
                {total === 0 ? null : (
                  <span className="study-seal-dots">
                    {point.conceptStates.map(state => (
                      <span
                        key={state.id}
                        className={'study-seal-dot' + (state.atTarget ? ' is-on' : '')}
                        title={`${state.name} · ${Math.floor(state.mastery * 100)}%`}
                      />
                    ))}
                  </span>
                )}
              </span>
            </span>
            {point.atTarget ? null : <span className="study-seal-standard">还差 {Math.max(0, targetPct - pct)}%</span>}
            {point.atTarget ? <span className="study-seal-stamp">到</span> : null}
          </div>
        )
      })}
    </div>
  )
}
