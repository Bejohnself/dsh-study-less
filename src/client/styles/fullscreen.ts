/** 全屏阅读与可拖分栏。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const FULLSCREEN_CSS = `/* ---------- fullscreen reading + resizable split ---------- */

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
[data-dsh-study] .study-reader2.is-full .study-pdf-col { height: 100%; overflow: auto; }
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
  border-radius: 4px;
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
  border-radius: 3px;
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
[data-dsh-study] .study-floatbar-collapse { padding: 5px 9px; color: var(--s-muted); font-size: 14px; line-height: 1; }
[data-dsh-study] .study-floatbar-collapse:hover { color: var(--s-text); }

/* 收起来之后是屏幕右边原位置上的一枚窄页签，只留一个「‹」 */
[data-dsh-study] .study-floatbar-tab {
  top: 14px;
  right: 0;
  width: 26px;
  height: 34px;
  padding: 0;
  border-radius: 4px 0 0 4px;
  border-right: 0;
  display: grid;
  place-items: center;
  font-size: 17px;
  line-height: 1;
  color: var(--s-muted);
  cursor: pointer;
}
[data-dsh-study] .study-floatbar-tab:hover { color: var(--s-text); background: var(--s-surface); }

/* Page zoom. Sits after the button styles so it overrides both the header ghost
   buttons and the fullscreen bar buttons; the group reads as one control. */
[data-dsh-study] .study-zoom {
  display: flex;
  align-items: center;
  flex: none;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  overflow: hidden;
}
[data-dsh-study] .study-zoom > button {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 4px 8px;
  min-width: 26px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--s-text);
}
[data-dsh-study] .study-zoom > button + button { border-left: 1px solid var(--s-border); }
[data-dsh-study] .study-zoom > button:hover:not(:disabled) { background: var(--s-hover); }
[data-dsh-study] .study-zoom > button:disabled { color: var(--s-faint); background: transparent; cursor: default; }
[data-dsh-study] .study-zoom-value {
  min-width: 48px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: var(--s-muted);
}
[data-dsh-study] .study-zoom-fit { font-size: 11.5px; }
[data-dsh-study] .study-zoom-fit[aria-pressed='true'] { color: var(--s-muted); }

/* The paragraph the rail is talking about: a hint, not a highlighter. */
[data-dsh-study] .study-mark {
  position: absolute;
  border-radius: 3px;
  background: transparent;
  /* Tint only: the selectable text layer above it owns the pointer. */
  pointer-events: none;
  animation: study-mark-in 220ms ease-out;
}
@keyframes study-mark-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Selectable text over the bitmap. The runs are transparent; the browser paints
   the selection and owns Ctrl+C, double-click and Shift+arrows. */
[data-dsh-study] .study-text {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  line-height: 1;
  cursor: text;
  caret-color: transparent;
  user-select: text;
  -webkit-user-select: text;
}
[data-dsh-study] .study-text-item {
  position: absolute;
  white-space: pre;
  transform-origin: 0 0;
  color: transparent;
  cursor: text;
  /* The span must lay out exactly like the string we measure. Anything inherited
     from the shell (weight, spacing, case) would move word boundaries and make
     the cursor land on the neighbouring word. */
  font-weight: 400;
  font-style: normal;
  font-variant: normal;
  font-stretch: normal;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
}
/* 透明文字不会自己显示选区，得把底色画出来；深色主题也读得清。 */
[data-dsh-study] .study-text ::selection {
  background: color-mix(in srgb, var(--s-primary) 28%, transparent);
}

/* Selecting a passage is the way into the question window now. The bar floats
   over the page, so it lives on the viewport, not inside the page box. */
[data-dsh-study] .study-select-bar {
  position: fixed;
  z-index: 95;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--s-border-strong);
  /* Opaque on purpose: a translucent + backdrop-filter layer is composited
     separately and the labels lose subpixel antialiasing (they look soft). */
  background: var(--s-surface);
  box-shadow: var(--s-shadow-md);
  white-space: nowrap;
}
[data-dsh-study] .study-select-bar > button {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--s-text);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;
}
[data-dsh-study] .study-select-bar > button:hover { background: var(--s-hover); }
[data-dsh-study] .study-select-action {
  max-width: 92px;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-dsh-study] .study-select-ask { color: var(--s-muted); }
[data-dsh-study] .study-select-ask:hover { color: var(--s-text); }

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
