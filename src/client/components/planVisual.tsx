/**
 * Visual read-only summaries of one goal: the section route and the mastery map.
 *
 * Both views sit behind a per-section 文字/图形 switch. The text view remains
 * the editing surface; these components only read the same PlanDetailView data
 * and open the corresponding section.
 */
import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PlanSectionView, PlanStepView } from '../../core/views.ts'
import type { Coverage } from '../../core/types.ts'
import { SKY_BOX, SKY_CENTER, SKY_MAIN_R, buildMasterySky } from '../masterySky.ts'

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

/** Glow of a small star: brightness is mastery, nothing else. */
function starGlow(mastery: number): string {
  const size = 1.5 + mastery * 5
  return `0 0 ${size.toFixed(1)}px ${(size / 2).toFixed(1)}px color-mix(in srgb, var(--s-primary) ${String(Math.round(35 + mastery * 55))}%, transparent)`
}

/** Glow of the main star: it faces the section's weakest concept. */
function mainGlow(mastery: number): string {
  return `0 0 ${(8 + mastery * 16).toFixed(0)}px ${(3 + mastery * 5).toFixed(0)}px color-mix(in srgb, var(--s-primary) ${String(Math.round(20 + mastery * 45))}%, transparent)`
}

/**
 * The goal's knowledge sky: one cluster per section, one star per concept.
 *
 * Brightness carries mastery and nothing else is coloured, so a glance answers
 * "how much is still dim". Shared concepts keep a dashed ring, because the same
 * star rises in every section that needs it.
 */
export function MasterySky({ sections }: { sections: readonly PlanSectionView[] }): ReactElement {
  const clusters = useMemo(() => buildMasterySky(sections), [sections])
  if (clusters.length === 0) {
    return <p className="study-muted">还没有知识点目标。切到文字视图逐节补，或重新生成一次路径。</p>
  }
  return (
    <div className="study-sky">
      <div className="study-sky-grid">
        {clusters.map(cluster => (
          <div key={cluster.target} className={'study-sky-cluster' + (cluster.atTarget ? ' is-passed' : '')}>
            <div className="study-sky-head">
              <span className="study-sky-title" title={`${cluster.title} · ${LEVEL_LABEL[cluster.level]}`}>
                {cluster.title}
              </span>
              <span className="study-sky-meta">
                {cluster.conceptCount === 0 ? '未挂' : `${String(cluster.atTargetCount)}/${String(cluster.conceptCount)}`}
              </span>
            </div>
            <div
              className="study-sky-field"
              style={{ width: `${SKY_BOX}px`, height: `${SKY_BOX}px` }}
              role="img"
              aria-label={`${cluster.title}，${LEVEL_LABEL[cluster.level]}，${cluster.conceptCount === 0 ? '未挂知识点' : `${String(cluster.atTargetCount)}/${String(cluster.conceptCount)} 个概念到档`}`}
            >
              <span
                className="study-sky-main"
                style={{
                  left: `${SKY_CENTER - SKY_MAIN_R}px`,
                  top: `${SKY_CENTER - SKY_MAIN_R}px`,
                  width: `${SKY_MAIN_R * 2}px`,
                  height: `${SKY_MAIN_R * 2}px`,
                  opacity: `${0.3 + cluster.mastery * 0.7}`,
                  boxShadow: mainGlow(cluster.mastery),
                }}
              />
              {cluster.stars.length === 0 ? <span className="study-sky-empty">未挂知识点</span> : null}
              {cluster.stars.map(star => {
                const pct = Math.round(Math.max(0, Math.min(1, star.mastery)) * 100)
                const label = `${star.name} · 掌握 ${String(pct)}% / 目标 ${String(Math.round(star.threshold * 100))}%${star.sections.length > 1 ? ` · ${String(star.sections.length)} 节共用` : ''}`
                return (
                  <span
                    key={star.id}
                    className={
                      'study-sky-star' +
                      (star.sections.length > 1 ? ' is-shared' : '') +
                      (star.atTarget ? ' is-on' : '')
                    }
                    style={{
                      left: `${star.x - star.r}px`,
                      top: `${star.y - star.r}px`,
                      width: `${star.r * 2}px`,
                      height: `${star.r * 2}px`,
                      opacity: `${0.35 + star.mastery * 0.65}`,
                      boxShadow: starGlow(star.mastery),
                    }}
                    title={label}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="study-sky-legend">
        越亮，掌握越牢；大星跟着这一节最暗的那颗星。带虚线圈的小星，是几节共用的知识点。
      </p>
    </div>
  )
}
