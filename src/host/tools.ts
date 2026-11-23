/**
 * Agent tools of the study desk.
 *
 * One builder assembles the groups in ./tools/<domain>.ts, so the model-facing
 * surface stays readable one domain at a time.
 */
import type { StudyService } from './service.ts'
import type { StudyToolDefinition, StudyToolExtras } from './tools/shared.ts'
import { libraryTools } from './tools/library.ts'
import { notesTools } from './tools/notes.ts'
import { readingTools } from './tools/reading.ts'
import { plansTools } from './tools/plans.ts'
import { generateTools } from './tools/generate.ts'

export type { StudyToolDefinition, StudyToolExtras }

/** Frozen experimental tools: never registered, even when their services exist. */
const FROZEN_TOOLS = new Set(['study_insight', 'study_book'])

/**
 * Build every tool the study desk registers.
 * @param service - the live study service.
 * @param extras - optional generation/insight services.
 */
export function buildStudyTools(service: StudyService, extras: StudyToolExtras = {}): StudyToolDefinition[] {
  const context = { service, extras }
  return [
    ...libraryTools(context),
    ...notesTools(context),
    ...readingTools(context),
    ...plansTools(context),
    ...generateTools(context),
  ].filter(tool => !FROZEN_TOOLS.has(tool.name))
}
