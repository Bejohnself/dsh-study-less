/**
 * Learning operations: due queues, today view, review and concepts.
 *
 * Free functions over StudyService. The class in ../service.ts keeps the signatures and
 * forwards here, so routes, tools and tests keep talking to the service object.
 */
import { splitUnitKey, unitKey } from '../../core/ids.ts'
import { insightCard, listInsights } from '../../core/insights.ts'
import { listManifests, structureNodeOf } from '../../core/library.ts'
import { dueUnits, isWeak, readProgress, recordReview } from '../../core/progress.ts'
import { listConcepts, readConcept } from '../../core/concepts.ts'
import { listPlans, nextStep as nextPlanStep } from '../../core/plans.ts'
import { dueCards, listCards, reviewCardOnce } from '../../core/cards.ts'
import { gateStatus, planProgress } from '../../core/planGate.ts'
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
  const [due, manifests, progress, plans, concepts] = await Promise.all([
    svc.due(date),
    listManifests(svc.paths),
    readProgress(svc.paths),
    listPlans(svc.paths),
    svc.concepts(),
  ])

  const activePlans = plans.filter(plan => plan.status === 'active')
  const planBriefs: PlanBrief[] = activePlans.map(plan => {
    const { done, total } = planProgress(plan)
    const step = nextPlanStep(plan)
    let next: PlanBrief['next']
    if (step?.target !== undefined) {
      try {
        const { materialId, unitId } = splitUnitKey(step.target)
        const manifest = manifests.find(candidate => candidate.id === materialId)
        const node = manifest?.structure.find(candidate => candidate.uid === unitId)
        if (manifest !== undefined && node !== undefined) {
          next = { materialId, unitId, title: node.title }
        }
      } catch {
        next = undefined
      }
    }
    return {
      id: plan.id,
      goal: plan.goal,
      done,
      total,
      gateReady: gateStatus(plan).ready,
      ...(plan.deliverable === undefined ? {} : { deliverable: plan.deliverable }),
      ...(next === undefined ? {} : { next }),
    }
  })

  let next: NextStepView | null = null
  for (const plan of activePlans) {
    const step = nextPlanStep(plan)
    if (step?.target === undefined) continue
    try {
      const { materialId, unitId } = splitUnitKey(step.target)
      const manifest = manifests.find(candidate => candidate.id === materialId)
      const node = manifest?.structure.find(candidate => candidate.uid === unitId)
      if (manifest !== undefined && node !== undefined) {
        next = {
          source: 'plan',
          planId: plan.id,
          materialId,
          unitId,
          title: node.title,
          materialTitle: manifest.title,
          why: step.why,
        }
        break
      }
    } catch {
      continue
    }
  }
  if (next === null) {
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

  const dueCardViews = await svc.dueCardList(date)
  const pinned = (await listInsights(svc.paths)).find(record => record.pinned)

  return {
    date,
    dueCards: dueCardViews,
    due,
    weak: concepts.filter(concept => concept.weak).slice(0, 5),
    next,
    plans: planBriefs,
    learnedToday,
    ...(pinned === undefined ? {} : { pinnedInsight: insightCard(pinned) }),
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
  const [records, progress] = await Promise.all([listConcepts(svc.paths), readProgress(svc.paths)])
  return records.map(record => {
    const entry = progress.concepts[record.id]
    return {
      id: record.id,
      name: record.name,
      mastery: entry?.mastery ?? 0.5,
      occurrences: record.occurrences.length,
      materials: [...new Set(record.occurrences.map(occurrence => occurrence.material))],
      weak: entry !== undefined && isWeak(entry),
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
