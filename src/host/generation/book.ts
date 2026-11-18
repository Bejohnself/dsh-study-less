/**
 * Self-authored book generation: outline, chapter, continuity.
 *
 * Free functions over GenerationService; the class keeps the signatures and forwards
 * here. Bodies are the original methods, with this. turned into svc.
 */
import { upsertConcept } from '../../core/concepts.ts'
import { splitUnitKey } from '../../core/ids.ts'
import { listManifests } from '../../core/library.ts'
import { readPlan } from '../../core/plans.ts'
import { writeTextAtomic } from '../../core/store.ts'
import type { MaterialManifest } from '../../core/types.ts'
import { validateQuizBank } from '../../core/validate.ts'
import type { BookChapterView, BookSummary } from '../../core/views.ts'
import { type JobContext } from '../jobs.ts'
import { bookChapterPrompt, bookContinuityPrompt, bookOutlinePrompt } from '../generate/bookPrompts.ts'
import { StudyError } from '../service.ts'
import type { GenerationService } from '../generation.ts'
import { asRecord, normalizeBookOutline, normalizeBookChapter } from './normalize.ts'

export async function generateBookOutline(svc: GenerationService, planId: string): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  if ((await svc.deps.books.forPlan(planId)) !== null) {
    throw new StudyError('conflict', '这条路径已经有自编书，直接打开即可')
  }
  const job = await svc.deps.jobs.create('book-outline', { planId }, context => svc.runBookOutline(planId, context))
  return { jobId: job.id }
}

export async function generateBookChapter(svc: GenerationService, bookId: string, chapterId: string): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  await svc.deps.books.read(bookId)
  const job = await svc.deps.jobs.create('book-chapter', { book: bookId, chapter: chapterId }, context =>
    svc.runBookChapter(bookId, chapterId, context),
  )
  return { jobId: job.id }
}

export async function generateBookContinuity(svc: GenerationService, bookId: string): Promise<{ jobId: string }> {
  if (!(await svc.textReady())) throw new StudyError('unsupported', '还没有配置文本引擎')
  const job = await svc.deps.jobs.create('book-continuity', { book: bookId }, context =>
    svc.runBookContinuity(bookId, context),
  )
  return { jobId: job.id }
}

export async function runBookOutline(svc: GenerationService, planId: string, context: JobContext): Promise<BookSummary> {
  const plan = await readPlan(svc.paths, planId)
  if (plan === null) throw new StudyError('not-found', `计划不存在：${planId}`)
  const all = await listManifests(svc.paths)
  const manifests = (plan.materials ?? [])
    .map(id => all.find(manifest => manifest.id === id))
    .filter((manifest): manifest is MaterialManifest => manifest !== undefined)
  if (manifests.length === 0) throw new StudyError('not-found', '计划的资料都不存在了')
  const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
  const steps = plan.steps.flatMap(step => {
    if (step.target === undefined) return []
    try {
      const { materialId, unitId } = splitUnitKey(step.target)
      const manifest = byId.get(materialId)
      const node = manifest?.structure.find(candidate => candidate.uid === unitId)
      if (manifest === undefined || node === undefined) return []
      return [{ n: step.n, kind: step.kind, title: node.title, materialTitle: manifest.title, why: step.why, target: step.target }]
    } catch {
      return []
    }
  })
  if (steps.length === 0) throw new StudyError('invalid', '这条路径还没有可用的单元步骤')
  const concepts = (await svc.deps.service.concepts()).map(concept => ({
    id: concept.id,
    name: concept.name,
    mastery: concept.mastery,
  }))
  const prompt = bookOutlinePrompt({
    goal: plan.goal,
    ...(plan.brief === undefined ? {} : { brief: plan.brief }),
    steps,
    manifests,
    concepts,
  })
  const taken = new Set((await svc.deps.books.list()).map(book => book.id))
  let summary: BookSummary | undefined
  await svc.completeJson(context, prompt, async parsed => {
    const book = normalizeBookOutline(parsed, {
      planId,
      goal: plan.goal,
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      manifests,
      taken,
    })
    const created = await svc.deps.books.create(book)
    summary = { id: created.id, title: created.title, status: created.status, chapters: created.chapters.length, done: 0, planId }
  })
  if (summary === undefined) throw new StudyError('invalid', '自编书大纲没有写入')
  context.report(1, `已生成 ${summary.chapters} 章大纲`)
  return summary
}

export async function runBookChapter(svc: GenerationService, bookId: string, chapterId: string, context: JobContext): Promise<BookChapterView> {
  const book = await svc.deps.books.read(bookId)
  const chapter = book.chapters.find(candidate => candidate.id === chapterId)
  if (chapter === undefined) throw new StudyError('not-found', `章节不存在：${chapterId}`)
  const ordered = [...book.chapters].sort((a, b) => a.order - b.order)
  const index = ordered.findIndex(candidate => candidate.id === chapterId)
  const previous = index > 0 ? ordered[index - 1] : undefined
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined
  const sources: Array<{
    materialTitle: string
    unitTitle: string
    pageStart: number
    pageEnd: number
    text: string
    notes?: string
  }> = []
  for (const ref of chapter.sourceRefs) {
    try {
      const material = await svc.deps.service.unitMaterial(ref.material, ref.unit, 12_000)
      sources.push({
        materialTitle: material.material.title,
        unitTitle: material.node.title,
        pageStart: material.node.pageStart,
        pageEnd: material.node.pageEnd,
        text: material.text,
        ...(material.existingNotes === null ? {} : { notes: material.existingNotes }),
      })
    } catch {
      // A missing source unit leaves the chapter marked as outline; the model
      // must not invent it.
    }
  }
  if (sources.length === 0) throw new StudyError('invalid', '这一章的来源单元都不可读')
  const prompt = bookChapterPrompt({
    book,
    chapter,
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
    sources,
  })
  await svc.completeJson(context, prompt, async parsed => {
    const normalized = normalizeBookChapter(parsed, chapter, sources)
    for (const concept of normalized.concepts) {
      await upsertConcept(svc.paths, {
        id: concept.id,
        name: concept.name ?? concept.id,
        definition: concept.definition,
        occurrences: [{ material: chapter.sourceRefs[0]!.material, unit: chapter.sourceRefs[0]!.unit, page: chapter.sourceRefs[0]!.pageStart, role: 'definition' }],
      })
    }
    const range = {
      pageStart: Math.min(...chapter.sourceRefs.map(ref => ref.pageStart)),
      pageEnd: Math.max(...chapter.sourceRefs.map(ref => ref.pageEnd)),
    }
    const issues = validateQuizBank(normalized.exercises, range)
    if (issues.length > 0) throw new StudyError('invalid', '章节练习未通过校验', { issues })
    await svc.deps.books.writeChapter(bookId, chapterId, {
      body: normalized.body,
      summary: normalized.summary,
      concepts: normalized.concepts.map(concept => concept.id),
      ...(normalized.wordCount === undefined ? {} : { wordCount: normalized.wordCount }),
      ...(normalized.exercises.length === 0
        ? {}
        : {
            quiz: {
              version: 1,
              unit: chapterId,
              items: normalized.exercises,
              updatedAt: new Date().toISOString(),
            },
          }),
    })
  })
  context.report(1, '本章完成')
  return await svc.deps.books.chapter(bookId, chapterId)
}

export async function runBookContinuity(svc: GenerationService, bookId: string, context: JobContext): Promise<{ verdict: string; issues: unknown[] }> {
  const book = await svc.deps.books.read(bookId)
  const chapters: Array<{ order: number; title: string; summary: string; opening: string; closing: string }> = []
  for (const chapter of [...book.chapters].sort((a, b) => a.order - b.order)) {
    const content = await svc.deps.books.chapterContent(bookId, chapter.id)
    chapters.push({
      order: chapter.order,
      title: chapter.title,
      summary: chapter.summary,
      opening: content.slice(0, 500),
      closing: content.slice(-500),
    })
  }
  const prompt = bookContinuityPrompt({ book, chapters })
  context.report(0.2, '正在检查全书脉络…')
  let result: { verdict: string; issues: unknown[] } = { verdict: 'warn', issues: [] }
  await svc.completeJson(context, prompt, async parsed => {
    const body = asRecord(parsed)
    const issues = Array.isArray(body.issues) ? body.issues : []
    const verdict = body.verdict === 'pass' ? 'pass' : 'warn'
    result = { verdict, issues }
    const lines = [`# ${book.title} · 统稿报告`, '', `结论：${verdict}`, '']
    for (const issue of issues) {
      const row = asRecord(issue)
      lines.push(`- 第 ${String(row.chapter ?? '?')} 章｜${String(row.kind ?? 'issue')}：${String(row.detail ?? '')}`, `  建议：${String(row.suggestion ?? '')}`)
    }
    await writeTextAtomic(svc.paths.bookContinuityFile(bookId), `${lines.join('\n')}\n`)
  })
  context.report(1, '统稿检查完成')
  return result
}
