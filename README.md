# dsh-study（书桌）

DSH Web GUI 的学习插件：知识库、学习路径、间隔复习与「大道至简」洞察。

## 三块

- **变强清单**：书/论文/文章的统一清单。导入 PDF 或 arXiv，按目录切成学习单元；勾选即记录首次学习。
- **学习之路**：默认入口。今日（下一步 / 到期复习 / 薄弱概念 / 钉选洞察）、路径（目标 → 步骤 → 阅读器）、复习（FSRS 评级）。路径和精读可以在页面内直接生成，不再默认把 prompt 发进聊天。
- **大道至简**：跨资料的概念图 + 一屏洞察卡（一句话本质 / 公式 / 对比 / 误区），每条都带可跳转的来源页码。

## 数据布局

默认根目录 `$DSH_HOME/study`（可用插件配置 `dataRoot` 覆盖）：

```
library root/
├─ materials/<mid>/        # manifest.json / pages / source / units/<uid>/{notes.md,meta.json,quiz.json,extras}
├─ concepts/<cid>.json     # 全局概念，跨资料共享
├─ plans/<pid>.json        # 目标与步骤
├─ books/<bid>/            # 自编书：book.json + chapters/*.md + 章节练习 + book.md
├─ quiz-sessions/<sid>.json # 自适应练习会话
├─ progress.json           # 单元 FSRS + 概念掌握度
├─ insights/<iid>.json     # 大道至简洞察卡
├─ jobs/<jobId>.json       # 页面内生成任务
├─ settings.json           # 引擎与学习偏好（0600）
└─ index/                  # 嵌入索引预留目录
```

## 页面内生成

设置（齿轮）里的四类能力：

| 能力 | 默认 | 说明 |
|---|---|---|
| 文本 | 复用 DSH 已配置模型（`ctx.llm` + `agentDefaultModel`） | 路径、精读、练习、洞察、校验；也可切到自定义 OpenAI 兼容接口 |
| 图片 | 关闭 | OpenAI Images 兼容，后续阶段接入 |
| 动画 | 关闭 | 先做文生 SVG/HTML，视频 API 预留 |
| 嵌入 | 关闭 | 语义检索/相关推荐，不是导入加速 |

练习使用 `quiz-sessions` 单题会话；书籍章节练习存在 `books/<bid>/chapters/<cid>.quiz.json`。

任务生命周期：`queued → running → done/failed/cancelled`。同 kind + target 去重；Host 重启后未完成任务标记为中断。浏览器轮询 `GET /study-api/jobs/:id`。

没有可用文本引擎时，新建目标会回退到「复制 prompt / 打开对话」，不会把创建目标卡死。

## 主要 API

所有接口在 `/study-api` 下，仅接受本机回环且同源：

- 读：`/library`、`/material`、`/unit`、`/today`、`/due`、`/concepts`、`/concept`、`/plans`、`/plan`、`/books`、`/book`、`/book/chapter`、`/quiz`、`/quiz/session`、`/insights`、`/insight`、`/jobs`、`/settings`
- 写：`/unit/complete`、`/unit/uncomplete`、`/review`、`/quiz/submit`、`/goal/create`、`/plan/create`、`/plan/update`、`/plan/delete`、`/insight/create|update|delete|pin`、`/material/archive`、`/material/delete`
- 生成：`/generate/plan|unit|quiz|insight`、`/generate/book/outline|chapter|continuity`、`/jobs/:id/cancel`、`/settings/test`
- 练习：`/quiz/session/start|answer|finish`
- 书：`/book/export`、`/book/progress`、`/book/delete`
- 资产：`/asset?mid&uid&name`（HTML/SVG 带 sandbox CSP）

Agent 工具与 HTTP 共用同一 service 方法；新增工具：`study_generate`、`study_jobs`、`study_insight`、`study_delete`（删除路径/资料，不可恢复）、`study_quiz`（自适应练习）、`study_book`（自编书）。

## 开发

```bash
node scripts/build.mjs      # 用 vendor 的 esbuild 打包 Host 与 Client
node --test tests/*.test.ts # 纯逻辑单测
node scripts/check-service.mjs
node scripts/check-routes.mjs
node scripts/check-generation.mjs
node scripts/check-api.mjs
```

构建产物在 `lib/`（git 忽略）。插件通过 profile 的 `link:` 安装，改完 Host 后需要重载插件或重启 Host；Client 改动重新 build 后刷新页面。
