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
import { SKY_MAIN_R, buildMasterySky } from '../masterySky.ts'

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

/** A four-point sparkle: the shape reads as a star at 4px wide. */
function sparklePath(x: number, y: number, r: number): string {
  const waist = r * 0.2
  return `M${x} ${y - r} L${x + waist} ${y - waist} L${x + r} ${y} L${x + waist} ${y + waist} L${x} ${y + r} L${x - waist} ${y + waist} L${x - r} ${y} L${x - waist} ${y - waist} Z`
}

/** The section's own star: a five-point star, so it never reads as a dot. */
function fiveStarPath(x: number, y: number, r: number): string {
  const points: string[] = []
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? r : r * 0.45
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    points.push(`${(x + Math.cos(angle) * radius).toFixed(2)} ${(y + Math.sin(angle) * radius).toFixed(2)}`)
  }
  return `M${points.join(' L')} Z`
}

/** SVG text has no ellipsis; keep long section titles from running into the next cluster. */
function clipTitle(title: string): string {
  return title.length > 11 ? `${title.slice(0, 11)}…` : title
}

/**
 * The goal's knowledge sky: one map, one constellation per section.
 *
 * Brightness carries mastery and nothing else is coloured, so a glance answers
 * "how much is still dim". Copied stars keep a dashed ring, and a dashed line
 * joins the copies of a shared concept.
 */
export function MasterySky({ sections }: { sections: readonly PlanSectionView[] }): ReactElement {
  const map = useMemo(() => buildMasterySky(sections), [sections])
  if (map.sections.length === 0) {
    return <p className="study-muted">还没有知识点目标。切到文字视图逐节补，或重新生成一次路径。</p>
  }
  const atTargetSections = map.sections.filter(section => section.atTarget).length
  return (
    <div className="study-sky">
      <svg
        className="study-sky-map"
        viewBox={`0 0 ${String(map.width)} ${String(map.height)}`}
        role="img"
        aria-label={`知识点星图：${String(atTargetSections)}/${String(map.sections.length)} 节到档，${String(map.stars.length)} 颗星`}
      >
        <defs>
          <radialGradient id="study-sky-glow">
            <stop offset="0%" className="study-sky-glow-stop" stopOpacity={0.55} />
            <stop offset="100%" className="study-sky-glow-stop" stopOpacity={0} />
          </radialGradient>
        </defs>
        {map.sections.map(section => (
          <g key={section.target}>
            <circle
              className="study-sky-nebula"
              cx={section.x}
              cy={section.y}
              r={SKY_MAIN_R * 9}
              fill="url(#study-sky-glow)"
              opacity={0.35}
            />
            {/* 名字放在星团轨道外：环上到处是星，放中心附近一定会压到星。 */}
            <text className="study-sky-title-text" x={section.x} y={section.y - 100} textAnchor="middle">
              {clipTitle(section.title)}
            </text>
            <text className="study-sky-count-text" x={section.x} y={section.y - 86} textAnchor="middle">
              {section.conceptCount === 0 ? '未挂' : `${String(section.atTargetCount)}/${String(section.conceptCount)}`}
            </text>
            <circle
              className="study-sky-main-glow"
              cx={section.x}
              cy={section.y}
              r={SKY_MAIN_R * 3.4}
              fill="url(#study-sky-glow)"
              opacity={0.25 + section.mastery * 0.5}
            />
            <path
              className="study-sky-main-shape"
              d={fiveStarPath(section.x, section.y, SKY_MAIN_R)}
              opacity={0.35 + section.mastery * 0.65}
            />
            {section.atTarget ? (
              <circle className="study-sky-target-ring" cx={section.x} cy={section.y} r={SKY_MAIN_R + 4} />
            ) : null}
          </g>
        ))}
        {map.stars.map(star => {
          const pct = Math.round(Math.max(0, Math.min(1, star.mastery)) * 100)
          const label = `${star.name} · 掌握 ${String(pct)}% / 目标 ${String(Math.round(star.threshold * 100))}%${star.sections.length > 1 ? ` · ${String(star.sections.length)} 节共用` : ''}`
          return (
            <g key={star.id}>
              <circle
                className="study-sky-star-glow"
                cx={star.x}
                cy={star.y}
                r={star.r * 3}
                fill="url(#study-sky-glow)"
                opacity={0.12 + star.mastery * 0.5}
              />
              <path className="study-sky-star-shape" d={sparklePath(star.x, star.y, star.r)} opacity={0.35 + star.mastery * 0.65}>
                <title>{label}</title>
              </path>
              {star.sections.length > 1 ? (
                <circle className="study-sky-shared-ring" cx={star.x} cy={star.y} r={star.r + 3.5} />
              ) : null}
              {star.atTarget ? <circle className="study-sky-target-ring" cx={star.x} cy={star.y} r={star.r + 2} /> : null}
            </g>
          )
        })}
      </svg>
      <p className="study-sky-legend">
        越亮，掌握越牢；大星跟着这一节最暗的那颗星。要共用同一个知识点的节，排在彼此旁边，那颗星只画一次。
      </p>
    </div>
  )
}
