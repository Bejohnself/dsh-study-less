/** 调色板、题签、原语、书架、今日。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const BASE_CSS = `[data-dsh-study] {
  color-scheme: light;

  /* 纸：宣纸底、墨字。骨架是黑白，颜色只在徽标、判定、进度上出现。 */
  --s-bg: #e9e4d8;
  --s-surface: #fbf8f1;
  --s-surface-2: #f4f0e6;
  --s-surface-3: #e8e2d2;
  --s-hover: #efe9db;
  --s-text: #1b1a16;
  --s-muted: #6b6457;
  --s-faint: #7a7262;
  --s-border: #ddd6c5;
  --s-border-strong: #c6bda7;
  --s-primary: #24221c;
  --s-primary-strong: #3a362c;
  --s-primary-soft: #ece6d6;
  --s-primary-ink: #1b1a16;
  --s-on-primary: #f8f4e9;
  --s-success: #4b6b4f;
  --s-success-soft: #e5ebe0;
  --s-warning: #8a6a2f;
  --s-warning-soft: #f3ebd9;
  --s-danger: #a4402f;
  --s-danger-soft: #f4e4de;
  --s-code-bg: #23211b;
  --s-code-fg: #eee7d6;
  --s-ring: rgba(36, 34, 28, 0.34);
  --s-shadow-color: rgba(48, 43, 32, 0.16);
  --s-shadow-sm: 0 1px 0 rgba(48, 43, 32, 0.05), 0 1px 2px rgba(48, 43, 32, 0.05);
  --s-shadow-md: 0 1px 0 rgba(48, 43, 32, 0.06), 0 6px 14px rgba(48, 43, 32, 0.07);
  --s-shadow-lg: 0 2px 4px rgba(48, 43, 32, 0.08), 0 18px 40px rgba(48, 43, 32, 0.12);
  --s-shelf-line: #c3b89f;
  --s-grain: rgba(58, 50, 32, 0.022);
  --s-badge-paper-bg: #ece4d2;
  --s-badge-paper-fg: #6b5a34;
  --s-scrim: rgba(20, 17, 12, 0.5);
  --s-font-ui: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --s-font-display: "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", "Times New Roman", serif;
  --s-reading-font: "Times New Roman", "Nimbus Roman", "Liberation Serif", "Songti SC", "SimSun", "Noto Serif CJK SC", serif;
  --s-math-font: "Latin Modern Math", "STIX Two Math", "Cambria Math", "Times New Roman", serif;

  color: var(--s-text);
  background-color: var(--s-bg);
  /* 纸纹：两组交叉斜线，静态铺底，不是图片资产。 */
  background-image:
    repeating-linear-gradient(45deg, var(--s-grain) 0 1px, transparent 1px 4px),
    repeating-linear-gradient(-45deg, var(--s-grain) 0 1px, transparent 1px 6px);
  font: 13.5px/1.6 var(--s-font-ui);
  height: 100%;
  min-height: 0;
  overflow: auto;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: var(--s-border-strong) transparent;
  -webkit-font-smoothing: antialiased;
}

html[data-dsh-study-theme='dark'] [data-dsh-study] {
  color-scheme: dark;
  /* 墨：暖近黑，字是纸色。 */
  --s-bg: #141310;
  --s-surface: #1f1d17;
  --s-surface-2: #24211a;
  --s-surface-3: #2a2720;
  --s-hover: #2a2820;
  --s-text: #e7e0cf;
  --s-muted: #a29a87;
  --s-faint: #8b8471;
  --s-border: #312e25;
  --s-border-strong: #433f31;
  --s-primary: #e9e2cf;
  --s-primary-strong: #f6f0df;
  --s-primary-soft: #2b2820;
  --s-primary-ink: #efe8d6;
  --s-on-primary: #17150f;
  --s-success: #8fae90;
  --s-success-soft: #1d2620;
  --s-warning: #c9a45c;
  --s-warning-soft: #2a2317;
  --s-danger: #d0765f;
  --s-danger-soft: #2b1c18;
  --s-code-bg: #0f0e0b;
  --s-code-fg: #e7e0cf;
  --s-ring: rgba(233, 226, 207, 0.4);
  --s-shadow-color: rgba(0, 0, 0, 0.6);
  --s-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.45);
  --s-shadow-md: 0 1px 0 rgba(0, 0, 0, 0.5), 0 8px 18px rgba(0, 0, 0, 0.4);
  --s-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.5), 0 20px 44px rgba(0, 0, 0, 0.45);
  --s-shelf-line: #3b372c;
  --s-grain: rgba(255, 244, 214, 0.014);
  --s-badge-paper-bg: #2a2620;
  --s-badge-paper-fg: #c8b184;
  --s-scrim: rgba(0, 0, 0, 0.58);
}

[data-dsh-study] *,
[data-dsh-study] *::before,
[data-dsh-study] *::after { box-sizing: border-box; }

[data-dsh-study] button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  transition: background-color .14s ease, color .14s ease, border-color .14s ease, transform .1s ease, box-shadow .14s ease;
}
[data-dsh-study] button:active { transform: translateY(1px); }
[data-dsh-study] button:focus-visible,
[data-dsh-study] input:focus-visible,
[data-dsh-study] a:focus-visible {
  outline: 2px solid var(--s-ring);
  outline-offset: 2px;
  border-radius: 6px;
}
[data-dsh-study] h1,
[data-dsh-study] h2,
[data-dsh-study] h3 { color: var(--s-text); }
[data-dsh-study] h1 { font-size: 21px; font-weight: 700; margin: 0; letter-spacing: .01em; }
[data-dsh-study] h2 { font-size: 18px; font-weight: 650; margin: 0; line-height: 1.35; }
[data-dsh-study] h3 { font-size: 13px; font-weight: 650; margin: 0; letter-spacing: .03em; }
[data-dsh-study] .study-link { color: var(--s-primary); }
[data-dsh-study] .study-link:hover { text-decoration: underline; }

[data-dsh-study] .study-shell {
  max-width: 1080px;
  margin: 0 auto;
  padding: 32px 34px 72px;
}

/* ---------- header: a 题签, not an app bar ---------- */
[data-dsh-study] .study-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 26px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--s-border);
}
[data-dsh-study] .study-head > h1 {
  order: 1;
  flex: none;
  font-family: var(--s-font-display);
  font-size: 25px;
  font-weight: 600;
  letter-spacing: .16em;
  line-height: 1.25;
  padding-left: .16em; /* 抵消末字多出的字距，视觉上仍然居中 */
}
[data-dsh-study] .study-version { order: 2; }
[data-dsh-study] .study-head-nav { order: 3; margin-left: auto; position: relative; z-index: 1; }
[data-dsh-study] .study-head.is-focus { margin-bottom: 18px; padding-bottom: 12px; }
[data-dsh-study] .study-head.is-reader-hidden { display: none; }
[data-dsh-study] .study-sub {
  order: 4;
  flex: 1 1 100%;
  margin-top: 2px;
  color: var(--s-muted);
  font-size: 12.5px;
  line-height: 1.6;
  max-width: 640px;
}
[data-dsh-study] .study-nav {
  display: inline-flex;
  gap: 4px;
  padding: 0;
  border-radius: 0;
  background: none;
  border: 0;
  box-shadow: none;
}
[data-dsh-study] .study-nav button {
  padding: 7px 4px 8px;
  margin: 0 8px;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: .06em;
  color: var(--s-muted);
  background: none;
}
[data-dsh-study] .study-nav button:hover { background: none; color: var(--s-text); border-bottom-color: var(--s-border-strong); }
[data-dsh-study] .study-nav button.is-on {
  background: none;
  color: var(--s-text);
  border-bottom-color: var(--s-text);
  box-shadow: none;
  font-weight: 600;
}
[data-dsh-study] .study-nav button.is-on:hover { background: none; color: var(--s-text); }

/* ---------- primitives ---------- */
[data-dsh-study] .study-muted { color: var(--s-muted); font-size: 12px; }
[data-dsh-study] .study-warn-text { color: var(--s-warning); font-size: 12px; font-weight: 500; }
[data-dsh-study] .study-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 8px 16px;
  border-radius: 4px;
  background: var(--s-primary);
  color: var(--s-on-primary);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .03em;
  box-shadow: none;
}
[data-dsh-study] .study-primary:hover { background: var(--s-primary-strong); }
[data-dsh-study] .study-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 46px 22px;
  text-align: center;
  color: var(--s-muted);
  background: transparent;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  font-size: 13px;
}
[data-dsh-study] .study-empty p { margin: 0; }
[data-dsh-study] .study-hint {
  font-size: 12.5px;
  line-height: 1.75;
  max-width: 620px;
  color: var(--s-muted);
}
[data-dsh-study] .study-badge {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: .04em;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-badge-paper { background: var(--s-badge-paper-bg); color: var(--s-badge-paper-fg); }
[data-dsh-study] .study-badge-article { background: var(--s-success-soft); color: var(--s-success); }
[data-dsh-study] .study-due-badge {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: .04em;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--s-warning-soft);
  color: var(--s-warning);
}

/* ---------- library shelf: 每本书落在一条搁板上 ---------- */
[data-dsh-study] .study-shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: 28px 20px;
}
[data-dsh-study] .study-book {
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
  padding: 16px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: 0 2px 0 var(--s-shelf-line);
}
[data-dsh-study] .study-book {
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), border-color .22s ease, box-shadow .22s ease;
}
[data-dsh-study] .study-book:hover {
  transform: translateY(-4px);
  border-color: var(--s-border-strong);
  box-shadow: 0 5px 0 var(--s-border-strong), var(--s-shadow-md);
}

/* A shelf card is the material's own first page, edge to edge: the paper is the
   card, the title sits on a scrim at its foot, and a spine strip on the left is
   what keeps a white title page from reading as an empty white box. The board
   under it is a solid 3px line, so the row reads as a shelf, not a card grid. */
[data-dsh-study] .study-cover-slot { position: relative; }
[data-dsh-study] .study-cover-slot .study-cover-card { width: 100%; }
[data-dsh-study] .study-cover-menu-wrap {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 6;
}
[data-dsh-study] .study-cover-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(20, 18, 12, 0.42);
  color: #fff;
  font-size: 15px;
  line-height: 1;
  backdrop-filter: blur(3px);
}
[data-dsh-study] .study-cover-menu-btn:hover { background: rgba(20, 18, 12, 0.62); }
[data-dsh-study] .study-cover-card {
  position: relative;
  display: block;
  padding: 0;
  overflow: hidden;
  text-align: left;
  border: 1px solid var(--s-border);
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 4px 0 var(--s-shelf-line), 0 12px 16px -12px var(--s-shadow-color);
  transition: transform .24s cubic-bezier(.2, .8, .2, 1), border-color .24s ease, box-shadow .24s ease;
  transform-origin: center bottom;
}
[data-dsh-study] .study-cover-card:hover {
  transform: translateY(-3px) scale(1.008);
  border-color: var(--s-border-strong);
  box-shadow: 0 5px 0 var(--s-border-strong), 0 20px 26px -18px var(--s-shadow-color);
  z-index: 3;
}
[data-dsh-study] .study-cover-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 6px;
  background: linear-gradient(90deg, rgba(12, 10, 6, 0.14), rgba(12, 10, 6, 0));
  pointer-events: none;
}
[data-dsh-study] .study-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 10 / 14;
  background: #fff;
}
[data-dsh-study] .study-cover-canvas {
  display: block;
  transition: transform .32s cubic-bezier(.2, .8, .2, 1);
}
[data-dsh-study] .study-cover-card:hover .study-cover-canvas { transform: scale(1.025); }
[data-dsh-study] .study-cover-ghost {
  position: absolute;
  inset: 0;
  background: #fff;
  animation: study-cover-breathe 1.6s ease-in-out infinite alternate;
}
[data-dsh-study] .study-cover-ghost::before,
[data-dsh-study] .study-cover-ghost::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  border-radius: 3px;
}
[data-dsh-study] .study-cover-ghost::before { top: 22px; right: 46%; height: 10px; background: #e6e0d3; }
[data-dsh-study] .study-cover-ghost::after {
  top: 48px;
  height: 34%;
  background: repeating-linear-gradient(180deg, #efeade 0 6px, transparent 6px 16px);
}
@keyframes study-cover-breathe {
  from { opacity: .55; }
  to { opacity: 1; }
}
[data-dsh-study] .study-cover-standin {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 顶部留出徽章的位置，角标不再压在「论文 / 书」上 */
  padding: 34px 14px 96px;
  overflow: hidden;
  color: #1b1a16;
  background: linear-gradient(165deg, #ffffff, #f1ece0);
}
[data-dsh-study] .study-cover-standin-title {
  font-family: var(--s-reading-font);
  font-size: 13px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-dsh-study] .study-cover-badges {
  position: absolute;
  top: 9px;
  right: 9px;
  left: 9px;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  pointer-events: none;
}
[data-dsh-study] .study-cover-badges-left {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
[data-dsh-study] .study-cover-foot {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 96px 12px 12px;
  background: linear-gradient(to top, rgba(14, 12, 8, 0.94), rgba(14, 12, 8, 0.74) 52%, rgba(14, 12, 8, 0));
}
[data-dsh-study] .study-cover-title {
  display: -webkit-box;
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.42;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
[data-dsh-study] .study-cover-meta {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.8);
  font-size: 10.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-dsh-study] .study-cover-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
[data-dsh-study] .study-cover-progress .study-progress { flex: 1; gap: 0; }
[data-dsh-study] .study-cover-progress .study-progress-bar { width: 100%; height: 3px; background: rgba(255, 255, 255, 0.26); }
/* 封面压在墨色渐变上：进度条用纸色，不跟随主题的墨色填充 */
[data-dsh-study] .study-cover-progress .study-progress-bar > span { background: #f8f4e9; }
[data-dsh-study] .study-cover-progress-text { color: rgba(255, 255, 255, 0.82); font-size: 10px; white-space: nowrap; }
/* 暗色下封面仍是纸，只是纸不那么白：纯白四块会刺眼。 */
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-cover-card { background: #efe9dc; border-color: #4a4638; }
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-cover { background: #efe9dc; }
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-cover-ghost { background: #efe9dc; }
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-cover-canvas { filter: brightness(.92); }
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-cover-standin { filter: brightness(.94); }
[data-dsh-study] .study-book-title { font-size: 15.5px; font-weight: 650; line-height: 1.45; }
[data-dsh-study] .study-progress { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
[data-dsh-study] .study-progress-bar {
  display: block;
  height: 5px;
  border-radius: 999px;
  background: var(--s-surface-3);
  overflow: hidden;
}
[data-dsh-study] .study-progress-bar > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--s-primary), var(--s-primary-strong));
}
[data-dsh-study] .study-progress-text { font-size: 11.5px; color: var(--s-muted); }

/* ---------- today ---------- */
[data-dsh-study] .study-today { display: flex; flex-direction: column; gap: 18px; }
[data-dsh-study] .study-today-line { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--s-muted); }
[data-dsh-study] .study-today-fish {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex: none;
  box-shadow: var(--s-shadow-md);
}
[data-dsh-study] .study-today-hi { color: var(--s-text); font-weight: 600; }
[data-dsh-study] .study-today-date {
  font-weight: 650;
  color: var(--s-text);
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 3px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-today-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
  align-items: start;
}
[data-dsh-study] .study-panel {
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  border-radius: 6px;
  padding: 20px;
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-panel h3 {
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--s-border);
  color: var(--s-text);
}
/* The desk's three panels are labels, not section headers: quieter, no rule. */
[data-dsh-study] .study-today .study-panel h3 {
  padding-bottom: 0;
  border-bottom: 0;
  font-size: 12.5px;
  letter-spacing: 0.06em;
  color: var(--s-muted);
}
[data-dsh-study] .study-panel p { margin: 0; font-size: 12.5px; color: var(--s-muted); line-height: 1.7; }
[data-dsh-study] .study-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
[data-dsh-study] .study-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border-radius: 4px;
}
[data-dsh-study] .study-item:hover { background: var(--s-hover); }
[data-dsh-study] .study-item-title { font-size: 13px; line-height: 1.5; color: var(--s-text); }
[data-dsh-study] .study-item-meta { font-size: 11.5px; color: var(--s-muted); }
[data-dsh-study] .study-next-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 16px 18px;
  border-radius: 4px;
  border: 1px solid var(--s-border-strong);
  background: var(--s-primary-soft);
}
[data-dsh-study] .study-next-card:hover { background: color-mix(in srgb, var(--s-primary-soft) 60%, var(--s-hover)); }
[data-dsh-study] .study-next-title { font-size: 14.5px; font-weight: 650; }
[data-dsh-study] .study-next-why { font-size: 12px; color: var(--s-muted); }
[data-dsh-study] .study-plans {
  list-style: none;
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--s-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
[data-dsh-study] .study-plans li { display: flex; flex-direction: column; gap: 1px; }
[data-dsh-study] .study-plan-goal { font-size: 12.5px; font-weight: 600; }
`
