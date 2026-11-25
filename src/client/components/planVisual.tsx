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
import { buildMasteryTree } from '../masteryTree.ts'

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

/** Geometry of the tree canvas, in px: branch column, leaf column, label room. */
const TREE_BRANCH_LEFT = 16
const TREE_BRANCH_WIDTH = 168
const TREE_BRANCH_RIGHT = TREE_BRANCH_LEFT + TREE_BRANCH_WIDTH
const TREE_TRUNK_X = 6
const TREE_LEAF_X = TREE_BRANCH_RIGHT + 48
const TREE_WIDTH = 560

/** Leaf size grows with the threshold: a deeper level asks for a bigger mark. */
function leafSize(threshold: number): number {
  const share = Math.max(0, Math.min(1, (threshold - 0.6) / 0.35))
  return Math.round(8 + share * 6)
}

/**
 * The goal's knowledge tree: one leaf per concept, one branch per section.
 *
 * The view is deliberately rough: it answers "how much is left" at a glance and
 * shows a hub leaf when several sections need the same concept. Rows scroll and
 * each branch folds, because a real goal can hold far more leaves than a card.
 */
export function MasteryTree({ sections }: { sections: readonly PlanSectionView[] }): ReactElement {
  const [collapsed, setCollapsed] = useState<readonly string[]>([])
  const tree = useMemo(() => buildMasteryTree(sections, new Set(collapsed)), [sections, collapsed])

  if (sections.length === 0) {
    return <p className="study-muted">还没有知识点目标。切到文字视图逐节补，或重新生成一次路径。</p>
  }

  const toggle = (target: string): void => {
    setCollapsed(previous => (previous.includes(target) ? previous.filter(value => value !== target) : [...previous, target]))
  }
  const first = tree.branches[0]
  const last = tree.branches[tree.branches.length - 1]

  return (
    <div className="study-tree">
      <div className="study-tree-scroll">
        <div className="study-tree-canvas" style={{ height: `${tree.height}px`, width: `${TREE_WIDTH}px` }}>
          <svg className="study-tree-edges" width={TREE_WIDTH} height={tree.height} aria-hidden="true">
            {first === undefined || last === undefined || first === last ? null : (
              <path className="study-tree-trunk" d={`M${TREE_TRUNK_X} ${first.y} L ${TREE_TRUNK_X} ${last.y}`} />
            )}
            {tree.edges.map(edge => {
              const branch = tree.branches[edge.branch]
              const leaf = tree.leaves[edge.leaf]
              if (branch === undefined || leaf === undefined) return null
              const end = TREE_LEAF_X - leafSize(leaf.threshold) / 2
              return (
                <path
                  key={`${String(edge.branch)}-${String(edge.leaf)}`}
                  className={'study-tree-edge' + (leaf.sections.length > 1 ? ' is-hub' : '')}
                  d={`M${TREE_BRANCH_RIGHT} ${branch.y} C ${TREE_BRANCH_RIGHT + 26} ${branch.y}, ${end - 26} ${leaf.y}, ${end} ${leaf.y}`}
                />
              )
            })}
          </svg>
          {tree.branches.map(branch => (
            <button
              key={branch.target}
              type="button"
              className={
                'study-tree-branch' + (branch.atTarget ? ' is-passed' : '') + (branch.collapsed ? ' is-collapsed' : '')
              }
              style={{ top: `${branch.y - 11}px`, left: `${TREE_BRANCH_LEFT}px`, width: `${TREE_BRANCH_WIDTH}px` }}
              aria-expanded={!branch.collapsed}
              aria-label={`${branch.title}，${LEVEL_LABEL[branch.level]}，${branch.conceptCount === 0 ? '未挂知识点' : `${String(branch.atTargetCount)}/${String(branch.conceptCount)} 个概念到档`}`}
              onClick={() => toggle(branch.target)}
            >
              <span className="study-tree-chevron" aria-hidden="true">
                ▸
              </span>
              <span className="study-tree-branch-title">{branch.title}</span>
              <span className="study-tree-branch-meta">
                {branch.conceptCount === 0 ? '未挂' : `${String(branch.atTargetCount)}/${String(branch.conceptCount)}`}
              </span>
            </button>
          ))}
          {tree.leaves.map(leaf => {
            const size = leafSize(leaf.threshold)
            const pct = Math.round(Math.max(0, Math.min(1, leaf.mastery)) * 100)
            const label = `${leaf.name} · 掌握 ${String(pct)}% / 目标 ${String(Math.round(leaf.threshold * 100))}%${leaf.sections.length > 1 ? ` · ${String(leaf.sections.length)} 节共用` : ''}`
            return (
              <span key={leaf.id}>
                <span
                  className={'study-tree-leaf' + (leaf.atTarget ? ' is-on' : '')}
                  style={{
                    top: `${leaf.y - size / 2}px`,
                    left: `${TREE_LEAF_X - size / 2}px`,
                    width: `${size}px`,
                    height: `${size}px`,
                    background: `color-mix(in srgb, var(--s-primary) ${String(10 + pct * 0.85)}%, var(--s-surface-3))`,
                  }}
                  title={label}
                  role="img"
                  aria-label={label}
                />
                <span
                  className="study-tree-leaf-label"
                  style={{ top: `${leaf.y - 8}px`, left: `${TREE_LEAF_X + 14}px` }}
                  title={label}
                >
                  {leaf.name}
                </span>
              </span>
            )
          })}
        </div>
      </div>
      <p className="study-tree-legend">
        叶越深，掌握越牢；叶越大，这节要的档位越高；一根线连到几节，说明这个概念几节都要用。点枝可折叠。
      </p>
    </div>
  )
}
