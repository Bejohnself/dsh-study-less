# 改动导航（AGENTS.md 的细则页）

> 先读 [AGENTS.md](../AGENTS.md) 的目录地图，再按这张表落到文件；不要用全仓 grep 代替这里。

## 改动导航（先看这张表，再打开文件）

| 我要改…… | 先读 | 通常还要改 | 验证 |
|---|---|---|---|
| 书架列表 / 封面 / 归档 | `client/pages/library.tsx`、`components/cover.tsx` | `core/views.ts`、`service.library/materialState` | `npm run build` + `check-client` |
| 阅读器 / PDF 渲染 / 分页 | `client/components/reader.tsx`（渲染段）、`reader/useUnitReader.ts`（状态与副作用）、`reader/pdfPage.tsx`（canvas 与文字层）、`reader/chrome.tsx`（侧栏/问询/缩放）、`client/pdf.ts` | `host/pdf.ts`、`service.layout`、`core/layout.ts` | `check-pdf-route`、`check-blocks`、`tests/layout.test.ts` |
| 导入 / 目录切分 / 页码范围 | `host/import.ts`、`host/structure.ts`、`host/pdf.ts` | `core/library.ts`、`core/ids.ts` | `tests/structure.test.ts`；旧库用 `scripts/reclose-ranges.mjs` 干跑 |
| 今日面板 | `client/pages/learn.tsx`（today） | `service.todayView`、`core/knowledge`、`core/plans` | `check-plan` |
| 目标 / 路线 / 档位 / 结案 | `client/pages/plan.tsx`（目标详情，文字/图形双视图）、`client/components/planVisual.tsx`（书脊路线与知识点星图）、`client/pages/learn.tsx`（NewGoalDialog） | `service.createGoal/updatePlan/closePlan`、`goalProgressOf`、`core/plans`、`core/knowledge` | `check-plan`、`tests/goal-progress.test.ts` |
| 复习 / FSRS | 今日到期列表、聚焦复习（`/quiz/session/start` 带 `concept`） | `core/knowledge`、`core/srs`；`/review` 只服务旧账（按节 FSRS） | `tests/knowledge.test.ts`、`tests/srs.test.ts` |
| 过关测试 / 练习会话 | `client/pages/practice.tsx`、`client/components/quiz.tsx` | `host/quizSessions.ts`（会话流程、`sessionPlanOf`）、`quizSessionEngine.ts`（出题/补题）、`quizSessionViews.ts`（视图与结算）、`core/quiz.ts`、`core/knowledge.ts`（唯一进度、`sectionPointStates`）、`core/plans.ts` | `check-api`、`tests/quiz-adaptive.test.ts`、`tests/quiz-session-judge.test.ts` |
| 笔记 / 概念 / 洞察（冻结） | `client/pages/insights.tsx` | `host/insights.ts`、`core/insights`、`core/concepts` | `check-api`、`tests/insight.test.ts` |
| 自编书（冻结） | `client/pages/book.tsx` | `host/books.ts`、`generation.generateBook*`、`core/books` | `check-generation` |
| 页面内生成 / 任务 | `host/generation.ts`、`host/jobs.ts` | `host/generate/prompts.ts`、`host/providers/*`、`core/jobs`、`core/settings` | `check-generation`、`check-blocks` |
| 设置 / 引擎 | `client/pages/settings.tsx` | `host/settings.ts`、`core/settings`、`providers/*` | `check-api`、`tests/settings.test.ts` |
| 主题 / 外观（纸·墨） | `client/theme.ts` | `client/styles/base.ts`（token 块）、`components/ui.tsx` 的 `ThemeToggle` | `npm run build` + `check-client` |
| 加一个 HTTP 端点 | `host/routes.ts`（分发）+ 对应 `host/routes/<域>.ts` | 同一个 service 方法；**同步 `host/tools/<域>.ts` 若 agent 也要用** | `check-api` + 对应 route check |
| 加一个 agent 工具 | `host/tools/<域>.ts` | `host/service/<域>.ts` 的操作函数（不要另写一套逻辑） | `tests/tools.test.ts` + 手动调用 |
| 文案 / 语气 | `DESIGN.md`（文案口径） | 对应 `client/**/*.tsx`、`host/generate/*Prompts.ts` | `check-voice` |

## 板块 → 入口 → 端点 → 落盘

| 板块 | 界面入口 | Host 端点 | 主要规则/服务 | 落盘 |
|---|---|---|---|---|
| **书架** | `pages/library.tsx`、`components/reader.tsx`、`components/cover.tsx` | `/library` `/material` `/unit` `/layout` `/pdf` `/import*` `/unit/complete` | `service` 资料段 + `import.ts` + `structure.ts` + `pdf.ts` + `core/layout` | `materials/<mid>/**`、`progress.json` |
| **阅读** | `pages/learn.tsx`（今日）、`pages/plan.tsx`（目标详情） | `/today` `/plans` `/plan/*` `/quiz/*` | `service` 目标段 + `core/knowledge` + `core/plans` + `core/srs` | `plans/`、`knowledge.json`、`quiz-sessions/` |
| **笔记/自编书（冻结）** | `pages/insights.tsx`、`pages/book.tsx`（导航隐藏） | `/insights` `/concept` `/books` `/book/*` | `insights.ts` + `books.ts` + `core/concepts|insights|books` | `concepts/`、`insights/`、`books/` |
| **设置/生成** | `pages/settings.tsx` + 各页轮询 | `/settings*` `/generate/*` `/jobs/*` | `generation.ts` + `jobs.ts` + `providers/*` | `settings.json`、`jobs/*.json`、`usage.json` |

### 端点速查：路径 → 文件（改接口先查这里，不必 grep 路径字符串）

- **GET**：`/health` `/settings` `/jobs` `/jobs/:id` `/usage` → `routes/admin.ts`；`/library` `/material` `/unit` `/layout` → `routes/library.ts`；`/clock` `/due` `/today` → `routes/reading.ts`；`/plans` `/plan` → `routes/plans.ts`；`/quiz` `/quiz/sessions` `/quiz/session` → `routes/practice.ts`；`/concepts` `/concept` `/insights` `/insight` `/books` `/book` `/book/chapter` `/book/export` → `routes/notes.ts`
- **POST**：`/import/upload` → `routes/import.ts`；`/import` `/import/url` `/material/archive` `/material/delete` `/unit/complete` `/unit/uncomplete` → `routes/library.ts`；`/clock` `/review` → `routes/reading.ts`；`/goal/create` `/plan/create` `/plan/update` `/plan/close` `/plan/delete` `/plan/retry-chat` `/plan/concepts` → `routes/plans.ts`；`/quiz/session/*` `/quiz/submit` → `routes/practice.ts`；`/insight/*` `/book/progress` `/book/delete` → `routes/notes.ts`；`/generate/*` `/ask` `/blocks/merge` `/jobs/:id/cancel` → `routes/generate.ts`；`/settings` `/settings/test` `/plugin/restart` → `routes/admin.ts`
- **兜底**：PDF / 单元资产 / pdf.js 资源由 `http/assets.ts` 处理，在 `routes.ts` 分发器的 GET 末尾调用；未命中一律 404。

### 工具速查：工具名 → 文件

- `study_library` `study_import_book` `study_structure_set` `study_unit_material` `study_unit_write` `study_unit_verify` `study_delete` → `tools/library.ts`
- `study_today` `study_due` `study_review` → `tools/reading.ts`
- `study_plans` `study_plan_create` `study_plan_update` → `tools/plans.ts`
- `study_concept` `study_concept_link` → `tools/notes.ts`（`study_insight` 代码保留但冻结）
- `study_generate` `study_jobs` `study_quiz` → `tools/generate.ts`（`study_book` 代码保留但冻结）

### 代码去哪找（按域，不必整读）

service.ts / generation.ts / routes.ts / tools.ts 都只是外壳，方法体在对应的域文件里：

- 资料/单元/导入/版面：`service/library.ts`（`library` `materialState` `pdfSource` `pdfAvailable` `unit` `unitMaterial` `complete` `uncomplete` `importOp` `importUpload` `importFromUrl` `structureSet` `layout` `mergeBlock` `manifest` `archiveMaterial` `deleteMaterial`）
- 今日/复习/概念：`service/learning.ts`（`due` `todayView` `review` `concepts` `conceptView`）
- 目标/裁剪/结案：`service/plans.ts`（`createGoal` `promptPlanInChat` `planList` `goalConceptLevels` `goalProgressOf` `planView` `createPlan` `updatePlan` `closePlan` `setPlanGeneration` `deletePlan`）
- 写作/校验/题库/块：`service/authoring.ts`（`writeUnit` `writeConcepts` `verifyUnit` `hasNotes` `quiz` `writeQuiz` `writeBlocks` `submitQuiz` `attachInsights`）
- 生成：`generation/plan.ts` `unit.ts` `quiz.ts` `blocks.ts` `insight.ts` `book.ts` `chat.ts`；形状校验在 `generation/normalize.ts`，常量在 `generation/shared.ts`
- HTTP：`routes/<域>.ts` 里是原来的分支；先用上面的端点速查表找到文件，再打开那一个文件

操作函数首参是服务对象（`svc`），正文里 `this.` 已换成 `svc.`。`deps` 与四个内部工具
（`preferences` / `readNotes` / `readPages` / `assertRevision`）因此是公开的——它们是包内
实现细节，不要在 routes/tools 之外的调用点使用。

## 阅读预算与禁区

**不要通读**（行数大、按方法名 grep 即可）：

| 文件 | 行数 | 读法 |
|---|---|---|
| `src/client/components/reader/useUnitReader.ts` | 721 | 阅读器的状态与副作用；按钩子名跳读 |
| `src/core/types.ts` | 746 | 按接口名搜，不要从头读 |
| `src/client/components/quizRun.tsx` | 761 | 按状态（run / summary / history）跳读 |
| `src/host/service/plans.ts` | 590 | 按方法名跳读（`updatePlan` 一个方法就 80 多行） |
| `src/core/views.ts` | 707 | 按视图名搜 |
| `src/client/pages/plan.tsx` | 689 | 目标详情按区块跳读 |
| `src/client/styles/panels.ts` | 699 | 按 class 名搜；token 在 `styles/base.ts` |
| `src/host/generation/normalize.ts` | 514 | 按 `normalize*` / `sanitize*` 名定位 |

host 侧已经没有需要整读的文件：改接口先开 `routes/<域>.ts`，改行为先开
`service/<域>.ts` 或 `generation/<域>.ts`，每个都是几百行的单域文件。

**不要读 / 不要改**：

- `lib/`：构建产物；改了会被覆盖。验证 Client 用 `check-client`。
- `vendor/`、`tooling/`：第三方运行时（pdf.js / marked / katex）与 esbuild，升级另开任务。`vendor/pdfjs/types/` 与两个 `.d.mts` 只是类型声明，跟着上游版本更新即可。
- `tests/fixtures/attention.pdf`：2.2MB 检查用样张（arXiv 原文件），只给 `check` 与 pdf worker 测试当输入，不进 npm 包。
- `.tmp/`：检查脚本的临时库，可随时删。
- 不要为了“看看现状”跑全量 `check`；先 `npm test`，再按下面「验证矩阵」挑一项。
- 不要用 `grep -rn` / `find` 找“这个功能在哪”：先按本页的端点速查、工具速查、域索引定位文件。
  整仓搜索只用于定位具体符号的行号，或确认某个名字有没有被用过。

**不做**：

- 不默认批量生成导读/自编书/洞察（实验功能），除非用户明确要求。
- 不在 `client` 里直接读写文件或调 `node:fs`。
- 不为单个功能新建第二套 service / 状态文件。
- 不删除防自欺规则（证据按「知识点 × 题干」排重、模型判定、自评不计进度、结案要求全到档位）；结案只看知识点是否到档位。

## 验证矩阵

| 改动位置 | 最小验证 | 全量 |
|---|---|---|
| `src/core/*.ts` 纯规则 | `npm test`（对应 `tests/*.test.ts`） | `npm run check` |
| `src/host/service.ts` 或 `service/<域>.ts` / 领域编排 | `node scripts/checks/service/check-service.mjs` + 相关 service check | `npm run check` |
| `src/host/routes.ts` 或 `routes/<域>.ts` / HTTP | 对应 `scripts/checks/http/check-*-route.mjs` | `npm run check` |
| `src/host/generation.ts` 或 `generation/*.ts` / prompts | `check-generation`、`check-blocks` | `npm run check` |
| `src/host/tools.ts` 或 `tools/<域>.ts` | `npm test -- tests/tools.test.ts` | `npm run check` |
| `src/client/**` | `npm run build` + `check-client` + 刷新页面 | `npm run check` |
| 导入 / 结构 | `npm test -- tests/structure.test.ts`；旧库 `node scripts/reclose-ranges.mjs`（干跑） | `npm run check` |
| 文案 | `node scripts/checks/ui/check-voice.mjs` | `npm run check` |
| 类型契约 / 跨文件 import | `npm run typecheck`（需先 `npm install`） | `npm run typecheck` + `npm run check` |

```text
scripts/checks/
├─ all.mjs              npm run check 的入口（先 build，再按依赖顺序跑 11 项）
├─ service/             服务层端到端（stub 引擎，临时库 .tmp/checks/<name>）
├─ http/                路由契约；check-routes 依赖 check-service 的库，
│                       check-plan-routes 依赖 check-plan 的库
├─ ui/                  构建产物、Markdown/数学、文案口径
└─ adhoc/               样本排查（outline/pdf/toc），不进闸门；check-toc 读 check-service 的临时库
```

单独跑检查时**必须在仓库根目录**（部分脚本用相对路径 `.tmp/checks/...`），并注意上面的依赖顺序。
