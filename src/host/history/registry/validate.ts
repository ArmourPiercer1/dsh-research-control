/**
 * WP-2.2 — `validateEvent`: the pure validation & registration gate for
 * HistoryEvents (HISTORY_EVENT_CATALOG §1/§3/§5; ARCHITECTURE §5.3).
 *
 * Contract: `validateEvent(registry, event, ctx)` is a PURE function — it
 * reads the candidate event and the injected read-only state snapshot `ctx`,
 * and returns a structured accept/reject. It NEVER writes (no map mutation,
 * no I/O, no event emission, no SQLite): the 「且不产生副作用」 half of
 * TC-HIST-001 follows from this calling convention — a rejected mutation
 * changes nothing because the validator has nothing to change.
 *
 * Check order (all errors aggregated, deterministic order):
 *  1. shape: envelope (§1) + payload discrimination via the schema-driven
 *     per-event validators (INV-HIST-4: unknown (eventType, schemaVersion) or
 *     payload violation ⇒ reject);
 *  2. common (§5 通用校验): ownerWorkstreamId exists; actor is a legal
 *     emitter for the event (EMITTER matrix, §3.6/§4 E column); AGENT actors
 *     must reference an existing Run;
 *  3. per-event (§5 详细规范): referenced objects exist (or are fresh for
 *     「新建」 events), transition consistency (INV-HIST-5: declared/implicit
 *     `from` = object's current derived state; INV-TASK-1: legal (from,to)),
 *     owner-workstream rule (§4 owner column / INV-HIST-9), and the payload
 *     cross-field rules (WAIVED⇒USER+note, NOT_REQUIRED⇒AC empty,
 *     AUTO_*⇒PLUGIN, relation 组合表 + endpoint redundancy, payload-vs-edge
 *     mirror).
 *
 * Late registration (TC-HIST-002 validation half): the validator deliberately
 * takes NO "previous events" context — `occurredAt` is never compared against
 * anything (no monotonicity assumption); `eventSeq` is shape-checked only
 * (integer ≥ 1). The dual-timeline independence is the registry's contract,
 * see late-registration.ts.
 */

import type {
  EventRegistryEntry,
  EventValidationError,
  HistoryEvent,
  HistoryEventRegistry,
  HistoryObjectContext,
  HistoryEventType,
  ObjectKind,
  TypedRef,
} from './types.js'
import { isLegalTransition, legalTargets } from './transitions.js'
import type { TabledMachine } from './transitions.js'
import { isLegalRelationCombination } from './relations.js'

/** Object kinds that are workstream-local (DOMAIN_SCHEMA: they carry a WS). */
const WS_LOCAL_KINDS: ReadonlySet<ObjectKind> = new Set([
  'TASK',
  'GATE',
  'MILESTONE',
  'RUN',
  'CLAIM',
  'FACT',
  'ARTIFACT',
  'WORKSTREAM',
])

type Push = (code: EventValidationError['code'], path: string | undefined, message: string) => void

/** The subject objects an event's transition check may run against. */
type TransitionSubject = 'run' | 'taskExecution' | 'taskValidation' | 'acSnapshot' | 'claim' | 'artifact' | 'relation' | 'milestone' | 'topologyEdge' | 'gate'

const SUBJECT_LABEL: Record<TransitionSubject, string> = {
  run: 'Run',
  taskExecution: 'Task execution',
  taskValidation: 'Task validation',
  acSnapshot: 'Task AC snapshot',
  claim: 'Claim',
  artifact: 'Artifact',
  relation: 'Relation',
  milestone: 'Milestone',
  topologyEdge: 'Topology edge',
  gate: 'Gate',
}

/**
 * The object's CURRENT derived state (or `undefined` when the object does
 * not exist in the snapshot). Gate current state = last evaluation result,
 * `PLANNED` when never evaluated (§5.6).
 */
function currentStateOf(subject: TransitionSubject, id: string, ctx: HistoryObjectContext): string | undefined {
  switch (subject) {
    case 'run':
      return ctx.runs.get(id)?.status
    case 'taskExecution':
      return ctx.tasks.get(id)?.execution
    case 'taskValidation':
      return ctx.tasks.get(id)?.validation
    case 'acSnapshot':
      return ctx.tasks.get(id) !== undefined ? JSON.stringify(ctx.tasks.get(id)!.acceptanceCriteria) : undefined
    case 'claim':
      return ctx.claims.get(id)?.status
    case 'artifact':
      return ctx.artifacts.get(id)?.status
    case 'relation':
      return ctx.relations.get(id)?.status
    case 'milestone':
      return ctx.milestones.get(id)?.status
    case 'topologyEdge':
      return ctx.topologyEdges.get(id)?.lifecycle
    case 'gate': {
      const gate = ctx.gates.get(id)
      return gate === undefined ? undefined : (gate.lastResult ?? 'PLANNED')
    }
  }
}

/**
 * Transition consistency for one event (INV-HIST-5 + INV-TASK-1):
 *  - object must exist (OBJECT_NOT_FOUND);
 *  - `fromSource=payload` (mutation, M column ●): payload.from must EQUAL the
 *    current derived state (FROM_MISMATCH) and (from,to) must be a legal §13
 *    transition (ILLEGAL_TRANSITION); the acSnapshot machine compares text
 *    snapshots (no state machine) and has no legal-transition step;
 *  - `fromSource=implicit`: the current state must be one of the event's
 *    declared implicit-from states (WRONG_STATE).
 */
function checkTransitionConsistency(
  event: HistoryEvent,
  entry: EventRegistryEntry,
  subject: TransitionSubject,
  id: string,
  idPath: string,
  /** JSON-pointer base of the declared from/to fields for payload-declared transitions ('/payload' for the three mutation events). */
  declaredPath: string | undefined,
  ctx: HistoryObjectContext,
  push: Push,
): void {
  const transition = entry.transition
  if (transition === undefined) return
  const current = currentStateOf(subject, id, ctx)
  if (current === undefined) {
    push('OBJECT_NOT_FOUND', idPath, `${SUBJECT_LABEL[subject]} ${JSON.stringify(id)} does not exist (catalog §5: payload 内引用的对象存在)`)
    return
  }
  const label = SUBJECT_LABEL[subject]
  if (transition.fromSource === 'implicit') {
    const expected = transition.expectedFrom ?? []
    if (!expected.includes(current)) {
      push(
        'WRONG_STATE',
        idPath,
        `${label} ${JSON.stringify(id)} is currently ${current}; ${event.eventType} requires ${expected.join(' | ')} (DOMAIN_SCHEMA §13)`,
      )
    }
    return
  }
  // fromSource = 'payload'
  const fromPath = `${declaredPath}/from`
  const toPath = `${declaredPath}/to`
  const payload = event.payload as { from: unknown; to: unknown }
  const from = payload.from
  const to = payload.to
  if (transition.machine === 'acSnapshot') {
    if (typeof from === 'string' || Array.isArray(from) === false) {
      push('CROSS_FIELD', fromPath, `AC snapshot from must be a string[] (got ${describe(from)})`)
      return
    }
    if (JSON.stringify(ctx.tasks.get(id)!.acceptanceCriteria) !== JSON.stringify(from)) {
      push(
        'FROM_MISMATCH',
        fromPath,
        `Task ${JSON.stringify(id)} AC snapshot is currently ${JSON.stringify(ctx.tasks.get(id)!.acceptanceCriteria)}; event declares from=${JSON.stringify(from)} (INV-HIST-5: from must equal the current derived state)`,
      )
      return
    }
    if (Array.isArray(to) === false || to.some((item) => typeof item !== 'string')) {
      push('CROSS_FIELD', toPath, `AC snapshot to must be a string[] (got ${describe(to)})`)
    }
    return
  }
  const machine = transition.machine as TabledMachine
  if (typeof from !== 'string') {
    push('CROSS_FIELD', fromPath, `${label} from must be a state string (got ${describe(from)}) (DOMAIN_SCHEMA §13)`)
    return
  }
  if (from !== current) {
    push(
      'FROM_MISMATCH',
      fromPath,
      `${label} ${JSON.stringify(id)} is currently ${current}; event declares from=${from} (INV-HIST-5: from must equal the current derived state; TC-HIST-001)`,
    )
    return
  }
  if (typeof to !== 'string' || !isLegalTransition(machine, from, to)) {
    const legal = legalTargets(machine, from)
    push(
      'ILLEGAL_TRANSITION',
      toPath,
      `illegal ${label.toLowerCase()} transition ${from} -> ${describe(to)}; ${
        legal.length === 0 ? `${from} is terminal` : `legal targets from ${from}: [${legal.join(', ')}]`
      } (DOMAIN_SCHEMA §13, INV-TASK-1)`,
    )
  }
}

function describe(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text
  } catch {
    return String(value)
  }
}

/** The workstream a typed ref is local to (`undefined` = not workstream-local or missing). */
function workstreamOf(ref: TypedRef, ctx: HistoryObjectContext): string | undefined {
  switch (ref.kind) {
    case 'WORKSTREAM':
      return ctx.workstreams.has(ref.id) ? ref.id : undefined
    case 'TASK':
      return ctx.tasks.get(ref.id)?.workstreamId
    case 'GATE':
      return ctx.gates.get(ref.id)?.workstreamId
    case 'MILESTONE':
      return ctx.milestones.get(ref.id)?.workstreamId
    case 'RUN':
      return ctx.runs.get(ref.id)?.workstreamId
    case 'CLAIM':
      return ctx.claims.get(ref.id)?.workstreamId
    case 'FACT':
      return ctx.facts.get(ref.id)?.workstreamId
    case 'ARTIFACT':
      return ctx.artifacts.get(ref.id)?.workstreamId
    default:
      return undefined
  }
}

/** Existence check for typed refs of workstream-local kinds (catalog §5 通用校验: referenced objects exist). */
function checkTypedRefs(refs: readonly TypedRef[] | undefined, basePath: string, ctx: HistoryObjectContext, push: Push): void {
  if (refs === undefined) return
  refs.forEach((ref, i) => {
    const path = `${basePath}/${i}`
    if (!WS_LOCAL_KINDS.has(ref.kind)) return // non-WS-local kinds are not modeled in the V1 snapshot
    const exists =
      ref.kind === 'WORKSTREAM'
        ? ctx.workstreams.has(ref.id)
        : ref.kind === 'TASK'
          ? ctx.tasks.has(ref.id)
          : ref.kind === 'GATE'
            ? ctx.gates.has(ref.id)
            : ref.kind === 'MILESTONE'
              ? ctx.milestones.has(ref.id)
              : ref.kind === 'RUN'
                ? ctx.runs.has(ref.id)
                : ref.kind === 'CLAIM'
                  ? ctx.claims.has(ref.id)
                  : ref.kind === 'FACT'
                    ? ctx.facts.has(ref.id)
                    : ctx.artifacts.has(ref.id)
    if (!exists) {
      push('OBJECT_NOT_FOUND', path, `referenced ${ref.kind} ${JSON.stringify(ref.id)} does not exist (catalog §5: payload 内引用的对象存在)`)
    }
  })
}

function sameWs(id: string, owner: string, object: string, path: string, ctx: HistoryObjectContext, push: Push): boolean {
  const ws =
    ctx.tasks.get(id)?.workstreamId ??
    ctx.gates.get(id)?.workstreamId ??
    ctx.milestones.get(id)?.workstreamId ??
    ctx.runs.get(id)?.workstreamId ??
    ctx.claims.get(id)?.workstreamId ??
    ctx.facts.get(id)?.workstreamId ??
    ctx.artifacts.get(id)?.workstreamId
  if (ws === undefined) return false
  if (ws !== owner) {
    push('OWNER_MISMATCH', path, `${object} ${JSON.stringify(id)} belongs to workstream ${ws}, not the event owner ${owner} (catalog §5: 属同/属 owner WS)`)
  }
  return ws === owner
}

function checkTopologyRealize(
  event: HistoryEvent,
  op: 'FORK' | 'MERGE',
  ctx: HistoryObjectContext,
  push: Push,
): void {
  const payload = event.payload as { topology_edge_id: string; inputs: string[]; outputs: string[] }
  const edge = ctx.topologyEdges.get(payload.topology_edge_id)
  if (edge === undefined) {
    push('OBJECT_NOT_FOUND', '/payload/topology_edge_id', `Topology edge ${JSON.stringify(payload.topology_edge_id)} does not exist (catalog §5.8: 存在)`)
    return
  }
  if (edge.lifecycle !== 'PLANNED') {
    push('WRONG_STATE', '/payload/topology_edge_id', `Topology edge ${payload.topology_edge_id} has lifecycle ${edge.lifecycle}; only PLANNED edges can be realized (catalog §5.8: PLANNED)`)
  }
  if (edge.operation !== op) {
    push('CROSS_FIELD', '/payload/topology_edge_id', `Edge ${payload.topology_edge_id} is a ${edge.operation} edge; ${event.eventType} applies to ${op} edges (DOMAIN_SCHEMA §3.1)`)
  }
  const mirror = (field: 'inputs' | 'outputs'): void => {
    const declared = edge[field]
    const given = payload[field]
    if (given.length !== declared.length || given.some((id, i) => declared[i] !== id)) {
      push('CROSS_FIELD', `/payload/${field}`, `${event.eventType} payload.${field} ${JSON.stringify(given)} must mirror the edge's declared ${field} ${JSON.stringify(declared)} (catalog §5.8)`)
    }
  }
  mirror('inputs')
  mirror('outputs')
  const owner = op === 'FORK' ? payload.inputs[0] : payload.outputs[0]
  if (owner === undefined) {
    push('OWNER_MISMATCH', '/ownerWorkstreamId', `${event.eventType} requires ${op === 'FORK' ? 'inputs[0]' : 'outputs[0]'} as owner (schema enforces ≥1)`)
    return
  }
  if (owner !== event.ownerWorkstreamId) {
    push('OWNER_MISMATCH', '/ownerWorkstreamId', `Owner must be ${op === 'FORK' ? 'inputs[0]' : 'outputs[0]'} = ${owner} (INV-HIST-9, catalog §5.8)`)
  }
  const ownerWs = ctx.workstreams.get(event.ownerWorkstreamId)
  if (ownerWs !== undefined && ownerWs.topicId !== edge.topicId) {
    push('OWNER_MISMATCH', '/ownerWorkstreamId', `Owner workstream ${event.ownerWorkstreamId} is in topic ${ownerWs.topicId}; edge ${payload.topology_edge_id} belongs to topic ${edge.topicId} (catalog §5.8: 同 owner Topic)`)
  }
}

/**
 * Validate one candidate event against the registry and the state snapshot.
 * Pure: never throws on validation failure (only on an unusable registry's
 * impossible state — see REGISTRY_UNUSABLE), never mutates `event` or `ctx`.
 */
export function validateEvent(registry: HistoryEventRegistry, event: unknown, ctx: HistoryObjectContext): import('./types.js').EventValidationResult {
  if (!registry.isUsable) {
    return {
      ok: false,
      errors: [
        {
          code: 'REGISTRY_UNUSABLE',
          message: `registry is unusable (load errors: ${registry.loadErrors.map((e) => e.code).join(', ')}); see HistoryEventRegistry.loadErrors`,
        },
      ],
    }
  }
  const shape = registry.checkShape(event)
  if (!shape.ok) return { ok: false, errors: shape.errors }

  const e = event as HistoryEvent
  const entry = registry.events.get(e.eventType)!
  const errors: EventValidationError[] = []
  const push: Push = (code, path, message) => errors.push({ code, path, message })

  // ---- common checks (catalog §5 通用校验) --------------------------------
  if (!ctx.workstreams.has(e.ownerWorkstreamId)) {
    push('OBJECT_NOT_FOUND', '/ownerWorkstreamId', `ownerWorkstreamId ${JSON.stringify(e.ownerWorkstreamId)} does not exist (catalog §5: ownerWorkstreamId 存在; INV-HIST-3)`)
  }
  if (!entry.emitters.some((emitter) => emitter === e.actor.kind)) {
    push(
      'EMITTER_FORBIDDEN',
      '/actor/kind',
      `actor kind ${e.actor.kind} is not an allowed emitter for ${e.eventType} (allowed: [${entry.emitters.join(', ')}]) (catalog §3.6/§4 E column)`,
    )
  }
  if (e.actor.kind === 'AGENT') {
    if (e.actor.run_id === undefined) {
      push('CROSS_FIELD', '/actor/run_id', 'AGENT actor must carry a run_id referencing the emitting Run (catalog §5: actor.run_id 对应 Run 存在)')
    } else if (!ctx.runs.has(e.actor.run_id)) {
      push('OBJECT_NOT_FOUND', '/actor/run_id', `actor.run_id ${JSON.stringify(e.actor.run_id)} does not reference an existing Run (catalog §5)`)
    }
  }

  // ---- per-event checks (catalog §5 详细规范) ------------------------------
  switch (e.eventType) {
    case 'RUN_STARTED': {
      const p = e.payload
      if (ctx.runs.has(p.run_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/run_id', `Run ${JSON.stringify(p.run_id)} already exists; RUN_STARTED requires a fresh run_id (catalog §5.1: 新建)`)
      }
      if (p.task_id !== undefined) {
        const task = ctx.tasks.get(p.task_id)
        if (task === undefined) push('OBJECT_NOT_FOUND', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.1: 存在)`)
        else if (task.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.1: 属同 WS)`)
        }
      }
      break
    }
    case 'RUNS_STARTED': {
      // Member rules: ≥2 fresh runs (schema minItems + 新建), optional task_id
      // existence. The per-owner envelope fan-out (one same-payload event per
      // relevant owner WS, §5.2 信封特例) is a registration-time property the
      // STORE enforces — a single event cannot see its sibling events.
      const p = e.payload
      p.runs.forEach((run, i) => {
        if (ctx.runs.has(run.run_id)) {
          push('OBJECT_ALREADY_EXISTS', `/payload/runs/${i}/run_id`, `Run ${JSON.stringify(run.run_id)} already exists; batch launches create fresh runs (catalog §5.1/§5.2: 新建)`)
        }
        if (run.task_id !== undefined && ctx.tasks.get(run.task_id) === undefined) {
          push('OBJECT_NOT_FOUND', `/payload/runs/${i}/task_id`, `Task ${JSON.stringify(run.task_id)} does not exist (catalog §5.1: 存在)`)
        }
      })
      break
    }
    case 'RUN_FINISHED':
    case 'RUN_FAILED':
    case 'RUN_CANCELLED': {
      const p = e.payload
      checkTransitionConsistency(e, entry, 'run', p.run_id, '/payload/run_id', undefined, ctx, push)
      const run = ctx.runs.get(p.run_id)
      if (run !== undefined && run.workstreamId !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/payload/run_id', `Run ${JSON.stringify(p.run_id)} belongs to workstream ${run.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: run 所属 WS)`)
      }
      break
    }
    case 'TASK_EXECUTION_CHANGED': {
      const p = e.payload
      const task = ctx.tasks.get(p.task_id)
      if (task === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`)
      } else {
        if (task.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2: 属 owner WS)`)
        }
        checkTransitionConsistency(e, entry, 'taskExecution', p.task_id, '/payload/task_id', '/payload', ctx, push)
      }
      break
    }
    case 'TASK_VALIDATION_CHANGED': {
      const p = e.payload
      const task = ctx.tasks.get(p.task_id)
      if (task === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`)
      } else {
        if (task.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2: 属 owner WS)`)
        }
        checkTransitionConsistency(e, entry, 'taskValidation', p.task_id, '/payload/task_id', '/payload', ctx, push)
        if (p.to === 'NOT_REQUIRED' && task.acceptanceCriteria.length > 0) {
          push('CROSS_FIELD', '/payload/to', `to=NOT_REQUIRED requires empty acceptance_criteria; task ${p.task_id} has ${task.acceptanceCriteria.length} (INV-TASK-3, catalog §5.2)`)
        }
      }
      break
    }
    case 'ACCEPTANCE_CRITERIA_CHANGED': {
      const p = e.payload
      const task = ctx.tasks.get(p.task_id)
      if (task === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} does not exist (catalog §5.2: 存在)`)
      } else {
        if (task.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/task_id', `Task ${JSON.stringify(p.task_id)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.2)`)
        }
        checkTransitionConsistency(e, entry, 'acSnapshot', p.task_id, '/payload/task_id', '/payload', ctx, push)
      }
      break
    }
    case 'FACT_RECORDED': {
      const p = e.payload
      if (ctx.facts.has(p.fact_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/fact_id', `Fact ${JSON.stringify(p.fact_id)} already exists; FACT_RECORDED requires a fresh fact_id (catalog §5.3: 新建)`)
      }
      if (e.actor.kind === 'AGENT' && p.created_by_run === undefined) {
        push('CROSS_FIELD', '/payload/created_by_run', 'FACT_RECORDED emitted by AGENT requires created_by_run (catalog §5.3: AGENT 发射时必填)')
      }
      if (p.created_by_run !== undefined && ctx.runs.get(p.created_by_run) === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/created_by_run', `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`)
      }
      break
    }
    case 'CLAIM_RECORDED': {
      const p = e.payload
      if (ctx.claims.has(p.claim_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/claim_id', `Claim ${JSON.stringify(p.claim_id)} already exists; CLAIM_RECORDED requires a fresh claim_id (catalog §5.3: 新建)`)
      }
      if (e.actor.kind === 'AGENT' && p.created_by_run === undefined) {
        push('CROSS_FIELD', '/payload/created_by_run', 'CLAIM_RECORDED emitted by AGENT requires created_by_run (catalog §5.3: AGENT 发射时必填)')
      }
      if (p.created_by_run !== undefined && ctx.runs.get(p.created_by_run) === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/created_by_run', `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`)
      }
      break
    }
    case 'CLAIM_RETRACTED': {
      const p = e.payload
      checkTransitionConsistency(e, entry, 'claim', p.claim_id, '/payload/claim_id', undefined, ctx, push)
      const claim = ctx.claims.get(p.claim_id)
      if (claim !== undefined && claim.workstreamId !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/payload/claim_id', `Claim ${JSON.stringify(p.claim_id)} belongs to workstream ${claim.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: claim 所属 WS)`)
      }
      break
    }
    case 'ARTIFACT_REGISTERED': {
      const p = e.payload
      if (ctx.artifacts.has(p.artifact_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/artifact_id', `Artifact ${JSON.stringify(p.artifact_id)} already exists; ARTIFACT_REGISTERED requires a fresh artifact_id (catalog §5.4: 新建)`)
      }
      if (p.created_by_run !== undefined && ctx.runs.get(p.created_by_run) === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/created_by_run', `Run ${JSON.stringify(p.created_by_run)} does not exist (catalog §5)`)
      }
      if (p.related_task !== undefined) {
        const task = ctx.tasks.get(p.related_task)
        if (task === undefined) push('OBJECT_NOT_FOUND', '/payload/related_task', `Task ${JSON.stringify(p.related_task)} does not exist (catalog §5.4)`)
        else if (task.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/related_task', `Task ${JSON.stringify(p.related_task)} belongs to workstream ${task.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.4: 属同 WS)`)
        }
      }
      if (p.supersedes !== undefined && ctx.artifacts.get(p.supersedes) === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/supersedes', `Artifact ${JSON.stringify(p.supersedes)} does not exist (catalog §5.4: supersedes 存在)`)
      }
      break
    }
    case 'ARTIFACT_MARKED_MISSING': {
      const p = e.payload
      checkTransitionConsistency(e, entry, 'artifact', p.artifact_id, '/payload/artifact_id', undefined, ctx, push)
      const artifact = ctx.artifacts.get(p.artifact_id)
      if (artifact !== undefined && artifact.workstreamId !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/payload/artifact_id', `Artifact ${JSON.stringify(p.artifact_id)} belongs to workstream ${artifact.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §4: artifact 所属 WS)`)
      }
      break
    }
    case 'RELATION_ADDED': {
      const p = e.payload
      if (ctx.relations.has(p.relation_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/relation_id', `Relation ${JSON.stringify(p.relation_id)} already exists; RELATION_ADDED requires a fresh relation_id (catalog §5.5: 新建)`)
      }
      if (!isLegalRelationCombination(p.relation_type, p.source.kind, p.target.kind)) {
        push(
          'CROSS_FIELD',
          '/payload/relation_type',
          `${p.relation_type} from ${p.source.kind} to ${p.target.kind} is not in the frozen combination table (DOMAIN_SCHEMA §8, INV-REL-1/2: TARGET 始终是 SOURCE 的前提/来源/输入/证据/上位目标)`,
        )
      }
      const checkEndpoint = (ref: TypedRef, path: string): void => {
        if (WS_LOCAL_KINDS.has(ref.kind) && workstreamOf(ref, ctx) === undefined) {
          push('OBJECT_NOT_FOUND', path, `referenced ${ref.kind} ${JSON.stringify(ref.id)} does not exist (catalog §5)`)
        }
      }
      checkEndpoint(p.source, '/payload/source')
      checkEndpoint(p.target, '/payload/target')
      const owner = workstreamOf(p.source, ctx) ?? workstreamOf(p.target, ctx)
      if (owner === undefined) {
        push('OWNER_MISMATCH', '/ownerWorkstreamId', `Neither relation endpoint is workstream-local; V1 refuses to create such relations (no owner workstream) (DOMAIN_SCHEMA §8: 两端都非 workstream-local 的 relation 拒绝创建)`)
      } else if (owner !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/ownerWorkstreamId', `Relation owner must be source.ws ?? target.ws = ${owner} (catalog §4 特例)`)
      }
      break
    }
    case 'RELATION_REMOVED': {
      const p = e.payload
      const relation = ctx.relations.get(p.relation_id)
      if (relation === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/relation_id', `Relation ${JSON.stringify(p.relation_id)} does not exist (catalog §5.5: 存在)`)
      } else {
        if (relation.status !== 'ACTIVE') {
          push('WRONG_STATE', '/payload/relation_id', `Relation ${JSON.stringify(p.relation_id)} is ${relation.status}; RELATION_REMOVED requires ACTIVE (catalog §5.5)`)
        }
        const redundant =
          relation.source.kind === p.source.kind &&
          relation.source.id === p.source.id &&
          relation.relationType === p.relation_type &&
          relation.target.kind === p.target.kind &&
          relation.target.id === p.target.id
        if (!redundant) {
          push(
            'CROSS_FIELD',
            '/payload/source',
            `Recorded source/relation_type/target must match the existing relation (audit redundancy, catalog §5.5); stored: source=${JSON.stringify(relation.source)} relation_type=${relation.relationType} target=${JSON.stringify(relation.target)}`,
          )
        }
        const owner = workstreamOf(relation.source, ctx) ?? workstreamOf(relation.target, ctx)
        if (owner === undefined) {
          push('OWNER_MISMATCH', '/ownerWorkstreamId', `Neither endpoint of relation ${p.relation_id} is workstream-local; no owner workstream (DOMAIN_SCHEMA §8)`)
        } else if (owner !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/ownerWorkstreamId', `Relation owner must be source.ws ?? target.ws = ${owner} (catalog §4 特例)`)
        }
      }
      break
    }
    case 'GATE_EVALUATED': {
      const p = e.payload
      const gate = ctx.gates.get(p.gate_id)
      if (gate === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/gate_id', `Gate ${JSON.stringify(p.gate_id)} does not exist (catalog §5.6: 存在)`)
      } else if (gate.workstreamId !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/payload/gate_id', `Gate ${JSON.stringify(p.gate_id)} belongs to workstream ${gate.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.6: 属 owner WS)`)
      }
      if (p.result === 'WAIVED') {
        if (e.actor.kind !== 'USER') {
          push('CROSS_FIELD', '/payload/result', `WAIVED requires actor.kind=USER (got ${e.actor.kind}) (catalog §5.6: WAIVED 仅 actor.kind=USER 且 note 非空)`)
        }
        if (p.note === undefined || p.note.trim() === '') {
          push('CROSS_FIELD', '/payload/note', 'WAIVED requires a non-empty note (catalog §5.6: WAIVED 仅用户+理由)')
        }
      }
      checkTypedRefs(p.evidence_refs, '/payload/evidence_refs', ctx, push)
      break
    }
    case 'MILESTONE_ACHIEVED': {
      const p = e.payload
      const milestone = ctx.milestones.get(p.milestone_id)
      if (milestone === undefined) {
        push('OBJECT_NOT_FOUND', '/payload/milestone_id', `Milestone ${JSON.stringify(p.milestone_id)} does not exist (catalog §5.6: 存在)`)
      } else {
        if (milestone.workstreamId !== e.ownerWorkstreamId) {
          push('OWNER_MISMATCH', '/payload/milestone_id', `Milestone ${JSON.stringify(p.milestone_id)} belongs to workstream ${milestone.workstreamId}, not the owner ${e.ownerWorkstreamId} (catalog §5.6)`)
        }
        checkTransitionConsistency(e, entry, 'milestone', p.milestone_id, '/payload/milestone_id', undefined, ctx, push)
      }
      checkTypedRefs(p.evidence_refs, '/payload/evidence_refs', ctx, push)
      break
    }
    case 'INTERVENTION_CREATED': {
      const p = e.payload
      if (ctx.interventions.has(p.intervention_id)) {
        push('OBJECT_ALREADY_EXISTS', '/payload/intervention_id', `Intervention ${JSON.stringify(p.intervention_id)} already exists; INTERVENTION_CREATED requires a fresh intervention_id (catalog §5.7: 新建)`)
      }
      if ((p.origin === 'AUTO_FLOODING' || p.origin === 'AUTO_AUDIT') && e.actor.kind !== 'PLUGIN') {
        push('CROSS_FIELD', '/payload/origin', `origin=${p.origin} requires actor.kind=PLUGIN (got ${e.actor.kind}) (catalog §5.7)`)
      }
      checkTypedRefs(p.source_refs, '/payload/source_refs', ctx, push)
      const firstWs = (p.source_refs ?? []).map((ref) => workstreamOf(ref, ctx)).find((ws) => ws !== undefined)
      if (firstWs === undefined) {
        push('OWNER_MISMATCH', '/ownerWorkstreamId', `Intervention has no workstream-related source ref; such interventions emit NO HistoryEvent (catalog §5.7: 完全无 WS 关联的 Intervention 不发事件)`)
      } else if (firstWs !== e.ownerWorkstreamId) {
        push('OWNER_MISMATCH', '/ownerWorkstreamId', `Owner must be the first related workstream ${firstWs} (workstream_ids[0] derived from source_refs, catalog §5.7)`)
      }
      break
    }
    case 'TOPOLOGY_FORK_REALIZED':
      checkTopologyRealize(e, 'FORK', ctx, push)
      break
    case 'TOPOLOGY_MERGE_REALIZED':
      checkTopologyRealize(e, 'MERGE', ctx, push)
      break
    default:
      break // unreachable: the registry is closed (CATALOG_SYNC), and checkShape already dispatched
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, eventType: e.eventType, ownerWorkstreamId: e.ownerWorkstreamId }
}
