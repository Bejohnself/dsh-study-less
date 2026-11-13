/**
 * Import and goal dialogs for the study desk.
 *
 * Both are shell-independent: they only call /study-api and the client actions
 * captured at activation.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { MaterialCard } from '../core/views.ts'
import { currentSessionId, openConversation } from './actions.ts'

/** One modal surface. */
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}): ReactElement {
  return (
    <div className="study-scrim" role="presentation" onClick={onClose}>
      <div
        className="study-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={event => event.stopPropagation()}
      >
        <div className="study-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle === undefined ? null : <p className="study-modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="study-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** POST one JSON body and unwrap the API envelope. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/study-api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; value?: unknown; error?: { message?: string } }
    | null
  if (response.ok && payload?.ok === true) return payload.value as T
  throw new Error(payload?.error?.message ?? `请求失败（HTTP ${response.status}）`)
}

/** Import a local PDF or an arXiv paper. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arxiv, setArxiv] = useState('')

  const upload = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error('文件超过 200 MiB')
      const response = await fetch('/study-api/import/upload', {
        method: 'POST',
        headers: {
          'content-type': 'application/pdf',
          'x-study-name': encodeURIComponent(file.name),
        },
        body: file,
      })
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; value?: { manifest?: { title?: string; type?: string; structure?: unknown[] } }; error?: { message?: string } }
        | null
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `导入失败（HTTP ${response.status}）`)
      const units = payload.value?.manifest?.structure?.length ?? 0
      onImported(`已导入「${payload.value?.manifest?.title ?? file.name}」，共 ${units} 个单元`)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const importArxiv = async (): Promise<void> => {
    if (arxiv.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const value = await postJson<{ manifest?: { title?: string; structure?: unknown[] } }>('/import/url', { url: arxiv.trim() })
      const units = value.manifest?.structure?.length ?? 0
      onImported(`已导入 arXiv 论文，共 ${units} 个单元`)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="导入资料"
      subtitle="支持本地 PDF 与 arXiv 论文；导入时会抽取目录并按页切片。"
      onClose={onClose}
    >
      <div className="study-field">
        <label className="study-field-label">本地 PDF</label>
        <label className={`study-file${busy ? ' is-busy' : ''}`}>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file !== undefined) void upload(file)
            }}
          />
          <span>{busy ? '上传并解析中…' : '选择 PDF 文件'}</span>
        </label>
      </div>

      <div className="study-field">
        <label className="study-field-label">arXiv 链接或编号</label>
        <div className="study-inline">
          <input
            type="text"
            className="study-input"
            placeholder="https://arxiv.org/abs/1706.03762"
            value={arxiv}
            disabled={busy}
            onChange={event => setArxiv(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void importArxiv()
            }}
          />
          <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void importArxiv()}>
            导入
          </button>
        </div>
      </div>

      {error === null ? null : <p className="study-form-error">{error}</p>}
      <p className="study-modal-note">PDF 会复制进学习库（默认 ~/.dsh/study），原始文件移动或删除都不影响已导入的内容。</p>
    </Modal>
  )
}

/**
 * Create a goal over selected materials.
 *
 * The Host writes a draft plan and queues one instruction into the current
 * conversation; the Agent there builds the steps and rewrites the units.
 */
export function GoalDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (message: string) => void }): ReactElement {
  const [cards, setCards] = useState<MaterialCard[] | null>(null)
  const [goal, setGoal] = useState('')
  const [brief, setBrief] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [depth, setDepth] = useState<'deep' | 'overview'>('deep')
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackPrompt, setFallbackPrompt] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/study-api/library')
      .then(response => response.json())
      .then((payload: { ok?: boolean; value?: MaterialCard[] }) => {
        if (alive && payload.ok === true && payload.value !== undefined) setCards(payload.value)
      })
      .catch(() => {
        if (alive) setCards([])
      })
    return () => {
      alive = false
    }
  }, [])

  const toggle = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (goal.trim().length === 0) {
      setError('先写一句学习目标')
      return
    }
    if (selected.size === 0) {
      setError('至少选一份资料')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const value = await postJson<{ planId: string; prompted: boolean; error?: string; prompt: string }>('/goal/create', {
        goal: goal.trim(),
        brief: brief.trim(),
        materials: [...selected],
        depth,
        ...(hours.trim() === '' ? {} : { hoursPerWeek: Number(hours) }),
        ...(currentSessionId() === undefined ? {} : { sessionId: currentSessionId() }),
      })
      if (value.prompted) {
        onCreated('已交给当前对话，AI 正在编排路径与重写内容')
        onClose()
      } else {
        setFallbackPrompt(value.prompt)
        onCreated(`已创建目标，但没能自动发送${value.error === undefined ? '' : `（${value.error}）`}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="新建学习目标"
      subtitle="选资料 + 说清目标，工具会把「编排 + 重写」交给当前会话里的 AI。"
      onClose={onClose}
    >
      <div className="study-field">
        <label className="study-field-label">目标</label>
        <input
          type="text"
          className="study-input"
          placeholder="例如：搞懂 Raft 的日志复制与选举"
          value={goal}
          disabled={busy}
          onChange={event => setGoal(event.target.value)}
        />
      </div>

      <div className="study-field">
        <label className="study-field-label">补充说明（可选）</label>
        <textarea
          className="study-input study-textarea"
          placeholder="背景、希望达到的程度、已有基础…"
          value={brief}
          disabled={busy}
          onChange={event => setBrief(event.target.value)}
        />
      </div>

      <div className="study-field">
        <label className="study-field-label">选择资料</label>
        {cards === null ? (
          <p className="study-muted">正在读取书库…</p>
        ) : cards.length === 0 ? (
          <p className="study-muted">书库为空，先导入资料。</p>
        ) : (
          <div className="study-pick-list">
            {cards.map(card => (
              <label key={card.id} className={`study-pick${selected.has(card.id) ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  className="study-check"
                  checked={selected.has(card.id)}
                  disabled={busy}
                  onChange={() => toggle(card.id)}
                />
                <span className="study-pick-body">
                  <span className="study-pick-title">{card.title}</span>
                  <span className="study-item-meta">
                    {card.type === 'paper' ? '论文' : '书'} · {card.pages} 页 · {card.units} 单元
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="study-row">
        <div className="study-field">
          <label className="study-field-label">深度</label>
          <select className="study-input" value={depth} disabled={busy} onChange={event => setDepth(event.target.value as 'deep' | 'overview')}>
            <option value="deep">精读：逐节重写</option>
            <option value="overview">速览：总览 + 关键节</option>
          </select>
        </div>
        <div className="study-field">
          <label className="study-field-label">每周时间（小时，可选）</label>
          <input
            type="number"
            min="0"
            className="study-input"
            placeholder="3"
            value={hours}
            disabled={busy}
            onChange={event => setHours(event.target.value)}
          />
        </div>
      </div>

      {error === null ? null : <p className="study-form-error">{error}</p>}

      {fallbackPrompt === null ? (
        <div className="study-modal-actions">
          <button type="button" className="study-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="study-primary study-primary-tight" disabled={busy} onClick={() => void submit()}>
            {busy ? '提交中…' : '创建并让 AI 开始'}
          </button>
        </div>
      ) : (
        <div className="study-fallback">
          <p className="study-modal-note">没能自动发进对话。复制下面这段，粘贴到聊天框即可开始：</p>
          <textarea className="study-input study-textarea study-textarea-tall" readOnly value={fallbackPrompt} />
          <div className="study-modal-actions">
            <button
              type="button"
              className="study-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(fallbackPrompt)
              }}
            >
              复制
            </button>
            <button
              type="button"
              className="study-primary study-primary-tight"
              onClick={() => {
                openConversation()
                onClose()
              }}
            >
              打开对话
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
