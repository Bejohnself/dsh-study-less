/**
 * The study desk application shell.
 *
 * Three top-level sections share one reader and one refresh token:
 * 书架 (library), 阅读 (today/paths/review) and 笔记（实验，insights）.
 * The 笔记（实验）entry can be hidden from settings.
 * Positioning lives in docs/POSITIONING.md; the copy here follows its glossary.
 * Settings is a utility dialog, not a fourth destination.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { InsightTab } from './pages/insights.tsx'
import { ConceptDetailPage, InsightDetailPage, InsightsPage } from './pages/insights.tsx'
import { LearnPage } from './pages/learn.tsx'
import { PlanDetailPage } from './pages/plan.tsx'
import { LibraryPage, MaterialPage } from './pages/library.tsx'
import { PracticePage } from './pages/practice.tsx'
import { BookPage } from './pages/book.tsx'
import { SettingsDialog } from './pages/settings.tsx'
import { ImportDialog } from './components/import.tsx'
import { Toast, TopNav, ThemeToggle, type TopTab } from './components/ui.tsx'
import { api } from './api.ts'
import type { TocRow } from '../core/views.ts'
import { PLUGIN_VERSION } from '../core/version.ts'

type View =
  | { kind: 'library' }
  | { kind: 'material'; mid: string; uid?: string; planId?: string }
  | { kind: 'practice'; mid: string; unit: TocRow; planId?: string }
  | { kind: 'learn' }
  | { kind: 'plan'; pid: string }
  | { kind: 'book'; bid: string; cid?: string; pid?: string }
  | { kind: 'insights'; tab: InsightTab }
  | { kind: 'insight'; iid: string }
  | { kind: 'concept'; cid: string }

/** The main study desk page. */
export function StudyApp(): ReactElement {
  const [view, setView] = useState<View>({ kind: 'learn' })
  const [dialog, setDialog] = useState<'import' | 'settings' | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [hostVersion, setHostVersion] = useState<string | null>(null)

  const bump = (): void => setRefreshToken(value => value + 1)

  useEffect(() => {
    api<{ version: string }>('/health')
      .then(value => setHostVersion(value.version))
      .catch(() => setHostVersion(null))
  }, [])

  // The panel and the Host are reloaded separately: an older Host is worth a
  // visible warning, because its API predates this panel's shape.
  const staleHost = hostVersion !== null && hostVersion !== PLUGIN_VERSION

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const top: TopTab =
    view.kind === 'practice'
      ? view.planId === undefined
        ? 'library'
        : 'learn'
      : view.kind === 'library' || (view.kind === 'material' && view.planId === undefined)
        ? 'library'
        : view.kind === 'learn' || view.kind === 'plan' || view.kind === 'book' || view.kind === 'material'
          ? 'learn'
          : 'insights'

  const subtitle = useMemo(() => {
    if (view.kind === 'library') return '书都在这儿。点一本就开始，不点也不欠谁。'
    if (view.kind === 'material') return '原文、引导、练习，都在这一页。'
    if (view.kind === 'practice') return '一次一题。答完判分，下一题按你答得怎么样来挑。'
    if (view.kind === 'learn' && view.tab === 'today') return '今天只看三件事：接着读、该复习、练最弱的。'
    if (view.kind === 'learn' && view.tab === 'paths') return '一个目标串起好几本；每一步都落到真实的一节。'
    if (view.kind === 'learn' && view.tab === 'review') return '先自己说一遍，再看最小的对照，最后评个级。'
    if (view.kind === 'plan') return '做完一步，推进一步；够了就结案。'
    if (view.kind === 'book') return '自编书（实验）：有目录、有过渡，能一直读下去。'
    if (view.kind === 'insights' && view.tab === 'insights') return '笔记（实验）：把一本书读成一句话、一条公式、一处对比。'
    if (view.kind === 'insights' && view.tab === 'concepts') return '同一个概念在很多书里出现过，这里是它的全部位置。'
    if (view.kind === 'insight') return '一条笔记的全部出处和相关概念。'
    return '这个概念在每份资料里的位置。'
  }, [view])

  const openUnit = (mid: string, uid: string, planId?: string): void => {
    setView({ kind: 'material', mid, uid, ...(planId === undefined ? {} : { planId }) })
  }
  const openConcept = (cid: string): void => setView({ kind: 'concept', cid })
  const openInsight = (iid: string): void => setView({ kind: 'insight', iid })
  const openBook = (bid: string, planId?: string): void => setView({ kind: 'book', bid, ...(planId === undefined ? {} : { pid: planId }) })

  // 过关测试 is a focused run: only theme and settings belong in the bar.
  const focusMode = view.kind === 'practice'

  return (
    <div data-dsh-study="" className="study-page">
      <div className={view.kind === 'material' || view.kind === 'practice' ? 'study-shell is-reader' : 'study-shell'}>
        <div className={focusMode ? 'study-head is-focus' : 'study-head'}>
          <h1>书桌</h1>
          {focusMode ? null : (
            <span
              className={staleHost ? 'study-version is-stale' : 'study-version'}
              title={staleHost ? 'Host 仍在跑旧代码：重载插件后再刷新页面' : '插件版本'}
            >
              v{PLUGIN_VERSION}
              {staleHost ? ' · Host 需重载' : ''}
            </span>
          )}
          {focusMode ? null : <span className="study-sub">{subtitle}</span>}
          <div className="study-head-nav">
            {focusMode ? null : (
              <TopNav
                active={top}
                showInsights={false}
                onSelect={tab => {
                  if (tab === 'library') setView({ kind: 'library' })
                  else if (tab === 'learn') setView({ kind: 'learn' })
                  else setView({ kind: 'insights', tab: 'insights' })
                }}
              />
            )}
            <div className="study-head-actions">
              <ThemeToggle />
              {focusMode ? null : (
                <button type="button" className="study-ghost" onClick={() => setDialog('import')}>
                  ＋ 导入
                </button>
              )}
              <button type="button" className="study-ghost" onClick={() => setDialog('settings')}>
                设置
              </button>
            </div>
          </div>
        </div>

        {view.kind === 'library' ? (
          <LibraryPage
            refreshToken={refreshToken}
            onOpen={mid => setView({ kind: 'material', mid })}
            onImport={() => setDialog('import')}
            onOpenBook={bid => openBook(bid)}
          />
        ) : null}

        {view.kind === 'material' ? (
          <MaterialPage
            mid={view.mid}
            {...(view.uid === undefined ? {} : { initialUid: view.uid })}
            {...(view.planId === undefined ? {} : { planId: view.planId })}
            refreshToken={refreshToken}
            onBack={() => setView(view.planId === undefined ? { kind: 'library' } : { kind: 'plan', pid: view.planId })}
            onOpenConcept={openConcept}
            onOpenInsight={openInsight}
            onOpenPlan={pid => setView({ kind: 'plan', pid })}
            onOpenQuiz={(mid, unit, planId) =>
              setView({
                kind: 'practice',
                mid,
                unit,
                ...(planId === undefined ? {} : { planId }),
              })
            }
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'practice' ? (
          <PracticePage
            mid={view.mid}
            unit={view.unit}
            {...(view.planId === undefined ? {} : { planId: view.planId })}
            onBack={() =>
              setView({
                kind: 'material',
                mid: view.mid,
                uid: view.unit.uid,
                ...(view.planId === undefined ? {} : { planId: view.planId }),
              })
            }
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'learn' ? (
          <LearnPage
            tab={view.tab}

            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
            onOpenInsight={openInsight}
            onOpenPlan={pid => setView({ kind: 'plan', pid })}
            onOpenLibrary={() => setView({ kind: 'library' })}
            refreshToken={refreshToken}
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'plan' ? (
          <PlanDetailPage
            pid={view.pid}
            onBack={() => setView({ kind: 'learn' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
            onOpenInsight={openInsight}
            onOpenBook={openBook}
            refreshToken={refreshToken}
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'book' ? (
          <BookPage
            bid={view.bid}
            {...(view.cid === undefined ? {} : { cid: view.cid })}
            onBack={() => setView(view.pid === undefined ? { kind: 'learn' } : { kind: 'plan', pid: view.pid })}
            onOpenChapter={chapterId => setView({ kind: 'book', bid: view.bid, cid: chapterId, ...(view.pid === undefined ? {} : { pid: view.pid }) })}
            onOpenUnit={(mid, uid) => openUnit(mid, uid)}
            onChanged={bump}
            refreshToken={refreshToken}
          />
        ) : null}

        {view.kind === 'insights' ? (

          <InsightsPage
            tab={view.tab}
            onTab={tab => setView({ kind: 'insights', tab })}
            onOpenInsight={openInsight}
            onOpenConcept={openConcept}
            refreshToken={refreshToken}
          />
        ) : null}

        {view.kind === 'insight' ? (
          <InsightDetailPage
            iid={view.iid}
            onBack={() => setView({ kind: 'insights', tab: 'insights' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
            refreshToken={refreshToken}
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'concept' ? (
          <ConceptDetailPage
            cid={view.cid}
            onBack={() => setView({ kind: 'insights', tab: 'concepts' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
            refreshToken={refreshToken}
            onChanged={bump}
          />
        ) : null}

        {dialog === 'import' ? (
          <ImportDialog
            onClose={() => setDialog(null)}
            onImported={message => {
              bump()
              setToast({ message, tone: 'ok' })
            }}
          />
        ) : null}
        {dialog === 'settings' ? (
          <SettingsDialog
            onClose={() => setDialog(null)}
            onSaved={() => {
              bump()
            }}
          />
        ) : null}
        {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
      </div>
    </div>
  )
}
