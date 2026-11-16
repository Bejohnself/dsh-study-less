/**
 * Voice gate: the few copy mistakes that are cheap to catch mechanically.
 *
 * This is not a linter for taste — it only blocks the openings that reliably
 * turn the desk back into a form (docs/VOICE.md「不可以」). Anything subtler
 * than these still needs a human read.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../src/client/', import.meta.url))

const BANNED = [
  { phrase: '综上所述', why: '书面腔' },
  { phrase: '值得注意的是', why: '书面腔' },
  { phrase: '本节将介绍', why: '书面腔' },
  { phrase: '由此可见', why: '书面腔' },
  { phrase: '本系统', why: '第三方口吻' },
  { phrase: '该功能', why: '第三方口吻' },
  { phrase: '秒懂', why: '夸张承诺' },
  { phrase: '彻底掌握', why: '夸张承诺' },
  { phrase: '轻松搞定', why: '夸张承诺' },
  { phrase: '嗷呜', why: '卖萌过头' },
]

/** Every source file under src/client, recursively. */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path)))
    else if (/\.(ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('mascot.ts')) out.push(path)
  }
  return out
}

const failures = []
const files = await walk(root)
for (const file of files) {
  const text = await readFile(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    // Only flagged inside quotes: a comment may legitimately name a banned form.
    if (!/['"`]/u.test(line)) return
    for (const rule of BANNED) {
      if (line.includes(rule.phrase)) {
        failures.push({ file: file.replace(root, ''), line: index + 1, phrase: rule.phrase, why: rule.why })
      }
    }
  })
}

if (failures.length === 0) {
  console.log(`voice check: ok (${String(files.length)} files)`)
} else {
  for (const failure of failures) {
    console.log(`✘ ${failure.file}:${String(failure.line)} 「${failure.phrase}」— ${failure.why}`)
  }
  console.log(`voice check: ${String(failures.length)} issue(s)`)
  process.exitCode = 1
}