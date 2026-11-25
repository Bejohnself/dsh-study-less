# 知止网页版

不依赖 DSH 的本机网页版：复用插件的服务层与面板，只把宿主换成自己的回环服务。
领域规则、存储、API 都在 `src/`，这里只有进程接线和构建。

## 用

```bash
npm run build:web
npm run start:web          # 默认 http://127.0.0.1:7801
```

- 数据目录：默认 `~/.zhizhi`，用 `STUDY_DATA_ROOT` 覆盖。和插件的 `$DSH_HOME/study` 分开。
- 端口：`PORT`，默认 7801。只监听 `127.0.0.1`。
- 首次打开：设置 → 文本引擎 → 自定义（OpenAI 兼容），填 Base URL、模型和 Key。没有 DSH 模型可借用，所以默认就是自定义引擎。

## 与插件版的差别

- 不注册 agent 工具，也没有系统提示词注入：网页版只提供面板。
- 「重启插件」按钮退化成刷新页面（后端返回 202，前端轮询 `/health` 后重载）。
- 构建产物在 `dist-web/`，与插件的 `lib/` 互不影响。
- 静态资源（katex、pdf.js）随产物复制到 `dist-web/`，因为服务端资源路由按自身模块位置找文件。

## 改共享代码之后

`src/` 是两个入口共用的。改完跑 `npm test`（160 项）和 `npm run check`（构建 + 11 项检查），确认插件没坏；
再 `npm run build` 重建 `lib/`，否则 DSH 里跑的还是旧 bundle。