/**
 * The generated-book reader.
 *
 * The book is the primary asset of a path: cover, parts, chapters, sources and
 * per-chapter exercises. Source units are reachable as evidence, not as the main
 * reading surface.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { BookChapterView, BookView, JobView } from '../../core/views.ts'
import { api, errorText, post, waitForJob } from '../api.ts'
import { QuizRunner } from '../components/quiz.tsx'
import { EmptyState, JobBanner, Markdown, Toast } from '../components/ui.tsx'

/** The book cover and chapter reader. */

/** Compact chapter navigation used beside the chapter body. */
function BookSideToc({
  book,
  current,
  onOpen,
}: {
  book: BookView
  current: string
  onOpen: (cid: string) => void
}): ReactElement {
  return (
    <nav className="study-book-side-toc" aria-label="书目录">
      {book.book.parts.map(part => (
        <div key={part.id} className="study-book-side-part">
          <span className="study-book-side-part-title">{part.title}</span>
          {part.chapterIds.map(chapterId => {
            const card = book.chapters.find(candidate => candidate.id === chapterId)
            if (card === undefined) return null
            return (
              <button
                key={card.id}
                type="button"
                className={`study-book-side-link${card.id === current ? ' is-current' : ''}`}
                onClick={() => onOpen(card.id)}
              >
                <span>{card.order}. {card.title}</span>
                {card.status === 'done' ? null : <span className="study-book-side-dot">未生成</span>}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function BookPage({
  bid,
  cid,
  onBack,
  onOpenChapter,
  onOpenUnit,
  onChanged,
  refreshToken,
}: {
  bid: string
  cid?: string
  onBack: () => void
  onOpenChapter: (cid: string) => void
  onOpenUnit: (mid: string, uid: string) => void
  onChanged: () => void
  refreshToken: number
}): ReactElement {
  const [book, setBook] = useState<BookView | null>(null)
  const [chapter, setChapter] = useState<BookChapterView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null)
  const [focus, setFocus] = useState(false)

  const load = useCallback(async () => {
    const value = await api<BookView>(`/book?bid=${encodeURIComponent(bid)}`)
    setBook(value)
    if (cid !== undefined) {
      setChapter(await api<BookChapterView>(`/book/chapter?bid=${encodeURIComponent(bid)}&cid=${encodeURIComponent(cid)}`))
    } else {
      setChapter(null)
    }
  }, [bid, cid])

  useEffect(() => {
    let alive = true
    setError(null)
    load().catch(reason => {
      if (alive) setError(errorText(reason))
    })
    return () => {
      alive = false
    }
  }, [load, refreshToken])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!focus) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus])

  const runJob = async (key: string, path: string, body: Record<string, unknown>, message: string): Promise<void> => {
    setBusy(key)
    setJob(null)
    try {
      const { jobId } = await post<{ jobId: string }>(path, body)
      const finished = await waitForJob(jobId, setJob)
      if (finished.status === 'done') {
        await load()
        onChanged()
        setToast({ message, tone: 'ok' })
      } else if (finished.status === 'failed') {
        setToast({ message: finished.error ?? '生成失败', tone: 'error' })
      }
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    } finally {
      setBusy(null)
      setJob(null)
    }
  }

  const generateChapter = (chapterId: string): void => {
    void runJob(chapterId, '/generate/book/chapter', { bid, cid: chapterId }, '本章已生成')
  }

  const continuity = (): void => {
    void runJob('continuity', '/generate/book/continuity', { bid }, '统稿检查完成')
  }

  const markRead = async (): Promise<void> => {
    if (cid === undefined) return
    try {
      await post('/book/progress', { bid, cid })
      await load()
      onChanged()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm('删除这本自编书？原文资料与路径步骤不会删除。')) return
    try {
      await post('/book/delete', { bid })
      onChanged()
      onBack()
    } catch (reason) {
      setToast({ message: errorText(reason), tone: 'error' })
    }
  }

  if (error !== null) return <div className="study-empty">无法打开自编书：{error}</div>
  if (book === null) return <div className="study-empty">正在载入自编书…</div>
  if (cid !== undefined && chapter === null) return <div className="study-empty">正在载入本章…</div>

  if (cid !== undefined && chapter !== null) {
    return (
      <div className={`study-book${focus ? ' is-focus' : ''}`}>
        <div className="study-material-head">
          <button type="button" className="study-back" onClick={onBack}>
            ← {book.book.title}
          </button>
          <div className="study-reader-title">
            <h2>{chapter.chapter.title}</h2>
            <span className="study-reader-sub">
              第 {chapter.chapter.order} 章 · {chapter.chapter.wordCount ?? 0} 字
              {chapter.chapter.status === 'outline' ? ' · 未生成' : ''}
            </span>
          </div>
          <div className="study-inline">
            <a className="study-ghost" href={`/study-api/book/export?bid=${encodeURIComponent(bid)}`} download>
              导出全书
            </a>
            <button type="button" className="study-ghost" onClick={() => void markRead()}>
              标记已读
            </button>
            <button type="button" className="study-ghost" onClick={() => setFocus(value => !value)}>
              {focus ? '退出全屏' : '全屏'}
            </button>
          </div>
        </div>

        <div className="study-book-body">
          <aside className="study-book-side">
            <div className="study-book-side-head">目录</div>
            <BookSideToc book={book} current={chapter.chapter.id} onOpen={onOpenChapter} />
          </aside>
          <div className="study-book-main">

        {chapter.content.trim().length === 0 ? (
          <EmptyState
            title="这一章还没有正文。"
            hint="点「生成本章」会基于本章来源单元写一篇有引导的章节；建议先生成第 1 章确认风格。"
            action={{ label: '生成本章', onClick: () => generateChapter(chapter.chapter.id) }}
          />
        ) : (
          <Markdown source={chapter.content} className="study-book-content" />
        )}

        {job === null ? null : <JobBanner job={job} />}
        {busy !== null && job === null ? <div className="study-muted">正在生成…</div> : null}

        <div className="study-book-actions">
          {chapter.chapter.status !== 'done' ? (
            <button type="button" className="study-primary study-primary-tight" disabled={busy !== null} onClick={() => generateChapter(chapter.chapter.id)}>
              {busy === chapter.chapter.id ? '生成中…' : '生成本章'}
            </button>
          ) : (
            <button type="button" className="study-ghost" disabled={busy !== null} onClick={() => generateChapter(chapter.chapter.id)}>
              重新生成
            </button>
          )}
          {chapter.prev === undefined ? null : (
            <button type="button" className="study-ghost" onClick={() => onOpenChapter(chapter.prev!.id)}>
              ← {chapter.prev.title}
            </button>
          )}
          {chapter.next === undefined ? null : (
            <button type="button" className="study-ghost" onClick={() => onOpenChapter(chapter.next!.id)}>
              {chapter.next.title} →
            </button>
          )}
        </div>

        {chapter.quiz === null ? null : (
          <>
            <h3 className="study-section-title">本章练习</h3>
            <QuizRunner scope={{ kind: 'book', bid, cid: chapter.chapter.id }} />
          </>
        )}

        <h3 className="study-section-title">本章来源</h3>
        <ul className="study-list">
          {chapter.sources.map(source => (
            <li key={`${source.materialId}:${source.unitId}`}>
              <button type="button" className="study-item" onClick={() => onOpenUnit(source.materialId, source.unitId)}>
                <span className="study-item-title">{source.unitTitle}</span>
                <span className="study-item-meta">
                  {source.materialTitle} · p{source.pageStart}–{source.pageEnd}
                </span>
              </button>
            </li>
          ))}
        </ul>
          </div>
        </div>

        {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
      </div>
    )
  }

  const done = book.chapters.filter(chapter => chapter.status === 'done')
  const firstReadable = done[0] ?? book.chapters[0]
  return (
    <div className="study-book">
      <div className="study-material-head">
        <button type="button" className="study-back" onClick={onBack}>
          ← 路径
        </button>
        <div className="study-reader-title">
          <h2>{book.book.title}</h2>
          <span className="study-reader-sub">
            {book.book.subtitle ?? book.book.goal} · {done.length}/{book.chapters.length} 章已生成
          </span>
        </div>
        <div className="study-inline">
          <a className="study-ghost" href={`/study-api/book/export?bid=${encodeURIComponent(bid)}`} download>
            导出 Markdown
          </a>
          <button type="button" className="study-ghost study-danger-text" onClick={() => void remove()}>
            删除书
          </button>
        </div>
      </div>

      <div className="study-book-cover">
        <p className="study-book-goal">{book.book.goal}</p>
        {book.book.audience === undefined ? null : <p className="study-muted">读者：{book.book.audience}</p>}
        <div className="study-book-cover-actions">
          {firstReadable === undefined ? null : (
            <button type="button" className="study-primary study-primary-tight" onClick={() => onOpenChapter(firstReadable.id)}>
              {done.length === 0 ? '查看第 1 章大纲' : '开始阅读'}
            </button>
          )}
          <button type="button" className="study-ghost" disabled={busy !== null} onClick={continuity}>
            全书统稿检查
          </button>
        </div>
      </div>

      {job === null ? null : <JobBanner job={job} />}
      {busy !== null && job === null ? <div className="study-muted">正在生成…</div> : null}

      <div className="study-book-toc">
        {book.book.parts.map(part => (
          <section key={part.id} className="study-book-part">
            <h3>{part.title}</h3>
            {part.chapterIds.map(chapterId => {
              const card = book.chapters.find(candidate => candidate.id === chapterId)
              if (card === undefined) return null
              return (
                <div key={card.id} className={`study-book-chapter${card.read ? ' is-read' : ''}`}>
                  <button type="button" className="study-book-chapter-main" onClick={() => onOpenChapter(card.id)}>
                    <span className="study-book-chapter-title">
                      {card.order}. {card.title}
                    </span>
                    <span className="study-item-meta">
                      {card.status === 'done' ? `${card.wordCount ?? 0} 字 · 已生成` : '未生成'}
                      {card.sourceCount === 0 ? '' : ` · ${card.sourceCount} 个来源`}
                      {card.read ? ' · 已读' : ''}
                    </span>
                    {card.summary.length === 0 ? null : <span className="study-book-chapter-summary">{card.summary}</span>}
                  </button>
                  {card.status !== 'done' ? (
                    <button type="button" className="study-ghost" disabled={busy !== null} onClick={() => generateChapter(card.id)}>
                      {busy === card.id ? '生成中…' : '生成本章'}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </div>

      {toast === null ? null : <Toast message={toast.message} tone={toast.tone} />}
    </div>
  )
}
