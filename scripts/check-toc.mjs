import { LibraryPaths } from '../src/core/paths.ts'
import { StudyService } from '../src/host/service.ts'
const service = new StudyService(new LibraryPaths('.test-study'))
const state = await service.materialState('attention')
console.log(state.toc.map(r => `${r.kind.padEnd(7)} p${r.pageStart}-${r.pageEnd} ${r.title}`).join('\n'))
