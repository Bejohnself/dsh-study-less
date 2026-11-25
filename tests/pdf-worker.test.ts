/**
 * The Node worker must be found after bundling.
 *
 * pdf.js resolves its fake worker relative to the importing module and falls
 * back to `./pdf.worker.mjs`; a bundle sits in `lib/` or `dist-web/` while the
 * worker ships in `pdfjs/`. This bundles the extractor the same way both builds
 * do and reads a real PDF, so the path contract fails here instead of at import.
 */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = fileURLToPath(new URL('../.tmp/unit-pdf', import.meta.url))
const esbuild = fileURLToPath(new URL('../tooling/package/bin/esbuild', import.meta.url))

test('bundled PDF extraction finds its Node worker', async () => {
  await rm(out, { recursive: true, force: true })
  await mkdir(`${out}/pdfjs`, { recursive: true })
  execFileSync(
    esbuild,
    [
      'src/host/pdf.ts',
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node22',
      `--define:__STUDY_PDF_WORKER__=${JSON.stringify('./pdfjs/pdf.worker.mjs')}`,
      '--log-level=warning',
      `--outfile=${out}/chunk.mjs`,
    ],
    { cwd: root, stdio: 'inherit' },
  )
  await cp(`${root}/vendor/pdfjs/pdf.worker.mjs`, `${out}/pdfjs/pdf.worker.mjs`)

  const { extractPdf } = await import(pathToFileURL(`${out}/chunk.mjs`).href)
  const data = new Uint8Array(await readFile(`${root}/tests/fixtures/attention.pdf`))
  const result = await extractPdf(data)

  assert.ok(result.numPages > 0)
  assert.ok(result.pages.some(page => page.text.trim().length > 0))
})