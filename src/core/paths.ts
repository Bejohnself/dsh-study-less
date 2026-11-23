/**
 * Filesystem layout of the study library.
 *
 * Every path is derived from a validated id, so the layout itself is the path
 * jail: nothing outside `root` can be addressed.
 */
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
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
  readonly materialsDir: string
  readonly conceptsDir: string
  readonly plansDir: string
  readonly booksDir: string
  readonly insightsDir: string
  readonly jobsDir: string
  readonly quizSessionsDir: string
  readonly indexDir: string
  readonly progressFile: string
  readonly knowledgeFile: string
  readonly settingsFile: string
  readonly usageFile: string

  readonly root: string

  constructor(root: string) {
    this.root = root
    this.materialsDir = join(root, 'materials')
    this.conceptsDir = join(root, 'concepts')
    this.plansDir = join(root, 'plans')
    this.booksDir = join(root, 'books')
    this.insightsDir = join(root, 'insights')
    this.jobsDir = join(root, 'jobs')
    this.quizSessionsDir = join(root, 'quiz-sessions')
    this.indexDir = join(root, 'index')
    this.progressFile = join(root, 'progress.json')
    this.knowledgeFile = join(root, 'knowledge.json')
    this.settingsFile = join(root, 'settings.json')
    this.usageFile = join(root, 'usage.json')
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

  /**
   * The original PDF of one material.
   *
   * `manifest.source.path` is relative to the material directory; the resolved
   * path must stay inside it, so a tampered manifest cannot read elsewhere.
   */
  sourceFile(materialId: string, sourcePath: string): string {
    const dir = this.materialDir(materialId)
    const resolved = resolve(dir, sourcePath)
    if (resolved !== dir && !resolved.startsWith(dir + sep)) {
      throw new Error(`source path escapes the material directory: ${sourcePath}`)
    }
    return resolved
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

  /** Paragraph geometry of one page, cached after the first extraction. */
  layoutDir(materialId: string): string {
    return join(this.materialDir(materialId), 'layout')
  }

  /** Paragraph geometry of one page. */
  layoutFile(materialId: string, page: number): string {
    return join(this.layoutDir(materialId), `p${String(page).padStart(4, '0')}.json`)
  }

  /** Semantic blocks and guiding cards of one unit (reading surface only). */
  blocksFile(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'blocks.json')
  }

  /** Extras (animations, code, media) of one unit. */
  extrasDir(materialId: string, unitId: string): string {
    return join(this.unitDir(materialId, unitId), 'extras')
  }

  /** One extra asset of a unit; `name` is a flat, validated file name. */
  extraFile(materialId: string, unitId: string, name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || name.includes('..')) {
      throw new Error(`invalid asset name: ${name}`)
    }
    return join(this.extrasDir(materialId, unitId), name)
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

  /** Directory of one generated book. */
  bookDir(bookId: string): string {
    assertSegment(bookId, 'book id')
    return join(this.booksDir, bookId)
  }

  /** Book manifest. */
  bookFile(bookId: string): string {
    return join(this.bookDir(bookId), 'book.json')
  }

  /** Chapter content file. */
  bookChapterFile(bookId: string, chapterId: string): string {
    assertSegment(chapterId, 'chapter id')
    return join(this.bookDir(bookId), 'chapters', `${chapterId}.md`)
  }

  /** Chapter quiz file. */
  bookChapterQuizFile(bookId: string, chapterId: string): string {
    assertSegment(chapterId, 'chapter id')
    return join(this.bookDir(bookId), 'chapters', `${chapterId}.quiz.json`)
  }

  /** Compiled whole-book Markdown. */
  bookCompiledFile(bookId: string): string {
    return join(this.bookDir(bookId), 'book.md')
  }

  /** Continuity report of one book. */
  bookContinuityFile(bookId: string): string {
    return join(this.bookDir(bookId), 'continuity.md')
  }

  /** Insight file. */
  insightFile(insightId: string): string {
    assertSegment(insightId, 'insight id')
    return join(this.insightsDir, `${insightId}.json`)
  }

  /** Generation job file. */
  jobFile(jobId: string): string {
    assertSegment(jobId, 'job id')
    return join(this.jobsDir, `${jobId}.json`)
  }

  /** One adaptive quiz session file. */
  quizSessionFile(sessionId: string): string {
    assertSegment(sessionId, 'quiz session id')
    return join(this.quizSessionsDir, `${sessionId}.json`)
  }

  /** Embedding index file. */
  indexFile(name: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) throw new Error(`invalid index name: ${name}`)
    return join(this.indexDir, name)
  }
}
