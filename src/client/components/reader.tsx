/**
 * The reading surface.
 *
 * One screen, two columns: the original PDF on the left, the guiding rail on the
 * right. There are no tabs — the rail follows the pages and asks one question per
 * semantic block, and it never explains.
 *
 * Nothing on this screen is a progress record: no page counter, no "read" mark,
 * no time spent. That is a rule, not an omission (DESIGN.md 信息架构,
 * §8.10). The closure gate is the only place that judges anything.
 */import type {ReactElement} from 'react'
import {PdfPage} from './reader/pdfPage.tsx'
import {
  AskPanel,
  GoalStrip,
  Mascot,
  Rail,
  SelectionBar,
  Thinking,
  TINT_PREF,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  ZoomBar,
  tintOf,
  tintVisible,
} from './reader/chrome.tsx'
import {EmptyState, InlineMarkdown, JobBanner, Toast} from './ui.tsx'
import {promptKindLabel} from '../labels.ts'
import {useUnitReader, type UnitReaderProps} from './reader/useUnitReader.ts'

/** The reading surface: props in, markup out. State lives in `useUnitReader`. */
export function UnitReader(props: UnitReaderProps): ReactElement {
  const {
    tocListRef,
    currentTocRef,
    thinkTimer,
    lastBlockId,
    suppressClick,
    columnRef,
    pageElements,
    layoutRef,
    loadLayout,
    load,
    zoomIn,
    zoomOut,
    zoomFit,
    registerPage,
    runJob,
    toggleTint,
    generateBlocks,
    mergeBlock,
    clampPos,
    beginDrag,
    startCardDrag,
    dockTo,
    startSpriteDrag,
    openGuide,
    openAsk,
    pages,
    page,
    blocks,
    activePara,
    activeBlock,
    activeIndex,
    tint,
    mood,
    marksOf,
    centerCurrentToc,
    unit,
    setUnit,
    layout,
    setLayout,
    error,
    setError,
    job,
    setJob,
    busy,
    setBusy,
    toast,
    setToast,
    showTint,
    setShowTint,
    tocOpen,
    setTocOpen,
    ask,
    setAsk,
    askSeed,
    setAskSeed,
    askNonce,
    setAskNonce,
    askPage,
    setAskPage,
    askAction,
    setAskAction,
    quickActions,
    setQuickActions,
    selection,
    setSelection,
    activePage,
    setActivePage,
    activeParaIndex,
    setActiveParaIndex,
    full,
    toggleFull,
    exitFull,
    zoom,
    cardPos,
    setCardPos,
    dock,
    setDock,
    dockY,
    setDockY,
    barOpen,
    setBarOpen,
    open,
    setOpen,
    trouble,
    setTrouble,
    side,
    setSide,
    thinking,
    setThinking,
    columnWidth,
    setColumnWidth,
    mid,
    uid,
    planId,
    toc,
    onSelectUnit,
    onBack,
    onOpenQuiz,
    onChanged,
  } = useUnitReader(props)
  if (error !== null) return <div className="study-empty">无法打开这一节：{error}</div>
  if (unit === null) return <div className="study-empty">正在载入…</div>

  return (
    <div className={full ? 'study-reader2 is-full' : 'study-reader2'}>
      {/* Fullscreen keeps only what reading needs: the page, and the actions that
          act on it. */}
      {full ? (
        barOpen ? (
          <div className="study-floatbar">
            <span className="study-floatbar-title">{unit.unit.title}</span>
            <ZoomBar zoom={zoom} tone="float" onOut={zoomOut} onIn={zoomIn} onFit={zoomFit} />
            <button type="button" className="study-floatbar-btn" onClick={() => setTocOpen(true)}>
              目录
            </button>
            <button type="button" className="study-floatbar-btn" onClick={() => onOpenQuiz?.(unit.unit)}>
              过关测试
            </button>
            <button type="button" className="study-floatbar-btn is-primary" onClick={exitFull}>
              退出全屏
            </button>
            <button
              type="button"
              className="study-floatbar-btn study-floatbar-collapse"
              onClick={() => setBarOpen(false)}
              title="把功能栏收到屏幕边上"
              aria-label="收起功能栏"
            >
              ›
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="study-floatbar study-floatbar-tab"
            onClick={() => setBarOpen(true)}
            title="展开功能栏"
            aria-label="展开功能栏"
          >
            ‹
          </button>
        )
      ) : null}
      <div className="study-reader2-top">
        {planId === undefined ? null : (
          <GoalStrip
            planId={planId}
            mid={mid}
            uid={uid}
            onBack={onBack}
          />
        )}
        <div className="study-reader2-head">
          <button type="button" className="study-back" onClick={onBack} aria-label="返回">
            ←
          </button>
          <div className="study-reader2-title">
            <h2>{unit.unit.title}</h2>
            <span className="study-reader-sub">
              {unit.material.title} · p{unit.unit.pageStart}–p{unit.unit.pageEnd} · 全书 {unit.material.pages} 页
            </span>
          </div>
          <div className="study-reader2-actions">
            <ZoomBar zoom={zoom} tone="head" onOut={zoomOut} onIn={zoomIn} onFit={zoomFit} />
            {unit.blocks === null ? null : (
              <button type="button" className="study-ghost" onClick={toggleTint} aria-pressed={!showTint}>
                {showTint ? '隐藏颜色' : '显示颜色'}
              </button>
            )}
            <button type="button" className="study-ghost" onClick={toggleFull}>
              {full ? '退出全屏' : '全屏'}
            </button>
            <button type="button" className="study-ghost" onClick={() => setTocOpen(true)}>
              目录
            </button>
            <button type="button" className="study-ghost" onClick={generateBlocks} disabled={busy !== null}>
              {busy === null ? (unit.blocks === null ? '生成引导' : '重新生成引导') : '生成中…'}
            </button>
            <button type="button" className="study-primary study-primary-tight" onClick={() => onOpenQuiz?.(unit.unit)}>
              过关测试
            </button>
          </div>
        </div>
      </div>

      <div className="study-reader2-body">
        <div className="study-pdf-col" ref={columnRef}>
          {unit.pdfAvailable ? (
            <div className="study-pdf-stack">
              {pages.map(pageNumber => (
                <PdfPage
                  key={pageNumber}
                  mid={mid}
                  page={pageNumber}
                  width={Math.max(0, Math.round(Math.max(0, columnWidth - 32) * zoom))}
                  marks={marksOf(pageNumber)}
                  tint={tint}
                  showTint={showTint}
                  onMount={registerPage}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="原文件不在库里。"
              hint="这一节的 PDF 已经不在磁盘上了：重新导入这份资料。"
            />
          )}
        </div>
      </div>

      {selection === null ? null : (
        <SelectionBar
          selection={selection}
          actions={quickActions}
          onAsk={() => openAsk(selection.text, selection.page ?? undefined)}
          onAction={action => openAsk(selection.text, selection.page ?? undefined, action)}
        />
      )}

      {/* One anchor, two states: the whale in the corner, or the card it opens
          into. Keeping the anchor mounted is what stops the button from jumping
          when the card closes — both live at the same point. */}
      {ask ? null : (
        <div
          className={`study-guide${open ? ' is-open' : ''}${dock === null ? '' : ' is-docked'}`}
          {...(dock === null ? {} : { 'data-dock': dock })}
          style={
            dock !== null
              ? dockY === null
                ? undefined
                : { top: `${String(dockY)}px`, bottom: 'auto' }
              : cardPos === null
                ? undefined
                : { left: `${String(cardPos.x)}px`, top: `${String(cardPos.y)}px`, right: 'auto', bottom: 'auto' }
          }
        >
          {open ? (
            <section
              className="study-companion"
              aria-label="引导"
              data-vertical={side.vertical}
              data-align={side.align}
              style={{ '--s-tint': tint } as React.CSSProperties}
            >
              <div
                className="study-companion-head"
                onPointerDown={startCardDrag}
                title={
                  activeBlock === null
                    ? '引导'
                    : activeBlock.startPage === activeBlock.endPage
                      ? `第 ${String(activeBlock.startPage)} 页 · 不记进度`
                      : `第 ${String(activeBlock.startPage)}–${String(activeBlock.endPage)} 页 · 不记进度`
                }
              >
                <span className="study-companion-avatar">
                  <Mascot mood={mood} thinking={thinking} />
                </span>
                <span className="study-companion-title">
                  {activeBlock === null ? '引导' : <InlineMarkdown source={activeBlock.title} />}
                </span>
                {activeBlock?.prompt === undefined ? null : (
                  <span className="study-rail-kind">{promptKindLabel(activeBlock.prompt.kind)}</span>
                )}
                <button
                  type="button"
                  className="study-companion-toggle"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => dockTo(dock === null ? 'right' : null, cardPos?.y ?? null)}
                  title={dock === null ? '贴到屏幕边上' : '回到原来的角落'}
                  aria-label={dock === null ? '贴到屏幕边上' : '取消贴边'}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9.5 3.2 5.8 8l3.7 4.8" />
                    <path d="M13 2.5v11" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="study-companion-toggle"
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => setOpen(false)}
                  aria-label="收起小鲸鱼"
                >
                  ↓
                </button>
              </div>

              <div className="study-companion-body">
                {job === null ? null : <JobBanner job={job} />}
                {busy !== null && job === null ? <p className="study-rail-empty">{busy}</p> : null}

                {thinking ? (
                  <div className="study-companion-think">
                    <Thinking />
                    <span>唔…我想想</span>
                  </div>
                ) : blocks === null ? (
                  <div className="study-rail-card">
                    <p className="study-rail-empty">我还没读这一节呢。要我按意思分几段吗？</p>
                    <button
                      type="button"
                      className="study-primary study-primary-tight"
                      onClick={generateBlocks}
                      disabled={busy !== null}
                    >
                      {busy === null ? '帮我分块' : '正在翻书…'}
                    </button>
                  </div>
                ) : activeBlock === null ? (
                  <p className="study-rail-empty">诶，这段好像没分到块里。</p>
                ) : (
                  <Rail
                    block={activeBlock}
                    index={activeIndex}
                    busy={busy !== null}
                    onAsk={() => openAsk(activePara?.text)}
                    onMerge={() => void mergeBlock(activeBlock.id)}
                  />
                )}

              </div>
            </section>
          ) : dock !== null ? (
            <button
              type="button"
              className="study-guide-strip"
              onPointerDown={startSpriteDrag}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                openGuide()
              }}
              title="展开引导（还在这条边上）"
              aria-label="展开引导"
            >
              <span className="study-guide-strip-title">
                {activeBlock === null ? '引导' : <InlineMarkdown source={activeBlock.title} />}
              </span>
              <span className="study-guide-strip-face">
                <Mascot mood={trouble ? 'worried' : 'cute'} />
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="study-sprite"
              onPointerDown={startSpriteDrag}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                openGuide()
              }}
              title="叫醒大肥鱼（它不记你读了多少）"
              aria-label="打开引导"
            >
              <Mascot mood={trouble ? 'worried' : 'cute'} />
            </button>
          )}
        </div>
      )}

      {ask ? (
        <AskPanel
          key={askNonce}
          mid={mid}
          uid={uid}
          page={askPage ?? page}
          {...(askSeed === undefined ? {} : { seed: askSeed })}
          {...(askAction === null ? {} : { action: askAction })}
          onClose={() => {
            setAsk(false)
            setAskSeed(undefined)
          }}
        />
      ) : null}

      {tocOpen ? (
        <div className="study-overlay" onClick={() => setTocOpen(false)}>
          <div className="study-drawer" onClick={event => event.stopPropagation()}>
            <div className="study-drawer-head">
              <h3>目录</h3>
              <button
                type="button"
                className="study-ghost"
                onClick={() => centerCurrentToc('smooth')}
                title="把目录滚动到当前这一节"
              >
                定位当前节
              </button>
              <button type="button" className="study-ghost" onClick={() => setTocOpen(false)}>
                关闭
              </button>
            </div>
            <nav className="study-drawer-list" ref={tocListRef}>
              {toc.map(row => (
                <button
                  key={row.uid}
                  ref={row.uid === uid ? currentTocRef : null}
                  type="button"
                  aria-current={row.uid === uid ? 'page' : undefined}
                  className={row.uid === uid ? 'study-drawer-row is-on' : 'study-drawer-row'}
                  onClick={() => {
                    setTocOpen(false)
                    onSelectUnit(row.uid)
                  }}
                >
                  <span className="study-drawer-title">{row.title}</span>
                  <span className="study-drawer-meta">
                    p{row.pageStart}–p{row.pageEnd}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      ) : null}

      {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
    </div>
  )
}
