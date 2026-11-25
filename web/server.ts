/**
 * Standalone host for the study desk.
 *
 * The plugin half talks to a DSH host; this file replaces that host with one
 * loopback server. `/study-api` is the same dispatcher the panel already uses,
 * everything else is the two files `web/build.mjs` emits next to this bundle.
 * No domain rule lives here — only process wiring, so the panel and the plugin
 * keep sharing one service.
 *
 * Env: `PORT` (default 7801), `STUDY_DATA_ROOT` (default `~/.zhizhi`).
 */
import { createServer, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LibraryPaths, resolveDataRoot } from '../src/core/paths.ts'
import { BookService } from '../src/host/books.ts'
import { GenerationService } from '../src/host/generation.ts'
import { InsightService } from '../src/host/insights.ts'
import { JobQueue } from '../src/host/jobs.ts'
import { QuizSessionService } from '../src/host/quizSessions.ts'
import { makeStudyRoutes } from '../src/host/routes.ts'
import { StudyService } from '../src/host/service.ts'
import { SettingsService } from '../src/host/settings.ts'
import { UsageService } from '../src/host/usage.ts'

/** Files live next to the built server, so `dist-web/` stays self-contained. */
const HERE = fileURLToPath(new URL('.', import.meta.url))
const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 7801)

/** The desk keeps its own library: never the plugin's `$DSH_HOME/study`. */
const DATA_ROOT = resolveDataRoot(process.env.STUDY_DATA_ROOT?.trim() || join(homedir(), '.zhizhi'))

const paths = new LibraryPaths(DATA_ROOT)
const service = new StudyService(paths)
const settings = new SettingsService(paths)
const usage = new UsageService(paths, settings)
const insights = new InsightService(paths)
const jobs = new JobQueue(paths, { concurrency: () => 1 })
const books = new BookService(paths, service)

// A browser profile has no Host model to borrow: start on the custom engine so
// the settings dialog opens on the fields a user can actually fill.
if (!existsSync(paths.settingsFile)) await settings.patch({ text: { kind: 'openai-compatible' } })

const generation = new GenerationService(paths, { service, books, insights, settings, jobs, usage })
const quizSessions = new QuizSessionService(paths, service, generation)
await jobs.recover()
await quizSessions.recover()

const [route] = makeStudyRoutes(service, {
  settings,
  insights,
  generation,
  jobs,
  quizSessions,
  books,
  usage,
  // Nothing to restart: the client only uses this as "reload after changes".
  restartPlugin: () => undefined,
})

/** Send one built file. Only the two known names are reachable. */
async function sendFile(res: ServerResponse, name: string, type: string, head: boolean): Promise<void> {
  const body = await readFile(join(HERE, name))
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(head ? undefined : body)
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`)
    const head = req.method === 'HEAD'
    if (url.pathname === '/' || url.pathname === '/index.html') {
      await sendFile(res, 'index.html', 'text/html; charset=utf-8', head)
      return
    }
    if (url.pathname === '/app.js') {
      await sendFile(res, 'app.js', 'text/javascript; charset=utf-8', head)
      return
    }
    if (route !== undefined && (url.pathname === '/study-api' || url.pathname.startsWith('/study-api/'))) {
      await route.handler(req, res)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })().catch(error => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(error instanceof Error ? error.message : String(error))
  })
})

server.listen(PORT, HOST, () => {
  console.log(`知止网页版：http://${HOST}:${PORT}`)
  console.log(`数据目录：${DATA_ROOT}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}