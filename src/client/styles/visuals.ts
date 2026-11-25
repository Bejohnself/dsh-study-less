/** 目标书脊与掌握印章、阅读面 v2。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const VISUALS_CSS = `/* ---------- goal visuals: route spines and mastery seals ---------- */
[data-dsh-study] .study-view-switch { flex: none; margin-left: 0; }
[data-dsh-study] .study-view-switch button { padding: 4px 10px; font-size: 11.5px; letter-spacing: 0; }

[data-dsh-study] .study-current-mark {
  display: inline-block;
  margin-right: 7px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10.5px;
  color: var(--s-on-primary);
  background: var(--s-primary);
}
[data-dsh-study] .study-route-map { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-route-track {
  display: flex;
  align-items: stretch;
  gap: 10px;
  overflow-x: auto;
  padding: 2px 2px 8px;
  scrollbar-width: thin;
}
[data-dsh-study] .study-spine {
  position: relative;
  flex: none;
  height: 94px;
  padding: 9px 10px 8px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 3px;
  overflow: hidden;
  text-align: left;
  border: 1px solid var(--s-border-strong);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: 0 3px 0 var(--s-shelf-line);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}
[data-dsh-study] .study-spine:hover {
  transform: translateY(-2px);
  border-color: var(--s-primary);
  box-shadow: 0 5px 0 var(--s-primary-soft), var(--s-shadow-md);
}
[data-dsh-study] .study-spine.is-skim { border-style: dashed; background: var(--s-surface-2); }
[data-dsh-study] .study-spine.is-skip { border-style: dashed; opacity: 0.48; box-shadow: none; }
[data-dsh-study] .study-spine.is-current { box-shadow: 0 0 0 2px var(--s-primary), 0 3px 0 var(--s-shelf-line); }
[data-dsh-study] .study-spine-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--s-primary) 16%, transparent);
  pointer-events: none;
  transition: height 620ms cubic-bezier(.2, .7, .2, 1);
}
[data-dsh-study] .study-spine.is-done .study-spine-fill { background: color-mix(in srgb, var(--s-success) 20%, transparent); }
[data-dsh-study] .study-spine > span:not(.study-spine-fill) { position: relative; z-index: 1; }
[data-dsh-study] .study-spine-value { font-size: 17px; font-weight: 650; line-height: 1.1; letter-spacing: .02em; }
[data-dsh-study] .study-spine-title {
  width: 100%;
  font-size: 12px;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
[data-dsh-study] .study-spine-meta { font-size: 10.5px; color: var(--s-muted); }
[data-dsh-study] .study-spine-done {
  position: absolute;
  top: 7px;
  right: 8px;
  z-index: 2;
  color: var(--s-success);
  font-size: 13px;
  font-weight: 700;
}
[data-dsh-study] .study-route-legend { margin: 2px 0 0; font-size: 11.5px; color: var(--s-faint); }
[data-dsh-study] .study-sky { margin-top: 10px; }
/* 一张图：宽就跟着容器缩，不另开滚动条。 */
[data-dsh-study] .study-sky-map { display: block; width: 100%; height: auto; }
[data-dsh-study] .study-sky-glow-stop { stop-color: var(--s-primary); }
[data-dsh-study] .study-sky-title-text { font-size: 12px; font-weight: 600; fill: var(--s-text); paint-order: stroke; stroke: var(--s-surface); stroke-width: 3px; stroke-linejoin: round; }
[data-dsh-study] .study-sky-count-text { font-size: 11px; fill: var(--s-muted); font-variant-numeric: tabular-nums; paint-order: stroke; stroke: var(--s-surface); stroke-width: 3px; stroke-linejoin: round; }
[data-dsh-study] .study-sky-star-shape,
[data-dsh-study] .study-sky-main-shape { fill: var(--s-primary); }
[data-dsh-study] .study-sky-shared-ring { fill: none; stroke: var(--s-primary); stroke-width: 1; stroke-dasharray: 2 3; opacity: .45; }
[data-dsh-study] .study-sky-target-ring { fill: none; stroke: var(--s-success); stroke-width: 1; opacity: .75; }
[data-dsh-study] .study-sky-legend { margin: 8px 0 0; font-size: 11.5px; color: var(--s-faint); }

@media (max-width: 900px) {
  [data-dsh-study] .study-boundary-row { grid-template-columns: auto minmax(0, 1fr); }
  [data-dsh-study] .study-boundary-row .study-coverage { grid-column: 1 / -1; justify-self: start; }
}

@media (prefers-reduced-motion: reduce) {
  [data-dsh-study] button,
  [data-dsh-study] .study-book,
  [data-dsh-study] .study-plan-card,
  [data-dsh-study] .study-concept-card,
  [data-dsh-study] .study-guide,
  [data-dsh-study] .study-floatbar { transition: none; }
  [data-dsh-study] button:active { transform: none; }
  [data-dsh-study] .study-book:hover,
  [data-dsh-study] .study-cover-card:hover,
  [data-dsh-study] .study-cover-card:hover .study-cover-canvas { transform: none; }
  /* 状态仍由文字说明，动画只是装饰 */
  [data-dsh-study] .study-spine,
  [data-dsh-study] .study-spine-fill,
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

/* The column is the horizontal scroller: zooming past fit-width keeps the left
   edge reachable; max-content + min-width 100% centres the page while it
   still fits. Without it, a wider page would overflow both sides and the left
   half could never be scrolled to. */
[data-dsh-study] .study-pdf-col {
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
[data-dsh-study] .study-pdf-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding: 10px 0 60px;
  width: max-content;
  min-width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
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
/* 页码印在纸上，所以永远是墨色、纸底，不跟主题走 */
[data-dsh-study] .study-pdf-page-no {
  position: absolute;
  z-index: 3;
  right: 8px;
  bottom: 6px;
  pointer-events: none;
  user-select: none;
  font-size: 11px;
  color: #6b6457;
  background: rgba(255, 255, 255, 0.82);
  padding: 0 4px;
  border-radius: 2px;
}
[data-dsh-study] .study-pdf-fail {
  position: absolute;
  z-index: 4;
  inset: 0;
  user-select: none;
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
`
