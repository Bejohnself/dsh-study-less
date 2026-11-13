/**
 * The study desk application shell.
 *
 * Three top-level sections share one reader and one refresh token:
 * 变强清单 (library), 学习之路 (today/paths/review) and 大道至简 (insights).
 * Settings is a utility dialog, not a fourth destination.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { InsightTab } from './pages/insights.tsx'
import { ConceptDetailPage, InsightDetailPage, InsightsPage } from './pages/insights.tsx'
import type { LearnTab } from './pages/learn.tsx'
import { LearnPage, NewGoalDialog, PlanDetailPage } from './pages/learn.tsx'
import { LibraryPage, MaterialPage } from './pages/library.tsx'
import { SettingsDialog } from './pages/settings.tsx'
import { ImportDialog } from './components/import.tsx'
import { Toast, TopNav, type TopTab } from './components/ui.tsx'

type View =
  | { kind: 'library' }
  | { kind: 'material'; mid: string; uid?: string; planId?: string }
  | { kind: 'learn'; tab: LearnTab }
  | { kind: 'plan'; pid: string }
  | { kind: 'insights'; tab: InsightTab }
  | { kind: 'insight'; iid: string }
  | { kind: 'concept'; cid: string }

/** The main study desk page. */
export function StudyApp(): ReactElement {
  const [view, setView] = useState<View>({ kind: 'learn', tab: 'today' })
  const [dialog, setDialog] = useState<'import' | 'settings' | 'goal' | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const bump = (): void => setRefreshToken(value => value + 1)

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const top: TopTab =
    view.kind === 'library' || (view.kind === 'material' && view.planId === undefined)
      ? 'library'
      : view.kind === 'learn' || view.kind === 'plan' || view.kind === 'material'
        ? 'learn'
        : 'insights'

  const subtitle = useMemo(() => {
    if (view.kind === 'library') return '知识库：书与论文统一管理，勾选即记录首次学习'
    if (view.kind === 'material') return '目录、原文、精读、练习与提炼，都在同一页'
    if (view.kind === 'learn' && view.tab === 'today') return '只给三件事：下一步、到期复习、一条洞察'
    if (view.kind === 'learn' && view.tab === 'paths') return '一个目标串起多份资料；页面内直接编排'
    if (view.kind === 'learn' && view.tab === 'review') return '先复述，再看最小对照，最后评级'
    if (view.kind === 'plan') return '每一步都指向真实单元；勾掉即推进'
    if (view.kind === 'insights' && view.tab === 'insights') return '把书读薄：一句话本质、公式、对比与误区'
    if (view.kind === 'insights' && view.tab === 'concepts') return '跨资料共享掌握度；点开概念跳到所有出现位置'
    if (view.kind === 'insight') return '一条洞察的全部来源与相关概念'
    return '同一个概念在不同资料里的所有位置'
  }, [view])

  const openUnit = (mid: string, uid: string, planId?: string): void => {
    setView({ kind: 'material', mid, uid, ...(planId === undefined ? {} : { planId }) })
  }
  const openConcept = (cid: string): void => setView({ kind: 'concept', cid })
  const openInsight = (iid: string): void => setView({ kind: 'insight', iid })

  return (
    <div data-dsh-study="" className="study-page">
      <div className="study-shell">
        <div className="study-head">
          <h1>书桌</h1>
          <span className="study-sub">{subtitle}</span>
          <div className="study-head-nav">
            <TopNav
              active={top}
              onSelect={tab => {
                if (tab === 'library') setView({ kind: 'library' })
                else if (tab === 'learn') setView({ kind: 'learn', tab: 'today' })
                else setView({ kind: 'insights', tab: 'insights' })
              }}
            />
            <div className="study-head-actions">
              <button type="button" className="study-ghost" onClick={() => setDialog('import')}>
                ＋ 导入
              </button>
              <button type="button" className="study-ghost" onClick={() => setDialog('settings')}>
                设置
              </button>
              <button type="button" className="study-primary study-primary-tight" onClick={() => setDialog('goal')}>
                ＋ 新建目标
              </button>
            </div>
          </div>
        </div>

        {view.kind === 'library' ? (
          <LibraryPage refreshToken={refreshToken} onOpen={mid => setView({ kind: 'material', mid })} onImport={() => setDialog('import')} />
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
            onChanged={bump}
          />
        ) : null}

        {view.kind === 'learn' ? (
          <LearnPage
            tab={view.tab}
            onTab={tab => setView({ kind: 'learn', tab })}
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
            onBack={() => setView({ kind: 'learn', tab: 'paths' })}
            onOpenUnit={openUnit}
            onOpenConcept={openConcept}
            onOpenInsight={openInsight}
            refreshToken={refreshToken}
            onChanged={bump}
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
        {dialog === 'goal' ? (
          <NewGoalDialog
            onClose={() => setDialog(null)}
            onOpenLibrary={() => {
              setDialog(null)
              setView({ kind: 'library' })
            }}
            onCreated={(planId, jobId) => {
              bump()
              setView({ kind: 'plan', pid: planId })
              setToast({
                message: jobId === undefined ? '已创建目标' : '已创建目标，正在页面内编排',
                tone: 'ok',
              })
            }}
          />
        ) : null}

        {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
      </div>
    </div>
  )
}
