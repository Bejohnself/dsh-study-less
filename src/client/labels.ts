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
  return kind === 'unit' ? '精读' : kind === 'paper-pass' ? '论文' : kind === 'drill' ? '练习' : '对比'
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
