/**
 * Host half of the dsh-study bundle.
 *
 * Owns the library (files under `$DSH_HOME/study`), the learning ledger, the
 * browser API and the agent tools. Both halves drive the same StudyService, so
 * a checkbox in the GUI and a tool call from the assistant change one state.
 */
import { LibraryPaths, resolveDataRoot } from '../core/paths.ts'
import { createOwnerPeer, promptSession, type GatewayFace } from './goal.ts'
import { makeStudyRoutes } from './routes.ts'
import { StudyService } from './service.ts'
import { buildStudyTools, type StudyToolDefinition } from './tools.ts'

/** One Host web route. */
interface HostWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  resource?: (request: Request, peer?: unknown) => Promise<Response>
  handler?: (req: unknown, res: unknown) => void | Promise<void>
}

/** The slice of the Host context this plugin needs. */
export interface HostContext {
  webServer: { register(route: HostWebRoute): () => void }
  effect(fn: () => (() => void) | void, label?: string): void
  inject(
    names: readonly string[],
    callback: (scoped: { get(name: string): unknown }) => (() => void) | void,
  ): { dispose(): void }
  get(name: string): unknown
}

/** Order of the study guidance section within the shared prompt band. */
const SECTION_ORDER = 200

/** Model-facing announcement of the study desk. */
export const STUDY_GUIDANCE = [
  '本机已安装 dsh-study 插件（DSH Web GUI 的「书桌」）：侧栏面板行「书桌」，提供多资料库、论文三遍法、目标学习路径与间隔复习。',
  '工具：study_library / study_import_book / study_structure_set / study_unit_material / study_unit_write / study_unit_verify / study_concept_link / study_concept / study_today / study_plans / study_plan_create / study_plan_update / study_due / study_review。',
  '导入流程：study_import_book(path) → 看返回的单元 → 必要时 study_structure_set 修正 → 逐节 study_unit_material → study_unit_write（精读稿）→ study_unit_verify。',
  '精读稿硬性要求：必须含「本节目标/前置知识/核心概念/逐步讲解/类比/常见误区/自测/出处」八节；正文≥400字；所有页码引用必须落在该单元 pageStart..pageEnd 内；概念用全局 id（如 consensus/raft）并通过 concepts 参数登记。',
  '公式一律 LaTeX：行内 $...$，独立公式 $$...$$（可使用 \\( \\) / \\[ \\]）；禁止用 √、ᵀ、∑、α 等 Unicode 字符或纯文本拼公式，阅读器用 KaTeX（MathML）渲染。',
  '论文学习：p1/p2/p3 是三遍法单元；先讲清 5C，再抓方法与假设，最后做可复现性与批判。论文主张要挂页码/图表证据。',
  '目标学习：用户说「我想搞懂 X / 读懂这篇」时，先 study_library + study_concept 摸清家底与掌握度，再用 study_plan_create 排出跨资料步骤（unit/paper-pass/drill/compare），每步写 why；不要凭空列不存在的单元。',
  '复习：会话开始时 study_today 或 study_due，逐项「先让我复述→指出偏差→给最小对照例子→study_review(rating)」，不要一次把答案倒完。',
  '未经用户明确同意，不要一次性生成整本书；先做 1 节样例让用户确认风格，再批量。用户提到「书桌 / 今日 / 学习路径 / 复习到期」即指本插件。',
].join('\n')

/** Tool registry face (`ctx.tools`). */
interface ToolRegistry {
  register(definition: StudyToolDefinition): () => void
}

/** Profile entry config. */
export interface Config {
  /** Data root override; defaults to `$DSH_HOME/study`. */
  dataRoot?: string
}

/** Required Host services: a deployment without a web server serves no panel. */
export const inject = ['webServer']

/** Plugin identity reported by the health endpoint. */
export const PLUGIN_ID = 'dsh-study'

/** Plugin version reported by the health endpoint. */
export const PLUGIN_VERSION = '0.1.0'

/**
 * Plugin activation.
 * @param ctx - Host context with the web server.
 * @param config - the profile entry config.
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  const paths = new LibraryPaths(resolveDataRoot(config.dataRoot))
  const peer = createOwnerPeer(ctx)
  ctx.effect(() => () => { void peer.dispose() }, 'study-desk: owner peer')

  const service = new StudyService(paths, {
    promptSession: async (sessionId, text) => {
      const gateway = (() => {
        try {
          return ctx.get('typertGateway') as GatewayFace | undefined
        } catch {
          return undefined
        }
      })()
      if (gateway === undefined) throw new Error('Host 没有可用的会话网关')
      await promptSession(gateway, peer, sessionId, text)
    },
  })

  ctx.effect(() => {
    const disposers = makeStudyRoutes(service).map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'study-desk: routes')

  // Guidance is optional too: a profile without a system-prompt service is fine.
  let promptFeed: { dispose(): void } | undefined
  try {
    promptFeed = ctx.inject(['systemPrompt'], scoped => {
      const prompt = scoped.get('systemPrompt') as
        | { section(options: { name: string; order: number; text: string }): () => void }
        | undefined
      if (prompt === undefined) return
      const dispose = prompt.section({ name: 'plugin:study', order: SECTION_ORDER, text: STUDY_GUIDANCE })
      return () => dispose()
    })
  } catch (error) {
    console.error('[dsh-study] prompt section unavailable:', error)
  }
  if (promptFeed !== undefined) {
    ctx.effect(() => () => promptFeed?.dispose(), 'study-desk: prompt section')
  }

  // Tools are optional: a profile without a tool registry still serves the panel.
  let toolsFeed: { dispose(): void } | undefined
  try {
    toolsFeed = ctx.inject(['tools'], scoped => {
      const registry = scoped.get('tools') as ToolRegistry | undefined
      if (registry === undefined) return
      const disposers = buildStudyTools(service).map(tool => registry.register(tool))
      return () => {
        for (const dispose of disposers.splice(0)) dispose()
      }
    })
  } catch (error) {
    console.error('[dsh-study] agent tools unavailable:', error)
  }
  if (toolsFeed !== undefined) {
    ctx.effect(() => () => toolsFeed?.dispose(), 'study-desk: agent tools')
  }
}
