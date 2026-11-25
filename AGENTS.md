# dsh-study-less（书桌）

DSH Web GUI 的书桌插件：把目标翻译成「读哪些节、每个知识点到哪一档」，只记知识点是否真到档位。
主文档是 [README.md](README.md)；产品规范与红线在 [DESIGN.md](DESIGN.md)。

## 目录地图

| 路径 | 职责 |
|---|---|
| `src/core/` | 领域规则与文件仓库：掌握度、FSRS、计划门、结构切分（只依赖 node 内置） |
| `src/host/` | 服务外壳与编排：`service/` `routes/` `tools/` `generation/` `providers/` |
| `src/client/` | React 面板，只读 `/study-api`，从不直接写文件 |
| `src/client/masteryTree.ts` | 知识点树布局：概念去重、跨节共用与折叠后的可见性（纯函数） |
| `scripts/` | 构建与检查：`build.mjs` 与 `checks/{service,http,ui,adhoc}/` |
| `tests/` | node:test 纯逻辑单测 |
| `docs/` | AGENTS 的导航与规则细则（产品与文案已并入 DESIGN） |
| `vendor/` | pdf.js / marked / katex 运行时，勿改 |
| `tooling/` | esbuild 二进制，勿改 |
| `lib/` | 构建产物（git 忽略），勿改 |

## 命令

- 测试：`npm test`（`node --test tests/*.test.ts`；pretest 先跑文档锚点）
- 构建：`npm run build`
- 全量闸门：`npm run check`（build + 11 项检查）
- 文档锚点：`npm run check:docs`
- 类型：`npm run typecheck`（需先 `npm install`，不在 check 内）

## 开工顺序

1. 读目录地图，按 [docs/AGENT-NAV.md](docs/AGENT-NAV.md) 的「改动导航」定位域文件。
2. 只打开那一个文件；host 侧单域文件一般 300–600 行。
3. 只有定位一个具体符号的行号时才 grep，不用全仓搜索代替这一页。

## 红线

- 依赖方向 `core ← host`、`core ← client`；`host` 与 `client` 互不 import。
- `routes/` 与 `tools/` 共用一套 service 方法；领域逻辑不进路由。
- `client` 不碰 `node:fs`；页面与工具改的是同一份 service 状态。
- `/study-api` 仅本机回环 + 同源；新增路由必须走 `routes.ts` 统一入口。
- 不默认批量生成导读/自编书/洞察（三个实验面已冻结，导航隐藏）。
- 不删防自欺规则：证据按「知识点 × 题干」排重、自评不计进度、结案只看知识点到档。
- `lib/`、`vendor/`、`tooling/` 不改；升级另开任务。

## 文档上限

- `AGENTS.md` 120 / `DESIGN.md` 180 / `ARCHITECTURE.md` 120（行；超了先删旧内容再加）
- `npm run check:docs` 读这一节，并按目录地图与模块表校验路径真实存在。

## 文档

| 文件 | 内容 |
|---|---|
| `README.md` | 主文档：功能、主链路、掌握度规则、API、数据布局 |
| `DESIGN.md` | 产品规范；加功能前读「不做什么」 |
| `ARCHITECTURE.md` | 模块边界、契约、失败模式、测试策略 |
| `docs/AGENT-NAV.md` | 改动导航、端点/工具速查、阅读预算、验证矩阵 |
| `docs/AGENT-RULES.md` | 硬约束与历史包袱（双轨、术语） |
