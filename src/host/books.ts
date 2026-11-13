/**
 * Generated-book storage and reading operations.
 *
 * The book is the primary study asset once it exists; source units and their
 * notes remain the evidence. Every read/write goes through this service so the
 * panel and the agent tools share one shape.
 */
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { compileBookMarkdown, bookChapterCard, bookSummary } from '../core/books.ts'
import { listManifests } from '../core/library.ts'
import type { LibraryPaths } from '../core/paths.ts'
import { listPlans, readPlan, writePlan } from '../core/plans.ts'
import { emptyProgress, readProgress } from '../core/progress.ts'
import { readJson, updateJson, writeJsonAtomic, writeTextAtomic } from '../core/store.ts'
import type { BookChapterMeta, BookRecord, ProgressFile, QuizBank } from '../core/types.ts'
import type { BookChapterView, BookSummary, BookView } from '../core/views.ts'
import { StudyError, type StudyService } from './service.ts'

/** Generated-book service. */
export class BookService {
  readonly paths: LibraryPaths
  private readonly service: StudyService

  constructor(paths: LibraryPaths, service: StudyService) {
    this.paths = paths
    this.service = service
  }

  /** List books, optionally only the one owned by a plan. */
  async list(planId?: string): Promise<BookSummary[]> {
    let entries: string[]
    try {
      entries = await readdir(this.paths.booksDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const books: BookRecord[] = []
    for (const entry of entries) {
      const book = await readJson<BookRecord | null>(join(this.paths.booksDir, entry, 'book.json'), null)
      if (book !== null) books.push(book)
    }
    books.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    return books
      .filter(book => planId === undefined || book.planId === planId)
      .map(bookSummary)
  }

  /** Read one book with chapter cards. */
  async get(bookId: string): Promise<BookView> {
    const book = await this.read(bookId)
    const progress = await readProgress(this.paths)
    const chapters = book.chapters
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(chapter => bookChapterCard(chapter, progress.books?.[bookId]?.chapters?.[chapter.id]?.readAt !== undefined))
    return { book, chapters }
  }

  /** Read one chapter with resolved sources and neighbours. */
  async chapter(bookId: string, chapterId: string): Promise<BookChapterView> {
    const book = await this.read(bookId)
    const chapter = book.chapters.find(candidate => candidate.id === chapterId)
    if (chapter === undefined) throw new StudyError('not-found', `章节不存在：${chapterId}`)
    const manifests = await listManifests(this.paths)
    const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
    const sources: BookChapterView['sources'] = []
    for (const source of chapter.sourceRefs) {
      const manifest = byId.get(source.material)
      const node = manifest?.structure.find(candidate => candidate.uid === source.unit)
      if (manifest === undefined || node === undefined) continue
      sources.push({
        materialId: manifest.id,
        materialTitle: manifest.title,
        unitId: node.uid,
        unitTitle: node.title,
        pageStart: source.pageStart,
        pageEnd: source.pageEnd,
      })
    }
    const ordered = [...book.chapters].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex(candidate => candidate.id === chapterId)
    const prev = index > 0 ? ordered[index - 1] : undefined
    const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined
    return {
      book: { id: book.id, title: book.title },
      chapter,
      content: await this.chapterContent(bookId, chapterId),
      ...(prev === undefined ? {} : { prev: { id: prev.id, title: prev.title } }),
      ...(next === undefined ? {} : { next: { id: next.id, title: next.title } }),
      sources,
      quiz: await readJson<QuizBank | null>(this.paths.bookChapterQuizFile(bookId, chapterId), null),
    }
  }

  /** Read a book record. */
  async read(bookId: string): Promise<BookRecord> {
    const book = await readJson<BookRecord | null>(this.paths.bookFile(bookId), null)
    if (book === null) throw new StudyError('not-found', `自编书不存在：${bookId}`)
    return book
  }

  /** Persist a book record. */
  async save(book: BookRecord): Promise<void> {
    book.updatedAt = new Date().toISOString()
    await writeJsonAtomic(this.paths.bookFile(book.id), book)
  }

  /** Create a book and link it to its plan. */
  async create(book: BookRecord): Promise<BookRecord> {
    await this.save(book)
    if (book.planId !== undefined) await this.linkPlan(book.planId, book.id)
    return book
  }

  /** Link a plan to its book (one book per plan for now). */
  async linkPlan(planId: string, bookId: string): Promise<void> {
    const plan = await readPlan(this.paths, planId)
    if (plan === null) return
    plan.bookId = bookId
    await writePlan(this.paths, plan)
  }

  /** Delete a book and unlink its plan. */
  async delete(bookId: string): Promise<{ deleted: boolean }> {
    const book = await readJson<BookRecord | null>(this.paths.bookFile(bookId), null)
    if (book === null) return { deleted: false }
    await rm(this.paths.bookDir(bookId), { recursive: true, force: true })
    if (book.planId !== undefined) {
      const plan = await readPlan(this.paths, book.planId)
      if (plan !== null && plan.bookId === bookId) {
        delete plan.bookId
        await writePlan(this.paths, plan)
      }
    }
    return { deleted: true }
  }

  /** Chapter body, or an empty string when it has not been generated. */
  async chapterContent(bookId: string, chapterId: string): Promise<string> {
    try {
      return await readFile(this.paths.bookChapterFile(bookId, chapterId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  /** Write a generated chapter, its quiz and update the book metadata. */
  async writeChapter(
    bookId: string,
    chapterId: string,
    input: { body: string; summary: string; wordCount?: number; concepts?: string[]; quiz?: QuizBank },
  ): Promise<BookRecord> {
    const book = await this.read(bookId)
    const chapter = book.chapters.find(candidate => candidate.id === chapterId)
    if (chapter === undefined) throw new StudyError('not-found', `章节不存在：${chapterId}`)
    await writeTextAtomic(this.paths.bookChapterFile(bookId, chapterId), input.body.trimEnd() + '\n')
    if (input.quiz !== undefined) {
      await writeJsonAtomic(this.paths.bookChapterQuizFile(bookId, chapterId), input.quiz)
    }
    chapter.summary = input.summary
    if (input.concepts !== undefined) chapter.concepts = [...new Set(input.concepts)]
    chapter.status = 'done'
    chapter.wordCount = input.wordCount ?? input.body.length
    chapter.generatedAt = new Date().toISOString()
    book.status = book.chapters.every(candidate => candidate.status === 'done') ? 'ready' : 'drafting'
    await this.save(book)
    return book
  }

  /** Update one chapter's metadata without touching its body. */
  async updateChapter(bookId: string, chapterId: string, patch: Partial<BookChapterMeta>): Promise<BookRecord> {
    const book = await this.read(bookId)
    const chapter = book.chapters.find(candidate => candidate.id === chapterId)
    if (chapter === undefined) throw new StudyError('not-found', `章节不存在：${chapterId}`)
    Object.assign(chapter, patch)
    await this.save(book)
    return book
  }

  /** Mark a chapter read. */
  async markRead(bookId: string, chapterId: string): Promise<void> {
    await updateJson<ProgressFile>(this.paths.progressFile, emptyProgress(), current => {
      current.books ??= {}
      current.books[bookId] ??= { chapters: {} }
      current.books[bookId]!.chapters[chapterId] ??= {}
      current.books[bookId]!.chapters[chapterId]!.readAt = new Date().toISOString()
      current.revision += 1
      current.updatedAt = new Date().toISOString()
      return current
    })
  }

  /** Read a chapter's quiz bank, when generated. */
  async chapterQuiz(bookId: string, chapterId: string): Promise<QuizBank | null> {
    return readJson<QuizBank | null>(this.paths.bookChapterQuizFile(bookId, chapterId), null)
  }

  /** Compile and return the whole book as Markdown. */
  async exportMarkdown(bookId: string): Promise<string> {
    const book = await this.read(bookId)
    const contents = new Map<string, string>()
    for (const chapter of book.chapters) {
      contents.set(chapter.id, await this.chapterContent(bookId, chapter.id))
    }
    const markdown = compileBookMarkdown(book, contents)
    await writeTextAtomic(this.paths.bookCompiledFile(bookId), markdown)
    return markdown
  }

  /** Find the book linked to a plan, if any. */
  async forPlan(planId: string): Promise<BookRecord | null> {
    const books = await this.list(planId)
    const first = books[0]
    return first === undefined ? null : this.read(first.id)
  }

  /** All plans that point at a book id. */
  async plansForBook(bookId: string): Promise<string[]> {
    return (await listPlans(this.paths)).filter(plan => plan.bookId === bookId).map(plan => plan.id)
  }
}
