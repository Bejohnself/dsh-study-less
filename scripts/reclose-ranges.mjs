/**
 * Re-close section page ranges for materials imported before the shared-page rule.
 *
 * A unit used to end on "the page before the next heading", which cut a section
 * off whenever the next one started halfway down a page: 1.1 stopped at p6 even
 * though p7 still carried its last paragraph above the 1.2 heading. A PDF page
 * cannot be split, so the importer now ends a unit on the page the next one
 * starts on — and this script applies the same rule to a library already on disk.
 *
 * Usage:
 *   node scripts/reclose-ranges.mjs           # dry run: print what would change
 *   node scripts/reclose-ranges.mjs --write   # back up the manifests, then write
 *
 * Only `structure[].pageEnd` is touched: unit ids, notes, quizzes and progress
 * are left alone, and the Host reads manifests per request, so no restart is
 * needed. Backups land in `<study>/tmp/reclose-<timestamp>/`.
 */
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDataRoot } from '../src/core/paths.ts'
import { closeRanges } from '../src/host/structure.ts'

const write = process.argv.includes('--write')
const root = resolveDataRoot(process.env.STUDY_ROOT)
const materialsDir = join(root, 'materials')

/** Read one material's page slices, dropping the `<!-- page N -->` marker. */
async function pagesOf(materialDir) {
  const entries = await readdir(join(materialDir, 'pages')).catch(() => [])
  const pages = []
  for (const entry of entries) {
    if (!/^p\d{4}\.txt$/.test(entry)) continue
    const raw = await readFile(join(materialDir, 'pages', entry), 'utf8')
    pages.push({ page: Number(entry.slice(1, 5)), text: raw.replace(/^<!-- page \d+ -->\n/, '') })
  }
  return pages
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join(root, 'tmp', `reclose-${stamp}`)
const materialIds = (await readdir(materialsDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

let written = 0
for (const id of materialIds) {
  const dir = join(materialsDir, id)
  const file = join(dir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    continue
  }
  const sections = manifest.structure.filter(node => node.kind !== 'pass')
  if (sections.length === 0) continue
  const before = new Map(sections.map(node => [node.uid, node.pageEnd]))
  closeRanges(sections, await pagesOf(dir), manifest.source.pages, { chapters: manifest.type === 'book' })
  const changed = sections.filter(node => before.get(node.uid) !== node.pageEnd)
  if (changed.length === 0) {
    console.log(`${id}: already closed`)
    continue
  }
  console.log(`${id}: ${changed.length}/${sections.length} sections gain the page they were cut on`)
  for (const node of changed.slice(0, 5)) {
    console.log(`  ${node.title.slice(0, 40)}  p${node.pageStart}-${before.get(node.uid)} → p${node.pageStart}-${node.pageEnd}`)
  }
  if (!write) continue
  await mkdir(backupDir, { recursive: true })
  await copyFile(file, join(backupDir, `${id}.json`))
  manifest.updatedAt = new Date().toISOString()
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  written += 1
}

if (write) console.log(`\nwrote ${written} manifest(s); backups in ${backupDir}`)
else console.log('\ndry run: pass --write to update the manifests')