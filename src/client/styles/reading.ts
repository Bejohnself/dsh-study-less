/** 阅读器排版、笔记正文、概念、目标、弹窗。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const READING_CSS = `/* ---------- material + reader ---------- */
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
/* KaTeX 默认 1.21em：在 16px 正文里略大，收一点，公式和汉字才齐平 */
[data-dsh-study] .study-notes .katex,
[data-dsh-study] .study-book-content .katex { font-size: 1.06em; }
[data-dsh-study] .study-rail-card .katex,
[data-dsh-study] .study-companion .katex { font-size: 1em; }
/* 问题句加粗时，公式不该跟着变粗：KaTeX 的粗细由它自己的字体决定 */
[data-dsh-study] .study-rail-card .katex,
[data-dsh-study] .study-rail-card .katex .mord,
[data-dsh-study] .study-rail-card .katex .mbin,
[data-dsh-study] .study-rail-card .katex .mrel,
[data-dsh-study] .study-rail-card .katex .mopen,
[data-dsh-study] .study-rail-card .katex .mclose,
[data-dsh-study] .study-rail-card .katex .mpunct,
[data-dsh-study] .study-rail-card .katex .minner { font-weight: 400; }
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
/* 定的值不是输入框：虚线边表示不可改，尺寸与 .study-input 对齐。 */
[data-dsh-study] .study-field-value {
  margin: 0;
  padding: 9px 11px;
  border: 1px dashed var(--s-border);
  border-radius: 4px;
  background: var(--s-surface-2);
  font-size: 13px;
  line-height: 1.6;
  color: var(--s-text);
  overflow-wrap: anywhere;
}
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
[data-dsh-study] .study-file.is-drag {
  border-color: var(--s-primary);
  background: var(--s-primary-soft);
  box-shadow: inset 0 0 0 1px var(--s-primary);
}
[data-dsh-study] .study-inline { display: flex; gap: 8px; align-items: stretch; }
/* 输入占满剩余宽度，按钮按内容宽度，别把「确定」挤成两行 */
[data-dsh-study] .study-inline > .study-input,
[data-dsh-study] .study-inline > .study-select { flex: 1 1 auto; width: auto; min-width: 0; }
[data-dsh-study] .study-inline > button { flex: none; white-space: nowrap; }
[data-dsh-study] .study-row { display: flex; gap: 12px; flex-wrap: wrap; }
[data-dsh-study] .study-form-error { margin: 4px 0 0; color: var(--s-danger); font-size: 12.5px; }
[data-dsh-study] .study-modal-note { margin: 12px 0 0; font-size: 12px; color: var(--s-muted); line-height: 1.65; }
[data-dsh-study] .study-modal-note a { color: inherit; text-decoration: underline; text-underline-offset: .18em; text-decoration-color: var(--s-border-strong); }
[data-dsh-study] .study-import-warn { margin: 0 0 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--s-warning) 45%, var(--s-border)); border-radius: 10px; font-size: 13px; line-height: 1.6; }
[data-dsh-study] .study-import-warn p { margin: 0; }
[data-dsh-study] .study-import-warn ul { margin: 6px 0 10px; padding-left: 18px; }
[data-dsh-study] .study-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
/* 弹窗底部按钮等高：主按钮没有边框，补一条透明边框对齐 ghost */
[data-dsh-study] .study-modal-actions > button { margin-top: 0; min-height: 34px; padding-block: 0; }
[data-dsh-study] .study-modal-actions > .study-primary { border: 1px solid transparent; }
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
`
