# 硬约束与历史包袱（AGENTS.md 的细则页）

> 这些是改代码时必须守住的规则与旧命名来源；AGENTS.md 只留指路。

## 术语与历史包袱

| 旧叫法 | 现叫法 | 备注 |
|---|---|---|
| 变强清单 | 书架 | 界面文案已换 |
| 学习之路 | 阅读 | 代码里仍有 `learn` / `plan` 命名 |
| 精读稿 | 导读（实验） | 校验规则仍叫 `notes` / `writeUnit` |
| 大道至简 | 笔记（实验） | `insights` / `concepts` |
| 阶段一 | 旧兼容层（已删） | 目标→裁剪→尝试→判定→结案；新主回路见 DESIGN.md「核心回路」 |

已知的双轨（改之前先确认改哪条）：

1. **进度账已收口**：掌握度只有 `knowledge.json` 一本（答题、申诉、`/quiz/submit` 都只写它；`progress.json` 只留单元 FSRS，其 `concepts` 只在 `seedKnowledgeFromProgress` 一次性迁移时被读）。知识点清单也只有一份——在节上（`units/<uid>/meta.json.concepts`）；目标只有 `steps[].level`，没有概念表，也没有 `passedAt`。判定题、判定卡、归因与卡点的代码已删除；只剩 `plan.attempts` 与 `plan.threshold` 这类旧字段，读旧目标时兼容。新功能一律接 knowledge。
2. **练习单模**：练习只在目标内存在并写进度；目标外/无目标由 `sessionPlanOf` 返回 `blocked`，`start` 直接拒绝并说明原因。旧的 `session.free` 只是历史标记，不再写入、不再续跑。
3. **两条生成**：页面内 job（`generation` + `jobs`，默认）与聊天回退（`goal.ts` 的 `promptSession`，无引擎时）。
4. **三个实验面**：导读、自编书、洞察卡；导航隐藏，不在「今日」出现。

## 硬约束与常见坑

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
