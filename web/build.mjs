/**
 * Build the standalone web version into `dist-web/`.
 *
 * Separate from `scripts/build.mjs` on purpose: a broken web experiment must
 * never block the plugin bundle. The server is bundled next to its static
 * files, because the asset routes resolve katex/pdf.js relative to their own
 * module URL.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const esbuild = fileURLToPath(new URL('../tooling/package/bin/esbuild', import.meta.url))
const out = fileURLToPath(new URL('../dist-web', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const define = `__STUDY_VERSION__=${JSON.stringify(pkg.version)}`

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

const run = args => {
  execFileSync(esbuild, args, { cwd: root, stdio: 'inherit' })
}

run([
  'web/server.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  `--define:${define}`,
  `--define:__STUDY_PDF_WORKER__=${JSON.stringify('./pdfjs/pdf.worker.mjs')}`,
  '--log-level=warning',
  '--outfile=dist-web/server.mjs',
])

run([
  'web/main.tsx',
  '--bundle',
  '--platform=browser',
  '--format=iife',
  '--target=es2022',
  '--jsx=automatic',
  '--define:process.env.NODE_ENV="production"',
  `--define:${define}`,
  '--minify',
  '--log-level=warning',
  '--outfile=dist-web/app.js',
])

// Same vendored assets the plugin ships: formulas and the in-panel PDF viewer
// must work without a CDN.
await cp(new URL('../vendor/katex/dist', import.meta.url), new URL('../dist-web/katex', import.meta.url), {
  recursive: true,
})
await mkdir(new URL('../dist-web/pdfjs', import.meta.url), { recursive: true })
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await cp(new URL(`../vendor/pdfjs/${name}`, import.meta.url), new URL(`../dist-web/pdfjs/${name}`, import.meta.url))
}
for (const directory of ['wasm', 'cmaps', 'standard_fonts']) {
  await cp(new URL(`../vendor/pdfjs/${directory}`, import.meta.url), new URL(`../dist-web/pdfjs/${directory}`, import.meta.url), {
    recursive: true,
  })
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知止</title>
<style>html,body{margin:0;height:100%}#root{height:100vh;height:100dvh}</style>
</head>
<body>
<div id="root"></div>
<script src="/app.js"></script>
</body>
</html>
`
await writeFile(new URL('../dist-web/index.html', import.meta.url), html)

const app = await readFile(new URL('../dist-web/app.js', import.meta.url))
console.log(`built dist-web/ (app.js ${(app.byteLength / 1024).toFixed(0)} KiB)`)