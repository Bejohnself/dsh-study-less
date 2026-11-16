/**
 * Small display helpers shared by the pages.
 */
import type { MaterialCard, TocRow } from '../core/views.ts'

/** Human label of a material type. */
export function typeLabel(type: MaterialCard['type']): string {
  return type === 'paper' ? '论文' : type === 'article' ? '文章' : '书'
}

/** Whether a unit is learned or in review. */
export function isDone(row: TocRow): boolean {
  return row.state === 'learned' || row.state === 'reviewing'
}

/** Display label of a concept occurrence role. */
export const ROLE_LABEL: Record<string, string> = {
  definition: '定义',
  method: '方法',
  evidence: '证据',
  critique: '批评',
  use: '应用',
}

/** Display label of a plan step kind. */
export function stepKindLabel(kind: string): string {
  return kind === 'unit' ? '导读' : kind === 'paper-pass' ? '论文' : kind === 'drill' ? '练习' : '对比'
}

/** Display label of an insight kind. */
export function insightKindLabel(kind: string): string {
  return kind === 'formula'
    ? '公式'
    : kind === 'contrast'
      ? '对比'
      : kind === 'pitfall'
        ? '误区'
        : kind === 'analogy'
          ? '类比'
          : kind === 'method'
            ? '方法'
            : '原理'
}

/** Display label of a boundary decision. */
export function coverageLabel(coverage: string): string {
  return coverage === 'skim' ? '略读' : coverage === 'skip' ? '不读' : '必读'
}

/** Display label of one minimal attempt move. */
export function moveLabel(move: string): string {
  return move === 'assumption'
    ? '换一条假设'
    : move === 'constraint'
      ? '加一条约束'
      : move === 'counterexample'
        ? '找一个反例'
        : move === 'ablation'
          ? '做一次消融'
          : '迁移到相邻场景'
}

/** Display label of how a conclusion was reached. */
export function provenanceLabel(provenance: string): string {
  return provenance === 'independent' ? '我独立想到的' : provenance === 'judged' ? '我判断后改的' : 'AI 给的，未验证'
}

/** Display label of a job status. */
export function jobStatusLabel(status: string): string {
  return status === 'queued'
    ? '排队中'
    : status === 'running'
      ? '生成中'
      : status === 'done'
        ? '完成'
        : status === 'failed'
          ? '失败'
          : '已取消'
}

/** Display label of what one guiding card asks the reader to do. */
export const PROMPT_KIND_LABEL: Record<string, string> = {
  predict: '预测',
  contrast: '对比',
  recall: '回忆',
  transfer: '迁移',
}

/** Label one guiding card's move. */
export function promptKindLabel(kind: string): string {
  return PROMPT_KIND_LABEL[kind] ?? '提问'
}
