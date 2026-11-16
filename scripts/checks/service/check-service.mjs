import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { StudyService } from '../../../src/host/service.ts'
import { LibraryPaths } from '../../../src/core/paths.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/service', import.meta.url))
await rm(root, { recursive: true, force: true })
const service = new StudyService(new LibraryPaths(root))
const result = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
console.log('imported:', result.manifest.id, result.manifest.type, 'pages', result.manifest.source.pages, 'units', result.manifest.structure.length)
console.log('warnings:', result.warnings)
console.log('first units:', result.manifest.structure.slice(0, 5).map(n => `${n.uid}(${n.pageStart}-${n.pageEnd})`).join(', '))
const library = await service.library()
console.log('library:', library.map(c => `${c.id}:${c.type}:units=${c.units}`).join(' | '))
const state = await service.materialState(result.manifest.id)
console.log('toc rows:', state.toc.length, 'next:', state.next)
const section = state.toc.find(row => row.kind === 'section' && row.pageStart > 1) ?? state.toc[0]
const unit = await service.unit(result.manifest.id, section.uid)
console.log('unit pages:', unit.original.length, 'notes:', unit.notes === null ? 'none' : 'present')
console.log('page1 snippet:', unit.original[0]?.text.slice(0, 120).replace(/\n/g, ' '))
const done = await service.complete(result.manifest.id, section.uid)
console.log('completed:', done.due, 'rev', done.revision, '|', done.note)
const again = await service.complete(result.manifest.id, section.uid)
console.log('idempotent:', again.note)
const dueToday = await service.due()
console.log('due today:', dueToday.length)
const dueTomorrow = await service.due(done.due)
console.log('due tomorrow:', dueTomorrow.map(d => `${d.materialId}:${d.unitId}`).join(', '))
const reviewed = await service.review(result.manifest.id, section.uid, { rating: 3, revision: done.revision })
console.log('reviewed -> next due', reviewed.due, 'rev', reviewed.revision)
