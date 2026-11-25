/**
 * Learning operations: due queues, today view, review and concepts.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { unitKey } from '../../core/ids.ts'
import { listManifests, structureNodeOf } from '../../core/library.ts'
import {
  DEFAULT_TARGET,
  decayedMastery,
  dueConcepts,
  ensureKnowledge,
  retentionSafe,
  thresholdForLevel,
} from '../../core/knowledge.ts'
import { dueUnits, readProgress, recordReview } from '../../core/progress.ts'
import { bestOccurrence, listConcepts, readConcept } from '../../core/concepts.ts'
import { activePlan, listPlans, nextStep } from '../../core/plans.ts'
import { planProgress } from '../../core/planGate.ts'
import { addDays, daysBetween, localDate } from '../../core/time.ts'
import type { Rating } from '../../core/types.ts'
import type { ConceptCard, ConceptDetailView, NextStepView, PlanBrief, TodayView } from '../../core/views.ts'
import { type CompleteResult, type DueItem } from '../../core/views.ts'
import { rowOf } from '../service/views.ts'
import { StudyError } from './error.ts'
import { goalConceptLevels, learnedSteps, learnedTargets } from './plans.ts'
import type { StudyService } from '../service.ts'

export async function due(svc: StudyService, today = svc.today()): Promise<DueItem[]> {
  const [manifests, progress] = await Promise.all([listManifests(svc.paths), readProgress(svc.paths)])
  const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
  const items: DueItem[] = []
  for (const entry of dueUnits(progress, today)) {
    const [materialId, unitId] = entry.key.split(':') as [string, string]
    const manifest = byId.get(materialId)
    if (manifest === undefined) continue
    const node = manifest.structure.find(candidate => candidate.uid === unitId)
    if (node === undefined) continue
    items.push({
      key: entry.key,
      materialId,
      unitId,
      title: node.title,
      materialTitle: manifest.title,
      due: entry.due,
      overdueDays: entry.overdueDays,
    })
  }
  return items
}

export async function todayView(svc: StudyService): Promise<TodayView> {
  const date = svc.today()
  const [manifests, progress, concepts, plans, knowledge, records] = await Promise.all([
    listManifests(svc.paths),
    readProgress(svc.paths),
    svc.concepts(),
    listPlans(svc.paths),
    ensureKnowledge(svc.paths),
    listConcepts(svc.paths),
  ])
  const active = activePlan(plans)
  // A goal owns no concept list: its sections carry them.
  const goalLevels = active === undefined ? undefined : await goalConceptLevels(svc, active)
  const goalMap = goalLevels?.levels ?? new Map<string, 1 | 2 | 3 | 4>()
  const thresholdOf = (conceptId: string): number =>
    goalMap.size === 0 ? DEFAULT_TARGET : thresholdForLevel(goalMap.get(conceptId))
  // A due concept opens the section that asks for the deepest level, not the
  // first page that happens to mention it.
  const sectionLevel = new Map(
    (goalLevels?.sections ?? []).map(section => [section.target, section.level] as const),
  )
  const places = new Map(
    records.map(record => {
      const occurrence = bestOccurrence(record.occurrences, candidate =>
        sectionLevel.get(`${candidate.material}:${candidate.unit}`),
      )
      return [
        record.id,
        occurrence === undefined
          ? undefined
          : { materialId: occurrence.material, unitId: occurrence.unit },
      ]
    }),
  )

  const names = new Map(concepts.map(concept => [concept.id, concept.name]))
  // Without an active goal there is no scope: today stays empty instead of
  // falling back to the whole library.
  const inScope = (conceptId: string): boolean => goalMap.size > 0 && goalMap.has(conceptId)
  const knowledgeDue = dueConcepts(knowledge, thresholdOf, date)
    .filter(entry => inScope(entry.conceptId))
    .map(entry => {
      const place = places.get(entry.conceptId)
      const manifest = place === undefined ? undefined : manifests.find(candidate => candidate.id === place.materialId)
      const unit = place === undefined ? undefined : manifest?.structure.find(node => node.uid === place.unitId)
      return {
        ...entry,
        name: names.get(entry.conceptId) ?? entry.conceptId,
        ...(place === undefined ? {} : place),
        ...(unit === undefined ? {} : { unitTitle: unit.title }),
        ...(manifest === undefined ? {} : { materialTitle: manifest.title }),
      }
    })
  const knowledgeBelow = concepts
    .filter(concept => inScope(concept.id))
    .map(concept => {
      return {
        conceptId: concept.id,
        name: concept.name,
        mastery: concept.mastery,
        target: thresholdOf(concept.id),
      }
    })
    .filter(entry => entry.mastery < entry.target)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)

  const goalPassed = [...goalMap.keys()].filter(conceptId => {
    const entry = knowledge.concepts[conceptId]
    if (entry === undefined) return false
    return decayedMastery(entry, date) >= thresholdForLevel(goalMap.get(conceptId))
  }).length
  // The gate and Today read one rule: a point is safe when it stays at target
  // through the deadline (or is at target already once the deadline passed).
  const goalSafe =
    active?.deadline === undefined
      ? 0
      : [...goalMap.keys()].filter(conceptId =>
          retentionSafe(knowledge.concepts[conceptId], thresholdOf(conceptId), active.deadline!, date),
        ).length
  const overdueDays =
    active?.deadline === undefined || active.deadline >= date ? 0 : daysBetween(active.deadline, date)
  const goalBlock =
    active === undefined
      ? undefined
      : {
          id: active.id,
          goal: active.goal,
          ...(active.deliverable === undefined ? {} : { deliverable: active.deliverable }),
          ...(active.deadline === undefined ? {} : { deadline: active.deadline }),
          passed: goalPassed,
          total: goalMap.size,
          missingSections: goalLevels?.missing.length ?? 0,
          overdueDays,
          readyToClose:
            goalMap.size > 0 && goalSafe === goalMap.size && (goalLevels?.missing.length ?? 0) === 0,
        }

  // The next reading suggestion follows the goal's section route, skipping the
  // sections whose knowledge points are already at target. Without a goal there
  // is nothing to suggest: the panel keeps its empty state.
  const learned =
    active === undefined
      ? new Set<string>()
      : learnedTargets(goalLevels?.sections ?? [], knowledge, date)
  let next: NextStepView | null = null
  const step = active === undefined ? undefined : nextStep(active, learnedSteps(learned))
  if (step?.target !== undefined && step.coverage !== 'skip') {
    const [materialId, unitId] = step.target.split(':') as [string, string]
    const manifest = manifests.find(candidate => candidate.id === materialId)
    const node = manifest?.structure.find(candidate => candidate.uid === unitId)
    if (manifest !== undefined && node !== undefined) {
      next = {
        source: 'plan',
        planId: active!.id,
        materialId,
        unitId,
        title: node.title,
        materialTitle: manifest.title,
        why: step.why,
      }
    }
  }
  const learnedToday = Object.values(progress.units).filter(entry => {
    const first = entry.firstLearnedAt === undefined ? '' : localDate(new Date(entry.firstLearnedAt))
    const last = entry.lastReviewedAt === undefined ? '' : localDate(new Date(entry.lastReviewedAt))
    return first === date || last === date
  }).length

  const planBriefs = await Promise.all(
    plans
      .filter(plan => plan.status === 'active')
      .map(async plan => {
        const learnedForPlan =
          plan === active && goalLevels !== undefined
            ? learned
            : learnedTargets((await goalConceptLevels(svc, plan)).sections, knowledge, date)
        return {
          id: plan.id,
          goal: plan.goal,
          ...planProgress(plan, learnedSteps(learnedForPlan)),
          gateReady: goalBlock?.readyToClose === true,
          ...(plan.deliverable === undefined ? {} : { deliverable: plan.deliverable }),
        }
      }),
  )

  return {
    date,
    clockOffsetDays: svc.clockState().offsetDays,
    weak: knowledgeBelow.slice(0, 5).map(entry => {
      const concept = concepts.find(candidate => candidate.id === entry.conceptId)
      return {
        id: entry.conceptId,
        name: entry.name,
        mastery: entry.mastery,
        occurrences: concept?.occurrences ?? 0,
        materials: concept?.materials ?? [],
        weak: true,
      }
    }),
    next,
    plans: planBriefs,
    learnedToday,
    ...(goalBlock === undefined ? {} : { goal: goalBlock }),
    knowledge: {
      total: Object.keys(knowledge.concepts).length,
      settled: goalSafe,
      due: knowledgeDue,
      below: knowledgeBelow,
    },
  }
}

export async function review(svc: StudyService, 
  materialId: string,
  unitId: string,
  options: { rating: Rating; quizScore?: number; revision?: number },
  ): Promise<CompleteResult> {
  const manifest = await svc.manifest(materialId)
  const node = structureNodeOf(manifest, unitId)
  await svc.assertRevision(options.revision)
  const key = unitKey(materialId, unitId)
  const preferences = await svc.preferences()
  const { progress, unit } = await recordReview(svc.paths, key, {
    rating: options.rating,
    quizScore: options.quizScore,
    today: svc.today(),
    targetRetention: preferences.targetRetention,
    maxIntervalDays: preferences.maxIntervalDays,
  })
  return {
    unit: rowOf(materialId, node, manifest, progress, false),
    due: unit.due ?? addDays(svc.today(), 1),
    revision: progress.revision,
    note: `已记录评级 ${options.rating}，下次复习 ${unit.due}。`,
  }
}

export async function concepts(svc: StudyService): Promise<ConceptCard[]> {
  const [records, knowledge] = await Promise.all([listConcepts(svc.paths), ensureKnowledge(svc.paths)])
  const today = svc.today()
  return records.map(record => {
    const entry = knowledge.concepts[record.id]
    const mastery = entry === undefined ? 0.5 : decayedMastery(entry, today)
    return {
      id: record.id,
      name: record.name,
      mastery,
      occurrences: record.occurrences.length,
      materials: [...new Set(record.occurrences.map(occurrence => occurrence.material))],
      weak: entry === undefined ? true : mastery < DEFAULT_TARGET || entry.streak >= 2,
    }
  })
}

export async function conceptView(svc: StudyService, conceptId: string): Promise<ConceptDetailView> {
  const record = await readConcept(svc.paths, conceptId)
  if (record === null) throw new StudyError('not-found', `概念不存在：${conceptId}`)
  const [manifests, knowledge] = await Promise.all([listManifests(svc.paths), ensureKnowledge(svc.paths)])
  const state = knowledge.concepts[conceptId]
  const byId = new Map(manifests.map(manifest => [manifest.id, manifest]))
  const occurrences: ConceptDetailView['occurrences'] = []
  for (const occurrence of record.occurrences) {
    const manifest = byId.get(occurrence.material)
    const node = manifest?.structure.find(candidate => candidate.uid === occurrence.unit)
    if (manifest === undefined || node === undefined) continue
    occurrences.push({
      materialId: manifest.id,
      materialTitle: manifest.title,
      unitId: node.uid,
      unitTitle: node.title,
      page: occurrence.page,
      role: occurrence.role,
    })
  }
  return {
    concept: {
      id: record.id,
      name: record.name,
      aliases: record.aliases,
      definition: record.definition,
      prereqOf: record.prereqOf,
      related: record.related,
    },
    ...(state === undefined
      ? {}
      : {
          mastery: {
            mastery: decayedMastery(state, svc.today()),
            attempts: state.attempts,
            correct: state.correct,
            streak: state.streak,
            ...(state.lastAt === undefined ? {} : { lastSeen: state.lastAt }),
          },
        }),
    occurrences,
  }
}
