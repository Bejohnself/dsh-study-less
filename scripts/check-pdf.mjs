import { readFile } from 'node:fs/promises'
const { getDocument } = await import('../vendor/pdfjs/pdf.mjs')
const data = new Uint8Array(await readFile('samples/attention.pdf'))
const doc = await getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise
console.log('pages:', doc.numPages)
const outline = await doc.getOutline()
console.log('outline:', outline ? outline.length : null, outline ? JSON.stringify(outline.slice(0, 3)).slice(0, 300) : '')
const page = await doc.getPage(1)
const content = await page.getTextContent()
const text = content.items.map(i => ('str' in i ? i.str : '')).join(' ')
console.log('p1 text:', text.slice(0, 300))
await doc.destroy()
