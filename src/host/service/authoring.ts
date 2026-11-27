/**
 * Authoring operations: unit notes, quizzes, reading blocks and insight links.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { validateBlocks } from '../../core/blocks.ts'
import { assertConceptId } from '../../core/ids.ts'
import { isLeafUnit, structureNodeOf, writeManifest } from '../../core/library.ts'
import { upsertConcept } from '../../core/concepts.ts'
import { questionFingerprint, recordEvidence } from '../../core/knowledge.ts'
import { gradeQuizItem } from '../../core/quiz.ts'
import { ratingFromScore } from '../../core/srs.ts'
import { readJson, writeJsonAtomic, writeTextAtomic } from '../../core/store.ts'
import type { BlockFile, BlockInput, BlockRecord, QuizBank, QuizItem, UnitMetaFile } from '../../core/types.ts'
import { mathStyleWarnings, validateNotes, validateQuizBank } from '../../core/validate.ts'
import type { QuizSubmitView } from '../../core/views.ts'
import { StudyError } from './error.ts'
import type { StudyService, WriteUnitResult } from '../service.ts'

export async function writeUnit(svc: StudyService, 
  materialId: string,
  unitId: string,
  input: {
    notes: string
    pageRefs: readonly number[]
    concepts: ReadonlyArray<{ id: string; name?: string; definition?: string }>
  },
  ): Promise<WriteUnitResult> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  if (!isLeafUnit(manifest.structure, unitId)) {
    throw new StudyError('invalid', `父节只作目录索引，精读稿写在最末一级的节上：${unitId}`)
  }
  for (const concept of input.concepts) assertConceptId(concept.id)
  const validation = validateNotes({
    markdown: input.notes,
    pageRefs: input.pageRefs,
    concepts: input.concepts.map(concept => concept.id),
    range: { pageStart: node.pageStart, pageEnd: node.pageEnd },
  })
  if (!validation.ok) {
    throw new StudyError('invalid', '精读稿未通过校验', { issues: validation.issues })
  }

  const now = new Date().toISOString()
  const previous = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  const meta: UnitMetaFile = {
    version: 1,
    material: materialId,
    unit: unitId,
    title: node.title,
    concepts: input.concepts.map(concept => concept.id),
    pageRefs: [...new Set(input.pageRefs)].sort((a, b) => a - b),
    generatedBy: { at: now, promptVersion: 'v1' },
    ...(previous?.insights === undefined ? {} : { insights: previous.insights }),
    ...(previous?.extras === undefined ? {} : { extras: previous.extras }),
  }
  await writeTextAtomic(svc.paths.notesFile(materialId, unitId), input.notes.trimEnd() + '\n')
  await writeJsonAtomic(svc.paths.unitMetaFile(materialId, unitId), meta)

  for (const concept of input.concepts) {
    await upsertConcept(svc.paths, {
      id: concept.id,
      name: concept.name ?? concept.id,
      definition: concept.definition,
      occurrences: [
        {
          material: materialId,
          unit: unitId,
          page: input.pageRefs[0] ?? node.pageStart,
          role: 'definition',
        },
      ],
    })
  }

  const unit = manifest.units.find(candidate => candidate.uid === unitId)
  if (unit !== undefined) {
    unit.status = 'drafted'
    unit.concepts = input.concepts.map(concept => concept.id)
    unit.words = input.notes.length
  }
  await writeManifest(svc.paths, manifest)

  return {
    material: materialId,
    unit: unitId,
    status: 'drafted',
    words: input.notes.length,
    concepts: input.concepts.map(concept => concept.id),
    warnings: mathStyleWarnings(input.notes),
  }
}

/**
 * Register the knowledge points extracted for one unit.
 *
 * Merges with what the unit already has: re-extracting must never drop a
 * concept that earlier answers already refer to. Occurrences point at the page
 * the extractor named, or the unit start when it did not.
 */
export async function writeConcepts(
  svc: StudyService,
  materialId: string,
  unitId: string,
  concepts: ReadonlyArray<{ id: string; name: string; definition?: string; page?: number }>,
): Promise<string[]> {
  if (concepts.length === 0) return []
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  for (const concept of concepts) assertConceptId(concept.id)
  const previous = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  const ids = [...new Set([...(previous?.concepts ?? []), ...concepts.map(concept => concept.id)])]
  const meta: UnitMetaFile = {
    version: 1,
    material: materialId,
    unit: unitId,
    title: node.title,
    concepts: ids,
    pageRefs: previous?.pageRefs ?? [],
    ...(previous?.generatedBy === undefined ? {} : { generatedBy: previous.generatedBy }),
    ...(previous?.verification === undefined ? {} : { verification: previous.verification }),
    ...(previous?.insights === undefined ? {} : { insights: previous.insights }),
    ...(previous?.extras === undefined ? {} : { extras: previous.extras }),
  }
  await writeJsonAtomic(svc.paths.unitMetaFile(materialId, unitId), meta)
  for (const concept of concepts) {
    const page = concept.page !== undefined && concept.page >= node.pageStart && concept.page <= node.pageEnd
      ? concept.page
      : node.pageStart
    await upsertConcept(svc.paths, {
      id: concept.id,
      name: concept.name,
      ...(concept.definition === undefined ? {} : { definition: concept.definition }),
      occurrences: [{ material: materialId, unit: unitId, page, role: 'definition' }],
    })
  }
  const unit = manifest.units.find(candidate => candidate.uid === unitId)
  if (unit !== undefined) unit.concepts = ids
  await writeManifest(svc.paths, manifest)
  return ids
}

export async function verifyUnit(svc: StudyService, 
  materialId: string,
  unitId: string,
  input: { verdict: 'pass' | 'fail'; issues?: readonly string[] },
  ): Promise<{ status: UnitMetaFile['verification'] }> {
  const manifest = await svc.manifest(materialId)
  structureNodeOf(manifest, unitId)
  const meta = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  if (meta === null) throw new StudyError('invalid', '这一节还没有精读稿，先写再校验')
  const verification = {
    verdict: input.verdict,
    issues: [...(input.issues ?? [])],
    at: new Date().toISOString(),
  }
  meta.verification = verification
  await writeJsonAtomic(svc.paths.unitMetaFile(materialId, unitId), meta)

  const unit = manifest.units.find(candidate => candidate.uid === unitId)
  if (unit !== undefined) unit.status = input.verdict === 'pass' ? 'verified' : 'drafted'
  await writeManifest(svc.paths, manifest)
  return { status: verification }
}

export async function hasNotes(svc: StudyService, materialId: string, unitId: string): Promise<boolean> {
  const manifest = await svc.manifest(materialId)
  structureNodeOf(manifest, unitId)
  return (await svc.readNotes(materialId, unitId)) !== null
}

export async function quiz(svc: StudyService, materialId: string, unitId: string): Promise<QuizBank | null> {
  const manifest = await svc.manifest(materialId)
  structureNodeOf(manifest, unitId)
  return readJson<QuizBank | null>(svc.paths.quizFile(materialId, unitId), null)
}

export async function writeQuiz(svc: StudyService, materialId: string, unitId: string, items: readonly QuizItem[]): Promise<QuizBank> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  const validation = validateQuizBank(items, { pageStart: node.pageStart, pageEnd: node.pageEnd })
  if (!validation.ok) throw new StudyError('invalid', '练习题未通过校验', { issues: validation.issues })
  const bank: QuizBank = {
    version: 1,
    unit: unitId,
    items: items.map(item => ({ ...item })),
    updatedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(svc.paths.quizFile(materialId, unitId), bank)
  return bank
}

export async function writeBlocks(svc: StudyService, materialId: string, unitId: string, blocks: readonly BlockInput[]): Promise<BlockFile> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  const paragraphs = await svc.layout(materialId, node.pageStart, node.pageEnd)
  if (paragraphs.length === 0) {
    throw new StudyError('invalid', '这一节抽取不到文字层，不能按段落分块')
  }
  const cleaned: BlockInput[] = blocks.map(block => ({
    id: block.id.trim(),
    startPara: block.startPara,
    endPara: block.endPara,
    title: block.title.replace(/\s+/gu, ' ').trim(),
    ...(block.prompt === undefined
      ? {}
      : {
          prompt: {
            kind: block.prompt.kind,
            transition: block.prompt.transition.replace(/\s+/gu, ' ').trim(),
            question: block.prompt.question.replace(/\s+/gu, ' ').trim(),
          },
        }),
  }))
  const issues = validateBlocks(cleaned, { paragraphs: paragraphs.length })
  if (issues.length > 0) throw new StudyError('invalid', '引导卡未通过校验', { issues })

  const records: BlockRecord[] = []
  for (const block of cleaned) {
    const first = paragraphs[block.startPara]
    const last = paragraphs[block.endPara]
    if (first === undefined || last === undefined) {
      throw new StudyError('invalid', `第 ${block.id} 块的段落超出范围`)
    }
    records.push({ ...block, startPage: first.page, endPage: last.page })
  }

  const file: BlockFile = {
    version: 2,
    unit: unitId,
    paragraphs: paragraphs.length,
    blocks: records,
    generatedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(svc.paths.blocksFile(materialId, unitId), file)
  return file
}

export async function submitQuiz(svc: StudyService, 
  materialId: string,
  unitId: string,
  answers: ReadonlyArray<{ itemId: string; answer: unknown }>,
  ): Promise<QuizSubmitView> {
  const bank = await svc.quiz(materialId, unitId)
  if (bank === null) throw new StudyError('not-found', '这一节还没有练习题，先让 AI 生成一组')
  const byId = new Map(bank.items.map(item => [item.id, item]))
  const rows: QuizSubmitView['attempts'] = []
  const at = new Date().toISOString()
  let objective = 0
  let correct = 0
  for (const answer of answers) {
    const item = byId.get(answer.itemId)
    if (item === undefined) continue
    const verdict = gradeQuizItem(item, answer.answer)
    const expected =
      item.type === 'choice' && item.answerIndex !== undefined
        ? item.choices?.[item.answerIndex]
        : item.type === 'cloze'
          ? item.answer
          : undefined
    rows.push({
      itemId: item.id,
      correct: verdict.correct,
      ...(expected === undefined ? {} : { expected }),
    })
    if (verdict.correct !== null) {
      objective += 1
      if (verdict.correct) correct += 1
      // Same ledger as the session path: an objective answer is evidence.
      const fingerprint = questionFingerprint(item.question)
      for (const conceptId of item.concepts) {
        await recordEvidence(svc.paths, {
          conceptId,
          fingerprint,
          verdict: verdict.correct ? 'pass' : 'fail',
          difficulty: item.difficulty ?? 2,
          at,
        })
      }
    }
  }
  const score = objective === 0 ? 0.5 : correct / objective
  return { score, ratingSuggestion: ratingFromScore(score), attempts: rows }
}

export async function attachInsights(svc: StudyService, materialId: string, unitId: string, insightIds: readonly string[]): Promise<void> {
  const manifest = await svc.manifest(materialId)
  structureNodeOf(manifest, unitId)
  const meta = await readJson<UnitMetaFile | null>(svc.paths.unitMetaFile(materialId, unitId), null)
  if (meta === null) return
  meta.insights = [...new Set([...(meta.insights ?? []), ...insightIds])]
  await writeJsonAtomic(svc.paths.unitMetaFile(materialId, unitId), meta)
}
