/**
 * Re-apply the current unit-structure rules to materials already on disk.
 *
 * Rules that have changed after import: a unit now spans its own subtree, a
 * boundary page stays shared unless the next heading opens that page (nothing
 * but a page number or a running head above it), and a start is only taken
 * from a line that matches the outline title as a whole. Re-importing would
 * mint new ids, so this script rebuilds the structure from the stored PDF and
 * copies the ranges onto the existing units.
 *
 * Usage:
 *   node scripts/reclose-ranges.mjs           # dry run: print what would change
 *   node scripts/reclose-ranges.mjs --write   # back up the manifests, then write
 *
 * Only `structure[].pageStart/pageEnd` is touched: unit ids, notes, quizzes and
 * progress are left alone, and the Host reads manifests per request, so no
 * restart is needed. A material whose units no longer match the PDF outline
 * (edited by hand with study_structure_set) is skipped. Backups land in
 * `<study>/tmp/reclose-<timestamp>/`.
 */
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDataRoot } from '../src/core/paths.ts'
import { extractPdf } from '../src/host/pdf.ts'
import { buildStructure } from '../src/host/structure.ts'

const write = process.argv.includes('--write')
const root = resolveDataRoot(process.env.STUDY_ROOT)
const materialsDir = join(root, 'materials')

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
  if (manifest.structure.some(node => node.kind === 'pass')) {
    console.log(`${id}: has legacy pass units; skipped`)
    continue
  }
  const sections = manifest.structure.filter(node => node.kind !== 'pass')
  if (sections.length === 0) continue
  let rebuilt
  try {
    const bytes = await readFile(join(dir, manifest.source.path))
    const extraction = await extractPdf(new Uint8Array(bytes))
    rebuilt = buildStructure({
      type: manifest.type,
      numPages: extraction.numPages,
      outline: extraction.outline,
      pages: extraction.pages,
    })
  } catch (error) {
    console.log(`${id}: cannot read the stored PDF (${error.message}); skipped`)
    continue
  }
  // Only an added intro unit is safe to insert: it is new to both the manifest
  // and the rebuilt structure. A missing unit means the outline or the manifest
  // changed by hand, and that needs a re-import, not a range write.
  const current = new Map(sections.map(node => [node.uid, node]))
  const dropped = sections.filter(node => !rebuilt.some(fresh => fresh.uid === node.uid))
  const added = rebuilt.filter(node => !current.has(node.uid))
  if (dropped.length > 0 || added.some(node => node.intro !== true)) {
    console.log(`${id}: units differ from the PDF outline (edited by hand?); skipped`)
    continue
  }
  const before = new Map(sections.map(node => [node.uid, `${node.pageStart}-${node.pageEnd}`]))
  const changed = rebuilt.filter(node => before.get(node.uid) !== `${node.pageStart}-${node.pageEnd}`)
  if (changed.length === 0 && added.length === 0) {
    console.log(`${id}: ranges already current`)
    continue
  }
  const inserted = added.length === 0 ? '' : `; 新增 ${added.length} 个序言单元`
  console.log(`${id}: ${changed.length}/${rebuilt.length} sections change page range${inserted}`)
  for (const node of changed.slice(0, 8)) {
    console.log(`  ${node.title.slice(0, 46)}  p${before.get(node.uid)} → p${node.pageStart}-${node.pageEnd}`)
  }
  if (!write) continue
  await mkdir(backupDir, { recursive: true })
  await copyFile(file, join(backupDir, `${id}.json`))
  // Rebuild in reading order: existing units keep their object (and progress),
  // the intro units are new, so units[] gets one record for each.
  const unitByUid = new Map((manifest.units ?? []).map(unit => [unit.uid, unit]))
  manifest.structure = rebuilt.map(fresh => {
    const node = current.get(fresh.uid)
    if (node === undefined) return { ...fresh }
    node.pageStart = fresh.pageStart
    node.pageEnd = fresh.pageEnd
    return node
  })
  manifest.units = rebuilt.map(fresh => unitByUid.get(fresh.uid) ?? { uid: fresh.uid, status: 'new', concepts: [] })
  manifest.updatedAt = new Date().toISOString()
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  written += 1
}

if (write) console.log(`\nwrote ${written} manifest(s); backups in ${backupDir}`)
else console.log('\ndry run: pass --write to update the manifests')