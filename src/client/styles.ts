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

  /* Blue-led light palette (Tailwind blue scale). */
  --s-bg: #f3f7fd;
  --s-surface: #ffffff;
  --s-surface-2: #f7faff;
  --s-surface-3: #eef4fe;
  --s-hover: #e9f1ff;
  --s-text: #10203d;
  --s-muted: #5a6c88;
  --s-faint: #8b9bb5;
  --s-border: #dbe6f4;
  --s-border-strong: #c4d5ec;
  --s-primary: #2563eb;
  --s-primary-strong: #1d4ed8;
  --s-primary-soft: #e7efff;
  --s-primary-ink: #1e4bb8;
  --s-on-primary: #ffffff;
  --s-success: #0f9d6e;
  --s-success-soft: #e6f7f0;
  --s-warning: #b45309;
  --s-warning-soft: #fdf1e0;
  --s-danger: #dc2626;
  --s-danger-soft: #fdeaea;
  --s-code-bg: #0e1a2e;
  --s-code-fg: #dbe7ff;
  --s-ring: rgba(37, 99, 235, 0.38);
  --s-shadow-sm: 0 1px 2px rgba(16, 32, 61, 0.06);
  --s-shadow-md: 0 1px 2px rgba(16, 32, 61, 0.05), 0 10px 28px rgba(16, 32, 61, 0.08);
  --s-shadow-lg: 0 2px 6px rgba(16, 32, 61, 0.06), 0 18px 44px rgba(16, 32, 61, 0.12);

  color: var(--s-text);
  background: var(--s-bg);
  font: 14px/1.65 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
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
  --s-bg: #0a1220;
  --s-surface: #111c2f;
  --s-surface-2: #152238;
  --s-surface-3: #1a2a43;
  --s-hover: #1b2b46;
  --s-text: #e7eefb;
  --s-muted: #94a7c4;
  --s-faint: #748aa9;
  --s-border: #223250;
  --s-border-strong: #2f4468;
  --s-primary: #6ba4ff;
  --s-primary-strong: #8dbaff;
  --s-primary-soft: #16274a;
  --s-primary-ink: #a8c8ff;
  --s-on-primary: #071225;
  --s-success: #34d399;
  --s-success-soft: #10291f;
  --s-warning: #fbbf24;
  --s-warning-soft: #2a2110;
  --s-danger: #f87171;
  --s-danger-soft: #2b1414;
  --s-code-bg: #0a1526;
  --s-code-fg: #dbe7ff;
  --s-ring: rgba(107, 164, 255, 0.45);
  --s-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
  --s-shadow-md: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 30px rgba(0, 0, 0, 0.32);
  --s-shadow-lg: 0 2px 8px rgba(0, 0, 0, 0.45), 0 20px 48px rgba(0, 0, 0, 0.4);
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
[data-dsh-study] h1 { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: .01em; }
[data-dsh-study] h2 { font-size: 18px; font-weight: 650; margin: 0; line-height: 1.35; }
[data-dsh-study] h3 { font-size: 13px; font-weight: 650; margin: 0; letter-spacing: .03em; }
[data-dsh-study] .study-link { color: var(--s-primary); }
[data-dsh-study] .study-link:hover { text-decoration: underline; }

[data-dsh-study] .study-shell {
  max-width: 1160px;
  margin: 0 auto;
  padding: 26px 28px 64px;
}

/* ---------- header ---------- */
[data-dsh-study] .study-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 22px;
}
[data-dsh-study] .study-head > h1 { flex: none; }
[data-dsh-study] .study-sub {
  color: var(--s-muted);
  font-size: 12.5px;
  line-height: 1.5;
  max-width: 620px;
}
[data-dsh-study] .study-head-nav { margin-left: auto; position: relative; z-index: 1; }
[data-dsh-study] .study-nav {
  display: inline-flex;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-nav button {
  padding: 6px 15px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--s-muted);
}
[data-dsh-study] .study-nav button:hover { background: var(--s-hover); color: var(--s-text); }
[data-dsh-study] .study-nav button.is-on {
  background: var(--s-primary);
  color: var(--s-on-primary);
  box-shadow: 0 1px 2px rgba(16, 32, 61, .18);
}
[data-dsh-study] .study-nav button.is-on:hover { background: var(--s-primary-strong); color: var(--s-on-primary); }

/* ---------- primitives ---------- */
[data-dsh-study] .study-muted { color: var(--s-muted); font-size: 12px; }
[data-dsh-study] .study-warn-text { color: var(--s-warning); font-size: 12px; font-weight: 500; }
[data-dsh-study] .study-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 9px 18px;
  border-radius: 10px;
  background: var(--s-primary);
  color: var(--s-on-primary);
  font-size: 13px;
  font-weight: 550;
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-primary:hover { background: var(--s-primary-strong); }
[data-dsh-study] .study-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 44px 22px;
  text-align: center;
  color: var(--s-muted);
  background: var(--s-surface-2);
  border: 1px dashed var(--s-border-strong);
  border-radius: 16px;
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
  font-size: 11px;
  font-weight: 550;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--s-primary-soft);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-badge-paper { background: #f0e9ff; color: #6d3fc8; }
[data-dsh-study] .study-badge-article { background: var(--s-success-soft); color: var(--s-success); }
html[data-dsh-study-theme='dark'] [data-dsh-study] .study-badge-paper { background: #241a3d; color: #b79cff; }
[data-dsh-study] .study-due-badge {
  font-size: 11px;
  font-weight: 550;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--s-warning-soft);
  color: var(--s-warning);
}

/* ---------- library shelf ---------- */
[data-dsh-study] .study-shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 14px;
}
[data-dsh-study] .study-book {
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
  padding: 18px;
  border: 1px solid var(--s-border);
  border-radius: 16px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-book:hover {
  transform: translateY(-2px);
  border-color: var(--s-border-strong);
  box-shadow: var(--s-shadow-md);
}
[data-dsh-study] .study-book-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
[data-dsh-study] .study-book-title { font-size: 15.5px; font-weight: 650; line-height: 1.45; }
[data-dsh-study] .study-book-meta { font-size: 12px; color: var(--s-muted); }
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
  background: linear-gradient(90deg, var(--s-primary), #4f8bff);
}
[data-dsh-study] .study-progress-text { font-size: 11.5px; color: var(--s-muted); }

/* ---------- today ---------- */
[data-dsh-study] .study-today { display: flex; flex-direction: column; gap: 18px; }
[data-dsh-study] .study-today-line { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--s-muted); }
[data-dsh-study] .study-today-date {
  font-weight: 650;
  color: var(--s-text);
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 8px;
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
  border-radius: 16px;
  padding: 18px;
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-panel h3 {
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--s-border);
  color: var(--s-primary-ink);
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
  border-radius: 10px;
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
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--s-primary) 26%, var(--s-border));
  border-left: 3px solid var(--s-primary);
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
  border-radius: 16px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-back {
  flex: none;
  padding: 6px 10px;
  border-radius: 9px;
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
  border-radius: 9px;
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
  border-radius: 16px;
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
  border-radius: 10px;
}
[data-dsh-study] .study-toc-row:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-toc-row.is-active {
  background: var(--s-primary-soft);
  box-shadow: inset 2px 0 0 var(--s-primary);
}
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
[data-dsh-study] .study-tabs {
  display: inline-flex;
  padding: 3px;
  border-radius: 11px;
  background: var(--s-surface-2);
  border: 1px solid var(--s-border);
  margin-left: auto;
}
[data-dsh-study] .study-tabs button {
  padding: 5px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--s-muted);
}
[data-dsh-study] .study-tabs button:hover { color: var(--s-text); }
[data-dsh-study] .study-tabs button.is-on {
  background: var(--s-primary);
  color: var(--s-on-primary);
  box-shadow: 0 1px 2px rgba(16, 32, 61, .16);
}
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

[data-dsh-study] .study-original { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-page-slice {
  border: 1px solid var(--s-border);
  border-radius: 14px;
  background: var(--s-surface);
  padding: 18px 20px;
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-page-no {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: var(--s-primary-ink);
  background: var(--s-primary-soft);
  padding: 1px 8px;
  border-radius: 6px;
}
[data-dsh-study] .study-page-slice pre {
  margin: 10px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--s-text);
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.85;
}
[data-dsh-study] .study-truncated { font-size: 12px; color: var(--s-muted); text-align: center; padding: 8px; }

/* ---------- notes typography ---------- */
[data-dsh-study] .study-notes {
  max-width: 84ch;
  padding: 26px 30px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  border-radius: 16px;
  box-shadow: var(--s-shadow-sm);
  color: var(--s-text);
  font-size: 14.5px;
  line-height: 1.85;
}
[data-dsh-study] .study-notes h1,
[data-dsh-study] .study-notes h2,
[data-dsh-study] .study-notes h3 { margin: 1.5em 0 .6em; line-height: 1.4; }
[data-dsh-study] .study-notes h1 { font-size: 22px; }
[data-dsh-study] .study-notes h2 {
  font-size: 17px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--s-border);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-notes h3 { font-size: 15px; }
[data-dsh-study] .study-notes > :first-child { margin-top: 0; }
[data-dsh-study] .study-notes p { margin: .75em 0; }
[data-dsh-study] .study-notes ul,
[data-dsh-study] .study-notes ol { padding-left: 1.45em; margin: .75em 0; }
[data-dsh-study] .study-notes li { margin: .3em 0; }
[data-dsh-study] .study-notes strong { font-weight: 650; color: var(--s-text); }
[data-dsh-study] .study-notes blockquote {
  margin: .9em 0;
  padding: .5em 1em;
  border-left: 3px solid var(--s-primary);
  color: var(--s-muted);
  background: var(--s-primary-soft);
  border-radius: 0 10px 10px 0;
}
[data-dsh-study] .study-notes code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  padding: .12em .38em;
  border-radius: 5px;
  background: var(--s-surface-3);
  color: var(--s-primary-ink);
}
[data-dsh-study] .study-notes pre {
  padding: 14px 16px;
  border-radius: 12px;
  overflow: auto;
  background: var(--s-code-bg);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-notes pre code { padding: 0; background: none; color: var(--s-code-fg); font-size: 12.5px; line-height: 1.7; }
[data-dsh-study] .study-notes table { border-collapse: collapse; margin: .9em 0; font-size: 13px; width: 100%; }
[data-dsh-study] .study-notes th,
[data-dsh-study] .study-notes td { border: 1px solid var(--s-border); padding: 7px 11px; text-align: left; }
[data-dsh-study] .study-notes th { background: var(--s-surface-2); font-weight: 600; }
[data-dsh-study] .study-notes a { color: var(--s-primary); text-decoration: none; }
[data-dsh-study] .study-notes a:hover { text-decoration: underline; }
[data-dsh-study] .study-notes img { max-width: 100%; border-radius: 10px; }
[data-dsh-study] .study-notes hr { border: 0; border-top: 1px solid var(--s-border); margin: 1.6em 0; }
[data-dsh-study] .study-notes .katex { display: inline-block; max-width: 100%; }
[data-dsh-study] .study-notes math { font-size: 1.06em; }
[data-dsh-study] .study-notes math[display="block"] {
  display: block;
  margin: 1em 0;
  text-align: center;
  overflow-x: auto;
  overflow-y: hidden;
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
  border-radius: 15px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-concept-card:hover {
  transform: translateY(-2px);
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
  background: linear-gradient(90deg, var(--s-primary), #4f8bff);
}
[data-dsh-study] .study-concept-detail { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-definition {
  margin: 0;
  padding: 16px 18px;
  border-left: 3px solid var(--s-primary);
  border-radius: 0 12px 12px 0;
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
  border-radius: 15px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-plan-card:hover {
  transform: translateY(-1px);
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
  border-radius: 13px;
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
  border-radius: 12px;
  font-size: 13px;
  color: var(--s-text);
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-lg);
}
[data-dsh-study] .study-toast-ok { border-color: color-mix(in srgb, var(--s-success) 45%, var(--s-border)); }
[data-dsh-study] .study-toast-error { border-color: color-mix(in srgb, var(--s-danger) 45%, var(--s-border)); }


/* ---------- header actions + dialogs ---------- */
[data-dsh-study] .study-head-actions { display: inline-flex; gap: 8px; margin-left: 10px; vertical-align: middle; }
[data-dsh-study] .study-ghost {
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  color: var(--s-text);
  font-size: 12.5px;
  font-weight: 500;
  box-shadow: var(--s-shadow-sm);
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
  background: rgba(10, 18, 32, 0.45);
  backdrop-filter: blur(2px);
}
[data-dsh-study] .study-modal {
  width: min(660px, 100%);
  max-height: 86vh;
  overflow: auto;
  padding: 22px 24px 20px;
  border-radius: 18px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  box-shadow: var(--s-shadow-lg);
  color: var(--s-text);
}
[data-dsh-study] .study-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
[data-dsh-study] .study-modal-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--s-muted); line-height: 1.6; }
[data-dsh-study] .study-modal-close {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
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
  border-radius: 10px;
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
  border-radius: 12px;
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
  border-radius: 10px;
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
  border-radius: 11px;
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
  padding: 3px;
  border-radius: 11px;
  background: var(--s-surface-3);
  border: 1px solid var(--s-border);
}
[data-dsh-study] .study-subnav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border-radius: 8px;
  color: var(--s-muted);
  font-size: 12.5px;
  font-weight: 550;
}
[data-dsh-study] .study-subnav button:hover { background: var(--s-surface); color: var(--s-text); }
[data-dsh-study] .study-subnav button.is-on { background: var(--s-surface); color: var(--s-text); box-shadow: var(--s-shadow-sm); }
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
  border-radius: 14px;
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
  border-radius: 14px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
}
[data-dsh-study] .study-insight-card:hover { border-color: var(--s-border-strong); transform: translateY(-1px); box-shadow: var(--s-shadow-md); }
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
  border-left: 3px solid var(--s-primary);
  border-radius: 0 10px 10px 0;
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
[data-dsh-study] .study-plan-row { display: flex; flex-direction: column; gap: 1px; text-align: left; width: 100%; padding: 7px 8px; border-radius: 8px; }
[data-dsh-study] .study-plan-row:hover { background: var(--s-hover); }
[data-dsh-study] .study-job {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 10px 0;
  padding: 11px 14px;
  border-radius: 11px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
}
[data-dsh-study] .study-job-ok { border-color: color-mix(in srgb, var(--s-success) 40%, var(--s-border)); }
[data-dsh-study] .study-job-error { border-color: color-mix(in srgb, var(--s-danger) 40%, var(--s-border)); }
[data-dsh-study] .study-job-head { display: flex; align-items: center; gap: 9px; font-size: 12.5px; flex-wrap: wrap; }
[data-dsh-study] .study-job-status { font-weight: 650; color: var(--s-primary-ink); }
[data-dsh-study] .study-reader-actions { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-quiz-item {
  padding: 15px 16px;
  border-radius: 13px;
  border: 1px solid var(--s-border);
  background: var(--s-surface);
}
[data-dsh-study] .study-quiz-item.is-correct { border-color: color-mix(in srgb, var(--s-success) 45%, var(--s-border)); }
[data-dsh-study] .study-quiz-item.is-wrong { border-color: color-mix(in srgb, var(--s-danger) 45%, var(--s-border)); }
[data-dsh-study] .study-quiz-head { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--s-muted); }
[data-dsh-study] .study-quiz-index { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; background: var(--s-primary-soft); color: var(--s-primary-ink); font-weight: 650; }
[data-dsh-study] .study-quiz-type { text-transform: uppercase; letter-spacing: .05em; font-size: 10.5px; }
[data-dsh-study] .study-quiz-question { margin: 8px 0 10px; font-size: 13.5px; font-weight: 550; line-height: 1.6; }
[data-dsh-study] .study-quiz-choices { display: flex; flex-direction: column; gap: 6px; }
[data-dsh-study] .study-quiz-choice { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--s-border); cursor: pointer; font-size: 12.5px; }
[data-dsh-study] .study-quiz-choice:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-quiz-score { padding: 12px 14px; border-radius: 10px; background: var(--s-success-soft); color: var(--s-success); font-weight: 600; }
[data-dsh-study] .study-extras { display: flex; flex-direction: column; gap: 16px; }
[data-dsh-study] .study-extra { margin: 0; padding: 12px; border-radius: 12px; border: 1px solid var(--s-border); background: var(--s-surface); }
[data-dsh-study] .study-extra img, [data-dsh-study] .study-extra video { max-width: 100%; border-radius: 8px; display: block; }
[data-dsh-study] .study-extra figcaption { margin-top: 7px; font-size: 11.5px; color: var(--s-faint); }
[data-dsh-study] .study-anim { width: 100%; min-height: 320px; border: 0; border-radius: 8px; background: var(--s-surface-2); }
[data-dsh-study] .study-settings { display: flex; flex-direction: column; gap: 20px; }
[data-dsh-study] .study-settings-section { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--s-border); }
[data-dsh-study] .study-settings-section:last-of-type { border-bottom: 0; }
[data-dsh-study] .study-settings-section h3 { margin: 0; }
[data-dsh-study] .study-settings-toggles { display: flex; flex-direction: column; gap: 8px; }
[data-dsh-study] .study-segmented { display: inline-flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--s-surface-3); align-self: flex-start; }
[data-dsh-study] .study-segmented button { padding: 6px 12px; border-radius: 7px; font-size: 12px; color: var(--s-muted); }
[data-dsh-study] .study-segmented button.is-on { background: var(--s-surface); color: var(--s-text); box-shadow: var(--s-shadow-sm); }
[data-dsh-study] .study-engine-card { display: flex; flex-direction: column; gap: 9px; padding: 12px 14px; border-radius: 11px; border: 1px solid var(--s-border); background: var(--s-surface-2); }
[data-dsh-study] .study-chip-static { cursor: default; }
[data-dsh-study] .study-chip-hint { margin-left: 5px; font-size: 10.5px; color: var(--s-faint); }
[data-dsh-study] .study-formula { margin: 10px 0; padding: 12px 14px; border-radius: 11px; background: var(--s-surface-2); border: 1px solid var(--s-border); overflow-x: auto; }
[data-dsh-study] .study-notes-formula { padding: 0; background: none; border: 0; }
[data-dsh-study] .study-review { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-review-card { padding: 20px 22px; border-radius: 16px; border: 1px solid var(--s-border); background: var(--s-surface); box-shadow: var(--s-shadow-sm); }
[data-dsh-study] .study-review-card h3 { font-size: 17px; margin: 0 0 3px; }
[data-dsh-study] .study-review-prompt { margin: 14px 0 10px; font-size: 13.5px; color: var(--s-text); }
[data-dsh-study] .study-review-notes { margin: 10px 0 14px; padding: 13px 15px; border-radius: 10px; background: var(--s-surface-2); border: 1px solid var(--s-border); font-size: 13px; line-height: 1.7; color: var(--s-muted); }
[data-dsh-study] .study-review-ratings { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
[data-dsh-study] .study-rating { padding: 10px 8px; border-radius: 10px; border: 1px solid var(--s-border); background: var(--s-surface); font-size: 12.5px; font-weight: 600; color: var(--s-muted); }
[data-dsh-study] .study-rating:hover { border-color: var(--s-primary); color: var(--s-primary-ink); background: var(--s-primary-soft); }
[data-dsh-study] .study-rating-1:hover { border-color: var(--s-danger); color: var(--s-danger); background: var(--s-danger-soft); }
[data-dsh-study] .study-rating-4:hover { border-color: var(--s-success); color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-due-list { display: flex; flex-direction: column; gap: 5px; }
[data-dsh-study] .study-due-row { display: flex; flex-direction: column; gap: 1px; text-align: left; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
[data-dsh-study] .study-due-row:hover { background: var(--s-hover); }
[data-dsh-study] .study-step-actions { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
[data-dsh-study] .study-danger-text { color: var(--s-danger); }
[data-dsh-study] .study-danger-text:hover { border-color: var(--s-danger); background: var(--s-danger-soft); }

@media (prefers-reduced-motion: reduce) {
  [data-dsh-study] button,
  [data-dsh-study] .study-book,
  [data-dsh-study] .study-plan-card,
  [data-dsh-study] .study-concept-card { transition: none; }
  [data-dsh-study] button:active { transform: none; }
}

@media (max-width: 900px) {
  [data-dsh-study] .study-shell { padding: 20px 16px 48px; }
  [data-dsh-study] .study-body { grid-template-columns: 1fr; }
  [data-dsh-study] .study-toc { position: static; max-height: 300px; }
  [data-dsh-study] .study-head-nav { width: 100%; margin-left: 0; }
  [data-dsh-study] .study-nav { display: flex; width: 100%; }
  [data-dsh-study] .study-head-actions { width: 100%; margin-left: 0; }
  [data-dsh-study] .study-head-actions > button { flex: 1; }
  [data-dsh-study] .study-nav button { flex: 1; }
  [data-dsh-study] .study-notes { padding: 20px 18px; }
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
