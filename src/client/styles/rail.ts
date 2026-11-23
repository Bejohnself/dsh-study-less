/** 导引栏、小窗、抽屉、鲸鱼。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const RAIL_CSS = `/* ---------- the small question window ---------- */

[data-dsh-study] .study-ask {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 70;
  width: min(360px, calc(100vw - 44px));
  max-height: calc(100vh - 44px);
  overflow: auto;
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
  align-self: stretch;
  width: 100%;
  min-width: 0;
  max-width: none;
  /* A translation can be much longer than a one-line answer: keep the window on
     screen and let the answer scroll instead of pushing the panel off the top. */
  max-height: 46vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--s-text);
  padding-top: 8px;
  border-top: 1px dashed var(--s-border);
}
[data-dsh-study] .study-ask-answer > :first-child { margin-top: 0; }
[data-dsh-study] .study-ask-answer > :last-child { margin-bottom: 0; }
[data-dsh-study] .study-ask-answer p { margin: .55em 0; }
[data-dsh-study] .study-ask-answer ul,
[data-dsh-study] .study-ask-answer ol { margin: .55em 0; padding-left: 1.4em; }
[data-dsh-study] .study-ask-answer .katex { font-size: 1em; }
[data-dsh-study] .study-ask-cut {
  margin: 2px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--s-warning);
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
  display: flex;
  flex-direction: column;
  width: min(440px, 100%);
  max-height: 84vh;
  overflow: hidden;
  padding: 18px;
  border-radius: 6px;
  background: var(--s-surface);
  border: 1px solid var(--s-border);
  box-shadow: var(--s-shadow-lg);
}
[data-dsh-study] .study-drawer-wide { width: min(820px, 100%); }
[data-dsh-study] .study-drawer-head { flex: none; display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
[data-dsh-study] .study-drawer-head h3 { flex: 1; }
[data-dsh-study] .study-drawer-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}
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

/* 贴边：停在这一侧，没打开时收进边里只探出一点，鼠标来了再整个出来。 */
[data-dsh-study] .study-guide.is-docked { right: 0; bottom: 12px; }
[data-dsh-study] .study-guide.is-docked[data-dock='left'] { right: auto; left: 0; }
/* 贴边但没打开时，锚点本身就收成一条竖排书签，不再是一个圆点 */
[data-dsh-study] .study-guide.is-docked:not(.is-open) {
  width: 38px;
  height: min(42vh, 340px);
}

[data-dsh-study] .study-guide-strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 10px 4px;
  overflow: hidden;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
  box-shadow: var(--s-shadow-sm);
  cursor: pointer;
}
[data-dsh-study] .study-guide.is-docked[data-dock='right'] .study-guide-strip { border-right: 0; border-radius: 4px 0 0 4px; }
[data-dsh-study] .study-guide.is-docked[data-dock='left'] .study-guide-strip { border-left: 0; border-radius: 0 4px 4px 0; }
[data-dsh-study] .study-guide-strip:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-guide-strip-title {
  flex: 0 1 auto;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  white-space: nowrap;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 12px;
  letter-spacing: .06em;
  color: var(--s-muted);
}
[data-dsh-study] .study-guide-strip:hover .study-guide-strip-title { color: var(--s-text); }
[data-dsh-study] .study-guide-strip-face {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
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
`
