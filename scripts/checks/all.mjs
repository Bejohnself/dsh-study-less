/**
 * Run every check in dependency order.
 *
 * The checks share throwaway libraries under `.tmp/checks/`: `check-service`
 * seeds the library that `check-routes` and `check-toc` read, and `check-plan`
 * seeds the one `check-plan-routes` reads. That is why the order below is not
 * alphabetical and why the folder name is not enough to run one check alone.
 *
 * The build runs first because `check-client` loads `lib/client.js`. The whole
 * run takes a few seconds; on success the throwaway tree is removed, on failure
 * it is kept for inspection.
 */
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const tmp = join(repo, '.tmp', 'checks')

/** Scripts in dependency order: seeding checks before the checks that read their library. */
const STEPS = [
  ['service: library / units / today', 'scripts/checks/service/check-service.mjs'],
  ['service: plan, attempts, closure gate', 'scripts/checks/service/check-plan.mjs'],
  ['service: judged answers and cards', 'scripts/checks/service/check-judge.mjs'],
  ['service: inline generation and jobs', 'scripts/checks/service/check-generation.mjs'],
  ['service: reading blocks and cards', 'scripts/checks/service/check-blocks.mjs'],
  ['http: API surface', 'scripts/checks/http/check-api.mjs'],
  ['http: core routes (needs service library)', 'scripts/checks/http/check-routes.mjs'],
  ['http: plan routes (needs plan library)', 'scripts/checks/http/check-plan-routes.mjs'],
  ['http: judged answers', 'scripts/checks/http/check-judge-route.mjs'],
  ['http: original PDF and Range', 'scripts/checks/http/check-pdf-route.mjs'],
  ['ui: built client bundle', 'scripts/checks/ui/check-client.mjs'],
  ['ui: Markdown and math', 'scripts/checks/ui/check-markdown.mjs'],
  ['ui: copy gate', 'scripts/checks/ui/check-voice.mjs'],
]

const run = (label, path) => {
  console.log(`\n▶ ${label}`)
  execFileSync(process.execPath, [join(repo, path)], { cwd: repo, stdio: 'inherit' })
}

await rm(tmp, { recursive: true, force: true })
try {
  run('build: host and client bundles', 'scripts/build.mjs')
  for (const [label, path] of STEPS) run(label, path)
} catch (error) {
  console.error('\ncheck failed — .tmp/checks kept for inspection')
  throw error
}
await rm(tmp, { recursive: true, force: true })
// `tmp` is `.tmp/checks`; drop the now-empty parent so the repo root stays clean.
await rm(join(repo, '.tmp'), { recursive: true, force: true })
console.log(`\nall checks passed (${String(STEPS.length)} scripts + build)`)