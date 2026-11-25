/**
 * Import dialog: upload a PDF, point at a local path, or fetch an arXiv paper.
 */
import { useEffect, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import { errorText, post } from '../api.ts'
import { Modal } from './ui.tsx'

/** What every import route returns: manifest preview plus non-fatal warnings. */
type ImportValue = { manifest?: { title?: string; structure?: unknown[] }; warnings?: string[] }

/** Import a local PDF or an arXiv paper. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }): ReactElement {
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [arxiv, setArxiv] = useState('')
  const [path, setPath] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  // A scan or a TOC-less PDF outlives a 3.6s toast: keep the dialog open so the
  // warning is actually read, otherwise the import looks fine until练习 fails.
  const finish = (title: string, units: number, list: readonly string[]): void => {
    onImported(`已导入「${title}」，共 ${units} 个单元`)
    if (list.length === 0) onClose()
    else setWarnings([...list])
  }

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
        | { ok?: boolean; value?: ImportValue; error?: { message?: string } }
        | null
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `导入失败（HTTP ${response.status}）`)
      const units = payload.value?.manifest?.structure?.length ?? 0
      finish(payload.value?.manifest?.title ?? file.name, units, payload.value?.warnings ?? [])
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const takeDroppedFile = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const file = event.dataTransfer.files[0]
    if (file === undefined) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('只能拖入 PDF 文件')
      return
    }
    void upload(file)
  }

  const importArxiv = async (): Promise<void> => {
    if (arxiv.trim().length === 0) return
    setBusy(true)
    setError(null)
    try {
      const value = await post<ImportValue>('/import/url', { url: arxiv.trim() })
      finish(value.manifest?.title ?? 'arXiv 论文', value.manifest?.structure?.length ?? 0, value.warnings ?? [])
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
      const value = await post<ImportValue>('/import', { path: path.trim() })
      finish(value.manifest?.title ?? path.trim(), value.manifest?.structure?.length ?? 0, value.warnings ?? [])
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="导入资料" subtitle="支持本地 PDF、本地路径与 arXiv；导入时会抽取目录并按页切片。" onClose={onClose} wide>
      {warnings.length > 0 ? (
        <div className="study-import-warn">
          <p>导入好了，但这几处会影响后面的练习：</p>
          <ul>
            {warnings.map(text => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <button type="button" className="study-primary study-primary-tight" onClick={onClose}>
            知道了
          </button>
        </div>
      ) : (
        <p className="study-modal-note">
          导入前先确认两件事：① PDF 要有文字层，扫描件请先做成可搜索 PDF，否则能翻原文，但抽不出知识点、出不了题；
          ② PDF 要有书签目录，没有目录只能按标题猜节边界。缺目录可以先拿
          <a href="https://tocify.aeriszhu.com/" target="_blank" rel="noreferrer">
            Tocify
          </a>
          补一份再导入。
        </p>
      )}
      <div className="study-field">
        <label className="study-field-label">本地 PDF</label>
        <label
          className={`study-file${busy ? ' is-busy' : ''}${dragging ? ' is-drag' : ''}`}
          onDragEnter={event => {
            event.preventDefault()
            if (!busy) setDragging(true)
          }}
          onDragOver={event => {
            event.preventDefault()
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
            if (!busy) setDragging(true)
          }}
          onDragLeave={event => {
            const next = event.relatedTarget
            if (next instanceof Node && event.currentTarget.contains(next)) return
            setDragging(false)
          }}
          onDrop={takeDroppedFile}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={event => {
              const file = event.target.files?.[0]
              if (file !== undefined) void upload(file)
            }}
          />
          <span>{busy ? '上传并解析中…' : dragging ? '松开就导入 PDF' : '选择 PDF 文件，或拖到这里'}</span>
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
