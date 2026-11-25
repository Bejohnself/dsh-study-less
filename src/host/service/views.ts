/**
 * Read-model builders shared by StudyService.
 *
 * These functions only read the records passed in; file IO and `today()` stay
 * in the service. They live outside service.ts so the shape of a shelf card,
 * a plan step or a TOC row can change without scrolling through the service.
 */
import { splitUnitKey, unitKey } from '../../core/ids.ts'
import { unitMetaOf } from '../../core/library.ts'
import { coverageOf } from '../../core/planGate.ts'
import { dueUnits } from '../../core/progress.ts'
import type {
  MaterialManifest,
  PlanStep,
  ProgressFile,
  StructureNode,
  UnitMetaFile,
} from '../../core/types.ts'
import type { ExtraAsset, MaterialCard, PlanStepView, TocRow } from '../../core/views.ts'

/** Build the media list of one unit from its metadata. */
export function extrasOf(materialId: string, unitId: string, meta: UnitMetaFile | null): ExtraAsset[] {
  const extras = meta?.extras
  if (extras === undefined) return []
  const names = [...(extras.image ?? []), ...(extras.anim ?? []), ...(extras.media ?? []), ...(extras.code ?? [])]
  const assets: ExtraAsset[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || name.includes('..')) continue
    seen.add(name)
    const lower = name.toLowerCase()
    const kind: ExtraAsset['kind'] = /\.(png|jpe?g|webp|gif|svg)$/.test(lower)
      ? 'image'
      : /\.(html?|svg)$/.test(lower)
        ? 'animation'
        : /\.(mp4|webm|mov)$/.test(lower)
          ? 'video'
          : /\.(js|ts|py|json|txt|md|css)$/.test(lower)
            ? 'code'
            : 'other'
    assets.push({
      name,
      kind,
      url: `/study-api/asset?mid=${encodeURIComponent(materialId)}&uid=${encodeURIComponent(unitId)}&name=${encodeURIComponent(name)}`,
    })
  }
  return assets
}

/** Resolve one card for the panel. */
/** Resolve one plan step into human labels. */
export function stepView(
  step: PlanStep,
  manifests: readonly MaterialManifest[],
  conceptById: ReadonlyMap<string, { id: string; name: string }>,
  masteryOf: (conceptId: string) => number,
  learned: ReadonlySet<string>,
): PlanStepView {
  const view: PlanStepView = {
    n: step.n,
    kind: step.kind,
    why: step.why,
    done: step.target !== undefined && learned.has(step.target),
    coverage: coverageOf(step),
    ...(step.skipReason === undefined ? {} : { skipReason: step.skipReason }),
  }
  if (step.target !== undefined) {
    try {
      const { materialId, unitId } = splitUnitKey(step.target)
      const manifest = manifests.find(candidate => candidate.id === materialId)
      const node = manifest?.structure.find(candidate => candidate.uid === unitId)
      if (manifest !== undefined && node !== undefined) {
        view.target = {
          materialId,
          unitId,
          title: node.title,
          materialTitle: manifest.title,
          pageStart: node.pageStart,
          pageEnd: node.pageEnd,
        }
      }
    } catch {
      // A stale target is dropped from the view; validatePlan refuses new ones.
    }
  }
  if (step.concepts !== undefined) {
    view.concepts = step.concepts.map(id => ({
      id,
      name: conceptById.get(id)?.name ?? id,
      mastery: masteryOf(id),
    }))
  }
  if (step.materials !== undefined) {
    view.materials = step.materials.map(id => ({
      id,
      title: manifests.find(manifest => manifest.id === id)?.title ?? id,
    }))
  }
  return view
}

/** Target resolver used by plan validation. */
export function planTargets(
  manifests: readonly MaterialManifest[],
  concepts: ReadonlyArray<{ id: string }>,
): { hasUnit(key: string): boolean; hasConcept(id: string): boolean; hasMaterial(id: string): boolean } {
  const conceptIds = new Set(concepts.map(concept => concept.id))
  return {
    hasUnit: key => {
      let materialId: string
      let unitId: string
      try {
        const parts = splitUnitKey(key)
        materialId = parts.materialId
        unitId = parts.unitId
      } catch {
        return false
      }
      return manifests.some(manifest => manifest.id === materialId && manifest.structure.some(node => node.uid === unitId))
    },
    hasConcept: id => conceptIds.has(id),
    hasMaterial: id => manifests.some(manifest => manifest.id === id),
  }
}

/** Build the library card of one material. */
export function cardOf(manifest: MaterialManifest, progress: ProgressFile, today: string): MaterialCard {
  const dueKeys = new Set(dueUnits(progress, today).map(entry => entry.key))
  let learned = 0
  let due = 0
  for (const unit of manifest.units) {
    const key = unitKey(manifest.id, unit.uid)
    const entry = progress.units[key]
    if (entry !== undefined && (entry.state === 'learned' || entry.state === 'reviewing')) learned += 1
    if (dueKeys.has(key)) due += 1
  }
  const verified = manifest.units.filter(unit => unit.status === 'verified').length
  return {
    id: manifest.id,
    type: manifest.type,
    title: manifest.title,
    ...(manifest.subtitle === undefined ? {} : { subtitle: manifest.subtitle }),
    authors: manifest.authors,
    ...(manifest.year === undefined ? {} : { year: manifest.year }),
    ...(manifest.venue === undefined ? {} : { venue: manifest.venue }),
    pages: manifest.source.pages,
    importedAt: manifest.source.importedAt,
    units: manifest.units.length,
    verifiedUnits: verified,
    learnedUnits: learned,
    dueCount: due,
    status: learned === 0 ? 'new' : learned >= manifest.units.length ? 'done' : 'learning',
    tags: manifest.tags,
    ...(manifest.archived === true ? { archived: true } : {}),
  }
}

/** Build one TOC row. */
export function rowOf(
  materialId: string,
  node: StructureNode,
  manifest: MaterialManifest,
  progress: ProgressFile,
  due: boolean,
): TocRow {
  const meta = unitMetaOf(manifest, node.uid)
  const entry = progress.units[unitKey(materialId, node.uid)]
  return {
    uid: node.uid,
    title: node.title,
    kind: node.kind,
    ...(node.pass === undefined ? {} : { pass: node.pass }),
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    status: meta?.status ?? 'new',
    state: entry?.state ?? 'new',
    ...(entry?.due === undefined ? {} : { due: entry.due }),
    concepts: meta?.concepts ?? [],
  }
}