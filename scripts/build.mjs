/**
 * Build both halves of the dsh-study bundle.
 *
 * The build uses the standalone esbuild binary under tooling/ so it never needs
 * a package manager: every runtime dependency is bundled into lib/, and the only
 * externals are the Host's own @deepseek-ai services and React's platform modules.
 *
 * Host half: ESM for the Node process.
 * Client half: the shell's module loader expects a classic script that registers
 * a CJS factory, so the browser bundle is built as CJS and wrapped below.
 */
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const esbuild = fileURLToPath(new URL('../tooling/package/bin/esbuild', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

await mkdir(new URL('../lib', import.meta.url), { recursive: true })

const run = (args) => {
  execFileSync(esbuild, args, { cwd: root, stdio: 'inherit' })
}

run([
  'src/host/index.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--external:@deepseek-ai/*',
  '--external:react',
  '--external:react-dom',
  `--define:__STUDY_VERSION__=${JSON.stringify(pkg.version)}`,
  '--sourcemap',
  '--log-level=warning',
  '--outfile=lib/index.js',
])

run([
  'src/client/index.tsx',
  '--bundle',
  '--platform=browser',
  '--format=cjs',
  '--target=es2022',
  '--jsx=automatic',
  '--external:react',
  '--external:react-dom',
  '--external:react/jsx-runtime',
  '--define:process.env.NODE_ENV="production"',
  `--define:__STUDY_VERSION__=${JSON.stringify(pkg.version)}`,
  '--minify',
  '--log-level=warning',
  '--outfile=lib/client.body.cjs',
])

const body = await readFile(new URL('../lib/client.body.cjs', import.meta.url), 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
await writeFile(new URL('../lib/client.js', import.meta.url), wrapped)
// The panel loads pdf.js in the browser from routes that mirror lib/pdfjs/, so
// the module, its worker and the decoder assets ship next to the Host bundle.
await mkdir(new URL('../lib/pdfjs', import.meta.url), { recursive: true })
for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await copyFile(
    new URL(`../vendor/pdfjs/${name}`, import.meta.url),
    new URL(`../lib/pdfjs/${name}`, import.meta.url),
  )
}
for (const directory of ['wasm', 'cmaps', 'standard_fonts']) {
  await cp(
    new URL(`../vendor/pdfjs/${directory}`, import.meta.url),
    new URL(`../lib/pdfjs/${directory}`, import.meta.url),
    { recursive: true },
  )
}
await unlink(new URL('../lib/client.body.cjs', import.meta.url))
console.log(`built lib/index.js and lib/client.js (${wrapped.length} bytes client)`)
