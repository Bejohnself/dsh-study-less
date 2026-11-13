/**
 * Generated-book domain helpers.
 *
 * A book is a first-class study asset: its outline, chapter summaries and
 * compiled Markdown are independent of the source units, while every chapter
 * keeps source page references so the reader can still check the evidence.
 */
import { slugify, uniqueSlug } from './ids.ts'
import type { BookChapterMeta, BookRecord } from './types.ts'
import type { BookChapterCard, BookSummary } from './views.ts'

/** A fresh, path-safe book id. */
export function bookId(title: string, taken: ReadonlySet<string>): string {
  return uniqueSlug(slugify(title, `book-${Date.now().toString(36)}`), taken)
}

/** The list card shape. */
export function bookSummary(book: BookRecord): BookSummary {
  return {
    id: book.id,
    ...(book.planId === undefined ? {} : { planId: book.planId }),
    title: book.title,
    ...(book.subtitle === undefined ? {} : { subtitle: book.subtitle }),
    status: book.status,
    chapters: book.chapters.length,
    done: book.chapters.filter(chapter => chapter.status === 'done').length,
  }
}

/** One chapter card, with reading progress folded in. */
export function bookChapterCard(chapter: BookChapterMeta, read: boolean): BookChapterCard {
  return {
    id: chapter.id,
    order: chapter.order,
    title: chapter.title,
    summary: chapter.summary,
    objectives: chapter.objectives,
    sourceCount: chapter.sourceRefs.length,
    status: chapter.status,
    ...(chapter.wordCount === undefined ? {} : { wordCount: chapter.wordCount }),
    read,
  }
}

/** Compile a book into one Markdown document. */
export function compileBookMarkdown(book: BookRecord, contents: ReadonlyMap<string, string>): string {
  const lines: string[] = [`# ${book.title}`, '']
  if (book.subtitle !== undefined) lines.push(`> ${book.subtitle}`, '')
  lines.push(`**目标**：${book.goal}`, '')
  if (book.audience !== undefined) lines.push(`**读者**：${book.audience}`, '')
  lines.push('## 目录', '')
  for (const part of book.parts) {
    lines.push(`### ${part.title}`, '')
    for (const chapterId of part.chapterIds) {
      const chapter = book.chapters.find(candidate => candidate.id === chapterId)
      if (chapter === undefined) continue
      lines.push(`- ${chapter.title}`)
    }
    lines.push('')
  }
  for (const chapter of [...book.chapters].sort((a, b) => a.order - b.order)) {
    lines.push(`## ${chapter.title}`, '')
    const content = contents.get(chapter.id)
    if (content === undefined || content.trim().length === 0) {
      lines.push(`_本章尚未生成。_`, '')
      continue
    }
    lines.push(content.trim(), '')
  }
  lines.push('---', '', '## 来源', '')
  const seen = new Set<string>()
  for (const chapter of book.chapters) {
    for (const source of chapter.sourceRefs) {
      const key = `${source.material}:${source.unit}`
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(`- ${source.material} / ${source.unit}（p${source.pageStart}–${source.pageEnd}）`)
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}
