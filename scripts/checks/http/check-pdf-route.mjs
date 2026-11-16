/**
 * Route check of the original-PDF endpoint: full body, Range, HEAD, ETag,
 * missing file and path traversal.
 */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LibraryPaths } from '../../../src/core/paths.ts'
import { StudyService } from '../../../src/host/service.ts'
import { makeStudyRoutes } from '../../../src/host/routes.ts'

const root = fileURLToPath(new URL('../../../.tmp/checks/pdf-route', import.meta.url))
await rm(root, { recursive: true, force: true })
const service = new StudyService(new LibraryPaths(root))
const imported = await service.import({ filePath: fileURLToPath(new URL('../../../samples/attention.pdf', import.meta.url)) })
const mid = imported.manifest.id
const routes = makeStudyRoutes(service)
const server = createServer((req, res) => {
  void routes[0].handler(req, res)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const base = 'http://127.0.0.1:' + String(address.port) + '/study-api'

try {
  const unitState = await service.materialState(mid)
  const uid = unitState.toc[0].uid
  const unit = await service.unit(mid, uid)
  assert.equal(unit.pdfAvailable, true, 'the reader reports the PDF is on disk')
  console.log('pdfAvailable:', unit.pdfAvailable)

  const full = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid))
  assert.equal(full.status, 200)
  assert.equal(full.headers.get('content-type'), 'application/pdf')
  assert.equal(full.headers.get('accept-ranges'), 'bytes')
  const bytes = new Uint8Array(await full.arrayBuffer())
  assert.ok(bytes.byteLength > 1000)
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-', 'the bytes are the real PDF')
  const etag = full.headers.get('etag')
  assert.ok(etag !== null, 'an etag is served')
  console.log('full:', bytes.byteLength, 'bytes | etag', etag)

  const ranged = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { headers: { range: 'bytes=0-99' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-99/' + String(bytes.byteLength))
  const head = new Uint8Array(await ranged.arrayBuffer())
  assert.equal(head.byteLength, 100)
  assert.deepEqual(head, bytes.slice(0, 100))
  console.log('range:', ranged.status, ranged.headers.get('content-range'))

  const openEnded = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { headers: { range: 'bytes=100-' } })
  assert.equal(openEnded.status, 206)
  assert.equal(openEnded.headers.get('content-range'), 'bytes 100-' + String(bytes.byteLength - 1) + '/' + String(bytes.byteLength))
  console.log('open-ended range: ok')

  const unsatisfiable = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { headers: { range: 'bytes=999999999-' } })
  assert.equal(unsatisfiable.status, 416)
  assert.equal(unsatisfiable.headers.get('content-range'), 'bytes */' + String(bytes.byteLength))
  console.log('unsatisfiable:', unsatisfiable.status)

  const head200 = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { method: 'HEAD' })
  assert.equal(head200.status, 200)
  assert.equal(head200.headers.get('content-length'), String(bytes.byteLength))
  const headBody = await head200.arrayBuffer()
  assert.equal(headBody.byteLength, 0, 'HEAD has no body')
  console.log('HEAD:', head200.status, head200.headers.get('content-length'))

  const cached = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { headers: { 'if-none-match': etag } })
  assert.equal(cached.status, 304)
  console.log('if-none-match:', cached.status)

  const missing = await fetch(base + '/pdf?mid=nope')
  assert.equal(missing.status, 404)
  const missingBody = await missing.json()
  assert.equal(missingBody.error.code, 'not-found')
  console.log('missing material:', missing.status)

  const traversal = await fetch(base + '/pdf?mid=' + encodeURIComponent('../etc'))
  assert.equal(traversal.status >= 400, true, 'a traversing mid is refused')
  console.log('traversal:', traversal.status)

  const cross = await fetch(base + '/pdf?mid=' + encodeURIComponent(mid), { headers: { origin: 'http://evil.example' } })
  assert.equal(cross.status, 403)
  console.log('cross-origin:', cross.status)
  console.log('pdf route check: ok')
} finally {
  server.close()
}
