/**
 * Small atomic JSON file store.
 *
 * Writes are serialized per path and go through a temp file + fsync + rename, so
 * a crash never leaves a half-written ledger. The Host half is the only writer;
 * the browser only sends actions.
 */
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Writes queued per absolute path. */
const queues = new Map<string, Promise<void>>()

/** Ensure a directory exists. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

/**
 * Read JSON, returning the fallback when the file is missing.
 * A corrupt file is an error, not a silent fallback: overwriting it would lose
 * the user's progress.
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`corrupt JSON at ${file}: ${(error as Error).message}`)
  }
}

/** Last modification time in ms, or 0 when the file does not exist. */
export async function mtimeMs(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/** Write JSON atomically and durably. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await ensureDir(dirname(file))
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Serialize writes to the same file. */
export function enqueueWrite(file: string, task: () => Promise<void>): Promise<void> {
  const previous = queues.get(file) ?? Promise.resolve()
  const next = previous.then(task, task)
  queues.set(
    file,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/** Read-modify-write one JSON file, serialized against other writes. */
export async function updateJson<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>,
): Promise<T> {
  let result: T = fallback
  await enqueueWrite(file, async () => {
    const current = await readJson(file, fallback)
    result = await mutate(current)
    await writeJsonAtomic(file, result)
  })
  return result
}

/** Write text atomically and durably. */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await ensureDir(dirname(file))
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(temp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
