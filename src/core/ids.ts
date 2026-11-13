/**
 * Id normalization and path-safe identifiers.
 *
 * Every id that reaches the filesystem goes through here first: material ids,
 * unit ids, concept ids and plan ids are restricted to lowercase slugs, and a
 * unit key is always `<material>:<unit>` with both halves validated. Paths are
 * then built with `join` from validated parts only, so a crafted id cannot
 * escape the data root.
 */

/** A single id segment: lowercase letters, digits and inner dashes. */
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/

/** A concept id: one or more slash-separated segments, e.g. `consensus/raft`. */
const CONCEPT = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,3}$/

/** Throw unless `value` is a valid single id segment. */
export function assertSegment(value: string, label = 'id'): void {
  if (!SEGMENT.test(value)) throw new Error(`invalid ${label}: ${JSON.stringify(value)}`)
}

/** Throw unless `value` is a valid concept id. */
export function assertConceptId(value: string, label = 'concept id'): void {
  if (!CONCEPT.test(value)) throw new Error(`invalid ${label}: ${JSON.stringify(value)}`)
}

/** Whether a string is a valid single id segment. */
export function isSegment(value: string): boolean {
  return SEGMENT.test(value)
}

/**
 * Normalize arbitrary text into a slug id.
 * @param input - human text (title, filename stub, heading).
 * @param fallback - used when the text has no usable characters.
 * @returns a valid id segment.
 */
export function slugify(input: string, fallback = 'item'): string {
  const base = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  if (base.length === 0) return fallback
  return /^[a-z0-9]/.test(base) ? base : fallback
}

/** Make a slug unique against a set of taken ids. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base.slice(0, 60)}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`cannot derive a unique id from ${base}`)
}

/** The global key of one unit. */
export function unitKey(materialId: string, unitId: string): string {
  assertSegment(materialId, 'material id')
  assertSegment(unitId, 'unit id')
  return `${materialId}:${unitId}`
}

/** Split a global unit key back into its parts. */
export function splitUnitKey(key: string): { materialId: string; unitId: string } {
  const index = key.indexOf(':')
  if (index <= 0) throw new Error(`invalid unit key: ${JSON.stringify(key)}`)
  const materialId = key.slice(0, index)
  const unitId = key.slice(index + 1)
  assertSegment(materialId, 'material id')
  assertSegment(unitId, 'unit id')
  return { materialId, unitId }
}
