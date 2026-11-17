/**
 * Study desk design system.
 *
 * Blue-led palette with explicit surfaces: the page owns its background, text
 * and elevation instead of borrowing shell colors as fills, so contrast holds in
 * both themes. The dark palette follows the attribute installed by theme.ts.
 */

let injected = false

export const STUDY_CSS = `
[data-dsh-study] {
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
[data-dsh-study] .study-book:hover {
  border-color: var(--s-border-strong);
  box-shadow: 0 2px 0 var(--s-border-strong), var(--s-shadow-md);
}

/* A shelf card is the material's own first page, edge to edge: the paper is the
   card, the title sits on a scrim at its foot, and a spine strip on the left is
   what keeps a white title page from reading as an empty white box. The board
   under it is a solid 3px line, so the row reads as a shelf, not a card grid. */
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
}
[data-dsh-study] .study-cover-card:hover {
  border-color: var(--s-border-strong);
  box-shadow: 0 4px 0 var(--s-border-strong), 0 16px 22px -12px var(--s-shadow-color);
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
  transition: transform .22s ease;
}
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

/* ---------- material + reader ---------- */
[data-dsh-study] .study-material-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-bottom: 16px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-back {
  flex: none;
  padding: 6px 10px;
  border-radius: 3px;
  font-size: 12.5px;
  color: var(--s-muted);
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-back:hover { color: var(--s-primary); border-color: var(--s-border-strong); background: var(--s-hover); }
[data-dsh-study] .study-reader-title { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
[data-dsh-study] .study-reader-sub { font-size: 12px; color: var(--s-muted); }
[data-dsh-study] .study-next {
  font-size: 12px;
  padding: 7px 13px;
  border-radius: 3px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
  color: var(--s-primary-ink);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-study] .study-next:hover { border-color: var(--s-primary); background: var(--s-primary-soft); }

[data-dsh-study] .study-body {
  display: grid;
  grid-template-columns: 296px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
[data-dsh-study] .study-toc {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: calc(100vh - 220px);
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
  position: sticky;
  top: 12px;
  scrollbar-width: thin;
}
[data-dsh-study] .study-toc-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 8px 9px;
  border-radius: 4px;
}
[data-dsh-study] .study-toc-row:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-toc-row.is-active { background: var(--s-surface-3); }
[data-dsh-study] .study-toc-row.is-active .study-toc-text { font-weight: 650; }
[data-dsh-study] .study-toc-row.is-pass .study-toc-text { font-weight: 650; }
[data-dsh-study] .study-check {
  margin-top: 3px;
  width: 15px;
  height: 15px;
  flex: none;
  accent-color: var(--s-primary);
  cursor: pointer;
}
[data-dsh-study] .study-toc-title { display: flex; flex-direction: column; gap: 1px; text-align: left; min-width: 0; flex: 1; }
[data-dsh-study] .study-toc-text { font-size: 12.8px; line-height: 1.45; color: var(--s-text); }
[data-dsh-study] .study-toc-meta { font-size: 11px; color: var(--s-faint); }
[data-dsh-study] .study-content { min-width: 0; }

[data-dsh-study] .study-reader { display: flex; flex-direction: column; gap: 16px; }
[data-dsh-study] .study-reader-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
[data-dsh-study] .study-chips { display: flex; flex-wrap: wrap; gap: 6px; }
[data-dsh-study] .study-chip {
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--s-primary) 25%, var(--s-border));
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-chip:hover { border-color: var(--s-primary); }

/* ---------- notes typography: 一页纸，不是一张卡 ---------- */
[data-dsh-study] .study-notes {
  font-family: var(--s-reading-font);
  /* 40em ≈ 每行 38 个汉字，读长文的舒服区间，也贴合内容栏 */
  max-width: 40em;
  padding: 40px 46px 46px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  border-radius: 2px;
  box-shadow: 0 1px 0 var(--s-border), 0 20px 40px -34px var(--s-shadow-color);
  color: var(--s-text);
  font-size: 16px;
  line-height: 1.9;
}
[data-dsh-study] .study-notes h1,
[data-dsh-study] .study-notes h2,
[data-dsh-study] .study-notes h3 { margin: 1.6em 0 .6em; line-height: 1.45; font-weight: 600; }
[data-dsh-study] .study-notes h1 { font-size: 23px; letter-spacing: .01em; }
[data-dsh-study] .study-notes h2 {
  font-size: 18px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--s-border);
  color: var(--s-text);
}
[data-dsh-study] .study-notes h3 { font-size: 15.5px; color: var(--s-text); }
[data-dsh-study] .study-notes > :first-child { margin-top: 0; }
[data-dsh-study] .study-notes p { margin: .8em 0; }
[data-dsh-study] .study-notes ul,
[data-dsh-study] .study-notes ol { padding-left: 1.5em; margin: .8em 0; }
[data-dsh-study] .study-notes li { margin: .35em 0; }
[data-dsh-study] .study-notes strong { font-weight: 700; color: var(--s-text); }
[data-dsh-study] .study-notes blockquote {
  margin: 1.1em 0;
  padding: .2em 0 .2em 1.2em;
  border: 0;
  color: var(--s-muted);
  background: none;
  border-radius: 0;
}
[data-dsh-study] .study-notes code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  padding: .1em .34em;
  border-radius: 2px;
  background: var(--s-surface-3);
  color: var(--s-text);
}
/* 代码块在纸上是一方印章：深墨底、纸色字 */
[data-dsh-study] .study-notes pre {
  padding: 14px 16px;
  border-radius: 2px;
  overflow: auto;
  background: var(--s-code-bg);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-notes pre code { padding: 0; background: none; color: var(--s-code-fg); font-size: 12.5px; line-height: 1.75; }
[data-dsh-study] .study-notes table { border-collapse: collapse; margin: 1em 0; font-size: 14px; width: 100%; }
[data-dsh-study] .study-notes th,
[data-dsh-study] .study-notes td { border: 0; border-bottom: 1px solid var(--s-border); padding: 8px 12px 8px 0; text-align: left; }
[data-dsh-study] .study-notes th { border-bottom-color: var(--s-border-strong); font-weight: 600; }
[data-dsh-study] .study-notes a { color: inherit; text-decoration: underline; text-underline-offset: .18em; text-decoration-color: var(--s-border-strong); }
[data-dsh-study] .study-notes a:hover { text-decoration-color: var(--s-text); }
[data-dsh-study] .study-notes img { max-width: 100%; border-radius: 2px; }
[data-dsh-study] .study-notes hr { border: 0; border-top: 1px solid var(--s-border); margin: 2em 0; }
[data-dsh-study] .study-notes .katex { display: inline-block; max-width: 100%; }
[data-dsh-study] .study-display-math {
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
  margin: 1.05em 0;
  padding: 2px 0 7px;
  overflow-x: auto;
  overflow-y: visible;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}
[data-dsh-study] .study-display-math::-webkit-scrollbar { height: 7px; }
[data-dsh-study] .study-display-math::-webkit-scrollbar-thumb { background: var(--s-border-strong); border-radius: 99px; }
[data-dsh-study] .study-display-math::-webkit-scrollbar-track { background: transparent; }
[data-dsh-study] .study-display-math .katex { display: block; flex: 0 0 auto; max-width: none; overflow: visible; margin: 0 auto; }
[data-dsh-study] .study-display-math math { display: block; overflow: visible; }
[data-dsh-study] .study-notes math,
[data-dsh-study] .study-notes math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-notes math { font-size: 1.08em; }
[data-dsh-study] .study-notes math[display="block"] {
  display: block;
  margin: 0;
}
[data-dsh-study] .study-notes .katex-display { overflow-x: auto; }

/* ---------- concepts ---------- */
[data-dsh-study] .study-concepts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(252px, 1fr));
  gap: 14px;
}
[data-dsh-study] .study-concept-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  padding: 16px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-concept-card:hover {
  border-color: var(--s-border-strong);
  box-shadow: var(--s-shadow-md);
}
[data-dsh-study] .study-concept-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
[data-dsh-study] .study-concept-name { font-size: 14px; font-weight: 650; }
[data-dsh-study] .study-mastery { display: flex; align-items: center; gap: 8px; }
[data-dsh-study] .study-mastery-bar {
  flex: 1;
  height: 5px;
  border-radius: 999px;
  background: var(--s-surface-3);
  overflow: hidden;
}
[data-dsh-study] .study-mastery-bar > span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--s-primary), var(--s-primary-strong));
}
[data-dsh-study] .study-concept-detail { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-definition {
  margin: 0;
  padding: 16px 18px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-primary-soft);
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--s-text);
}
[data-dsh-study] .study-section-title { margin: 6px 0 0; font-size: 13px; font-weight: 650; color: var(--s-primary-ink); }
[data-dsh-study] .study-role {
  font-size: 10px;
  font-weight: 550;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
  vertical-align: 1px;
}

/* ---------- plans ---------- */
[data-dsh-study] .study-plans-page { display: flex; flex-direction: column; gap: 12px; max-width: 780px; }
[data-dsh-study] .study-plan-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  padding: 16px 18px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-plan-card:hover {
  border-color: var(--s-border-strong);
  box-shadow: var(--s-shadow-md);
}
[data-dsh-study] .study-plan-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
[data-dsh-study] .study-status-pill {
  font-size: 10.5px;
  font-weight: 550;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--s-border);
  color: var(--s-muted);
  background: var(--s-surface-2);
}
[data-dsh-study] .study-status-active { color: var(--s-success); border-color: color-mix(in srgb, var(--s-success) 40%, var(--s-border)); background: var(--s-success-soft); }
[data-dsh-study] .study-status-done { color: var(--s-primary-ink); border-color: color-mix(in srgb, var(--s-primary) 40%, var(--s-border)); background: var(--s-primary-soft); }
[data-dsh-study] .study-plan-detail { display: flex; flex-direction: column; gap: 16px; }
[data-dsh-study] .study-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
[data-dsh-study] .study-step {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-step.is-done { opacity: .66; }
[data-dsh-study] .study-step-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
[data-dsh-study] .study-step-title { display: flex; align-items: baseline; gap: 8px; font-size: 13.5px; flex-wrap: wrap; }
[data-dsh-study] .study-step-kind {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 5px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
  flex: none;
}

/* ---------- toast ---------- */
[data-dsh-study] .study-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 40;
  max-width: min(680px, calc(100vw - 48px));
  padding: 11px 18px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--s-text);
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-lg);
}
[data-dsh-study] .study-toast-ok { border-color: color-mix(in srgb, var(--s-success) 45%, var(--s-border)); }
[data-dsh-study] .study-toast-error { border-color: color-mix(in srgb, var(--s-danger) 45%, var(--s-border)); }


/* ---------- header actions + dialogs ---------- */
[data-dsh-study] .study-head-actions { display: inline-flex; gap: 8px; align-items: center; margin-left: 10px; }
[data-dsh-study] .study-theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  color: var(--s-muted);
  background: transparent;
}
[data-dsh-study] .study-theme-toggle:hover { color: var(--s-text); border-color: var(--s-border-strong); background: var(--s-surface-2); }
[data-dsh-study] .study-theme-toggle:focus-visible { outline: 2px solid var(--s-ring); outline-offset: 2px; }
[data-dsh-study] .study-ghost {
  padding: 7px 13px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: transparent;
  color: var(--s-text);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .02em;
  box-shadow: none;
}
[data-dsh-study] .study-ghost:hover { border-color: var(--s-border-strong); background: var(--s-surface-2); }
[data-dsh-study] .study-primary-tight { margin-top: 0; padding: 8px 15px; font-size: 12.5px; }
[data-dsh-study] .study-scrim {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--s-scrim);
  backdrop-filter: blur(2px);
}
[data-dsh-study] .study-modal {
  width: min(660px, 100%);
  max-height: 86vh;
  overflow: auto;
  padding: 22px 24px 20px;
  border-radius: 6px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  box-shadow: var(--s-shadow-lg);
  color: var(--s-text);
}
[data-dsh-study] .study-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
/* 弹窗标题与阅读标题走衬线，和题签一套 */
[data-dsh-study] .study-modal-head h2,
[data-dsh-study] .study-reader-title h2 { font-family: var(--s-font-display); font-weight: 600; letter-spacing: .02em; }
[data-dsh-study] .study-modal-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--s-muted); line-height: 1.6; }
[data-dsh-study] .study-modal-close {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  color: var(--s-muted);
  font-size: 18px;
  line-height: 1;
  background: var(--s-surface-2);
}
[data-dsh-study] .study-modal-close:hover { color: var(--s-text); border-color: var(--s-border-strong); }
[data-dsh-study] .study-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; flex: 1; min-width: 0; }
[data-dsh-study] .study-field-label { font-size: 12px; font-weight: 600; color: var(--s-muted); }
[data-dsh-study] .study-input {
  width: 100%;
  padding: 9px 11px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
  color: var(--s-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
[data-dsh-study] .study-input:focus { border-color: var(--s-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--s-primary) 18%, transparent); }
[data-dsh-study] .study-input:disabled { opacity: .6; }
[data-dsh-study] .study-textarea { min-height: 76px; resize: vertical; line-height: 1.65; }
[data-dsh-study] .study-textarea-tall { min-height: 190px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
[data-dsh-study] .study-file {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 22px;
  border-radius: 4px;
  border: 1px dashed var(--s-border-strong);
  background: var(--s-surface-2);
  color: var(--s-primary-ink);
  font-size: 13px;
  cursor: pointer;
}
[data-dsh-study] .study-file:hover { border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-file input { display: none; }
[data-dsh-study] .study-file.is-busy { cursor: progress; opacity: .75; }
[data-dsh-study] .study-inline { display: flex; gap: 8px; align-items: stretch; }
/* 输入占满剩余宽度，按钮按内容宽度，别把「确定」挤成两行 */
[data-dsh-study] .study-inline > .study-input,
[data-dsh-study] .study-inline > .study-select { flex: 1 1 auto; width: auto; min-width: 0; }
[data-dsh-study] .study-inline > button { flex: none; white-space: nowrap; }
[data-dsh-study] .study-row { display: flex; gap: 12px; flex-wrap: wrap; }
[data-dsh-study] .study-form-error { margin: 4px 0 0; color: var(--s-danger); font-size: 12.5px; }
[data-dsh-study] .study-modal-note { margin: 12px 0 0; font-size: 12px; color: var(--s-muted); line-height: 1.65; }
[data-dsh-study] .study-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
[data-dsh-study] .study-pick-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; padding: 2px; }
[data-dsh-study] .study-pick {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  cursor: pointer;
  background: var(--s-surface);
}
[data-dsh-study] .study-pick:hover { border-color: var(--s-border-strong); background: var(--s-surface-2); }
[data-dsh-study] .study-pick.is-on { border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-pick-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
[data-dsh-study] .study-pick-title { font-size: 13px; font-weight: 550; }
[data-dsh-study] .study-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--s-primary) 28%, var(--s-border));
  background: var(--s-primary-soft);
  font-size: 12.5px;
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-fallback { margin-top: 6px; }

/* ---------- 0.2: sub navigation, dashboards, insights, jobs ---------- */
[data-dsh-study] .study-modal-wide { width: min(820px, 100%); }
[data-dsh-study] .study-subnav {
  display: inline-flex;
  gap: 4px;
  padding: 0;
  border-radius: 0;
  background: none;
  border: 0;
  border-bottom: 1px solid var(--s-border);
}
[data-dsh-study] .study-subnav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 7px;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--s-muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: .04em;
}
[data-dsh-study] .study-subnav button:hover { background: none; color: var(--s-text); }
[data-dsh-study] .study-subnav button.is-on {
  background: none;
  color: var(--s-text);
  border-bottom-color: var(--s-text);
  box-shadow: none;
  font-weight: 600;
}
[data-dsh-study] .study-subnav-count {
  font-size: 10.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-learn-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
[data-dsh-study] .study-library-tools { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
[data-dsh-study] .study-library-tools .study-input { width: auto; min-width: 200px; flex: 1 1 220px; }
[data-dsh-study] .study-select { width: auto; min-width: 120px; }
[data-dsh-study] .study-inline-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--s-muted); cursor: pointer; }
[data-dsh-study] .study-today-spacer { flex: 1; }
[data-dsh-study] .study-pinned-insight {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  margin-top: 18px;
  padding: 15px 18px;
  text-align: left;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--s-primary) 30%, var(--s-border));
  background: linear-gradient(135deg, var(--s-primary-soft), var(--s-surface));
}
[data-dsh-study] .study-pinned-insight:hover { border-color: var(--s-primary); }
[data-dsh-study] .study-insight-page { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-insight-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
[data-dsh-study] .study-insight-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 15px 16px;
  text-align: left;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-insight-card:hover { border-color: var(--s-border-strong); box-shadow: var(--s-shadow-md); }
[data-dsh-study] .study-insight-card.is-pinned { border-color: color-mix(in srgb, var(--s-primary) 35%, var(--s-border)); }
[data-dsh-study] .study-insight-card-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
[data-dsh-study] .study-insight-kind {
  align-self: flex-start;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: .04em;
  padding: 1px 7px;
  border-radius: 5px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-insight-title { font-size: 14px; font-weight: 650; color: var(--s-text); }
[data-dsh-study] .study-insight-line { font-size: 12.5px; color: var(--s-muted); line-height: 1.6; }
[data-dsh-study] .study-insight-meta { font-size: 11.5px; color: var(--s-faint); }
[data-dsh-study] .study-insight-one-liner {
  margin: 6px 0 16px;
  padding: 12px 15px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
  font-size: 14px;
  line-height: 1.7;
}
[data-dsh-study] .study-insight-detail .study-notes { margin-top: 14px; }
[data-dsh-study] .study-quote { font-size: 12px; color: var(--s-faint); font-style: italic; }
[data-dsh-study] .study-badge-pin { background: var(--s-primary-soft); color: var(--s-primary-ink); }
[data-dsh-study] .study-badge-ai { background: var(--s-surface-3); color: var(--s-muted); }
[data-dsh-study] .study-badge-archive { background: var(--s-warning-soft); color: var(--s-warning); }
[data-dsh-study] .study-plans-footer { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
[data-dsh-study] .study-plan-row { display: flex; flex-direction: column; gap: 1px; text-align: left; width: 100%; padding: 7px 8px; border-radius: 3px; }
[data-dsh-study] .study-plan-row:hover { background: var(--s-hover); }
[data-dsh-study] .study-job {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 10px 0;
  padding: 11px 14px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
}
[data-dsh-study] .study-job-ok { border-color: color-mix(in srgb, var(--s-success) 40%, var(--s-border)); }
[data-dsh-study] .study-job-error { border-color: color-mix(in srgb, var(--s-danger) 40%, var(--s-border)); }
[data-dsh-study] .study-job-head { display: flex; align-items: center; gap: 9px; font-size: 12.5px; flex-wrap: wrap; }
[data-dsh-study] .study-job-status { font-weight: 650; color: var(--s-primary-ink); }
[data-dsh-study] .study-job-issues { margin: 2px 0 0; padding-left: 18px; font-size: 12px; color: var(--s-danger); line-height: 1.6; }
[data-dsh-study] .study-reader-actions { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-quiz-start { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--s-border); border-radius: 4px; background: var(--s-surface); }
[data-dsh-study] .study-quiz-runner { display: flex; flex-direction: column; gap: 12px; }
[data-dsh-study] .study-quiz-progress { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; }
[data-dsh-study] .study-quiz-progress-num { color: var(--s-faint); font-size: 11.5px; }
[data-dsh-study] .study-quiz-question { margin: 8px 0 10px; font-family: var(--s-reading-font); font-size: 15px; font-weight: 500; line-height: 1.8; }
[data-dsh-study] .study-quiz-question p { margin: .5em 0; }
[data-dsh-study] .study-quiz-question math,
[data-dsh-study] .study-quiz-question math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-quiz-feedback { display: flex; flex-direction: column; gap: 9px; padding: 14px 16px; border-radius: 4px; background: var(--s-surface-2); border: 1px solid var(--s-border); }
[data-dsh-study] .study-quiz-verdict { font-weight: 650; color: var(--s-primary-ink); }
[data-dsh-study] .study-quiz-rubric ul { margin: 5px 0 0; padding-left: 20px; }
[data-dsh-study] .study-quiz-rubric-item,
[data-dsh-study] .study-quiz-explanation { font-family: var(--s-reading-font); font-size: 13.5px; line-height: 1.75; margin: .3em 0; }
[data-dsh-study] .study-quiz-rubric-item p,
[data-dsh-study] .study-quiz-explanation p { margin: .3em 0; }
[data-dsh-study] .study-quiz-rubric math,
[data-dsh-study] .study-quiz-rubric math *,
[data-dsh-study] .study-quiz-explanation math,
[data-dsh-study] .study-quiz-explanation math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-quiz-selfgrade { display: flex; gap: 8px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz-summary { display: flex; flex-direction: column; gap: 10px; padding: 18px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); }
[data-dsh-study] .study-quiz-summary h3 { margin: 0; }
[data-dsh-study] .study-quiz-item {
  padding: 15px 16px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
}
[data-dsh-study] .study-quiz-item.is-correct { border-color: color-mix(in srgb, var(--s-success) 45%, var(--s-border)); }
[data-dsh-study] .study-quiz-item.is-wrong { border-color: color-mix(in srgb, var(--s-danger) 45%, var(--s-border)); }
[data-dsh-study] .study-quiz-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--s-muted); }
[data-dsh-study] .study-quiz-index { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; background: var(--s-primary-soft); color: var(--s-primary-ink); font-weight: 650; }
[data-dsh-study] .study-quiz-type { text-transform: uppercase; letter-spacing: .05em; font-size: 10.5px; }
[data-dsh-study] .study-quiz-choices { display: flex; flex-direction: column; gap: 6px; }
[data-dsh-study] .study-quiz-choice { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 3px; border: 1px solid var(--s-border); cursor: pointer; font-family: var(--s-reading-font); font-size: 13.5px; line-height: 1.7; }
[data-dsh-study] .study-quiz-choice p { margin: 0; }
[data-dsh-study] .study-quiz-choice math,
[data-dsh-study] .study-quiz-choice math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-quiz-choice:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-quiz-score { padding: 12px 14px; border-radius: 4px; background: var(--s-success-soft); color: var(--s-success); font-weight: 600; }
[data-dsh-study] .study-practice { display: flex; flex-direction: column; gap: 18px; max-width: 880px; margin: 0 auto; padding: 4px 0 40px; }
[data-dsh-study] .study-practice-head { display: flex; align-items: flex-start; gap: 12px; }
[data-dsh-study] .study-practice-title { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
[data-dsh-study] .study-practice-title h2 { margin: 0; font-size: 19px; }
[data-dsh-study] .study-practice-body { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-quiz-resume { margin: 0; padding: 10px 13px; border-radius: 4px; background: var(--s-primary-soft); color: var(--s-primary-ink); font-size: 12.5px; }
[data-dsh-study] .study-quiz-verdict.is-correct { color: var(--s-success); }
[data-dsh-study] .study-quiz-verdict.is-wrong { color: var(--s-danger); }
[data-dsh-study] .study-quiz-history { display: flex; flex-direction: column; gap: 9px; padding: 14px 16px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); }
[data-dsh-study] .study-quiz-history > summary { cursor: pointer; font-size: 13px; font-weight: 650; color: var(--s-primary-ink); }
[data-dsh-study] .study-quiz-history h3 { margin: 0; font-size: 14px; }
[data-dsh-study] .study-quiz-history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
[data-dsh-study] .study-quiz-history-row { padding: 11px 12px; border-radius: 4px; background: var(--s-surface-2); border: 1px solid var(--s-border); }
[data-dsh-study] .study-quiz-history-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--s-muted); }
[data-dsh-study] .study-quiz-history-row .study-quiz-question { margin: 7px 0 6px; font-size: 14px; }
[data-dsh-study] .study-quiz-history-answer,
[data-dsh-study] .study-quiz-history-expected { margin: 4px 0; font-size: 13px; line-height: 1.7; font-family: var(--s-reading-font); }
[data-dsh-study] .study-quiz-past { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface-2); }
[data-dsh-study] .study-quiz-past-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
[data-dsh-study] .study-quiz-past-head h3 { margin: 0; font-size: 14px; }
[data-dsh-study] .study-quiz-recent { display: flex; flex-direction: column; gap: 8px; }
[data-dsh-study] .study-quiz-recent h3 { margin: 0; font-size: 14px; }
[data-dsh-study] .study-quiz-recent-list { display: flex; flex-direction: column; gap: 5px; }
[data-dsh-study] .study-quiz-recent-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 3px; border: 1px solid var(--s-border); background: var(--s-surface); font-size: 12.5px; color: var(--s-text); text-align: left; }
[data-dsh-study] .study-quiz-recent-row:hover { background: var(--s-hover); }
[data-dsh-study] .study-quiz-recent-row .study-muted { margin-left: auto; }
[data-dsh-study] .study-extras { display: flex; flex-direction: column; gap: 16px; }
[data-dsh-study] .study-extra { margin: 0; padding: 12px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); }
[data-dsh-study] .study-extra img, [data-dsh-study] .study-extra video { max-width: 100%; border-radius: 3px; display: block; }
[data-dsh-study] .study-extra figcaption { margin-top: 7px; font-size: 11.5px; color: var(--s-faint); }
[data-dsh-study] .study-anim { width: 100%; min-height: 320px; border: 0; border-radius: 3px; background: var(--s-surface-2); }
[data-dsh-study] .study-settings { display: flex; flex-direction: column; gap: 20px; }
[data-dsh-study] .study-settings-section { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--s-border); }
[data-dsh-study] .study-settings-section:last-of-type { border-bottom: 0; }
[data-dsh-study] .study-settings-section h3 { margin: 0; }
[data-dsh-study] .study-settings-toggles { display: flex; flex-direction: column; gap: 8px; }
[data-dsh-study] .study-segmented {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  overflow: hidden;
}
[data-dsh-study] .study-segmented button {
  padding: 6px 14px;
  border-radius: 0;
  border-right: 1px solid var(--s-border);
  font-size: 12px;
  letter-spacing: .03em;
  color: var(--s-muted);
}
[data-dsh-study] .study-segmented button:last-child { border-right: 0; }
[data-dsh-study] .study-segmented button:hover { background: var(--s-surface-2); color: var(--s-text); }
[data-dsh-study] .study-segmented button.is-on { background: var(--s-primary); color: var(--s-on-primary); box-shadow: none; }
[data-dsh-study] .study-segmented button.is-on:hover { background: var(--s-primary); color: var(--s-on-primary); }
[data-dsh-study] .study-engine-card { display: flex; flex-direction: column; gap: 9px; padding: 12px 14px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface-2); }
[data-dsh-study] .study-chip-static { cursor: default; }
[data-dsh-study] .study-chip-hint { margin-left: 5px; font-size: 10.5px; color: var(--s-faint); }
[data-dsh-study] .study-formula { margin: 10px 0; padding: 12px 14px; border-radius: 4px; background: var(--s-surface-2); border: 1px solid var(--s-border); overflow-x: auto; }
[data-dsh-study] .study-notes-formula { padding: 0; background: none; border: 0; }
[data-dsh-study] .study-review { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-review-card { padding: 20px 22px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); box-shadow: var(--s-shadow-sm); }
[data-dsh-study] .study-review-card h3 { font-size: 17px; margin: 0 0 3px; }
[data-dsh-study] .study-review-prompt { margin: 14px 0 10px; font-size: 13.5px; color: var(--s-text); }
[data-dsh-study] .study-review-notes { margin: 10px 0 14px; padding: 13px 15px; border-radius: 4px; background: var(--s-surface-2); border: 1px solid var(--s-border); font-size: 13px; line-height: 1.7; color: var(--s-muted); }
[data-dsh-study] .study-review-ratings { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
[data-dsh-study] .study-rating { padding: 10px 8px; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); font-size: 12.5px; font-weight: 600; color: var(--s-muted); }
[data-dsh-study] .study-rating:hover { border-color: var(--s-primary); color: var(--s-primary-ink); background: var(--s-primary-soft); }
[data-dsh-study] .study-rating-1:hover { border-color: var(--s-danger); color: var(--s-danger); background: var(--s-danger-soft); }
[data-dsh-study] .study-rating-4:hover { border-color: var(--s-success); color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-due-list { display: flex; flex-direction: column; gap: 5px; }
[data-dsh-study] .study-due-row { display: flex; flex-direction: column; gap: 1px; text-align: left; padding: 8px 10px; border-radius: 3px; font-size: 13px; }
[data-dsh-study] .study-due-row:hover { background: var(--s-hover); }
[data-dsh-study] .study-step-actions { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
[data-dsh-study] .study-danger-text { color: var(--s-danger); }
[data-dsh-study] .study-danger-text:hover { border-color: var(--s-danger); background: var(--s-danger-soft); }

/* ---------- generated book ---------- */
[data-dsh-study] .study-book-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0 18px;
  padding: 16px 18px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--s-primary) 28%, var(--s-border));
  background: linear-gradient(135deg, var(--s-primary-soft), var(--s-surface));
}
[data-dsh-study] .study-book-card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-dsh-study] .study-book-shelf { margin-bottom: 18px; }
[data-dsh-study] .study-book-shelf h3 { margin: 0 0 8px; }
[data-dsh-study] .study-book-shelf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
[data-dsh-study] .study-book-mini { display: flex; align-items: center; gap: 12px; padding: 10px 12px; text-align: left; border-radius: 4px; border: 1px solid var(--s-border); background: var(--s-surface); }
[data-dsh-study] .study-book-mini:hover { border-color: var(--s-primary); background: var(--s-surface-2); }
[data-dsh-study] .study-book-mini-cover {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 58px;
  overflow: hidden;
  border-radius: 3px;
  border: 1px solid rgba(12, 10, 6, 0.1);
  background: linear-gradient(160deg, #ffffff, #f1ece0);
  box-shadow: 0 1px 2px rgba(12, 10, 6, 0.08), 0 6px 12px rgba(12, 10, 6, 0.06);
  color: #1b1a16;
  font-family: var(--s-reading-font);
  font-size: 15px;
  line-height: 1;
}
[data-dsh-study] .study-book-mini-cover::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, var(--s-primary), var(--s-primary-strong));
}
[data-dsh-study] .study-book-mini-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-dsh-study] .study-book-mini .study-book-title { font-size: 13.5px; }
[data-dsh-study] .study-book-cover {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 4px 0 18px;
  padding: 22px 24px;
  border-radius: 6px;
  border: 1px solid var(--s-border);
  background: linear-gradient(140deg, var(--s-surface), var(--s-primary-soft));
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-book-goal { margin: 0; font-family: var(--s-reading-font); font-size: 17px; line-height: 1.7; color: var(--s-text); }
[data-dsh-study] .study-book-cover-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
[data-dsh-study] .study-book-toc { display: flex; flex-direction: column; gap: 18px; }
[data-dsh-study] .study-book-part h3 { margin: 0 0 8px; font-size: 14px; color: var(--s-primary-ink); }
[data-dsh-study] .study-book-chapter {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  margin-bottom: 7px;
}
[data-dsh-study] .study-book-chapter.is-read { border-color: color-mix(in srgb, var(--s-success) 35%, var(--s-border)); }
[data-dsh-study] .study-book-chapter-main { display: flex; flex-direction: column; gap: 2px; text-align: left; flex: 1; min-width: 0; }
[data-dsh-study] .study-book-chapter-title { font-family: var(--s-reading-font); font-size: 14.5px; font-weight: 600; }
[data-dsh-study] .study-book-chapter-summary { font-size: 12.5px; color: var(--s-muted); line-height: 1.65; }
[data-dsh-study] .study-book-content {
  font-family: var(--s-reading-font);
  max-width: 78ch;
  padding: 30px 34px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  border-radius: 4px;
  box-shadow: var(--s-shadow-sm);
  font-size: 15.5px;
  line-height: 1.95;
}
[data-dsh-study] .study-book-content h1,
[data-dsh-study] .study-book-content h2,
[data-dsh-study] .study-book-content h3 { font-family: var(--s-reading-font); line-height: 1.4; margin: 1.5em 0 .6em; }
[data-dsh-study] .study-book-content h2 { font-size: 19px; color: var(--s-primary-ink); border-bottom: 1px solid var(--s-border); padding-bottom: 6px; }
[data-dsh-study] .study-book-content p { margin: .8em 0; }
[data-dsh-study] .study-book-content blockquote { margin: 1em 0; padding: .2em 0 .2em 1.2em; color: var(--s-muted); }
[data-dsh-study] .study-book-content math,
[data-dsh-study] .study-book-content math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-book-content math { font-size: 1.08em; }
[data-dsh-study] .study-book-content math[display="block"] { display: block; margin: 1em 0; text-align: center; }
[data-dsh-study] .study-book-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 18px; }
[data-dsh-study] .study-book-body { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 24px; align-items: start; }
[data-dsh-study] .study-book-side { position: sticky; top: 16px; max-height: calc(100vh - 120px); overflow: auto; padding: 14px 12px; border: 1px solid var(--s-border); border-radius: 4px; background: var(--s-surface-2); }
[data-dsh-study] .study-book-side-head { font-size: 11px; font-weight: 650; letter-spacing: .06em; color: var(--s-faint); padding: 0 6px 8px; }
[data-dsh-study] .study-book-side-part { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
[data-dsh-study] .study-book-side-part-title { font-size: 11.5px; font-weight: 600; color: var(--s-muted); padding: 4px 6px; }
[data-dsh-study] .study-book-side-link { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 7px; border-radius: 3px; text-align: left; font-size: 12px; line-height: 1.45; color: var(--s-muted); }
[data-dsh-study] .study-book-side-link:hover { background: var(--s-hover); color: var(--s-text); }
[data-dsh-study] .study-book-side-link.is-current { background: var(--s-primary-soft); color: var(--s-primary-ink); font-weight: 600; }
[data-dsh-study] .study-book-side-dot { font-size: 10px; color: var(--s-faint); }
[data-dsh-study] .study-book-main { min-width: 0; }
[data-dsh-study] .study-book-main .study-book-content { width: 100%; max-width: none; }
[data-dsh-study] .study-book.is-focus { position: fixed; inset: 0; z-index: 80; overflow: auto; padding: 0 30px 56px; background: var(--s-bg); }
[data-dsh-study] .study-book.is-focus .study-material-head { position: sticky; top: 0; z-index: 2; padding: 14px 0; margin-bottom: 8px; background: var(--s-bg); }
[data-dsh-study] .study-book.is-focus .study-book-body { grid-template-columns: minmax(0, 1fr); }
[data-dsh-study] .study-book.is-focus .study-book-side { display: none; }
[data-dsh-study] .study-book.is-focus .study-book-content { max-width: 1100px; margin: 0 auto; }
@media (max-width: 900px) {
  [data-dsh-study] .study-book-body { grid-template-columns: 1fr; }
  [data-dsh-study] .study-book-side { position: static; max-height: 260px; }
  [data-dsh-study] .study-book.is-focus { padding: 0 14px 40px; }
}

/* Question generator toolbar and manual fallback. */
[data-dsh-study] .study-question-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
[data-dsh-study] .study-question-why { color: var(--s-faint); font-size: 12px; }
[data-dsh-study] .study-question-manual { margin-top: 12px; }
[data-dsh-study] .study-question-manual > summary { cursor: pointer; font-size: 13px; margin-bottom: 8px; }

/* Judgement questions: verdict chips and the answer box. */
[data-dsh-study] .study-question { flex-direction: column; align-items: stretch; gap: 8px; }
[data-dsh-study] .study-question-head { display: flex; align-items: center; gap: 10px; }
[data-dsh-study] .study-question-head .study-question-text { flex: 1; min-width: 0; }
[data-dsh-study] .study-verdict {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--s-border);
  color: var(--s-muted);
  white-space: nowrap;
}
[data-dsh-study] .study-verdict.is-pass { color: var(--s-success); border-color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-verdict.is-partial { color: var(--s-warning); border-color: var(--s-warning); background: var(--s-warning-soft); }
[data-dsh-study] .study-verdict.is-fail { color: var(--s-danger); border-color: var(--s-danger); background: var(--s-danger-soft); }
[data-dsh-study] .study-verdict.is-self { color: var(--s-primary-ink); border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-question-feedback {
  font-size: 13px;
  color: var(--s-muted);
  padding: 6px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
[data-dsh-study] .study-question-feedback ul { margin: 0; padding-left: 18px; }
[data-dsh-study] .study-answer { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
[data-dsh-study] .study-answer .study-textarea { min-height: 130px; }
[data-dsh-study] .study-answer .study-inline .study-input { flex: 1; min-width: 200px; }

/* Original PDF surface: the browser viewer does the rendering. */
[data-dsh-study] .study-pdf { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
[data-dsh-study] .study-ghost-tight { padding: 4px 10px; font-size: 12px; }
/* Canvas viewer: the original page is drawn by pdf.js, so it renders even where
   the browser has no built-in PDF viewer. */
[data-dsh-study] .study-pdf-canvas {
  margin: 0 auto;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.38);
}
/* Goal context above the reading surface. */
[data-dsh-study] .study-goal-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface-2);
}
[data-dsh-study] .study-goal-strip-label {
  font-size: 11px;
  color: var(--s-muted);
  border: 1px solid var(--s-border);
  border-radius: 999px;
  padding: 1px 8px;
}
[data-dsh-study] .study-goal-strip-goal { font-weight: 600; }

/* Goal, crop list, attempts and the closure gate (docs/POSITIONING.md). */
[data-dsh-study] .study-goal-card,
[data-dsh-study] .study-boundary,
[data-dsh-study] .study-attempts,
[data-dsh-study] .study-gate {
  margin: 18px 0;
  padding: 18px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
}
[data-dsh-study] .study-version {
  align-self: center;
  font-size: 10.5px;
  letter-spacing: .04em;
  color: var(--s-faint);
  border: 1px solid var(--s-border);
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
}
[data-dsh-study] .study-version.is-stale { color: var(--s-warning); border-color: var(--s-warning); background: var(--s-warning-soft); }
[data-dsh-study] .study-panel-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 12px; }
[data-dsh-study] .study-goal-card .study-row .study-field:first-child { flex: 2 1 320px; }
[data-dsh-study] .study-goal-card .study-row .study-field:nth-child(2) { flex: 1 1 160px; }
[data-dsh-study] .study-panel-head h3 { margin: 0; font-size: 15px; }
[data-dsh-study] .study-boundary-group { margin-top: 14px; }
[data-dsh-study] .study-boundary-group-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
[data-dsh-study] .study-coverage-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--s-border);
  color: var(--s-muted);
  background: var(--s-surface-2);
}
[data-dsh-study] .study-coverage-pill.is-read { color: var(--s-primary-ink); border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-coverage-pill.is-skim { color: var(--s-warning); border-color: var(--s-warning); background: var(--s-warning-soft); }
[data-dsh-study] .study-coverage-pill.is-skip { color: var(--s-faint); }
[data-dsh-study] .study-boundary-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--s-border);
}
[data-dsh-study] .study-boundary-row.is-skip .study-step-body { opacity: 0.62; }
[data-dsh-study] .study-skip-mark { font-size: 12px; color: var(--s-faint); padding-top: 3px; }
[data-dsh-study] .study-skip-reason { margin-top: 4px; font-size: 12px; color: var(--s-muted); font-style: italic; }
[data-dsh-study] .study-coverage { display: inline-flex; border: 1px solid var(--s-border); border-radius: 3px; overflow: hidden; }
[data-dsh-study] .study-coverage-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 0;
  background: var(--s-surface-2);
  color: var(--s-muted);
  cursor: pointer;
}
[data-dsh-study] .study-coverage-btn + .study-coverage-btn { border-left: 1px solid var(--s-border); }
[data-dsh-study] .study-coverage-btn.is-on { background: var(--s-primary-soft); color: var(--s-primary-ink); font-weight: 600; }
[data-dsh-study] .study-coverage-btn:disabled { cursor: not-allowed; opacity: 0.55; }
[data-dsh-study] .study-stuck { margin: 10px 0; display: flex; flex-direction: column; gap: 6px; }
[data-dsh-study] .study-stuck .study-chip { cursor: default; }
[data-dsh-study] .study-attempt-form {
  margin-top: 12px;
  padding: 14px;
  border: 1px dashed var(--s-border-strong);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
[data-dsh-study] .study-attempt-list { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
[data-dsh-study] .study-attempt { padding: 12px 14px; border: 1px solid var(--s-border); border-radius: 4px; background: var(--s-surface-2); }
[data-dsh-study] .study-attempt-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
[data-dsh-study] .study-attempt-head .study-link { margin-left: auto; }
[data-dsh-study] .study-prov { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--s-border); }
[data-dsh-study] .study-prov.is-independent { color: var(--s-success); border-color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-prov.is-judged { color: var(--s-primary-ink); border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-prov.is-adopted-unverified { color: var(--s-warning); border-color: var(--s-warning); background: var(--s-warning-soft); }
[data-dsh-study] .study-question-list { list-style: none; margin: 10px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
[data-dsh-study] .study-question-list li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--s-border); border-radius: 4px; }
[data-dsh-study] .study-question-list li.is-passed { border-color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-question-text { flex: 1; min-width: 0; }
[data-dsh-study] .study-gate-reasons { margin: 12px 0 0; padding-left: 18px; color: var(--s-muted); font-size: 13px; line-height: 1.7; }
[data-dsh-study] .study-gate-ready { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--s-success); border-radius: 4px; background: var(--s-success-soft); }
[data-dsh-study] .study-gate-ready p { margin: 0 0 8px; }
[data-dsh-study] .study-closed { margin-top: 12px; font-size: 13px; color: var(--s-muted); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
[data-dsh-study] .study-gate .study-inline > .study-input { flex: 1; min-width: 220px; }

@media (max-width: 900px) {
  [data-dsh-study] .study-boundary-row { grid-template-columns: auto minmax(0, 1fr); }
  [data-dsh-study] .study-boundary-row .study-coverage { grid-column: 1 / -1; justify-self: start; }
}

@media (prefers-reduced-motion: reduce) {
  [data-dsh-study] button,
  [data-dsh-study] .study-book,
  [data-dsh-study] .study-plan-card,
  [data-dsh-study] .study-concept-card { transition: none; }
  [data-dsh-study] button:active { transform: none; }
  /* 状态仍由文字说明，动画只是装饰 */
  [data-dsh-study] .study-mascot,
  [data-dsh-study] .study-sprite,
  [data-dsh-study] .study-cover-ghost,
  [data-dsh-study] .study-companion,
  [data-dsh-study] .study-rail-card { animation: none; }
}

@media (max-width: 900px) {
  [data-dsh-study] .study-shell { padding: 20px 16px 48px; }
  [data-dsh-study] .study-body { grid-template-columns: 1fr; }
  [data-dsh-study] .study-toc { position: static; max-height: 300px; }
  /* 窄屏：题签单独一行，导航靠左、按钮靠右，不把下划线拉成一排 */
  [data-dsh-study] .study-head-nav { width: 100%; margin-left: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  [data-dsh-study] .study-nav { display: flex; width: auto; }
  [data-dsh-study] .study-nav button { flex: none; margin: 0 12px 0 0; padding-left: 0; padding-right: 0; }
  [data-dsh-study] .study-head-actions { width: auto; margin-left: auto; }
  [data-dsh-study] .study-head-actions > button { flex: none; }
  [data-dsh-study] .study-notes { padding: 24px 18px; }
}
/* ---------- reading surface v2: PDF left, guiding rail right ---------- */

/*
  The reader escapes the 1160px shell. Everything in this block exists to keep
  two numbers stable while the reader scrolls: the column width and the rail
  width. A width that changes under content is what made the old viewer flash.
*/
[data-dsh-study] .study-shell.is-reader { max-width: none; padding: 18px 22px 40px; }

[data-dsh-study] .study-reader2 { display: block; }

[data-dsh-study] .study-reader2-top {
  position: sticky;
  top: 0;
  z-index: 4;
  padding-bottom: 8px;
  background: var(--s-bg);
}

[data-dsh-study] .study-reader2-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--s-border);
}
[data-dsh-study] .study-reader2-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
[data-dsh-study] .study-reader2-title h2 { font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
[data-dsh-study] .study-reader2-actions { display: flex; align-items: center; gap: 8px; flex: none; }

[data-dsh-study] .study-menu-wrap { position: relative; }
[data-dsh-study] .study-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 180px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-md);
  z-index: 12;
}
[data-dsh-study] .study-menu button {
  text-align: left;
  padding: 7px 9px;
  border-radius: 3px;
  font-size: 12.5px;
  color: var(--s-text);
}
[data-dsh-study] .study-menu button:hover { background: var(--s-hover); }
[data-dsh-study] .study-menu button:disabled { color: var(--s-faint); cursor: default; }

[data-dsh-study] .study-reader2-body { display: block; }

[data-dsh-study] .study-pdf-col { min-width: 0; }
[data-dsh-study] .study-pdf-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 10px 0 60px;
}

/* The page box keeps its measured height, so adding a bitmap never moves it. */
[data-dsh-study] .study-pdf-page {
  position: relative;
  flex: none;
  background: var(--s-surface);
  border-radius: 3px;
  box-shadow: 0 1px 0 var(--s-border), 0 14px 30px -18px var(--s-shadow-color);
  overflow: hidden;
}
[data-dsh-study] .study-pdf-canvas { display: block; }
[data-dsh-study] .study-pdf-page-no {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: 11px;
  color: var(--s-faint);
  background: var(--s-surface);
  padding: 0 4px;
  border-radius: 4px;
}
[data-dsh-study] .study-pdf-fail {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  font-size: 12px;
  text-align: center;
  color: var(--s-muted);
  background: var(--s-surface-2);
}

/* ---------- the rail ---------- */

[data-dsh-study] .study-rail-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: study-card-in 160ms ease-out;
}
@keyframes study-card-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

[data-dsh-study] .study-rail-head { display: flex; align-items: center; gap: 8px; }
[data-dsh-study] .study-rail-title {
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--s-muted);
}
[data-dsh-study] .study-rail-kind {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--s-faint);
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
}

[data-dsh-study] .study-rail-transition {
  font-size: 13px;
  line-height: 1.6;
  color: var(--s-muted);
}
/* The question is the only thing on this screen allowed to look important. */
[data-dsh-study] .study-rail-question {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.65;
  color: var(--s-text);
}
[data-dsh-study] .study-rail-empty { font-size: 12.5px; color: var(--s-muted); }
[data-dsh-study] .study-rail-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
[data-dsh-study] .study-rail-ask {
  padding: 6px 12px;
  border-radius: 3px;
  font-size: 12.5px;
  color: var(--s-primary-ink);
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-rail-ask:hover { border-color: var(--s-primary); background: var(--s-primary-soft); }
[data-dsh-study] .study-rail-merge {
  font-size: 12px;
  color: var(--s-muted);
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}
[data-dsh-study] .study-rail-merge:hover { color: var(--s-primary-ink); }
[data-dsh-study] .study-rail-foot {
  padding-top: 8px;
  border-top: 1px dashed var(--s-border);
  font-size: 11px;
  color: var(--s-faint);
}

/* ---------- the small question window ---------- */

[data-dsh-study] .study-ask {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 70;
  width: min(360px, calc(100vw - 44px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 4px;
  background: var(--s-surface);
  border: 1px solid var(--s-border-strong);
  box-shadow: var(--s-shadow-lg);
}
[data-dsh-study] .study-ask-head { display: flex; align-items: center; font-size: 12.5px; color: var(--s-muted); }
[data-dsh-study] .study-ask-copy {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--s-muted);
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-ask-copy:hover { color: var(--s-primary-ink); border-color: var(--s-primary); }
[data-dsh-study] .study-ask-close { margin-left: 8px; font-size: 16px; line-height: 1; color: var(--s-faint); }
[data-dsh-study] .study-ask-input {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
  color: var(--s-text);
  font: inherit;
}
[data-dsh-study] .study-ask-input:focus { outline: none; border-color: var(--s-primary); box-shadow: 0 0 0 3px var(--s-ring); }
[data-dsh-study] .study-ask-actions { display: flex; align-items: center; gap: 10px; }
[data-dsh-study] .study-ask-hint { font-size: 11px; color: var(--s-faint); }
[data-dsh-study] .study-ask-answer {
  font-size: 13px;
  line-height: 1.7;
  color: var(--s-text);
  padding-top: 8px;
  border-top: 1px dashed var(--s-border);
}

/* ---------- drawers ---------- */

[data-dsh-study] .study-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px;
  background: var(--s-scrim);
}
[data-dsh-study] .study-drawer {
  width: min(440px, 100%);
  max-height: 84vh;
  overflow: auto;
  padding: 18px;
  border-radius: 6px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-lg);
}
[data-dsh-study] .study-drawer-wide { width: min(820px, 100%); }
[data-dsh-study] .study-drawer-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
[data-dsh-study] .study-drawer-head h3 { flex: 1; }
[data-dsh-study] .study-drawer-list { display: flex; flex-direction: column; gap: 2px; }
[data-dsh-study] .study-drawer-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 9px;
  border-radius: 3px;
  text-align: left;
}
[data-dsh-study] .study-drawer-row:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-drawer-row.is-on { background: var(--s-primary-soft); }
[data-dsh-study] .study-drawer-title { font-size: 13px; color: var(--s-text); min-width: 0; }
[data-dsh-study] .study-drawer-meta { margin-left: auto; font-size: 11px; color: var(--s-faint); }

/* ---------- the guide: a whale in the corner, a cloud when opened ---------- */

/*
  The anchor is always mounted: closing the card must not move the button, so
  both states share one fixed point and the card positions itself against it.
*/
[data-dsh-study] .study-guide {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 62;
  width: 58px;
  height: 58px;
}

[data-dsh-study] .study-sprite {
  width: 58px;
  height: 58px;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  background: transparent;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  cursor: grab;
  animation: study-bob 4.2s ease-in-out infinite;
  transition: box-shadow 140ms ease;
}
[data-dsh-study] .study-sprite:hover {
  animation-play-state: paused;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.26), 0 0 0 3px color-mix(in srgb, var(--s-primary) 22%, transparent);
}
[data-dsh-study] .study-sprite:active { cursor: grabbing; }
[data-dsh-study] .study-sprite .study-mascot { width: 100%; height: 100%; object-fit: cover; }

.study-mascot {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}
.study-mascot.is-think { animation: study-wobble 1.2s ease-in-out infinite; transform-origin: 50% 62%; }

@keyframes study-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes study-wobble {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg); }
}
@keyframes study-puff {
  0%, 100% { opacity: 0.35; transform: translateY(1px) scale(0.96); }
  50% { opacity: 0.85; transform: translateY(-1px) scale(1.04); }
}
@keyframes study-dot {
  0%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}

/*
  The card is a cloud: an irregular silhouette, translucent enough that the page
  shows through, anchored to the whale with a little tail. The tint follows the
  block, so switching blocks also switches colour.
*/
[data-dsh-study] .study-companion {
  position: absolute;
  right: 0;
  bottom: 68px;
  width: min(300px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  padding: 2px;
  border-radius: 42px 38px 34px 40px;
  background: color-mix(in srgb, var(--s-surface) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.06);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.06),
    0 18px 44px rgba(0, 0, 0, 0.16),
    inset 0 0 0 1px color-mix(in srgb, var(--s-tint, var(--s-primary)) 22%, transparent);
  animation: study-cloud-in 200ms ease-out;
}
[data-dsh-study] .study-companion[data-vertical='below'] { bottom: auto; top: 68px; }
[data-dsh-study] .study-companion[data-align='start'] { right: auto; left: 0; }

/* The tail that points back at the whale. */
[data-dsh-study] .study-companion::after {
  content: '';
  position: absolute;
  right: 24px;
  bottom: -7px;
  width: 16px;
  height: 16px;
  border-radius: 6px;
  background: inherit;
  transform: rotate(45deg);
}
[data-dsh-study] .study-companion[data-vertical='below']::after { bottom: auto; top: -7px; }
[data-dsh-study] .study-companion[data-align='start']::after { right: auto; left: 24px; }

@keyframes study-cloud-in {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: none; }
}

[data-dsh-study] .study-companion-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 14px;
  cursor: grab;
  user-select: none;
}
[data-dsh-study] .study-companion-head:active { cursor: grabbing; }
[data-dsh-study] .study-companion-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  flex: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--s-tint, var(--s-primary)) 32%, transparent);
}
[data-dsh-study] .study-companion-avatar .study-mascot { width: 100%; height: 100%; object-fit: cover; }
[data-dsh-study] .study-companion-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--s-text);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
[data-dsh-study] .study-companion-head .study-rail-kind {
  margin-left: auto;
  border-color: color-mix(in srgb, var(--s-tint, var(--s-primary)) 35%, transparent);
  color: color-mix(in srgb, var(--s-tint, var(--s-primary)) 80%, var(--s-text));
}
[data-dsh-study] .study-companion-toggle {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--s-faint);
}
[data-dsh-study] .study-companion-toggle:hover { background: var(--s-hover); color: var(--s-muted); }
[data-dsh-study] .study-companion-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 18px 14px;
  border-radius: 0 0 38px 34px;
  max-height: min(52vh, 420px);
  overflow: auto;
}
[data-dsh-study] .study-companion-think {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 2px 12px;
  font-size: 12.5px;
  color: var(--s-muted);
}
[data-dsh-study] .study-think { display: inline-flex; gap: 4px; align-items: center; }
[data-dsh-study] .study-think i {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--s-tint, var(--s-primary));
  opacity: 0.3;
  animation: study-dot 1.05s ease-in-out infinite;
}
[data-dsh-study] .study-think i:nth-child(2) { animation-delay: 0.15s; }
[data-dsh-study] .study-think i:nth-child(3) { animation-delay: 0.3s; }

/* The question takes the block's colour: the one thing allowed to stand out. */
[data-dsh-study] .study-rail-question {
  font-size: 14.5px;
  font-weight: 650;
  line-height: 1.62;
  color: var(--s-text);
  text-wrap: pretty;
}

@media (max-width: 900px) {
  /* Not a mobile layout: the companion simply shrinks to the viewport. */
  [data-dsh-study] .study-companion { right: 10px; bottom: 10px; width: calc(100vw - 20px); }
}

/* ---------- fullscreen reading + resizable split ---------- */

/*
  Fullscreen is the reading mode: the reader owns the viewport, the left column
  scrolls on its own, and the rail keeps its width. Nothing else changes, so
  there is only one layout to reason about.
*/
[data-dsh-study] .study-reader2.is-full {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  padding: 0 16px 10px;
  background: var(--s-bg);
}
[data-dsh-study] .study-reader2.is-full .study-reader2-top { display: none; }
[data-dsh-study] .study-reader2.is-full .study-reader2-body { flex: 1; min-height: 0; }
[data-dsh-study] .study-reader2.is-full .study-pdf-col { height: 100%; overflow-y: auto; }
[data-dsh-study] .study-reader2.is-full .study-pdf-stack { padding-top: 56px; }

/* Fullscreen bar: three actions and a title, translucent, out of the way. */
[data-dsh-study] .study-floatbar {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 92;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  border-radius: 999px;
  background: var(--s-surface);
  background: color-mix(in srgb, var(--s-surface) 88%, transparent);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-md);
  backdrop-filter: blur(8px);
}
[data-dsh-study] .study-floatbar-title {
  max-width: 260px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  color: var(--s-muted);
  margin-right: 6px;
}
[data-dsh-study] .study-floatbar-btn {
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--s-text);
  background: transparent;
  border: 1px solid transparent;
}
[data-dsh-study] .study-floatbar-btn:hover { background: var(--s-hover); }
[data-dsh-study] .study-floatbar-btn.is-primary {
  color: var(--s-on-primary);
  background: var(--s-primary);
}
[data-dsh-study] .study-floatbar-btn.is-primary:hover { background: var(--s-primary-strong); }

/* The paragraph the rail is talking about: a hint, not a highlighter. */
[data-dsh-study] .study-mark {
  position: absolute;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease;
  animation: study-mark-in 220ms ease-out;
}
/* Every paragraph is a target, but only the hovered one says so. */
[data-dsh-study] .study-mark:hover { background: color-mix(in srgb, var(--s-primary) 6%, transparent); }
[data-dsh-study] .study-mark.is-active { cursor: pointer; }
[data-dsh-study] .study-mark.is-active:hover { filter: brightness(0.95) saturate(1.25); }
@keyframes study-mark-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
[data-dsh-study] .study-mark:focus-visible { outline: 2px solid var(--s-primary); outline-offset: 1px; }

[data-dsh-study] .study-ask-seed {
  max-height: 84px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--s-muted);
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
}

`

/** Inject the stylesheet once per document. */
export function ensureStudyStyles(): void {
  if (injected || typeof document === 'undefined') return
  injected = true
  const style = document.createElement('style')
  style.setAttribute('data-dsh-study-style', '')
  style.textContent = STUDY_CSS
  document.head.append(style)
}
