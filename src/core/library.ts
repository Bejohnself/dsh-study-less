/**
 * Material manifests: reading, writing and enumerating the library.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSegment } from './ids.ts'
import type { LibraryPaths } from './paths.ts'
import { readJson, writeJsonAtomic } from './store.ts'
import type { MaterialManifest, MaterialType, StructureNode, UnitMeta } from './types.ts'

/** Read one material manifest. */
export async function readManifest(paths: LibraryPaths, materialId: string): Promise<MaterialManifest> {
  const manifest = await readJson<MaterialManifest | null>(paths.manifestFile(materialId), null)
  if (manifest === null) throw new Error(`unknown material: ${materialId}`)
  return manifest
}

/** Whether a material exists in the library. */
export async function hasMaterial(paths: LibraryPaths, materialId: string): Promise<boolean> {
  return (await readJson<MaterialManifest | null>(paths.manifestFile(materialId), null)) !== null
}

/** Write one material manifest. */
export async function writeManifest(paths: LibraryPaths, manifest: MaterialManifest): Promise<void> {
  assertSegment(manifest.id, 'material id')
  manifest.updatedAt = new Date().toISOString()
  await writeJsonAtomic(paths.manifestFile(manifest.id), manifest)
}

/** List every material in the library, newest import first. */
export async function listManifests(paths: LibraryPaths): Promise<MaterialManifest[]> {
  let entries: string[]
  try {
    entries = await readdir(paths.materialsDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const manifests: MaterialManifest[] = []
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry)) continue
    const manifest = await readJson<MaterialManifest | null>(join(paths.materialsDir, entry, 'manifest.json'), null)
    if (manifest !== null) manifests.push(manifest)
  }
  manifests.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return manifests
}

/** Find the structure node of one unit. */
export function structureNodeOf(manifest: MaterialManifest, unitId: string): StructureNode {
  const node = manifest.structure.find(candidate => candidate.uid === unitId)
  if (node === undefined) throw new Error(`unknown unit ${unitId} in ${manifest.id}`)
  return node
}

/** Find the pipeline metadata of one unit. */
export function unitMetaOf(manifest: MaterialManifest, unitId: string): UnitMeta | undefined {
  return manifest.units.find(candidate => candidate.uid === unitId)
}

/** The human label of a material. */
export function materialLabel(manifest: MaterialManifest): string {
  return manifest.subtitle === undefined ? manifest.title : `${manifest.title}（${manifest.subtitle}）`
}

/** Character shown for each material type. */
export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  book: '书',
  paper: '论文',
  article: '文章',
}
