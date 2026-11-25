/** 副导航与面板、自编书。
 * 从 styles.ts 按段落拆出，拼接顺序即原样式顺序。
 */
export const PANELS_CSS = `/* ---------- 0.2: sub navigation, dashboards, insights, jobs ---------- */
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
[data-dsh-study] .study-clock { display: inline-flex; align-items: center; gap: 6px; }
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
[data-dsh-study] .study-usage-note {
  display: block;
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--s-faint);
  line-height: 1.5;
}
[data-dsh-study] .study-job .study-usage-note { margin-top: 0; }
[data-dsh-study] .study-usage-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface-2);
}
[data-dsh-study] .study-usage-summary > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
[data-dsh-study] .study-usage-summary strong { font-size: 14px; font-weight: 650; color: var(--s-text); }
[data-dsh-study] .study-usage-heat { margin-top: 14px; }
[data-dsh-study] .study-usage-heat > .study-muted { margin: 0 0 8px; font-size: 12px; }
[data-dsh-study] .study-usage-heat-body { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
[data-dsh-study] .study-usage-heat-days {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  gap: 3px;
  font-size: 10px;
  line-height: 12px;
  color: var(--s-faint);
  text-align: right;
}
[data-dsh-study] .study-usage-heat-days span { height: 12px; }
[data-dsh-study] .study-usage-heat-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 12px);
  grid-auto-columns: 12px;
  gap: 3px;
}
[data-dsh-study] .study-usage-heat-cell {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: var(--s-surface-3);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--s-border) 70%, transparent);
}
[data-dsh-study] .study-usage-heat-cell.is-1 { background: color-mix(in srgb, var(--s-primary) 16%, var(--s-surface-2)); }
[data-dsh-study] .study-usage-heat-cell.is-2 { background: color-mix(in srgb, var(--s-primary) 34%, var(--s-surface-2)); }
[data-dsh-study] .study-usage-heat-cell.is-3 { background: color-mix(in srgb, var(--s-primary) 56%, var(--s-surface-2)); }
[data-dsh-study] .study-usage-heat-cell.is-4 { background: color-mix(in srgb, var(--s-primary) 82%, var(--s-surface-2)); }
[data-dsh-study] .study-usage-heat-cell.is-empty { background: transparent; box-shadow: none; }
[data-dsh-study] .study-usage-heat-cell.is-today { box-shadow: inset 0 0 0 1px var(--s-primary-strong); }
[data-dsh-study] .study-usage-heat-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--s-faint);
}
[data-dsh-study] .study-reader-actions { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz { display: flex; flex-direction: column; gap: 14px; }
[data-dsh-study] .study-quiz-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz-test {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12px;
}
[data-dsh-study] .study-quiz-test .study-ghost { padding: 3px 8px; font-size: 12px; }
[data-dsh-study] .study-quiz-start { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--s-border); border-radius: 4px; background: var(--s-surface); }
[data-dsh-study] .study-quiz-runner { display: flex; flex-direction: column; gap: 12px; }
[data-dsh-study] .study-quiz-progress { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; }
[data-dsh-study] .study-quiz-progress-num { color: var(--s-faint); font-size: 11.5px; }
[data-dsh-study] .study-quiz-question { margin: 8px 0 10px; font-family: var(--s-reading-font); font-size: 15px; font-weight: 500; line-height: 1.8; }
[data-dsh-study] .study-quiz-question p { margin: .5em 0; }
[data-dsh-study] .study-quiz-question math,
[data-dsh-study] .study-quiz-question math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-quiz-math-hint { margin: 6px 0 0; font-size: 11.5px; color: var(--s-faint); }
[data-dsh-study] .study-quiz-preview {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--s-border-strong);
  border-radius: 4px;
  background: var(--s-surface-2);
}
[data-dsh-study] .study-quiz-preview > .study-field-label { display: block; margin-bottom: 5px; }
[data-dsh-study] .study-quiz-answer-preview {
  margin: 0;
  font-family: var(--s-reading-font);
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--s-text);
  overflow-wrap: anywhere;
}
[data-dsh-study] .study-quiz-answer-preview p { margin: .35em 0; }
[data-dsh-study] .study-quiz-answer-preview math,
[data-dsh-study] .study-quiz-answer-preview math * { font-family: var(--s-math-font); }
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
/* 出题花费是头行里最次的信息：贴右端，跟题号那一排同一行，不另起一块。 */
[data-dsh-study] .study-quiz-head .study-usage-note { margin: 0 0 0 auto; line-height: 1.4; text-align: right; }
[data-dsh-study] .study-quiz-index { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 999px; background: var(--s-primary-soft); color: var(--s-primary-ink); font-weight: 650; }
[data-dsh-study] .study-quiz-type { text-transform: uppercase; letter-spacing: .05em; font-size: 10.5px; }
[data-dsh-study] .study-quiz-choices { display: flex; flex-direction: column; gap: 6px; }
[data-dsh-study] .study-quiz-choice { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 3px; border: 1px solid var(--s-border); cursor: pointer; font-family: var(--s-reading-font); font-size: 13.5px; line-height: 1.7; }
[data-dsh-study] .study-quiz-choice p { margin: 0; }
[data-dsh-study] .study-quiz-choice math,
[data-dsh-study] .study-quiz-choice math * { font-family: var(--s-math-font); }
[data-dsh-study] .study-quiz-choice:hover { background: var(--s-surface-2); }
[data-dsh-study] .study-quiz-score { padding: 12px 14px; border-radius: 4px; background: var(--s-success-soft); color: var(--s-success); font-weight: 600; }
[data-dsh-study] .study-quiz-score.is-open { background: var(--s-surface-2); color: var(--s-primary-ink); }
[data-dsh-study] .study-quiz-start-actions,
[data-dsh-study] .study-quiz-summary-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
[data-dsh-study] .study-quiz-progress-num.is-on { color: var(--s-success); font-weight: 650; }
[data-dsh-study] .study-quiz-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
[data-dsh-study] .study-quiz-points.is-compact { flex-direction: row; flex-wrap: wrap; gap: 6px 16px; }
[data-dsh-study] .study-quiz-points.is-compact .study-quiz-point { flex: 1 1 230px; }
[data-dsh-study] .study-quiz-point {
  display: grid;
  grid-template-columns: minmax(76px, 1.1fr) minmax(80px, 2fr) auto;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: var(--s-muted);
}
[data-dsh-study] .study-quiz-point-name { overflow-wrap: anywhere; color: var(--s-text); }
[data-dsh-study] .study-quiz-point.is-on .study-quiz-point-name { color: var(--s-success); font-weight: 600; }
[data-dsh-study] .study-quiz-point-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--s-surface-2);
  overflow: hidden;
}
[data-dsh-study] .study-quiz-point-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, var(--s-primary) 55%, transparent);
}
[data-dsh-study] .study-quiz-point.is-on .study-quiz-point-fill { background: var(--s-success); }
[data-dsh-study] .study-quiz-point-target {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--s-border-strong);
}
[data-dsh-study] .study-quiz-point-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 11.5px; }
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
[data-dsh-study] .study-quick-action .study-row { align-items: flex-end; }
[data-dsh-study] .study-quick-action-name { flex: 0 0 110px; }
[data-dsh-study] .study-quick-action-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  margin-bottom: 14px;
}
[data-dsh-study] .study-quick-action-move { padding: 4px 9px; font-size: 12px; line-height: 1.4; }
[data-dsh-study] .study-quick-action-move:disabled { opacity: .35; cursor: default; }
[data-dsh-study] .study-quick-action-remove { flex: none; }
[data-dsh-study] .study-quick-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--s-muted);
}
[data-dsh-study] .study-quick-chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--s-border);
  background: var(--s-surface-2);
  font-size: 11.5px;
  color: var(--s-text);
}
[data-dsh-study] .study-quick-chip.is-ask { color: var(--s-muted); }
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

/* Goal, crop list, attempts and the closure gate (DESIGN.md). */
[data-dsh-study] .study-goal-card,
[data-dsh-study] .study-boundary,
[data-dsh-study] .study-attempts,
[data-dsh-study] .study-mastery {
  margin: 18px 0;
  padding: 18px;
  border: 1px solid var(--s-border);
  border-radius: 4px;
  background: var(--s-surface);
}
[data-dsh-study] .study-mastery-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
[data-dsh-study] .study-mastery-item { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border: 1px solid var(--s-border); border-radius: 4px; }
[data-dsh-study] .study-mastery-item.is-passed { border-color: var(--s-success); background: var(--s-success-soft); }
[data-dsh-study] .study-mastery-body { flex: 1; min-width: 0; }
[data-dsh-study] .study-point-list { list-style: none; margin: 7px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
[data-dsh-study] .study-point-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--s-muted); }
[data-dsh-study] .study-point-row.is-on .study-point-name { color: var(--s-success); }
[data-dsh-study] .study-point-name { overflow-wrap: anywhere; }
[data-dsh-study] .study-point-value { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 11.5px; }
[data-dsh-study] .study-point-empty { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; }
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
[data-dsh-study] .study-panel-head.is-split { align-items: flex-start; justify-content: space-between; }
[data-dsh-study] .study-panel-head-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; min-width: 0; flex: 1; }
[data-dsh-study] .study-panel-head-main h3 { margin: 0; font-size: 15px; }
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
`
