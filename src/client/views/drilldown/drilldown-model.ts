/**
 * WP-4.6 — drill-down display model (pure projection).
 *
 * Data path (task brief; the frozen DTOs have NO Claim/Artifact fields —
 * `DashboardSnapshot`/`ProjectSnapshot`/`TopicSnapshot`/`WorkstreamSnapshot`
 * carry runs/tasks/planForks only, verified against
 * `shared/rpc-contracts.ts`): the Claim/Artifact display layer is
 * REBUILT from the `queryHistory` event log (the CLAIM_* / ARTIFACT_* /
 * RELATION_* events of HISTORY_EVENT_CATALOG §5.3–§5.5, plus the
 * RUN_STARTED `dsh_session_id` pointer), merged with the run table that
 * `getWorkstream` does expose (`current.runs`).
 *
 * Chain (plan §26 / TC-E2E-012/013):
 *   Claim card    → owning Run   via the `created_by_run` EVENT POINTER
 *                    (CLAIM_RECORDED payload — required when the Agent
 *                    produced the claim, DOMAIN_SCHEMA §7.1)
 *   Artifact card → owning Run   via the `created_by_run` event pointer
 *                    AND/OR the RELY_ON-form relation `PRODUCED_BY`
 *                    (ARTIFACT → RUN — DOMAIN_SCHEMA §8 组合表)
 *   Run           → DSH Session  via `dsh_session_id` (RUN_STARTED payload
 *                    / the run table pointer — INV-DB-2: pointer only, the
 *                    session itself stays host-owned)
 *
 * Zero I/O, zero DSH (INV-PERM-5), zero store imports: the container
 * passes plain wire data (`QueryHistoryResult.events` + `RunDto[]`).
 */

import type { HistoryEventDto, RunDto } from '../../../shared/rpc-contracts.js'

/** One Claim card (rebuilt from CLAIM_RECORDED ± CLAIM_RETRACTED). */
export interface DrilldownClaim {
  readonly id: string
  readonly statement: string
  readonly status: 'ACTIVE' | 'RETRACTED'
  /** The EVENT POINTER to the producing run (null = user-registered). */
  readonly createdByRun: string | null
  readonly recordedSeq: number
  readonly occurredAt: number
  /** RELATION ids where this claim is the source (evidence edges out). */
  readonly relationIds: readonly string[]
}

/** One Artifact card (rebuilt from ARTIFACT_REGISTERED ± MARKED_MISSING). */
export interface DrilldownArtifact {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly uri: string
  readonly status: 'REGISTERED' | 'MISSING'
  /** The EVENT POINTER to the producing run (null = user-registered). */
  readonly createdByRun: string | null
  readonly relatedTask: string | null
  readonly recordedSeq: number
  readonly occurredAt: number
  /** The RELY_ON-form `PRODUCED_BY` relations (ARTIFACT → RUN) pointing at
   *  a run beyond the event pointer (the §8 combination-table edge). */
  readonly producedByRunIds: readonly string[]
  readonly relationIds: readonly string[]
}

/** One linked Run (run-table row + its session pointer + event evidence). */
export interface DrilldownRun {
  readonly id: string
  readonly status: RunDto['status']
  readonly taskId: string | null
  readonly intent: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  /** The DSH session pointer (RUN_STARTED payload `dsh_session_id`;
   *  INV-DB-2: the plugin stores the pointer only — opening the session
   *  is a host-side navigation, §26: 「在宿主会话列表中打开」). */
  readonly dshSessionId: string | null
  /** Event ids mentioning this run (RUN_STARTED/FINISHED/... + semantic
   *  events whose actor carries `run_id` — the 「事件指针」 trail). */
  readonly evidenceEventIds: readonly string[]
  /** Why this run is linked to the selected object: the pointer kind(s). */
  readonly linkKinds: readonly ('CREATED_BY_RUN' | 'PRODUCED_BY_RELATION')[]
}

/** The full drill-down model for one workstream's event window. */
export interface DrilldownModel {
  readonly claims: readonly DrilldownClaim[]
  readonly artifacts: readonly DrilldownArtifact[]
  readonly runs: readonly DrilldownRun[]
  /** Run id → model run (the run table may list runs the window's events
   *  do not cover — the model keeps the table row with null session). */
  readonly runById: ReadonlyMap<string, DrilldownRun>
}

/* -------------------------------------------------------------------- *
 * Payload mirrors (structural — the wire payload is `unknown`)
 * -------------------------------------------------------------------- */

interface ClaimRecordedPayload {
  readonly claim_id?: unknown
  readonly statement?: unknown
  readonly created_by_run?: unknown
}
interface ClaimRetractedPayload {
  readonly claim_id?: unknown
}
interface ArtifactRegisteredPayload {
  readonly artifact_id?: unknown
  readonly type?: unknown
  readonly title?: unknown
  readonly uri?: unknown
  readonly created_by_run?: unknown
  readonly related_task?: unknown
}
interface ArtifactMarkedMissingPayload {
  readonly artifact_id?: unknown
}
interface RelationAddedPayload {
  readonly relation_id?: unknown
  readonly source?: { readonly kind?: unknown; readonly id?: unknown }
  readonly relation_type?: unknown
  readonly target?: { readonly kind?: unknown; readonly id?: unknown }
}
interface RelationRemovedPayload {
  readonly relation_id?: unknown
}
interface RunStartedPayload {
  readonly run_id?: unknown
  readonly dsh_session_id?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Build the drill-down model from a `queryHistory` window + the run table.
 * Deterministic: cards sort by (recordedSeq, id); the window is expected
 * to be the FULL owner-WS log (the container requests a large `limit`).
 * @param events - the wire event DTOs (any replay order — seq-sorted here).
 * @param runs - the `getWorkstream` `current.runs` projection.
 * @returns the display model.
 */
export function buildDrilldownModel(
  events: readonly HistoryEventDto[],
  runs: readonly RunDto[],
): DrilldownModel {
  // 1) fold the semantic events (audit order = eventSeq order is the
  //    registration order; derived status follows the last event).
  const ordered = [...events].sort((a, b) => a.eventSeq - b.eventSeq || a.eventId.localeCompare(b.eventId))

  const claims = new Map<string, DrilldownClaim>()
  const artifacts = new Map<string, DrilldownArtifact>()
  const relations: { id: string; source: { kind: string; id: string }; type: string; target: { kind: string; id: string }; status: 'ACTIVE' | 'REMOVED' }[] = []
  const relationStatus = new Map<string, 'ACTIVE' | 'REMOVED'>()
  const sessionByRun = new Map<string, string>()
  const evidenceByRun = new Map<string, string[]>()

  for (const ev of ordered) {
    const p = ev.payload as Record<string, unknown>
    switch (ev.eventType) {
      case 'RUN_STARTED': {
        const payload = p as unknown as RunStartedPayload
        const runId = asString(payload.run_id)
        const sessionId = asString(payload.dsh_session_id)
        if (runId !== null) {
          if (sessionId !== null && sessionByRun.get(runId) === undefined) sessionByRun.set(runId, sessionId)
          // RUN_STARTED names its run on the PAYLOAD (the actor is the
          // launching user) — the trail includes the run's birth event.
          evidenceByRun.set(runId, [...(evidenceByRun.get(runId) ?? []), ev.eventId])
        }
        break
      }
      case 'CLAIM_RECORDED': {
        const payload = p as unknown as ClaimRecordedPayload
        const id = asString(payload.claim_id)
        if (id === null) break
        claims.set(id, {
          id,
          statement: asString(payload.statement) ?? '',
          status: 'ACTIVE',
          createdByRun: asString(payload.created_by_run),
          recordedSeq: ev.eventSeq,
          occurredAt: ev.occurredAt,
          relationIds: [],
        })
        break
      }
      case 'CLAIM_RETRACTED': {
        const payload = p as unknown as ClaimRetractedPayload
        const id = asString(payload.claim_id)
        if (id !== null) {
          const claim = claims.get(id)
          if (claim !== undefined) claims.set(id, { ...claim, status: 'RETRACTED' })
        }
        break
      }
      case 'ARTIFACT_REGISTERED': {
        const payload = p as unknown as ArtifactRegisteredPayload
        const id = asString(payload.artifact_id)
        if (id === null) break
        artifacts.set(id, {
          id,
          type: asString(payload.type) ?? 'OTHER',
          title: asString(payload.title) ?? '',
          uri: asString(payload.uri) ?? '',
          status: 'REGISTERED',
          createdByRun: asString(payload.created_by_run),
          relatedTask: asString(payload.related_task),
          recordedSeq: ev.eventSeq,
          occurredAt: ev.occurredAt,
          producedByRunIds: [],
          relationIds: [],
        })
        break
      }
      case 'ARTIFACT_MARKED_MISSING': {
        const payload = p as unknown as ArtifactMarkedMissingPayload
        const id = asString(payload.artifact_id)
        if (id !== null) {
          const artifact = artifacts.get(id)
          if (artifact !== undefined) artifacts.set(id, { ...artifact, status: 'MISSING' })
        }
        break
      }
      case 'RELATION_ADDED': {
        const payload = p as unknown as RelationAddedPayload
        const id = asString(payload.relation_id)
        const sourceId = asString(payload.source?.id)
        const sourceKind = asString(payload.source?.kind)
        const type = asString(payload.relation_type)
        const targetId = asString(payload.target?.id)
        const targetKind = asString(payload.target?.kind)
        if (id === null || sourceId === null || sourceKind === null || type === null || targetId === null || targetKind === null) break
        relations.push({ id, source: { kind: sourceKind, id: sourceId }, type, target: { kind: targetKind, id: targetId }, status: 'ACTIVE' })
        relationStatus.set(id, 'ACTIVE')
        break
      }
      case 'RELATION_REMOVED': {
        const payload = p as unknown as RelationRemovedPayload
        const id = asString(payload.relation_id)
        if (id !== null) relationStatus.set(id, 'REMOVED')
        break
      }
      default:
        break
    }
  }

  // 1b) the 「事件指针」 trail per run: EVERY event whose actor carries
  //     `run_id` (run terminals, semantic events attributed to the run).
  for (const ev of ordered) {
    const runId = asString(ev.actor.run_id)
    if (runId !== null) evidenceByRun.set(runId, [...(evidenceByRun.get(runId) ?? []), ev.eventId])
  }

  // 2) resolve relation edges (ACTIVE only) onto the cards.
  const activeRelations = relations.filter((r) => relationStatus.get(r.id) === 'ACTIVE')
  for (const rel of activeRelations) {
    if (rel.source.kind === 'CLAIM') {
      const claim = claims.get(rel.source.id)
      if (claim !== undefined) claims.set(rel.source.id, { ...claim, relationIds: [...claim.relationIds, rel.id] })
    }
    if (rel.source.kind === 'ARTIFACT') {
      const artifact = artifacts.get(rel.source.id)
      if (artifact !== undefined) {
        const producedBy =
          rel.type === 'PRODUCED_BY' && rel.target.kind === 'RUN' ? [...artifact.producedByRunIds, rel.target.id] : artifact.producedByRunIds
        artifacts.set(rel.source.id, { ...artifact, producedByRunIds: producedBy, relationIds: [...artifact.relationIds, rel.id] })
      }
    }
  }

  // 3) runs: the run table (authoritative) + the RUN_STARTED session
  //    pointer (the table row itself carries no session column on the
  //    wire — RunDto has no session field; the pointer lives in the event
  //    payload, so the model reads it from the log).
  const evidenceSorted = new Map<string, readonly string[]>()
  for (const [runId, ids] of evidenceByRun) evidenceSorted.set(runId, [...new Set(ids)].sort())

  const runsOut: DrilldownRun[] = runs.map((r) => ({
    id: r.id,
    status: r.status,
    taskId: r.taskId,
    intent: r.intent,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    dshSessionId: sessionByRun.get(r.id) ?? null,
    evidenceEventIds: evidenceSorted.get(r.id) ?? [],
    linkKinds: [],
  }))
  // Runs referenced by events but absent from the table window (the table
  // lists ALL ws runs in production — defensive parity for partial input).
  for (const [runId] of sessionByRun) {
    if (!runsOut.some((r) => r.id === runId)) {
      runsOut.push({
        id: runId,
        status: 'FINISHED',
        taskId: null,
        intent: null,
        startedAt: 0,
        endedAt: null,
        dshSessionId: sessionByRun.get(runId) ?? null,
        evidenceEventIds: evidenceSorted.get(runId) ?? [],
        linkKinds: [],
      })
    }
  }

  const runById = new Map(runsOut.map((r) => [r.id, r]))
  const claimsOut = [...claims.values()].sort((a, b) => a.recordedSeq - b.recordedSeq || a.id.localeCompare(b.id))
  const artifactsOut = [...artifacts.values()].sort((a, b) => a.recordedSeq - b.recordedSeq || a.id.localeCompare(b.id))

  return { claims: claimsOut, artifacts: artifactsOut, runs: runsOut, runById }
}

/**
 * The Run link set of ONE selected object (claim or artifact):
 *  - claim: `created_by_run` (event pointer) ⇒ link kind CREATED_BY_RUN;
 *  - artifact: `created_by_run` (CREATED_BY_RUN) + every ACTIVE
 *    `PRODUCED_BY` relation target run (PRODUCED_BY_RELATION).
 * Unknown run ids (referenced but not in the table) are dropped — the
 * card shows the pointer id as text either way (no fabricated rows).
 */
export function linkedRunsFor(
  object: { readonly createdByRun: string | null; readonly producedByRunIds?: readonly string[] } | null,
  model: DrilldownModel,
): DrilldownRun[] {
  if (object === null) return []
  const seen = new Map<string, Set<DrilldownRun['linkKinds'][number]>>()
  const add = (runId: string | null, kind: DrilldownRun['linkKinds'][number]): void => {
    if (runId === null) return
    const run = model.runById.get(runId)
    if (run === undefined) return
    seen.set(runId, new Set([...(seen.get(runId) ?? []), kind]))
  }
  add(object.createdByRun, 'CREATED_BY_RUN')
  for (const id of object.producedByRunIds ?? []) add(id, 'PRODUCED_BY_RELATION')
  return [...seen.entries()]
    .map(([runId, kinds]) => ({ ...model.runById.get(runId)!, linkKinds: [...kinds].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** The session pointer(s) of the selected runs (deduped, stable order). */
export function sessionPointersFor(runs: readonly DrilldownRun[]): readonly { runId: string; sessionId: string }[] {
  const out: { runId: string; sessionId: string }[] = []
  for (const run of runs) {
    if (run.dshSessionId !== null) out.push({ runId: run.id, sessionId: run.dshSessionId })
  }
  return out.sort((a, b) => a.runId.localeCompare(b.runId) || a.sessionId.localeCompare(b.sessionId))
}
