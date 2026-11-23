# AGENTS.md · 工程地图（给 coding agent）

> 改代码前先读这一页。只有当任务确实落到某个文件时，才打开那个文件；**不要通读整个仓库**。
> 产品定位与红线在 [docs/POSITIONING.md](docs/POSITIONING.md)，面向读者的文案口径在 [docs/VOICE.md](docs/VOICE.md)，用户向说明在 [README.md](README.md)。

## 开工顺序（三步，别跳）

1. **查表定位域**：在第 5 节的「改动导航」「端点速查」「工具速查」里，找到这次改动属于哪个域文件。
2. **只开那个文件**：host 侧单文件一般 300–600 行（`quizSessions.ts` 只放运行，存储与 scope 在 `quizSessionBase.ts`），按域名直接打开 `service/<域>.ts`、`generation/<域>.ts`、`routes/<域>.ts`、`tools/<域>.ts`。
3. **最后才 grep**：只有要定位一个具体符号（函数名、路径字符串、class 名）的行号时才 grep，不要用全仓 grep 代替这一页。

先查表再动手，成本是读几百行；上来就 `grep -rn` 再整读大文件，成本是几万 token，而且容易改错层。

## 0. 一句话

DSH Web GUI 的插件（bundle），两个半共享一份本地文件库：

- **Host 半**（Node 进程）：持有资料库、学习账本、`/study-api`、18 个 agent 工具、页面内生成任务；洞察/自编书工具已冻结。
- **Client 半**（React 面板）：只读 `/study-api`，从不直接写文件。
- 两边最终都调同一个 `StudyService`——页面里勾一下和 agent 调一次工具，改的是同一份状态。

没有数据库、没有独立服务器、单用户本地运行。数据是 `$DSH_HOME/study` 下的 JSON / Markdown / 原 PDF。

## 1. 目录与职责

```text
src/
├─ core/                 23 个文件：领域规则 + 文件仓库（只依赖 node 内置）
│  ├─ types.ts           所有落盘记录与枚举；改数据结构先看它
│  ├─ views.ts           给 UI 的只读视图类型
│  ├─ paths.ts           数据根与 LibraryPaths
│  ├─ store.ts           JSON 原子写、串行写队列
│  ├─ library.ts         manifest 读写、单元查找
│  ├─ plans.ts           目标/步骤的读写与校验
│  ├─ planGate.ts        节级路线的页数算术（必读/略读/不读）与阈值
│  ├─ progress.ts        单元 FSRS 状态与到期
│  ├─ srs.ts             FSRS 排程
│  ├─ quiz.ts            题库选择、判分、自适应下一题
│  ├─ knowledge.ts       知识点空间：掌握度、证据排重、FSRS、衰减、结案
│  ├─ concepts.ts        全局概念与出现位置
│  ├─ insights.ts / books.ts   冻结实验面的数据
│  ├─ blocks.ts          阅读面语义块与引导卡校验
│  ├─ layout.ts          PDF 段落几何（把文本框排成段）
│  ├─ validate.ts        导读八节 / 页码 / 公式校验
│  ├─ settings.ts        引擎与学习偏好
│  └─ ids / time / jobs / usage / version
│     （core 直接做文件 IO，不是纯模型层）
├─ host/                 58 个文件：服务、HTTP、工具、生成；大的都按域拆成目录
│  ├─ index.ts           apply()：组装服务，注册路由/工具/提示词
│  ├─ service.ts         StudyService 外壳：字段、today()、四个内部工具，其余转发
│  ├─ service/           library learning plans authoring + views / prompts / error
│  ├─ routes.ts          回环/同源校验 + 分发；按域的分支在 routes/
│  ├─ routes/            library reading plans practice notes generate admin import + shared
│  ├─ http/assets.ts     PDF / 单元资产 / pdf.js 资源路由
│  ├─ tools.ts + tools/  18 个 study_* 工具，按域分组
│  ├─ generation.ts + generation/   外壳 + chat plan unit quiz concepts blocks insight book + normalize + shared
│  ├─ jobs.ts            JobQueue：jobs/*.json，queued→running→done/failed
│  ├─ quizSessions.ts    会话运行：start / answer / appeal / finish / index
│  ├─ quizSessionBase.ts 会话存储、scope 与题库解析（基类）
│  ├─ quizSessionEngine.ts / quizSessionViews.ts   出题补题 / 视图与结算
│  ├─ books.ts / insights.ts / settings.ts / usage.ts / pluginRestart.ts
│  ├─ import.ts / structure.ts / pdf.ts
│  ├─ goal.ts            无引擎时把 prompt 送回聊天
│  └─ providers/         dsh.ts（默认）/ openai.ts / types.ts / index.ts
├─ client/               34 个文件：React 面板
│  ├─ index.tsx          注册侧栏行「书桌」+ 主区面板
│  ├─ app.tsx            View 联合类型与页面切换（无路由库）
│  ├─ pages/             library learn plan practice book insights settings
│  ├─ components/        reader.tsx + reader/（pdfPage / chrome / useUnitReader）cover quiz/quizRun import ui usage planVisual
│  ├─ styles.ts + styles/   设计系统入口（44 行）+ 6 个段落文件
│  ├─ pdf.ts             浏览器端 pdf.js 管线（阅读器与封面共用）
│  ├─ api.ts             fetch 封装、job 轮询
│  ├─ markdown.ts        Markdown + KaTeX 渲染（vendor 源）
│  └─ actions / labels / theme / mascot
├─ scripts/              构建、检查、迁移（见第 9 节）
├─ tests/                22 个 node:test 纯逻辑单测（tools.test.ts 守住 18 个工具的注册表）
├─ vendor/               第三方运行时：pdfjs / marked / katex（勿改）
│  ├─ pdfjs/types/       pdfjs-dist@6.3.289 的上游 d.ts（只给 tsc 用）
│  └─ marked.d.mts / katex.d.mts   把运行文件接到上游类型
├─ tooling/              esbuild 二进制（勿改）
└─ figure/ samples/      mascot 源图、样张 PDF（attention.pdf）
```

目录树不写行数（变化太快）；要判断哪个文件不能整读，看第 7 节的表。

构建产物在 `lib/`（git 忽略）：`lib/index.js`（Host ESM）、`lib/client.js`（浏览器 CJS 包装）、`lib/pdfjs/*`、`lib/katex/*`（公式样式与字体）。
`package.json` 的 `main` / `exports` 与 `dsh.client` 指向这里；`cordis.patch.yml` 把 `study-desk` 行插进 Web profile。

## 2. 启动与构建

```bash
npm test            # node --test tests/*.test.ts，纯逻辑单测（秒级）
npm run build       # scripts/build.mjs：esbuild 打包 Host + Client，并复制 pdf.js 资产
npm run check       # 全量闸门：build + 11 个 service/http/ui 检查（见第 9 节）
npm run typecheck   # tsc --noEmit；需要先 npm install，不在 check 里
```

- Host 改动：`npm run build` 后**重载插件或重启 Host**。
- Client 改动：`npm run build` 后刷新页面；面板标题旁会提示 Host/Client 版本不一致。
- `build` / `test` / `check` 只依赖 `tooling/package/bin/esbuild`，不需要 `npm install`；`typecheck` 需要 `node_modules`（typescript + marked + katex，都是 devDependencies）。

## 3. 三个板块 ↔ 代码

| 板块 | 界面入口 | Host 端点 | 主要规则/服务 | 落盘 |
|---|---|---|---|---|
| **书架** | `pages/library.tsx`、`components/reader.tsx`、`components/cover.tsx` | `/library` `/material` `/unit` `/layout` `/pdf` `/import*` `/unit/complete` | `service` 资料段 + `import.ts` + `structure.ts` + `pdf.ts` + `core/layout` | `materials/<mid>/**`、`progress.json` |
| **阅读** | `pages/learn.tsx`（今日）、`pages/plan.tsx`（目标详情） | `/today` `/plans` `/plan/*` `/quiz/*` | `service` 目标段 + `core/knowledge` + `core/plans` + `core/srs` | `plans/`、`knowledge.json`、`quiz-sessions/` |
| **笔记/自编书（已冻结）** | `pages/insights.tsx`、`pages/book.tsx`（导航隐藏） | `/insights` `/concept` `/books` `/book/*` | `insights.ts` + `books.ts` + `core/concepts|insights|books` | `concepts/`、`insights/`、`books/` |
| 设置/生成 | `pages/settings.tsx` + 各页轮询 | `/settings*` `/generate/*` `/jobs/*` | `generation.ts` + `jobs.ts` + `providers/*` | `settings.json`、`jobs/*.json`、`usage.json` |

## 4. 数据布局

默认根 `$DSH_HOME/study`，可用插件配置 `dataRoot` 覆盖（`core/paths.ts`）：

```text
materials/<mid>/   manifest.json / pages / source / layout / units/<uid>/{notes.md,meta.json,quiz.json,blocks.json,extras}
concepts/<cid>.json      全局概念，跨资料共享
plans/<pid>.json         目标、节级路线（`steps[].coverage` + `steps[].level`）、交付物与期限
quiz-sessions/<sid>.json 自适应练习会话
books/<bid>/             自编书：book.json + chapters/*.md + 章节练习 + book.md
progress.json            旧进度（阅读 / 按节 FSRS）；其 concepts 只在 knowledge.json 缺失时被一次性迁移读取
insights/<iid>.json      洞察卡
jobs/<jobId>.json        页面内生成任务
knowledge.json           知识点空间：掌握度 / 到期 / 证据 / 结案
settings.json            引擎、学习偏好与估算单价（0600）
usage.json               页面内 AI 调用的 token / 费用聚合（总计 + 今天 + 每日，供设置里按天格子图）
index/                   嵌入索引预留目录（当前未写入）
```

## 5. 改动导航（先看这张表，再打开文件）

| 我要改…… | 先读 | 通常还要改 | 验证 |
|---|---|---|---|
| 书架列表 / 封面 / 归档 | `client/pages/library.tsx`、`components/cover.tsx` | `core/views.ts`、`service.library/materialState` | `npm run build` + `check-client` |
| 阅读器 / PDF 渲染 / 分页 | `client/components/reader.tsx`（渲染段）、`reader/useUnitReader.ts`（状态与副作用）、`reader/pdfPage.tsx`（canvas 与文字层）、`reader/chrome.tsx`（侧栏/问询/缩放）、`client/pdf.ts` | `host/pdf.ts`、`service.layout`、`core/layout.ts` | `check-pdf-route`、`check-blocks`、`tests/layout.test.ts` |
| 导入 / 目录切分 / 页码范围 | `host/import.ts`、`host/structure.ts`、`host/pdf.ts` | `core/library.ts`、`core/ids.ts` | `tests/structure.test.ts`；旧库用 `scripts/reclose-ranges.mjs` 干跑 |
| 今日面板 | `client/pages/learn.tsx`（today） | `service.todayView`、`core/knowledge`、`core/plans` | `check-plan` |
| 目标 / 路线 / 档位 / 结案 | `client/pages/plan.tsx`（目标详情，文字/图形双视图）、`client/components/planVisual.tsx`（书脊路线与掌握印章）、`client/pages/learn.tsx`（NewGoalDialog） | `service.createGoal/updatePlan/closePlan`、`goalProgressOf`、`core/plans`、`core/knowledge` | `check-plan`、`tests/goal-progress.test.ts` |
| 复习 / FSRS | 今日到期列表、聚焦复习（`/quiz/session/start` 带 `concept`） | `core/knowledge`、`core/srs`；`/review` 只服务旧账（按节 FSRS） | `tests/knowledge.test.ts`、`tests/srs.test.ts` |
| 过关测试 / 练习会话 | `client/pages/practice.tsx`、`client/components/quiz.tsx` | `host/quizSessions.ts`（会话流程、`sessionPlanOf`）、`quizSessionEngine.ts`（出题/补题）、`quizSessionViews.ts`（视图与结算）、`core/quiz.ts`、`core/knowledge.ts`（唯一进度、`sectionPointStates`）、`core/plans.ts` | `check-api`、`tests/quiz-adaptive.test.ts`、`tests/quiz-session-judge.test.ts` |
| 笔记 / 概念 / 洞察（冻结） | `client/pages/insights.tsx` | `host/insights.ts`、`core/insights`、`core/concepts` | `check-api`、`tests/insight.test.ts` |
| 自编书（冻结） | `client/pages/book.tsx` | `host/books.ts`、`generation.generateBook*`、`core/books` | `check-generation` |
| 页面内生成 / 任务 | `host/generation.ts`、`host/jobs.ts` | `host/generate/prompts.ts`、`host/providers/*`、`core/jobs`、`core/settings` | `check-generation`、`check-blocks` |
| 设置 / 引擎 | `client/pages/settings.tsx` | `host/settings.ts`、`core/settings`、`providers/*` | `check-api`、`tests/settings.test.ts` |
| 主题 / 外观（纸·墨） | `client/theme.ts` | `client/styles/base.ts`（token 块）、`components/ui.tsx` 的 `ThemeToggle` | `npm run build` + `check-client` |
| 加一个 HTTP 端点 | `host/routes.ts`（分发）+ 对应 `host/routes/<域>.ts` | 同一个 service 方法；**同步 `host/tools/<域>.ts` 若 agent 也要用** | `check-api` + 对应 route check |
| 加一个 agent 工具 | `host/tools/<域>.ts` | `host/service/<域>.ts` 的操作函数（不要另写一套逻辑） | `tests/tools.test.ts` + 手动调用 |
| 文案 / 语气 | `docs/VOICE.md` | 对应 `client/**/*.tsx`、`host/generate/*Prompts.ts` | `check-voice` |

### 端点速查：路径 → 文件（改接口先查这里，不必 grep 路径字符串）

- **GET**：`/health` `/settings` `/jobs` `/jobs/:id` `/usage` → `routes/admin.ts`；`/library` `/material` `/unit` `/layout` → `routes/library.ts`；`/due` `/today` → `routes/reading.ts`；`/plans` `/plan` → `routes/plans.ts`；`/quiz` `/quiz/sessions` `/quiz/session` → `routes/practice.ts`；`/concepts` `/concept` `/insights` `/insight` `/books` `/book` `/book/chapter` `/book/export` → `routes/notes.ts`
- **POST**：`/import/upload` → `routes/import.ts`；`/import` `/import/url` `/material/archive` `/material/delete` `/unit/complete` `/unit/uncomplete` → `routes/library.ts`；`/review` → `routes/reading.ts`；`/goal/create` `/plan/create` `/plan/update` `/plan/close` `/plan/delete` `/plan/retry-chat` `/plan/concepts` → `routes/plans.ts`；`/quiz/session/*` `/quiz/submit` → `routes/practice.ts`；`/insight/*` `/book/progress` `/book/delete` → `routes/notes.ts`；`/generate/*` `/ask` `/blocks/merge` `/jobs/:id/cancel` → `routes/generate.ts`；`/settings` `/settings/test` `/plugin/restart` → `routes/admin.ts`
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

## 6. 分层与放置规则

- 依赖方向：`core ← host`、`core ← client`；`host` 与 `client` **互不 import**。改动前先守住这条。
- `core` 不是纯模型：`store/paths/library/plans/concepts/insights/jobs` 直接读写文件。领域规则放 `core`，文件编排放 `host`。
- `routes.ts` 与 `tools.ts` 是**两个入口、一套 service**。新增动作先加 service 方法，再分别接线；不要在路由里写领域逻辑。
- UI 视图类型放 `core/views.ts`，不要从 `host` 导类型给 `client`。
- 新功能如果只是实验（导读、书、洞察、练习），不要接进「今日」主回路；判据见 POSITIONING 第三、七、八节。

## 7. 阅读预算与禁区

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
- `samples/attention.pdf`：2.2MB 样张，只用于检查脚本。
- `.tmp/`：检查脚本的临时库，可随时删。
- 不要为了“看看现状”跑全量 `check`；先 `npm test`，再按第 9 节挑一项。
- 不要用 `grep -rn` / `find` 找“这个功能在哪”：先按第 5 节的端点速查、工具速查、域索引定位文件。
  整仓搜索只用于定位具体符号的行号，或确认某个名字有没有被用过。

**不做**：

- 不默认批量生成导读/自编书/洞察（实验功能），除非用户明确要求。
- 不在 `client` 里直接读写文件或调 `node:fs`。
- 不为单个功能新建第二套 service / 状态文件。
- 不删除防自欺规则（证据按「知识点 × 题干」排重、模型判定、自评不计进度、结案要求全到档位）；结案只看知识点是否到档位。

## 8. 术语与历史包袱

| 旧叫法 | 现叫法 | 备注 |
|---|---|---|
| 变强清单 | 书架 | 界面文案已换 |
| 学习之路 | 阅读 | 代码里仍有 `learn` / `plan` 命名 |
| 精读稿 | 导读（实验） | 校验规则仍叫 `notes` / `writeUnit` |
| 大道至简 | 笔记（实验） | `insights` / `concepts` |
| 阶段一 | 旧兼容层（已删） | 目标→裁剪→尝试→判定→结案；新主回路见 POSITIONING §3 |

已知的双轨（改之前先确认改哪条）：

1. **进度账已收口**：掌握度只有 `knowledge.json` 一本（答题、申诉、`/quiz/submit` 都只写它；`progress.json` 只留单元 FSRS，其 `concepts` 只在 `seedKnowledgeFromProgress` 一次性迁移时被读）。知识点清单也只有一份——在节上（`units/<uid>/meta.json.concepts`）；目标只有 `steps[].level`，没有概念表，也没有 `passedAt`。判定题、判定卡、归因与卡点的代码已删除；只剩 `plan.attempts` 与 `plan.threshold` 这类旧字段，读旧目标时兼容。新功能一律接 knowledge。
2. **练习单模**：练习只在目标内存在并写进度；目标外/无目标由 `sessionPlanOf` 返回 `blocked`，`start` 直接拒绝并说明原因。旧的 `session.free` 只是历史标记，不再写入、不再续跑。
3. **两条生成**：页面内 job（`generation` + `jobs`，默认）与聊天回退（`goal.ts` 的 `promptSession`，无引擎时）。
4. **三个实验面**：导读、自编书、洞察卡；导航隐藏，不在「今日」出现。

## 9. 验证矩阵

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

## 10. 硬约束与常见坑

- 导读（精读稿）必须含八节：本节目标 / 前置知识 / 核心概念 / 逐步讲解 / 类比 / 常见误区 / 自测 / 出处；正文 ≥400 字；页码落在单元 `pageStart..pageEnd`；概念用全局 id 并通过 `concepts` 登记。
- 公式一律 LaTeX：行内 `$...$`，独立 `$$...$$`；禁止 Unicode 拼公式；函数名用 `\operatorname{...}`。阅读器用 KaTeX。
- `/study-api` 仅接受本机回环 + 同源；新增路由必须走 `routes.ts` 的统一入口，不要绕过。
- `unit/complete` 等写操作带 `revision` 乐观锁；客户端要传当前 revision。
- 原文件 PDF 走 Range 流式；前端 pdf.js 由 Host 提供 `lib/pdfjs/*`，不要引 CDN。
- 资产（HTML/SVG）路由带 sandbox CSP；不要放宽。
- 自编书/导读生成前先确认用户要风格，不要一次生成整本。
- 目标必须带交付物与期限；期限在 `/generate/plan`、`study_generate` 与新建目标弹窗三处都强制。
- 知识点目标四档：了解 0.6 / 会用 0.75 / 能讲 0.85 / 创新 0.95；练习只考目标内、未到阈值的点。**档位挂在节上**：`PlanStep.level`（缺省 2），`goalLevelOf` 读最深的那一步；`knowledge.json` 只存能力值（没有 target 字段）。知识点清单只在节上（`units/<uid>/meta.json.concepts`），目标不再持有 `mastery` 副本——要加知识点就写进那一节。作答时档位与期限由 `quizSessions.evidenceOptions` 从会话快照（`targetThresholds` / `horizonDays`）传进账本，读侧由 `todayView` / `goalProgressOf` 按当前目标算。
- 掌握度更新（唯一入口 `core/knowledge.applyEvidence`，规则表在 README「掌握度怎么变」）：**从证据按时间序重算**，两步之间先结算闲置衰减，所以放置一个月不会被下一次答对抹平；起点 0.5；答对加 `学习率 ×（1 − 现值）`，学习率 0.14 / 0.18 / 0.22（简 / 中 / 难），半对减半；答错 ×0.90；同一个指纹再答是替换那条证据，不叠加（没有旧版的 0.3 折）；申诉改判替换证据并重算，改对的涨幅按 0.7 折（`APPEAL_WEIGHT`）；未到档位的点 `due` 封顶 7 天（`MAX_OPEN_INTERVAL_DAYS`）。数值只由确定性规则算，AI 只出 pass/partial/fail。
- 出题按「知识点 × 题干指纹」排重（`quizSessions.usedQuestions` → `orderQuizItems` / `pickAdaptiveNext` 的 `skip`）：同一知识点不会再被同一道题考到，过关测试与到期复习同规则；没新题就在**下一组开组时** `appendQuestions` 补 1–3 道（答题请求里不生成），补不出就把这一组关成 `exhausted`。排重靠账本证据 + 同 scope 的历史会话。
- 通过 = 本组目标点在 `knowledge.json` 里全部达到该节阈值；没有组级模型研判（`sectionConfirmed` 已删除）。题量/评级不得作为通过门槛。练习不写进度就没有存在理由：不在目标里一律拒绝（`QuizBlockReason`：`no-goal` / `outside-goal` / `no-concepts`）；复习会话仍按「最新一次答对」关闭。
- 目标知识点：创建目标时给**每个非 skip 节**抽 3–8 个知识点（顺序执行，避免 manifest 并发写；连续 2 节失败即停）。没有知识点的必需节会阻塞结案并点名，目标页可逐节 `POST /plan/concepts`（agent 用 `study_generate action=concepts`）补。
- 结案与结案性 `settleIfDone` 都看**遗忘间隔** `forgettingIntervalDays`（`srs.S` 推到 `MAX_STABILITY`，不按 `MAX_SCHEDULE_DAYS=180` 截断），要求大于 `max(30, 距期限 × 1.5)`；`due` 只决定「哪天回来复习」。别把两者混用：拿被截断的 `due` 当门槛会让期限剩 120 天以上的目标永远结不了案。目标里的节没有知识点时不回退到题量或评级，而是明确拦下并点名；在目标页逐节「补知识点」（`/plan/concepts`）后再结案。

## 11. 文档索引

- [README.md](README.md)：用户向功能与 API 一览。
- [docs/POSITIONING.md](docs/POSITIONING.md)：产品规范与红线（加功能前必读第八节）。
- [docs/VOICE.md](docs/VOICE.md)：面向读者的文案口径。
- 本文件：工程地图、改动导航、验证矩阵。改目录结构或新增板块时**同步更新这里**。
