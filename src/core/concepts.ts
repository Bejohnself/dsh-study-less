/**
 * The cross-material concept graph.
 *
 * A concept is global: the same id is taught by a book section, used by a paper
 * method, and critiqued by another paper. Occurrences make every one of those
 * pages reachable from the concept page; the progress document keeps mastery.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assertConceptId } from './ids.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import type { ConceptOccurrence, ConceptRecord } from './types.ts'

/** Read one concept, or null when it does not exist yet. */
export async function readConcept(paths: LibraryPaths, conceptId: string): Promise<ConceptRecord | null> {
  return readJson<ConceptRecord | null>(paths.conceptFile(conceptId), null)
}

/** Write one concept, refreshing `updatedAt`. */
export async function writeConcept(paths: LibraryPaths, record: ConceptRecord): Promise<void> {
  assertConceptId(record.id)
  record.updatedAt = new Date().toISOString()
  await writeJsonAtomic(paths.conceptFile(record.id), record)
}

/** Deduplicate occurrences by material + unit + page + role. */
export function mergeOccurrences(
  current: readonly ConceptOccurrence[],
  next: readonly ConceptOccurrence[],
): ConceptOccurrence[] {
  const merged = [...current]
  const seen = new Set(current.map(o => `${o.material}:${o.unit}:${o.page}:${o.role}`))
  for (const occurrence of next) {
    const key = `${occurrence.material}:${occurrence.unit}:${occurrence.page}:${occurrence.role}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(occurrence)
  }
  return merged
}

/**
 * The occurrence a goal should open for a due concept.
 *
 * The first occurrence in the file is not necessarily the section that
 * requires the point: a concept can be defined in an early low-level section
 * and used later at a higher level. Pick the goal section that asks for the
 * deepest level; equal levels keep the occurrence order, and a concept no goal
 * section carries falls back to its first occurrence.
 */
export function bestOccurrence(
  occurrences: readonly ConceptOccurrence[],
  levelOf: (occurrence: ConceptOccurrence) => number | undefined,
): ConceptOccurrence | undefined {
  let best: ConceptOccurrence | undefined
  let bestLevel = -1
  for (const occurrence of occurrences) {
    const level = levelOf(occurrence)
    if (level === undefined || level <= bestLevel) continue
    best = occurrence
    bestLevel = level
  }
  return best ?? occurrences[0]
}

/** Create or extend a concept. */
export async function upsertConcept(
  paths: LibraryPaths,
  input: {
    id: string
    name: string
    definition?: string
    aliases?: readonly string[]
    occurrences?: readonly ConceptOccurrence[]
    prereqOf?: readonly string[]
    related?: readonly string[]
  },
): Promise<ConceptRecord> {
  const existing = await readConcept(paths, input.id)
  const record: ConceptRecord = {
    id: input.id,
    name: input.name.trim().length > 0 ? input.name.trim() : (existing?.name ?? input.id),
    aliases: [...new Set([...(existing?.aliases ?? []), ...(input.aliases ?? [])])],
    definition: input.definition?.trim().length ? input.definition.trim() : (existing?.definition ?? ''),
    occurrences: mergeOccurrences(existing?.occurrences ?? [], input.occurrences ?? []),
    prereqOf: [...new Set([...(existing?.prereqOf ?? []), ...(input.prereqOf ?? [])])],
    related: [...new Set([...(existing?.related ?? []), ...(input.related ?? [])])],
    updatedAt: new Date().toISOString(),
  }
  await writeConcept(paths, record)
  return record
}

/** Recursively list every concept file. */
export async function listConcepts(paths: LibraryPaths): Promise<ConceptRecord[]> {
  const records: ConceptRecord[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const record = await readJson<ConceptRecord | null>(full, null)
        if (record !== null) records.push(record)
      }
    }
  }
  await walk(paths.conceptsDir)
  records.sort((a, b) => a.id.localeCompare(b.id))
  return records
}

/** Concepts ordered by weakness (lowest mastery first). */
export function weakestConcepts(
  concepts: readonly ConceptRecord[],
  mastery: Readonly<Record<string, { mastery: number; streak: number } | undefined>>,
  limit: number,
): ConceptRecord[] {
  return [...concepts]
    .sort((a, b) => {
      const ma = mastery[a.id]?.mastery ?? 0.5
      const mb = mastery[b.id]?.mastery ?? 0.5
      return ma - mb || a.id.localeCompare(b.id)
    })
    .slice(0, limit)
}
