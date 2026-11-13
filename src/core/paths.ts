/**
 * Filesystem layout of the study library.
 *
 * Every path is derived from a validated id, so the layout itself is the path
 * jail: nothing outside `root` can be addressed.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertConceptId, assertSegment } from './ids.ts'

/** The DSH home directory (`$DSH_HOME` or `~/.dsh`). */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DSH_HOME?.trim()
  return explicit === undefined || explicit.length === 0 ? join(homedir(), '.dsh') : resolve(explicit)
}

/** Resolve the library root: explicit config wins, else `$DSH_HOME/study`. */
export function resolveDataRoot(configRoot?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = configRoot?.trim()
  return explicit === undefined || explicit.length === 0 ? join(dshHome(env), 'study') : resolve(explicit)
}

/** Paths of one library root. */
export class LibraryPaths {
  readonly libraryFile: string
  readonly materialsDir: string
  readonly conceptsDir: string
  readonly plansDir: string
  readonly progressFile: string
  readonly exportDir: string

  readonly root: string

  constructor(root: string) {
    this.root = root
    this.libraryFile = join(root, 'library.json')
    this.materialsDir = join(root, 'materials')
    this.conceptsDir = join(root, 'concepts')
    this.plansDir = join(root, 'plans')
    this.progressFile = join(root, 'progress.json')
    this.exportDir = join(root, 'export')
  }

  /** Directory of one material. */
  materialDir(materialId: string): string {
    assertSegment(materialId, 'material id')
    return join(this.materialsDir, materialId)
  }

  /** Manifest file of one material. */
  manifestFile(materialId: string): string {
    return join(this.materialDir(materialId), 'manifest.json')
  }

  /** Source directory of one material. */
  sourceDir(materialId: string): string {
    return join(this.materialDir(materialId), 'source')
  }

  /** Per-page text slices of one material. */
  pagesDir(materialId: string): string {
    return join(this.materialDir(materialId), 'pages')
  }

  /** Page text file (`p0001.txt`). */
  pageFile(materialId: string, page: number): string {
    if (!Number.isInteger(page) || page < 1) throw new Error(`invalid page: ${page}`)
    return join(this.pagesDir(materialId), `p${String(page).padStart(4, '0')}.txt`)
  }

  /** Units directory of one material. */
  unitsDir(materialId: string): string {
    return join(this.materialDir(materialId), 'units')
  }

  /** Directory of one unit. */
  unitDir(materialId: string, unitId: string): string {
    assertSegment(unitId, 'unit id')
    return join(this.unitsDir(materialId), unitId)
  }

  /** Generated notes of one unit. */
  notesFile(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'notes.md')
  }

  /** Notes metadata of one unit. */
  unitMetaFile(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'meta.json')
  }

  /** Quiz bank of one unit. */
  quizFile(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'quiz.json')
  }

  /** Extras (animations, code, media) of one unit. */
  extrasDir(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'extras')
  }

  /** Paper-only files of one material. */
  paperDir(materialId: string): string {
    return join(this.materialDir(materialId), 'paper')
  }

  /** Claims of a paper. */
  claimsFile(materialId: string): string {
    return join(this.paperDir(materialId), 'claims.json')
  }

  /** Concept file (ids may contain one slash, producing a nested directory). */
  conceptFile(conceptId: string): string {
    assertConceptId(conceptId)
    return join(this.conceptsDir, `${conceptId}.json`)
  }

  /** Plan file. */
  planFile(planId: string): string {
    assertSegment(planId, 'plan id')
    return join(this.plansDir, `${planId}.json`)
  }
}
