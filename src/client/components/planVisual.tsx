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
import { SKY_MAIN_R, brightnessOf, buildMasterySky, glowOf, goldOf, hash01 } from '../masterySky.ts'

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

/** A six-point star marks a concept several sections share, without a frame. */
function multiStarPath(x: number, y: number, r: number): string {
  const points: string[] = []
  for (let index = 0; index < 12; index += 1) {
    const radius = index % 2 === 0 ? r : r * 0.5
    const angle = -Math.PI / 2 + (index * Math.PI) / 6
    points.push(`${(x + Math.cos(angle) * radius).toFixed(2)} ${(y + Math.sin(angle) * radius).toFixed(2)}`)
  }
  return `M${points.join(' L')} Z`
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

/** Ink to gold: the fill of a star that has been learned well. */
function goldFill(mastery: number): string {
  const gold = goldOf(mastery)
  return gold === 0
    ? 'var(--s-primary)'
    : `color-mix(in srgb, var(--s-sky-gold) ${String(gold)}%, var(--s-primary))`
}

/** Rough width of a tooltip line in SVG units at 11px. */
function textWidth(value: string): number {
  let width = 0
  for (const char of value) width += /[\u3000-\u9fff\uff00-\uffef]/u.test(char) ? 11.5 : 6.4
  return width
}

type SkyHover = { kind: 'star'; index: number } | { kind: 'section'; index: number }

/** Hover card drawn inside the SVG, so it scales and positions with the map. */
function SkyTooltip({
  cx,
  cy,
  r,
  lines,
  mapWidth,
}: {
  cx: number
  cy: number
  r: number
  lines: string[]
  mapWidth: number
}): ReactElement {
  const width = Math.min(mapWidth - 8, Math.max(96, ...lines.map(textWidth)) + 20)
  const height = lines.length * 14 + 12
  const above = cy - r - 10 - height
  const top = above < 6 ? cy + r + 10 : above
  const x = Math.min(mapWidth - width / 2 - 4, Math.max(width / 2 + 4, cx))
  return (
    <g className="study-sky-tip" pointerEvents="none">
      <rect x={x - width / 2} y={top} width={width} height={height} rx={5} />
      {lines.map((line, index) => (
        <text
          key={`${String(index)}-${line}`}
          className={index === 0 ? 'study-sky-tip-name' : 'study-sky-tip-meta'}
          x={x}
          y={top + 16 + index * 14}
          textAnchor="middle"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/**
 * The goal's knowledge sky: one map, one constellation per section.
 *
 * Nothing is labelled until hovered: the map stays a sky, and the detail shows
 * up where the pointer is. Brightness still carries mastery and nothing else is
 * coloured; the slow drift is decoration, switched off for reduced motion.
 */
export function MasterySky({ sections }: { sections: readonly PlanSectionView[] }): ReactElement {
  const [hover, setHover] = useState<SkyHover | null>(null)
  const map = useMemo(() => buildMasterySky(sections), [sections])
  if (map.sections.length === 0) {
    return <p className="study-muted">还没有知识点目标。切到文字视图逐节补，或重新生成一次路径。</p>
  }
  const atTargetSections = map.sections.filter(section => section.atTarget).length
  const level = (value: number): string => LEVEL_LABEL[value] ?? '会用'

  let tip: { cx: number; cy: number; r: number; lines: string[] } | null = null
  if (hover?.kind === 'star') {
    const star = map.stars[hover.index]
    if (star !== undefined) {
      const pct = Math.round(Math.max(0, Math.min(1, star.mastery)) * 100)
      const firstSection = star.sections[0]
      const home = firstSection === undefined ? '' : (map.sections[firstSection]?.title ?? '')
      tip = {
        cx: star.x,
        cy: star.y,
        r: star.r,
        lines: [
          star.name,
          `掌握 ${String(pct)}% · 目标 ${String(Math.round(star.threshold * 100))}%`,
          star.sections.length > 1 ? `${home} 等 ${String(star.sections.length)} 节共用` : home,
        ],
      }
    }
  } else if (hover?.kind === 'section') {
    const section = map.sections[hover.index]
    if (section !== undefined) {
      tip = {
        cx: section.x,
        cy: section.y,
        r: SKY_MAIN_R,
        lines: [
          section.title,
          `${level(section.level)} · ${section.conceptCount === 0 ? '未挂知识点' : `${String(section.atTargetCount)}/${String(section.conceptCount)} 到档`}`,
          `掌握 ${String(Math.round(Math.max(0, Math.min(1, section.mastery)) * 100))}%`,
        ],
      }
    }
  }

  return (
    <div className="study-sky">
      <svg
        className="study-sky-map"
        viewBox={`0 0 ${String(map.width)} ${String(map.height)}`}
        role="img"
        aria-label={`知识点星图：${String(atTargetSections)}/${String(map.sections.length)} 节到档，${String(map.stars.length)} 颗星；悬停星星看细节`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <radialGradient id="study-sky-glow">
            <stop offset="0%" className="study-sky-glow-stop" stopOpacity={0.55} />
            <stop offset="100%" className="study-sky-glow-stop" stopOpacity={0} />
          </radialGradient>
          <radialGradient id="study-sky-gold-glow">
            <stop offset="0%" className="study-sky-gold-stop" stopOpacity={0.7} />
            <stop offset="100%" className="study-sky-gold-stop" stopOpacity={0} />
          </radialGradient>
        </defs>
        {map.sections.map((section, index) => (
          <g
            key={section.target}
            className="study-sky-section"
            tabIndex={0}
            role="img"
            aria-label={`${section.title}，${level(section.level)}，${String(section.atTargetCount)}/${String(section.conceptCount)} 到档`}
            onMouseEnter={() => setHover({ kind: 'section', index })}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover({ kind: 'section', index })}
            onBlur={() => setHover(null)}
          >
            <g className="study-sky-breathe" style={{ animationDelay: `${(hash01(`section:${section.target}`) * 6).toFixed(2)}s` }}>
              <circle
                className="study-sky-main-glow"
                cx={section.x}
                cy={section.y}
                r={SKY_MAIN_R * 3.4}
                fill="url(#study-sky-glow)"
                opacity={glowOf(section.mastery)}
              />
            </g>
            {goldOf(section.mastery) === 0 ? null : (
              <circle
                className="study-sky-gold-glow"
                cx={section.x}
                cy={section.y}
                r={SKY_MAIN_R * 3.2}
                fill="url(#study-sky-gold-glow)"
                opacity={(goldOf(section.mastery) / 100) * 0.8}
              />
            )}
            <circle className="study-sky-hit" cx={section.x} cy={section.y} r={SKY_MAIN_R + 8} />
            <path
              className="study-sky-main-shape"
              d={fiveStarPath(section.x, section.y, SKY_MAIN_R)}
              opacity={brightnessOf(section.mastery)}
              style={{ fill: goldFill(section.mastery) }}
            />
          </g>
        ))}
        {map.stars.map((star, index) => (
          <g
            key={star.id}
            className={'study-sky-star' + (hover?.kind === 'star' && hover.index === index ? ' is-hot' : '')}
            style={{
              animationDelay: `${(hash01(`delay:${star.id}`) * 6).toFixed(2)}s`,
              animationDuration: `${(5 + hash01(`speed:${star.id}`) * 4).toFixed(2)}s`,
            }}
            tabIndex={0}
            role="img"
            aria-label={`${star.name}，掌握 ${String(Math.round(Math.max(0, Math.min(1, star.mastery)) * 100))}%`}
            onMouseEnter={() => setHover({ kind: 'star', index })}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover({ kind: 'star', index })}
            onBlur={() => setHover(null)}
          >
            <circle
              className="study-sky-star-glow"
              cx={star.x}
              cy={star.y}
              r={star.r * 3}
              fill="url(#study-sky-glow)"
              opacity={glowOf(star.mastery)}
            />
            {goldOf(star.mastery) === 0 ? null : (
              <circle
                className="study-sky-gold-glow"
                cx={star.x}
                cy={star.y}
                r={star.r * 3.4}
                fill="url(#study-sky-gold-glow)"
                opacity={(goldOf(star.mastery) / 100) * 0.85}
              />
            )}
            <circle className="study-sky-hit" cx={star.x} cy={star.y} r={Math.max(star.r + 8, 11)} />
            <path
              className={'study-sky-star-shape' + (star.sections.length > 1 ? ' is-shared' : '')}
              d={
                star.sections.length > 1
                  ? multiStarPath(star.x, star.y, star.r * 1.15)
                  : sparklePath(star.x, star.y, star.r)
              }
              opacity={brightnessOf(star.mastery)}
            />
          </g>
        ))}
        {tip === null ? null : (
          <SkyTooltip cx={tip.cx} cy={tip.cy} r={tip.r} lines={tip.lines} mapWidth={map.width} />
        )}
      </svg>
      <p className="study-sky-legend">
        越亮越金，掌握越牢；大星取这一节的平均。共用同一个知识点的节挨在一起，六角星就是几节共用的那颗。悬停星星看细节。
      </p>
    </div>
  )
}
