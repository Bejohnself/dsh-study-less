/**
 * Prompt builders for the chat fallback.
 *
 * When no text engine is configured, creating a goal sends this instruction
 * into the conversation the user is watching. It is a pure string builder so it
 * can be reviewed (and tested) apart from the service that delivers it.
 */
import { isLeafUnit } from '../../core/library.ts'
import type { MaterialManifest, PlanRecord } from '../../core/types.ts'

/** The instruction queued into the conversation for one goal. */
export function goalPrompt(plan: PlanRecord, manifests: readonly MaterialManifest[], depth: 'deep' | 'overview'): string {
  const catalogue = manifests
    .map(manifest => {
      const leaves = manifest.structure.filter(node => isLeafUnit(manifest.structure, node.uid))
      const rows = leaves.slice(0, 60).map(node => `    - ${node.uid}｜${node.title}（p${node.pageStart}${node.pageEnd > node.pageStart ? `–${node.pageEnd}` : ''}）`)
      const more = leaves.length > 60 ? `    …共 ${leaves.length} 个末级节` : ''
      return `- ${manifest.id}｜《${manifest.title}》｜${manifest.type}｜${manifest.units.length} 单元\n${rows.join('\n')}${more}`
    })
    .join('\n')
  const hours = plan.budget?.hoursPerWeek === undefined ? '未指定' : `每周约 ${plan.budget.hoursPerWeek} 小时`
  const mode = depth === 'deep' ? '精读（逐节重写）' : '速览（只做总览、论文关键节与对比）'
  return [
    '用户在知止里新建了一个学习目标，请在本次会话中完成「编排 + 重写」。',
    '',
    `目标：${plan.goal}`,
    ...(plan.brief === undefined ? [] : [`补充说明：${plan.brief}`]),
    `深度：${mode}`,
    `时间预算：${hours}`,
    `计划 id：${plan.id}`,
    '',
    '只用这些选定资料：',
    catalogue,
    '',
    '请按顺序执行：',
    `1. 用 study_library 确认资料与单元；然后用 study_plan_update 把计划 ${plan.id} 的步骤（只允许 unit / paper-pass，只用最末一级的节——父节只是目录索引；每步 why 必须呼应目标，只选真正相关的单元）和 mastery（3–8 个掌握点：title、可判定的 standard、target=<material>:<unit>）一起写出来。Host 会在步骤写入后把它转为 active。`,
    '2. 从最核心的单元开始：study_unit_material → 按目标重写精读稿（保留固定八节，其中「逐步讲解」优先展开与目标相关的部分，并在「常见误区」后加一段「与目标的关系」）→ study_unit_write → study_unit_verify。',
    '3. 先做 1 节样例，让我确认风格，再继续其余单元；不要一次生成整本书。',
    '4. 全部完成后用三句话总结这条路径与下一步。',
  ].join('\n')
}