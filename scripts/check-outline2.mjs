import { readFile } from 'node:fs/promises'
import { extractPdf } from '../src/host/pdf.ts'
const result = await extractPdf(new Uint8Array(await readFile('samples/attention.pdf')))
console.log(result.outline.map(e => `${e.level} p${e.page} ${e.title}`).join('\n'))
