# AGENTS.md · 工程地图（给 coding agent）

> 改代码前先读这一页。只有当任务确实落到某个文件时，才打开那个文件；**不要通读整个仓库**。
> 产品定位与红线在 [docs/POSITIONING.md](docs/POSITIONING.md)，面向读者的文案口径在 [docs/VOICE.md](docs/VOICE.md)，用户向说明在 [README.md](README.md)。

## 0. 一句话

DSH Web GUI 的插件（bundle），两个半共享一份本地文件库：

- **Host 半**（Node 进程）：持有资料库、学习账本、`/study-api`、20 个 agent 工具、页面内生成任务。
- **Client 半**（React 面板）：只读 `/study-api`，从不直接写文件。
- 两边最终都调同一个 `StudyService`——页面里勾一下和 agent 调一次工具，改的是同一份状态。

没有数据库、没有独立服务器、单用户本地运行。数据是 `$DSH_HOME/study` 下的 JSON / Markdown / 原 PDF。

## 1. 目录与职责

```text
src/
├─ core/                 22 个文件：领域规则 + 文件仓库（依赖：只依赖 node 内置）
│  ├─ types.ts           (677) 所有落盘记录与枚举；改数据结构先看它
│  ├─ views.ts           (498) 给 UI 的只读视图类型
│  ├─ paths.ts           数据根与 LibraryPaths（materials/concepts/... 的路径）
│  ├─ store.ts           JSON 原子写、串行写队列、readJson/writeJsonAtomic
│  ├─ library.ts         manifest 读写、单元查找
│  ├─ plans.ts           目标/步骤的读写与校验
│  ├─ planGate.ts        裁剪单、归因、结案门（阈值 / 独立证据 ≥3）
│  ├─ progress.ts        单元 FSRS 状态、到期、概念掌握度
│  ├─ cards.ts           判定卡（答错生成、答对退役）
│  ├─ srs.ts             FSRS 排程
│  ├─ quiz.ts            题库选择、判分、自适应下一题
│  ├─ concepts.ts        全局概念与出现位置
│  ├─ insights.ts        洞察卡
│  ├─ books.ts           自编书
│  ├─ blocks.ts          阅读面语义块与引导卡校验
│  ├─ layout.ts          PDF 段落几何（把文本框排成段）
│  ├─ validate.ts        导读（精读稿）八节 / 页码 / 公式校验
│  ├─ settings.ts        引擎与学习偏好
│  ├─ ids.ts / time.ts / jobs.ts / version.ts
│  └─ （core 直接做文件 IO，不是纯模型层）
├─ host/                 23 个文件：服务、HTTP、agent 工具、生成
│  ├─ index.ts           插件入口 apply()：组装所有服务并注册路由/工具/提示词
│  ├─ service.ts         (1533) StudyService：资料/单元/目标/判定/卡/概念/导入/资产
│  ├─ routes.ts          (909) /study-api 手写 if 链（60+ 条路径）
│  ├─ http/assets.ts     PDF / 单元资产 / pdf.js 资源路由
│  ├─ service/           views.ts（只读视图）、prompts.ts（聊天回退提示）
│  ├─ tools.ts           (771) 20 个 study_* agent 工具
│  ├─ generation.ts      (1368) 页面内生成：plan/unit/quiz/insight/blocks/book/judge
│  ├─ jobs.ts            JobQueue：jobs/*.json，queued→running→done/failed
│  ├─ books.ts / insights.ts / quizSessions.ts / settings.ts
│  ├─ import.ts          导入 PDF、切页、建单元
│  ├─ structure.ts       目录 → 单元范围（相邻单元共享起始页）
│  ├─ pdf.ts             pdf.js 抽文本 / 目录 / 段落几何
│  ├─ goal.ts            无引擎时把 prompt 送回聊天
│  ├─ generate/          prompts.ts、bookPrompts.ts
│  └─ providers/         dsh.ts（默认）/ openai.ts / types.ts / index.ts
├─ client/               21 个文件：React 面板
│  ├─ index.tsx          注册侧栏行「书桌」+ 主区面板
│  ├─ app.tsx            (257) View 联合类型与页面切换（无路由库）
│  ├─ pages/             library(396) learn(841) plan(1048) book(343) insights(547) settings(334)
│  ├─ components/        reader(1155) cover(159) quiz(252) import(143) ui(224) markdown
│  ├─ pdf.ts             浏览器端 pdf.js 管线（阅读器与封面共用）
│  ├─ api.ts             fetch 封装、job 轮询
│  ├─ styles.ts          (1980) 全部 CSS
│  └─ actions.ts / labels.ts / theme.ts / mascot.ts
├─ scripts/              构建、检查、迁移（见第 9 节）
├─ tests/                12 个 node:test 纯逻辑单测
├─ vendor/               pdfjs / marked / katex（第三方，勿改）
├─ tooling/              esbuild 二进制（勿改）
└─ figure/ samples/      mascot 源图、样张 PDF（attention.pdf）
```

构建产物在 `lib/`（git 忽略）：`lib/index.js`（Host ESM）、`lib/client.js`（浏览器 CJS 包装）、`lib/pdfjs/*`。
`package.json` 的 `main` / `exports` 与 `dsh.client` 指向这里；`cordis.patch.yml` 把 `study-desk` 行插进 Web profile。

## 2. 启动与构建

```bash
npm test            # node --test tests/*.test.ts，纯逻辑单测（秒级）
npm run build       # scripts/build.mjs：esbuild 打包 Host + Client，并复制 pdf.js 资产
npm run check       # 全量闸门：build + 13 个 service/http/ui 检查（见第 9 节）
```

- Host 改动：`npm run build` 后**重载插件或重启 Host**。
- Client 改动：`npm run build` 后刷新页面；面板标题旁会提示 Host/Client 版本不一致。
- 构建只依赖 `tooling/package/bin/esbuild`，不需要 `npm install`（`node_modules` 可能不存在）。

## 3. 三个板块 ↔ 代码

| 板块 | 界面入口 | Host 端点 | 主要规则/服务 | 落盘 |
|---|---|---|---|---|
| **书架** | `pages/library.tsx`、`components/reader.tsx`、`components/cover.tsx` | `/library` `/material` `/unit` `/layout` `/pdf` `/import*` `/unit/complete` | `service` 资料段 + `import.ts` + `structure.ts` + `pdf.ts` + `core/layout` | `materials/<mid>/**`、`progress.json` |
| **阅读** | `pages/learn.tsx`（今日/目标列表/复习）、`pages/plan.tsx`（目标详情） | `/today` `/plans` `/plan/*` `/review` `/cards` `/due` `/quiz/*` | `service` 目标段 + `core/planGate` + `core/cards` + `core/srs` | `plans/`、`cards/`、`quiz-sessions/`、`progress.json` |
| **笔记（实验）** | `pages/insights.tsx`、`pages/book.tsx` | `/insights` `/concept` `/books` `/book/*` | `insights.ts` + `books.ts` + `core/concepts|insights|books` | `concepts/`、`insights/`、`books/` |
| 设置/生成 | `pages/settings.tsx` + 各页轮询 | `/settings*` `/generate/*` `/jobs/*` | `generation.ts` + `jobs.ts` + `providers/*` | `settings.json`、`jobs/*.json` |

## 4. 数据布局

默认根 `$DSH_HOME/study`，可用插件配置 `dataRoot` 覆盖（`core/paths.ts`）：

```text
materials/<mid>/   manifest.json / pages / source / layout / units/<uid>/{notes.md,meta.json,quiz.json,blocks.json,extras}
concepts/<cid>.json      全局概念，跨资料共享
plans/<pid>.json         目标、裁剪单、尝试、卡点、判定题
cards/<cid>.json         判定卡（结案时退役/删除）
quiz-sessions/<sid>.json 自适应练习会话
books/<bid>/             自编书：book.json + chapters/*.md + 章节练习 + book.md
progress.json            单元 FSRS + 概念掌握度
insights/<iid>.json      洞察卡
jobs/<jobId>.json        页面内生成任务
settings.json            引擎与学习偏好（0600）
```

## 5. 改动导航（先看这张表，再打开文件）

| 我要改…… | 先读 | 通常还要改 | 验证 |
|---|---|---|---|
| 书架列表 / 封面 / 归档 | `client/pages/library.tsx`、`components/cover.tsx` | `core/views.ts`、`service.library/materialState` | `npm run build` + `check-client` |
| 阅读器 / PDF 渲染 / 分页 | `client/components/reader.tsx`、`client/pdf.ts` | `host/pdf.ts`、`service.layout`、`core/layout.ts` | `check-pdf-route`、`check-blocks`、`tests/layout.test.ts` |
| 导入 / 目录切分 / 页码范围 | `host/import.ts`、`host/structure.ts`、`host/pdf.ts` | `core/library.ts`、`core/ids.ts` | `tests/structure.test.ts`；旧库用 `scripts/reclose-ranges.mjs` 干跑 |
| 今日面板 | `client/pages/learn.tsx`（today） | `service.todayView`、`core/planGate`、`core/progress` | `check-plan` |
| 目标 / 裁剪 / 判定 / 结案 | `client/pages/plan.tsx`（目标详情）、`client/pages/learn.tsx`（目标列表、NewGoalDialog） | `service.createGoal/updatePlan/recordQuestions/recordJudgement/closePlan`、`core/plans`、`core/planGate`、`core/cards` | `check-plan`、`check-judge`、`check-plan-routes` |
| 复习 / FSRS | `client/pages/learn.tsx`（review） | `service.review/reviewCard`、`core/srs`、`core/progress`、`core/cards` | `tests/srs.test.ts`、`tests/cards.test.ts` |
| 笔记 / 概念 / 洞察 | `client/pages/insights.tsx` | `host/insights.ts`、`core/insights`、`core/concepts` | `check-api`、`tests/insight.test.ts` |
| 自编书 | `client/pages/book.tsx` | `host/books.ts`、`generation.generateBook*`、`core/books` | `check-generation` |
| 页面内生成 / 任务 | `host/generation.ts`、`host/jobs.ts` | `host/generate/prompts.ts`、`host/providers/*`、`core/jobs`、`core/settings` | `check-generation`、`check-blocks` |
| 设置 / 引擎 | `client/pages/settings.tsx` | `host/settings.ts`、`core/settings`、`providers/*` | `check-api`、`tests/settings.test.ts` |
| 加一个 HTTP 端点 | `host/routes.ts` | 同一个 service 方法；**同步 `host/tools.ts` 若 agent 也要用** | `check-api` + 对应 route check |
| 加一个 agent 工具 | `host/tools.ts` | `host/service.ts` 的公开方法（不要另写一套逻辑） | 手动调用 + `check-api` |
| 文案 / 语气 | `docs/VOICE.md` | 对应 `client/**/*.tsx`、`host/generate/*Prompts.ts` | `check-voice` |

### StudyService 方法索引（按域，避免通读 1533 行）

- 资料/单元：`library` `materialState` `pdfSource` `pdfAvailable` `unit` `unitMaterial` `complete` `uncomplete` `layout` `mergeBlock` `import` `structureSet` `archiveMaterial` `deleteMaterial` `manifest`
- 目标：`createGoal` `promptPlanInChat` `planList` `planView` `createPlan` `updatePlan` `closePlan` `recordQuestions` `recordJudgement` `setPlanGeneration` `deletePlan`
- 复习/卡：`due` `review` `dueCardList` `reviewCard`
- 概念/笔记：`concepts` `conceptView` `attachInsights`
- 题库/练习/块：`quiz` `writeQuiz` `submitQuiz` `writeBlocks`
- 写作/校验：`writeUnit` `verifyUnit`

### GenerationService 方法索引

`generatePlan` `retryPlan` `generateUnit` `generateQuiz` `generateBlocks` `generateInsights` `generateBookOutline` `generateBookChapter` `generateBookContinuity` `generateQuestions` `judgeAnswer` `ask` `testEngine`

## 6. 分层与放置规则

- 依赖方向：`core ← host`、`core ← client`；`host` 与 `client` **互不 import**。改动前先守住这条。
- `core` 不是纯模型：`store/paths/library/plans/cards/concepts/insights/jobs` 直接读写文件。领域规则放 `core`，文件编排放 `host`。
- `routes.ts` 与 `tools.ts` 是**两个入口、一套 service**。新增动作先加 service 方法，再分别接线；不要在路由里写领域逻辑。
- UI 视图类型放 `core/views.ts`，不要从 `host` 导类型给 `client`。
- 新功能如果只是实验（导读、书、洞察、练习），不要接进「今日」主回路；判据见 POSITIONING 第三、七、八节。

## 7. 阅读预算与禁区

**不要通读**（行数大、按方法名 grep 即可）：

| 文件 | 行数 | 读法 |
|---|---|---|
| `src/client/styles.ts` | 1980 | 只在改样式时按 class 名搜 |
| `src/client/pages/plan.tsx` | 1048 | 目标详情按区块跳读 |
| `src/client/pages/learn.tsx` | 841 | 按 tab / 组件名跳读 |
| `src/host/service.ts` | 1533 | 用上面的方法索引定位 |
| `src/host/generation.ts` | 1368 | 按 `generate*` 方法名定位 |
| `src/host/routes.ts` | 909 | 按 path 字符串搜；PDF/资产在 http/assets.ts |
| `src/client/components/reader.tsx` | 1155 | 按分块/页/全屏函数名跳读 |

**不要读 / 不要改**：

- `lib/`：构建产物；改了会被覆盖。验证 Client 用 `check-client`。
- `vendor/`、`tooling/`：第三方 pdf.js / esbuild，升级另开任务。
- `samples/attention.pdf`：2.2MB 样张，只用于检查脚本。
- `.tmp/`：检查脚本的临时库，可随时删。
- 不要为了“看看现状”跑全量 `check`；先 `npm test`，再按第 9 节挑一项。

**不做**：

- 不默认批量生成导读/自编书/洞察（实验功能），除非用户明确要求。
- 不在 `client` 里直接读写文件或调 `node:fs`。
- 不为单个功能新建第二套 service / 状态文件。
- 不删除 `planGate` 的结案门（独立证据 ≥3、判定阈值）——那是产品防自欺的机关。

## 8. 术语与历史包袱

| 旧叫法 | 现叫法 | 备注 |
|---|---|---|
| 变强清单 | 书架 | 界面文案已换 |
| 学习之路 | 阅读 | 代码里仍有 `learn` / `plan` 命名 |
| 精读稿 | 导读（实验） | 校验规则仍叫 `notes` / `writeUnit` |
| 大道至简 | 笔记（实验） | `insights` / `concepts` |
| 阶段一 | 当前主回路 | README 里指目标→裁剪→尝试→判定→结案 |

已知的双轨（改之前先确认改哪条）：

1. **两套复习**：`cards`（判定题答错生成，主回路）与 `due`（按节 FSRS，旧账，复习页底部）。新功能默认接 `cards`。
2. **两条生成**：页面内 job（`generation` + `jobs`，默认）与聊天回退（`goal.ts` 的 `promptSession`，无引擎时）。
3. **三个实验面**：导读、自编书、洞察卡；默认不在「今日」出现。

## 9. 验证矩阵

| 改动位置 | 最小验证 | 全量 |
|---|---|---|
| `src/core/*.ts` 纯规则 | `npm test`（对应 `tests/*.test.ts`） | `npm run check` |
| `src/host/service.ts` / 领域编排 | `node scripts/checks/service/check-service.mjs` + 相关 service check | `npm run check` |
| `src/host/routes.ts` / HTTP | 对应 `scripts/checks/http/check-*-route.mjs` | `npm run check` |
| `src/host/generation.ts` / prompts | `check-generation`、`check-blocks` | `npm run check` |
| `src/client/**` | `npm run build` + `check-client` + 刷新页面 | `npm run check` |
| 导入 / 结构 | `npm test -- tests/structure.test.ts`；旧库 `node scripts/reclose-ranges.mjs`（干跑） | `npm run check` |
| 文案 | `node scripts/checks/ui/check-voice.mjs` | `npm run check` |

```text
scripts/checks/
├─ all.mjs              npm run check 的入口（先 build，再按依赖顺序跑 13 项）
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

## 11. 文档索引

- [README.md](README.md)：用户向功能与 API 一览。
- [docs/POSITIONING.md](docs/POSITIONING.md)：产品规范与红线（加功能前必读第八节）。
- [docs/VOICE.md](docs/VOICE.md)：面向读者的文案口径。
- 本文件：工程地图、改动导航、验证矩阵。改目录结构或新增板块时**同步更新这里**。