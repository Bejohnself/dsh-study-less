/**
 * 笔记（实验）: distilled insight cards and the global concept graph.
 *
 * Insights are the "read the book down to one page" layer; concepts are the
 * cross-material index. Both jump back to the exact page they came from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  ConceptCard,
  ConceptDetailView,
  InsightCard,
  InsightDetailView,
  JobView,
} from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { ROLE_LABEL, insightKindLabel } from '../labels.ts'
import { Chips, EmptyState, JobBanner, Markdown, Modal, SubNav, Toast } from '../components/ui.tsx'

export type InsightTab = 'insights' | 'concepts'

/** The list surface for insights and concepts. */
export function InsightsPage({
  tab,
  onTab,
  onOpenInsight,
  onOpenConcept,
  refreshToken,
}: {
  tab: InsightTab
  onTab: (tab: InsightTab) => void
  onOpenInsight: (iid: string) => void
  onOpenConcept: (cid: string) => void
  refreshToken: number
}): ReactElement {
  return (
    <div className="study-insights">
      <div className="study-learn-bar">
        <SubNav
          items={[
            { id: 'insights', label: '洞察' },
            { id: 'concepts', label: '概念' },
          ]}
          active={tab}
          onSelect={onTab}
        />
      </div>
      {tab === 'insights' ? <InsightList onOpen={onOpenInsight} refreshToken={refreshToken} /> : null}
      {tab === 'concepts' ? <ConceptList onOpen={onOpenConcept} refreshToken={refreshToken} /> : null}
    </div>
  )
}

function InsightList({ onOpen, refreshToken }: { onOpen: (iid: string) => void; refreshToken: number }): ReactElement {
  const [items, setItems] = useState<InsightCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)

  useEffect(() => {
    let alive = true
    api<InsightCard[]>('/insights')
      .then(value => {
        if (alive) setItems(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (items ?? []).filter(item => {
      if (pinnedOnly && !item.pinned) return false
      if (term.length === 0) return true
      return `${item.title} ${item.oneLiner} ${item.tags.join(' ')}`.toLowerCase().includes(term)
    })
  }, [items, pinnedOnly, query])

  if (error !== null) return <div className="study-empty">无法读取洞察：{error}</div>
  if (items === null) return <div className="study-empty">正在读取洞察…</div>
  if (items.length === 0) {
    return (
      <EmptyState
        title="还没攒下笔记。"
        hint="随便打开一节，点「提炼洞察」；或者把同一个概念在不同书里的讲法摆在一起，比较本身就是一条笔记。"
      />
    )
  }

  return (
    <div className="study-insight-page">
      <div className="study-library-tools">
        <input
          type="search"
          className="study-input"
          placeholder="搜索标题 / 一句话 / 标签"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <label className="study-inline-check">
          <input type="checkbox" checked={pinnedOnly} onChange={event => setPinnedOnly(event.target.checked)} />
          只看钉选
        </label>
      </div>

      <div className="study-insight-grid">
        {filtered.map(item => (
          <button key={item.id} type="button" className={`study-insight-card${item.pinned ? ' is-pinned' : ''}`} onClick={() => onOpen(item.id)}>
            <span className="study-insight-card-head">
              <span className="study-insight-kind">{insightKindLabel(item.kind)}</span>
              {item.pinned ? <span className="study-badge study-badge-pin">钉选</span> : null}
              {item.origin === 'generated' ? <span className="study-badge study-badge-ai">AI</span> : null}
            </span>
            <span className="study-insight-title">{item.title}</span>
            <span className="study-insight-line">{item.oneLiner}</span>
            <span className="study-insight-meta">
              {item.sourceCount} 处来源{item.tags.length === 0 ? '' : ` · ${item.tags.join(' / ')}`}
            </span>
          </button>
        ))}
      </div>
      {filtered.length === 0 ? <div className="study-empty">没有符合筛选的洞察。</div> : null}
    </div>
  )
}

function ConceptList({ onOpen, refreshToken }: { onOpen: (cid: string) => void; refreshToken: number }): ReactElement {
  const [items, setItems] = useState<ConceptCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<ConceptCard[]>('/concepts')
      .then(value => {
        if (alive) setItems(value)
      })
      .catch(reason => {
        if (alive) setError(errorText(reason))
      })
    return () => {
      alive = false
    }
  }, [refreshToken])

  if (error !== null) return <div className="study-empty">无法读取概念：{error}</div>
  if (items === null) return <div className="study-empty">正在读取概念图…</div>
  if (items.length === 0) {
    return <EmptyState title="还没有概念。" hint="导读里登记过的概念会聚到这里，掌握度跨书共享。" />
  }

  return (
    <div className="study-concepts">
      {items.map(item => (
        <button key={item.id} type="button" className="study-concept-card" onClick={() => onOpen(item.id)}>
          <span className="study-concept-head">
            <span className="study-concept-name">{item.name}</span>
            {item.weak ? <span className="study-due-badge">薄弱</span> : null}
          </span>
          <span className="study-mastery">
            <span className="study-mastery-bar">
              <span style={{ width: `${Math.floor(item.mastery * 100)}%` }} />
            </span>
            <span className="study-muted">{Math.floor(item.mastery * 100)}%</span>
          </span>
          <span className="study-item-meta">
            {item.occurrences} 处 · {item.materials.join(' / ')}
          </span>
        </button>
      ))}
    </div>
  )
}

/** One insight with its sources and an editor. */
export function InsightDetailPage({
  iid,
  onBack,
  onOpenUnit,
  onOpenConcept,
  refreshToken,
  onChanged,
}: {
  iid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
  refreshToken: number
  onChanged: () => void
}): ReactElement {
  const [data, setData] = useState<InsightDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const reload = useCallback(async () => {
    setData(await api<InsightDetailView>(`/insight?iid=${encodeURIComponent(iid)}`))
  }, [iid])

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload, refreshToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const pin = async (pinned: boolean): Promise<void> => {
    try {
      await post('/insight/pin', { iid, pinned })
      await reload()
      onChanged()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm('删除这条洞察？来源页面不会受影响。')) return
    try {
      await post('/insight/delete', { iid })
      onChanged()
      onBack()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  if (error !== null) return <div className="study-empty">无法打开洞察：{error}</div>
  if (data === null) return <div className="study-empty">正在载入洞察…</div>

  const insight = data.insight

  return (
    <div className="study-insight-detail">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 笔记（实验）
        </button>
        <div className="study-reader-title">
          <h2>{insight.title}</h2>
          <span className="study-reader-sub">
            {insightKindLabel(insight.kind)} · {insight.origin === 'generated' ? 'AI 生成' : '手动'} · {insight.sources.length} 处来源
          </span>
        </div>
        <div className="study-inline">
          <button type="button" className="study-ghost" onClick={() => void pin(!insight.pinned)}>
            {insight.pinned ? '取消钉选' : '钉选'}
          </button>
          <button type="button" className="study-ghost" onClick={() => setEditing(true)}>
            编辑
          </button>
          <button type="button" className="study-ghost" onClick={() => void remove()}>
            删除
          </button>
        </div>
      </div>

      <p className="study-insight-one-liner">{insight.oneLiner}</p>
      {insight.formula === undefined ? null : (
        <div className="study-formula">
          <Markdown source={`$$${insight.formula}$$`} className="study-notes study-notes-formula" />
        </div>
      )}
      <Markdown source={insight.body} />
      {insight.tags.length > 0 ? (
        <div className="study-chips">
          {insight.tags.map(tag => (
            <span key={tag} className="study-chip study-chip-static">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {data.concepts.length > 0 ? (
        <>
          <h3 className="study-section-title">相关概念</h3>
          <Chips
            items={data.concepts.map(concept => ({ id: concept.id, label: concept.name }))}
            onSelect={onOpenConcept}
          />
        </>
      ) : null}

      <h3 className="study-section-title">来源</h3>
      <ul className="study-list">
        {data.sources.map(source => (
          <li key={`${source.materialId}:${source.unitId}:${source.page}`}>
            <button type="button" className="study-item" onClick={() => onOpenUnit(source.materialId, source.unitId)}>
              <span className="study-item-title">
                {source.unitTitle} <span className="study-role">p{source.page}</span>
              </span>
              <span className="study-item-meta">{source.materialTitle}</span>
              {source.quote === undefined ? null : <span className="study-quote">“{source.quote}”</span>}
            </button>
          </li>
        ))}
      </ul>

      {editing ? (
        <InsightEditor
          data={data}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            await reload()
            onChanged()
            setToast({ message: '已保存', tone: 'ok' })
          }}
        />
      ) : null}
      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}

/** Edit the text fields of an existing insight; sources stay page-bound. */
function InsightEditor({
  data,
  onClose,
  onSaved,
}: {
  data: InsightDetailView
  onClose: () => void
  onSaved: () => Promise<void>
}): ReactElement {
  const insight = data.insight
  const [title, setTitle] = useState(insight.title)
  const [oneLiner, setOneLiner] = useState(insight.oneLiner)
  const [body, setBody] = useState(insight.body)
  const [formula, setFormula] = useState(insight.formula ?? '')
  const [tags, setTags] = useState(insight.tags.join(', '))
  const [kind, setKind] = useState(insight.kind)
  const [pinned, setPinned] = useState(insight.pinned)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await post('/insight/update', {
        iid: insight.id,
        title,
        oneLiner,
        body,
        formula,
        kind,
        pinned,
        tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(tag => tag.length > 0),
      })
      await onSaved()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="编辑洞察" subtitle="来源页码保持不变；正文与公式使用 Markdown / LaTeX。" onClose={onClose} wide>
      <div className="study-field">
        <label className="study-field-label">标题</label>
        <input className="study-input" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />
      </div>
      <div className="study-field">
        <label className="study-field-label">一句话本质</label>
        <input className="study-input" value={oneLiner} disabled={busy} onChange={event => setOneLiner(event.target.value)} />
      </div>
      <div className="study-field">
        <label className="study-field-label">正文</label>
        <textarea className="study-input study-textarea study-textarea-tall" value={body} disabled={busy} onChange={event => setBody(event.target.value)} />
      </div>
      <div className="study-row">
        <div className="study-field">
          <label className="study-field-label">公式（可选，LaTeX）</label>
          <input className="study-input" value={formula} disabled={busy} onChange={event => setFormula(event.target.value)} />
        </div>
        <div className="study-field">
          <label className="study-field-label">类型</label>
          <select className="study-input" value={kind} disabled={busy} onChange={event => setKind(event.target.value as typeof kind)}>
            <option value="principle">原理</option>
            <option value="formula">公式</option>
            <option value="contrast">对比</option>
            <option value="pitfall">误区</option>
            <option value="analogy">类比</option>
            <option value="method">方法</option>
          </select>
        </div>
      </div>
      <div className="study-field">
        <label className="study-field-label">标签（逗号分隔）</label>
        <input className="study-input" value={tags} disabled={busy} onChange={event => setTags(event.target.value)} />
      </div>
      <label className="study-inline-check">
        <input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} />
        钉选到「今日」
      </label>
      {error === null ? null : <p className="study-form-error">{error}</p>}
      <div className="study-modal-actions">
        <button type="button" className="study-ghost" onClick={onClose}>
          取消
        </button>
        <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  )
}

/** One concept with every place it appears, plus cross-material synthesis. */
export function ConceptDetailPage({
  cid,
  onBack,
  onOpenUnit,
  onOpenConcept,
  refreshToken,
  onChanged,
}: {
  cid: string
  onBack: () => void
  onOpenUnit: (mid: string, uid: string) => void
  onOpenConcept: (cid: string) => void
  refreshToken: number
  onChanged: () => void
}): ReactElement {
  const [data, setData] = useState<ConceptDetailView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)

  const reload = useCallback(async () => {
    setData(await api<ConceptDetailView>(`/concept?cid=${encodeURIComponent(cid)}`))
  }, [cid])

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    reload().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [reload, refreshToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const synthesize = async (): Promise<void> => {
    setBusy(true)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>('/generate/insight', { concept: cid })
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        onChanged()
        setToast({ message: '已生成跨资料对比洞察', tone: 'ok' })
      } else if (finished.status === 'failed') {
        setToast({ message: finished.error ?? '生成失败', tone: 'error' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setBusy(false)
      setJob(null)
    }
  }

  if (error !== null) return <div className="study-empty">无法打开概念：{error}</div>
  if (data === null) return <div className="study-empty">正在载入概念…</div>

  return (
    <div className="study-concept-detail">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 笔记（实验）
        </button>
        <div className="study-reader-title">
          <h2>{data.concept.name}</h2>
          <span className="study-reader-sub">
            {data.mastery === undefined
              ? '尚未练习'
              : `掌握度 ${Math.floor(data.mastery.mastery * 100)}% · 答对 ${data.mastery.correct}/${data.mastery.attempts}`}
          </span>
        </div>
        <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void synthesize()}>
          {busy ? '合并中…' : '跨资料合并洞察'}
        </button>
      </div>

      {job === null ? null : <JobBanner job={job} />}
      {data.concept.definition.length > 0 ? <p className="study-definition">{data.concept.definition}</p> : null}

      <h3 className="study-section-title">在资料中的位置</h3>
      <ul className="study-list">
        {data.occurrences.map(occurrence => (
          <li key={`${occurrence.materialId}:${occurrence.unitId}:${occurrence.page}:${occurrence.role}`}>
            <button type="button" className="study-item" onClick={() => onOpenUnit(occurrence.materialId, occurrence.unitId)}>
              <span className="study-item-title">
                {occurrence.unitTitle} <span className="study-role">{ROLE_LABEL[occurrence.role] ?? occurrence.role}</span>
              </span>
              <span className="study-item-meta">
                {occurrence.materialTitle} · p{occurrence.page}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {data.concept.prereqOf.length > 0 || data.concept.related.length > 0 ? (
        <>
          <h3 className="study-section-title">相关概念</h3>
          <div className="study-chips">
            {[...data.concept.prereqOf, ...data.concept.related].map(related => (
              <button key={related} type="button" className="study-chip" onClick={() => onOpenConcept(related)}>
                {related}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {toast !== null ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  )
}
