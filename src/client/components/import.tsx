/**
 * Import dialog: upload a PDF, point at a local path, or fetch an arXiv paper.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { errorText, post } from '../api.ts'
import { Modal } from './ui.tsx'

/** Import a local PDF or an arXiv paper. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arxiv, setArxiv] = useState('')
  const [path, setPath] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

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
        | { ok?: boolean; value?: { manifest?: { title?: string; structure?: unknown[] } }; error?: { message?: string } }
        | null
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `导入失败（HTTP ${response.status}）`)
      const units = payload.value?.manifest?.structure?.length ?? 0
      onImported(`已导入「${payload.value?.manifest?.title ?? file.name}」，共 ${units} 个单元`)
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const importArxiv = async (): Promise<void> => {
    if (arxiv.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<{ manifest?: { title?: string; structure?: unknown[] } }>('/import/url', { url: arxiv.trim() })
      onImported(`已导入 arXiv 论文，共 ${value.manifest?.structure?.length ?? 0} 个单元`)
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const importPath = async (): Promise<void> => {
    if (path.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<{ manifest?: { title?: string; structure?: unknown[] } }>('/import', { path: path.trim() })
      onImported(`已导入「${value.manifest?.title ?? path.trim()}」，共 ${value.manifest?.structure?.length ?? 0} 个单元`)
      onClose()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="导入资料" subtitle="支持本地 PDF、本地路径与 arXiv；导入时会抽取目录并按页切片。" onClose={onClose} wide>
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
        <label className="study-field-label">或本地绝对路径</label>
        <div className="study-inline">
          <input
            type="text"
            className="study-input"
            placeholder="/home/me/books/raft.pdf"
            value={path}
            disabled={busy}
            onChange={event => setPath(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void importPath()
            }}
          />
          <button type="button" className="study-ghost" disabled={busy} onClick={() => void importPath()}>
            导入路径
          </button>
        </div>
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
            导入 arXiv
          </button>
        </div>
      </div>

      {error === null ? null : <p className="study-form-error">{error}</p>}
      {toast === null ? null : <p className="study-muted">{toast}</p>}
      <p className="study-modal-note">PDF 会复制进学习库（默认 ~/.dsh/study），原始文件移动或删除都不影响已导入的内容。</p>
    </Modal>
  )
}
