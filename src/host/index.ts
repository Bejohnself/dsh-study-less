/**
 * Host half of the dsh-study-less bundle.
 *
 * Owns the library (files under `$DSH_HOME/study`), the learning ledger, the
 * browser API and the agent tools. Both halves drive the same StudyService, so
 * a checkbox in the GUI and a tool call from the assistant change one state.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { LibraryPaths, resolveDataRoot } from '../core/paths.ts'
import { PLUGIN_VERSION } from '../core/version.ts'
import { BookService } from './books.ts'
import { GenerationService } from './generation.ts'
import { createOwnerPeer, promptSession, type GatewayFace } from './goal.ts'
import { InsightService } from './insights.ts'
import { JobQueue } from './jobs.ts'
import { QuizSessionService } from './quizSessions.ts'
import { makeStudyRoutes } from './routes.ts'
import { StudyService } from './service.ts'
import { SettingsService } from './settings.ts'
import { UsageService } from './usage.ts'
import { schedulePluginRestart } from './pluginRestart.ts'
import { buildStudyTools, type StudyToolDefinition } from './tools.ts'
import type { DshLlmFace, DshModelSelection } from './providers/dsh.ts'

/** One Host web route. */
interface HostWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  resource?: (request: Request, peer?: unknown) => Promise<Response>
  handler?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The slice of the Host context this plugin needs. */
export interface HostContext {
  /** Present on the real DSH context; used to locate this plugin's loader entry. */
  fiber?: unknown
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
  '本机已安装 dsh-study-less 插件（DSH Web GUI 的「书桌」），分为三块：书架（知识库）、阅读（今日/目标/复习）、笔记（实验，概念与洞察）。侧栏面板行「书桌」。',
  '定位规范见 DESIGN.md，核心是「允许你不读完」：目标（节级路线 + 知识点四档 + 期限）→ 读书做题写知识点 → 到期复习 → 结案。判定题、独立尝试、归因、卡点是旧兼容层。精读稿（现称导读）、自编书、洞察卡属于冻结实验功能，不要默认批量生成。',
  '工具：study_library / study_import_book / study_structure_set / study_unit_material / study_unit_write / study_unit_verify / study_concept_link / study_concept / study_today / study_plans / study_plan_create / study_plan_update / study_due / study_review / study_generate / study_jobs / study_delete / study_quiz。',
  '导入流程：study_import_book(path) → 看返回的单元 → 必要时 study_structure_set 修正 → 逐节 study_unit_material → study_unit_write（精读稿）→ study_unit_verify。',
  '精读稿硬性要求：必须含「本节目标/前置知识/核心概念/逐步讲解/类比/常见误区/自测/出处」八节；正文≥400字；所有页码引用必须落在该单元 pageStart..pageEnd 内；概念用全局 id（如 consensus/raft）并通过 concepts 参数登记。',
  '公式一律 LaTeX：行内 $...$，独立公式 $$...$$（可使用 \\( \\) / \\[ \\]）；禁止用 √、ᵀ、∑、α 等 Unicode 字符或纯文本拼公式；函数名用 \\operatorname{name}，不要用 \\mathrm 包多字母函数名或中文；阅读器用 KaTeX（MathML）渲染。',
  '论文学习：新导入的论文和书一样按目录小节切单元，不再生成 p1/p2/p3 三遍法；阅读时先讲清 5C，再抓方法与假设，最后做可复现性与批判。论文主张要挂页码/图表证据。',
  '页面内生成：用户在学习桌里新建目标/点生成时，Host 会用已配置的文本引擎直接编排路径、写精读、出题（study_generate 返回 jobId，用 study_jobs 查进度），不再默认把 prompt 发进聊天。未配置引擎时才回退到对话。',
  '自编书、洞察、概念浏览页已冻结：路由与工具都不再注册，数据保留但默认不可达。',
  '目标学习：用户说「我想搞懂 X / 读懂这篇」时，先 study_library + study_concept 摸清家底与掌握度，再用 study_plan_create 或 study_generate(action=plan) 排出节级路线（只有 unit/paper-pass），每步写 why，并用 mastery 写知识点图景；不要凭空列不存在的单元。',
  '复习：会话开始时 study_today 或 study_due，逐项「先让我复述→指出偏差→给最小对照例子→study_review(rating)」，不要一次把答案倒完。',
  '未经用户明确同意，不要一次性生成整本书；先做 1 节样例让用户确认风格，再批量。用户提到「书桌 / 今日 / 目标 / 复习到期 / 笔记」即指本插件。',
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
export const PLUGIN_ID = 'dsh-study-less'

/** Plugin version is owned by core/version.ts and injected at build time. */
export { PLUGIN_VERSION }

/** Read an optional Host service without failing activation. */
function face<T>(ctx: HostContext, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}

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

  const settingsService = new SettingsService(paths)
  const usageService = new UsageService(paths, settingsService)
  const insightService = new InsightService(paths)
  const jobQueue = new JobQueue(paths, { concurrency: () => 1 })
  void jobQueue.recover()
  const bookService = new BookService(paths, service)
  const generationService = new GenerationService(paths, {
    service,
    books: bookService,
    insights: insightService,
    settings: settingsService,
    jobs: jobQueue,
    usage: usageService,
    ...(face<DshLlmFace>(ctx, 'llm') === undefined ? {} : { llm: face<DshLlmFace>(ctx, 'llm')! }),
    selection: () => face<{ currentSelection(): DshModelSelection }>(ctx, 'agentDefaultModel')?.currentSelection(),
  })
  const quizSessions = new QuizSessionService(paths, service, bookService, generationService)
  void quizSessions.recover()

  ctx.effect(() => {
    const disposers = makeStudyRoutes(service, {
      settings: settingsService,
      insights: insightService,
      generation: generationService,
      jobs: jobQueue,
      quizSessions,
      books: bookService,
      usage: usageService,
      restartPlugin: () => schedulePluginRestart(ctx, PLUGIN_ID),
    }).map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'study-desk: routes')

  // Publish the freshly built client bundle when the row restarts. Without
  // this, a normal page refresh can keep serving the bundle revision captured
  // at boot, which makes CSS/UI fixes look like they had no effect.
  try {
    face<{ rebuilt(id: string): string | undefined }>(ctx, 'clientModules')?.rebuilt(PLUGIN_ID)
  } catch {
    // A profile without the client module table simply has no browser half.
  }

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
    console.error('[dsh-study-less] prompt section unavailable:', error)
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
      const disposers = buildStudyTools(service, {
        generation: generationService,
        insights: insightService,
        jobs: jobQueue,
        quizSessions,
        books: bookService,
      }).map(tool => registry.register(tool))
      return () => {
        for (const dispose of disposers.splice(0)) dispose()
      }
    })
  } catch (error) {
    console.error('[dsh-study-less] agent tools unavailable:', error)
  }
  if (toolsFeed !== undefined) {
    ctx.effect(() => () => toolsFeed?.dispose(), 'study-desk: agent tools')
  }
}
