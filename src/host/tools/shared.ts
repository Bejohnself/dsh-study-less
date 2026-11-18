/**
 * Shared pieces of the agent tools.
 *
 * Definitions are plain objects (name, description, JSON Schema parameters,
 * canonical JSON output and a renderer), so no runtime dependency on the tool SDK
 * is needed. Domain refusals come back as values the model can read and fix.
 */
import type { StudyService } from '../service.ts'
import type { BookService } from '../books.ts'
import type { GenerationService } from '../generation.ts'
import type { InsightService } from '../insights.ts'
import type { JobQueue } from '../jobs.ts'
import type { QuizSessionService } from '../quizSessions.ts'
import { StudyError } from '../service/error.ts'

/** Minimal ToolDefinition shape the Host registry accepts. */
export interface StudyToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: { signal?: AbortSignal }): Promise<unknown>
}

/** Optional services a deployment may or may not have. */
export interface StudyToolExtras {
  generation?: GenerationService
  insights?: InsightService
  jobs?: JobQueue
  quizSessions?: QuizSessionService
  books?: BookService
}

/** What every tool group receives. */
export interface ToolContext {
  service: StudyService
  extras: StudyToolExtras
}

/** Render a canonical value as pretty JSON for the model. */
export function renderJson(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Refusal value returned instead of throwing for expected domain errors. */
export function refusal(error: unknown): Record<string, unknown> {
  if (error instanceof StudyError) {
    return { ok: false, code: error.code, message: error.message, details: error.details ?? null }
  }
  throw error
}

/** Object JSON Schema helper. */
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}
