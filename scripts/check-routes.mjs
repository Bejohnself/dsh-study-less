import { createServer } from 'node:http'
import { LibraryPaths } from '../src/core/paths.ts'
import { StudyService } from '../src/host/service.ts'
import { makeStudyRoutes } from '../src/host/routes.ts'

const service = new StudyService(new LibraryPaths('.test-study'))
const routes = makeStudyRoutes(service)
const server = createServer((req, res) => { void routes[0].handler(req, res) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = `http://127.0.0.1:${port}/study-api`
const call = async (path, init) => {
  const response = await fetch(base + path, init)
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}
try {
  const lib = await call('/library')
  console.log('library:', lib.status, lib.body.ok, lib.body.value?.[0]?.id)
  const state = await call('/material?mid=attention')
  console.log('material:', state.status, state.body.ok, state.body.value?.toc?.length, 'due', state.body.value?.due?.length)
  const uid = state.body.value.toc.find(r => r.kind === 'section').uid
  const unit = await call(`/unit?mid=attention&uid=${uid}`)
  console.log('unit:', unit.status, unit.body.ok, 'pages', unit.body.value?.original?.length, 'notes', unit.body.value?.notes)
  const revision = state.body.value.material.learnedUnits === 0 ? 0 : undefined
  const badConflict = await call('/unit/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mid: 'attention', uid, revision: 9999 }) })
  console.log('conflict guard:', badConflict.status, badConflict.body.error?.code)
  const ok = await call('/unit/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mid: 'attention', uid, revision: revision }) })
  console.log('complete:', ok.status, ok.body.value?.note)
  const cross = await fetch(base + '/library', { headers: { origin: 'http://evil.example' } })
  console.log('cross-origin:', cross.status)
  const missing = await call('/material?mid=nope')
  console.log('not-found:', missing.status, missing.body.error?.code)
  const unknown = await call('/nope')
  console.log('unknown route:', unknown.status)
} finally {
  server.close()
}
