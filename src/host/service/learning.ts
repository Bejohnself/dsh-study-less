/**
 * Learning operations: due queues, today view, review and concepts.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { unitKey } from '../../core/ids.ts'
import { listManifests, structureNodeOf } from '../../core/library.ts'
import { decayedMastery, dueConcepts, ensureKnowledge, targetOf, thresholdForLevel } from '../../core/knowledge.ts'
import { dueUnits, readProgress, recordReview } from '../../core/progress.ts'
import { listConcepts, readConcept } from '../../core/concepts.ts'
import { activePlan, goalConcepts, listPlans, nextStep } from '../../core/plans.ts'
import { dueCards, listCards, reviewCardOnce } from '../../core/cards.ts'
import { addDays, localDate } from '../../core/time.ts'
import type { Rating } from '../../core/types.ts'
import type { CardView, ConceptCard, ConceptDetailView, NextStepView, PlanBrief, TodayView } from '../../core/views.ts'
import { type CompleteResult, type DueItem } from '../../core/views.ts'
import { cardView, rowOf } from '../service/views.ts'
import { StudyError } from './error.ts'
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
  const [manifests, progress, concepts, plans, knowledge] = await Promise.all([
    listManifests(svc.paths),
    readProgress(svc.paths),
    svc.concepts(),
    listPlans(svc.paths),
    ensureKnowledge(svc.paths),
  ])
  const active = activePlan(plans)
  const goalMap = active === undefined ? new Map<string, 1 | 2 | 3 | 4>() : goalConcepts(active)
  const thresholdOf = (conceptId: string): number =>
    goalMap.size === 0 ? targetOf(knowledge.concepts[conceptId]) : thresholdForLevel(goalMap.get(conceptId))

  const names = new Map(concepts.map(concept => [concept.id, concept.name]))
  const inScope = (conceptId: string): boolean => goalMap.size === 0 || goalMap.has(conceptId)
  const knowledgeDue = dueConcepts(knowledge, date)
    .filter(entry => inScope(entry.conceptId))
    .map(entry => ({
      ...entry,
      name: names.get(entry.conceptId) ?? entry.conceptId,
      target: thresholdOf(entry.conceptId),
    }))
  const knowledgeBelow = concepts
    .filter(concept => inScope(concept.id))
    .map(concept => {
      const entry = knowledge.concepts[concept.id]
      return {
        conceptId: concept.id,
        name: concept.name,
        mastery: concept.mastery,
        target: thresholdOf(concept.id),
        settled: entry?.settledAt !== undefined,
      }
    })
    .filter(entry => !entry.settled && entry.mastery < entry.target)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)

  const goalPassed = [...goalMap.keys()].filter(conceptId => {
    const entry = knowledge.concepts[conceptId]
    if (entry === undefined) return false
    return decayedMastery(entry, date) >= thresholdForLevel(goalMap.get(conceptId))
  }).length
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
          readyToClose: goalMap.size > 0 && goalPassed === goalMap.size,
        }

  // The next reading suggestion follows the goal's section route; without a
  // goal it falls back to the next unfinished section in book order.
  let next: NextStepView | null = null
  const step = active === undefined ? undefined : nextStep(active)
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
  if (next === null && active === undefined) {
    for (const manifest of manifests) {
      const node = manifest.structure.find(candidate => {
        const entry = progress.units[unitKey(manifest.id, candidate.uid)]
        return entry === undefined || entry.state === 'new' || entry.state === 'suspended'
      })
      if (node !== undefined) {
        next = {
          source: 'material',
          materialId: manifest.id,
          unitId: node.uid,
          title: node.title,
          materialTitle: manifest.title,
          why: '书序下一节',
        }
        break
      }
    }
  }

  const learnedToday = Object.values(progress.units).filter(entry => {
    const first = entry.firstLearnedAt === undefined ? '' : localDate(new Date(entry.firstLearnedAt))
    const last = entry.lastReviewedAt === undefined ? '' : localDate(new Date(entry.lastReviewedAt))
    return first === date || last === date
  }).length

  const planBriefs = plans
    .filter(plan => plan.status === 'active')
    .map(plan => ({
      id: plan.id,
      goal: plan.goal,
      done: plan.steps.filter(candidate => candidate.done).length,
      total: plan.steps.length,
      gateReady: goalBlock?.readyToClose === true,
      ...(plan.deliverable === undefined ? {} : { deliverable: plan.deliverable }),
    }))

  return {
    date,
    dueCards: [],
    due: [],
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
      settled: Object.values(knowledge.concepts).filter(state => state.settledAt !== undefined).length,
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

export async function dueCardList(svc: StudyService, date = svc.today()): Promise<CardView[]> {
  const [cards, plans] = await Promise.all([listCards(svc.paths), listPlans(svc.paths)])
  const goalById = new Map(plans.map(plan => [plan.id, plan.goal]))
  return dueCards(cards, date).map(card => cardView(card, date, goalById))
}

export async function reviewCard(svc: StudyService, cardId: string, rating: Rating): Promise<{ card: CardView; due: string }> {
  const preferences = await svc.preferences()
  const today = svc.today()
  const card = await reviewCardOnce(svc.paths, cardId, {
    rating,
    today,
    targetRetention: preferences.targetRetention,
    maxIntervalDays: preferences.maxIntervalDays,
  })
  const plans = await listPlans(svc.paths)
  const goalById = new Map(plans.map(plan => [plan.id, plan.goal]))
  return { card: cardView(card, today, goalById), due: card.due ?? today }
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
      weak: entry === undefined ? true : mastery < targetOf(entry) || entry.streak >= 2,
    }
  })
}

export async function conceptView(svc: StudyService, conceptId: string): Promise<ConceptDetailView> {
  const record = await readConcept(svc.paths, conceptId)
  if (record === null) throw new StudyError('not-found', `概念不存在：${conceptId}`)
  const [manifests, progress] = await Promise.all([listManifests(svc.paths), readProgress(svc.paths)])
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
    ...(progress.concepts[conceptId] === undefined ? {} : { mastery: progress.concepts[conceptId] }),
    occurrences,
  }
}
