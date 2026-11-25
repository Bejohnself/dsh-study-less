import { readFile } from 'node:fs/promises'
import { extractPdf } from '../../../src/host/pdf.ts'
const data = new Uint8Array(await readFile('tests/fixtures/attention.pdf'))
const result = await extractPdf(data)
console.log('pages', result.numPages, 'outline entries', result.outline.length)
console.log(JSON.stringify(result.outline.slice(0, 10), null, 1))
