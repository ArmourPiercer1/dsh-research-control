/**
 * WP-3.6 (RR-011 (a) / RR-010 / TC-DOM-033 声明式半边) — the
 * workstream.yaml PLANNED→REALIZED flip with the RR-010 file compensation
 * protocol.
 *
 * ## The atomic-realize seam (store side, WP-2.1/2.4 delivered)
 *
 * The store fires `realize.apply` INSIDE the event write transaction,
 * exactly once per workstream whose FIRST event is appended
 * (`externalState` lifecycle PLANNED gate, WP-2.4). The hook performs:
 *   1. the derived_state half (`tx.setDerivedState('workstream', ws, …)`)
 *      — WP-2.4's service code;
 *   2. the DECLARATIVE half — this module: flip `workstream.yaml`
 *      `lifecycle` PLANNED→REALIZED with an atomic file write.
 *
 * ## The RR-010 compensation window (G2 r1 攻击者 B5)
 *
 * The file flip happens BEFORE the store's `COMMIT` (the hook runs inside
 * the transaction). If the COMMIT (or anything after the flip) fails, the
 * event rows roll back but the file is already flipped — file says
 * REALIZED, History says never happened. The compensation protocol:
 *
 *   - the flip captures the file's PRE-flip content (or its absence);
 *   - after `appendEvents` settles, the guarded store wrapper
 *     (realize-store.ts) tells the realizer the outcome:
 *       - committed → the flip is permanent (a later ROW-projection
 *         failure keeps the flip — the documented WP-2.4 residual, the
 *         run-row lag converges by reconciliation);
 *       - failed → run the compensation: restore the pre-flip content, or
 *         DELETE the file when it did not exist before (the flip only
 *         modifies a file that the loaded tree already had — the delete
 *         arm covers the crash-recovery re-flip edge where a prior
 *         incomplete flip left a file the tree no longer claims);
 *   - the compensation is best-effort-LOUD: if IT fails, the original
 *     append error still propagates and the anomaly is left for the
 *     STARTUP lifecycle reconciliation (lifecycle-reconcile.ts), which
 *     converges file/DB divergence either way — the two mechanisms are
 *     belt and braces for the same window.
 *
 * Crash after a committed flip is a no-op (file and DB agree). A crash
 * BETWEEN the flip and the COMMIT leaves file=REALIZED without events —
 * the startup reconciliation rolls the file back to PLANNED (History is
 * the 真源 for "did it happen").
 *
 * The flip itself:
 *   - single-document YAML round-trip through the `yaml` library's
 *     Document API (style-preserving for untouched nodes);
 *   - the `lifecycle` key is ABSENT in many legal files (schema default
 *     PLANNED) — the flip inserts it when absent, rewrites it when
 *     present-and-PLANNED, and FAILS LOUD on any other state (the file is
 *     the declarative 真源: a mismatch with the PLANNED expectation the
 *     service already gated means tree/DB divergence — fail the batch,
 *     never guess);
 *   - atomic write: `<path>.dshrc-tmp` + rename (the domain's
 *     `TMP_FILE_SUFFIX`, the same crash-residue the WP-2.6 startup sweep
 *     cleans); a failed temp write or rename leaves the previous content
 *     intact (best-effort tmp cleanup).
 *
 * No DSH imports (INV-PERM-5).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseDocument, YAMLMap } from 'yaml'

import { TMP_FILE_SUFFIX } from '../../domain/topology/types.js'
import { HostWiringError, type HostWiringLogger } from './types.js'

/** The `.research`-relative path of one workstream's declarative file. */
export function workstreamYamlRelPath(topicId: string, workstreamId: string): string {
  return join('topics', topicId, 'workstreams', workstreamId, 'workstream.yaml')
}

/** A one-shot file compensation (restore pre-flip content / delete new). */
export type FileCompensation = () => void

/** Atomic `<path>.dshrc-tmp` + rename; on failure the previous content
 *  (or absence) is intact and the tmp residue is best-effort removed. */
function atomicWriteText(absPath: string, content: string): void {
  const tmp = absPath + TMP_FILE_SUFFIX
  try {
    writeFileSync(tmp, content, 'utf8')
  } catch (cause) {
    try {
      unlinkSync(tmp)
    } catch {
      /* best effort */
    }
    throw cause
  }
  try {
    renameSync(tmp, absPath)
  } catch (cause) {
    try {
      unlinkSync(tmp)
    } catch {
      /* best effort */
    }
    throw cause
  }
}

interface FlipInput {
  readonly researchRoot: string
  readonly topicId: string
  readonly workstreamId: string
  readonly logger?: HostWiringLogger
}

/**
 * Flip ONE workstream.yaml from PLANNED to REALIZED (the declarative half
 * of TC-DOM-033).
 *
 * @returns the compensation that restores the pre-flip file state (or
 *  deletes the file when it was newly created) — the caller (the realizer)
 *  holds it until the store append settles.
 * @throws {HostWiringError} `WIRING_REALIZE` on a missing/unreadable file,
 *  a non-single-document or non-mapping YAML, an unreadable/illegal
 *  lifecycle, or a write failure.
 */
export function flipWorkstreamYamlToRealized(input: FlipInput): FileCompensation {
  const absPath = join(input.researchRoot, workstreamYamlRelPath(input.topicId, input.workstreamId))
  let oldText: string | null
  try {
    oldText = readFileSync(absPath, 'utf8')
  } catch {
    throw new HostWiringError(
      'WIRING_REALIZE',
      `workstream flip: ${absPath} is missing or unreadable — the loaded tree claims this workstream; refusing to fabricate the declarative 真源`,
    )
  }

  let doc: ReturnType<typeof parseDocument>
  try {
    doc = parseDocument(oldText)
  } catch (cause) {
    throw new HostWiringError('WIRING_REALIZE', `workstream flip: ${absPath} is not parseable YAML: ${causeMessage(cause)}`)
  }
  if (doc.errors.length > 0) {
    throw new HostWiringError(
      'WIRING_REALIZE',
      `workstream flip: ${absPath} YAML errors: ${doc.errors.map((e) => e.message).join('; ')}`,
    )
  }
  if (!(doc.contents instanceof YAMLMap)) {
    throw new HostWiringError('WIRING_REALIZE', `workstream flip: ${absPath} is not a YAML mapping`)
  }
  const map = doc.contents

  const lifecycleValue: unknown = map.get('lifecycle')
  const current =
    lifecycleValue === undefined || lifecycleValue === null ? 'PLANNED' : String(lifecycleValue)
  if (current !== 'PLANNED') {
    throw new HostWiringError(
      'WIRING_REALIZE',
      `workstream flip: ${input.workstreamId} file lifecycle is ${current}, expected PLANNED — file/DB divergence; the append batch is rejected (TC-DOM-033)`,
    )
  }

  doc.set('lifecycle', 'REALIZED')
  const newContent = doc.toString()

  // Re-parse BEFORE writing: the flipped document must be well-formed and
  // actually carry the flip (fail loud, never write a corrupt 真源).
  const check = parseDocument(newContent)
  if (check.errors.length > 0 || !(check.contents instanceof YAMLMap)) {
    throw new HostWiringError('WIRING_REALIZE', `workstream flip: the flipped document of ${absPath} is not a well-formed mapping`)
  }
  if (String(check.contents.get('lifecycle')) !== 'REALIZED') {
    throw new HostWiringError('WIRING_REALIZE', `workstream flip: the flipped document of ${absPath} does not carry lifecycle: REALIZED`)
  }

  try {
    mkdirSync(dirname(absPath), { recursive: true })
    atomicWriteText(absPath, newContent)
  } catch (cause) {
    throw new HostWiringError('WIRING_REALIZE', `workstream flip: writing ${absPath} failed: ${causeMessage(cause)}`, {
      cause,
    })
  }

  input.logger?.info(
    'workstream-flip',
    `${input.workstreamId}: workstream.yaml flipped PLANNED→REALIZED (${absPath})`,
  )

  // The compensation: restore the exact pre-flip bytes, or delete the file
  // when the flip created it (oldText === null cannot occur for a tree-
  // claimed workstream — the file read above must have succeeded — but the
  // delete arm is kept for the crash-recovery edge where a re-flip targets
  // a file left behind by an earlier incomplete flip).
  return () => {
    if (oldText === null) {
      try {
        if (existsSync(absPath)) unlinkSync(absPath)
      } catch (cause) {
        throw new HostWiringError(
          'WIRING_REALIZE',
          `workstream compensation: could not delete ${absPath}: ${causeMessage(cause)}`,
          { cause },
        )
      }
      return
    }
    try {
      atomicWriteText(absPath, oldText)
    } catch (cause) {
      throw new HostWiringError(
        'WIRING_REALIZE',
        `workstream compensation: could not restore ${absPath}: ${causeMessage(cause)}`,
        { cause },
      )
    }
  }
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/* ====================================================================== *
 * The realizer — flip + pending-compensation state machine
 * ====================================================================== */

export interface WorkstreamRealizerInput {
  /** Absolute `.research` root. */
  readonly researchRoot: string
  /** workstream id → its topic (from the loaded tree). */
  readonly workstreams: ReadonlyMap<string, { readonly topicId: string }>
  readonly logger?: HostWiringLogger
}

/**
 * The RR-010 compensation state machine, owned by the wiring:
 *
 *   - `onWorkstreamRealized(wsId)` — called INSIDE the store write
 *     transaction by the RunBindingService's realize hook. Performs the
 *     file flip and arms the pending compensation.
 *   - `settleAppend(outcome)` — called by the guarded store wrapper
 *     (realize-store.ts) after `appendEvents` returns or throws:
 *     `committed` disarms (the flip is permanent); `failed` RUNS the
 *     compensation (restoring the pre-flip file state) before the append
 *     error propagates.
 *
 * At most one flip is pending at a time (the store transaction is
 * synchronous; a second `onWorkstreamRealized` with a pending
 * compensation is a wiring bug and fails loud).
 */
export class WorkstreamRealizer {
  readonly #input: WorkstreamRealizerInput
  #pending: { readonly workstreamId: string; readonly compensate: FileCompensation } | null = null

  constructor(input: WorkstreamRealizerInput) {
    this.#input = input
  }

  /** The workstream with an armed compensation (diagnostics). */
  get pendingWorkstreamId(): string | null {
    return this.#pending === null ? null : this.#pending.workstreamId
  }

  /** Realize the declarative half for one workstream (IN-TRANSACTION). */
  onWorkstreamRealized(workstreamId: string): void {
    if (this.#pending !== null) {
      throw new HostWiringError(
        'WIRING_REALIZE',
        `workstream realizer: ${workstreamId} realized while ${this.#pending.workstreamId}'s compensation is still armed — wiring bug (one realize per store transaction)`,
      )
    }
    const topic = this.#input.workstreams.get(workstreamId)
    if (topic === undefined) {
      throw new HostWiringError(
        'WIRING_REALIZE',
        `workstream realizer: ${workstreamId} is not in the loaded tree — refusing to write a workstream.yaml for an unknown workstream`,
      )
    }
    const compensate = flipWorkstreamYamlToRealized({
      researchRoot: this.#input.researchRoot,
      topicId: topic.topicId,
      workstreamId,
      logger: this.#input.logger,
    })
    this.#pending = { workstreamId, compensate }
  }

  /**
   * Settle the in-flight append: `committed` → the flip stands; `failed`
   * → run the compensation (its own failure is logged LOUD and rethrown
   * AFTER the caller has been given the original error — the wrapper
   * calls this inside its catch, so this method must not mask the append
   * error: it throws ONLY when the compensation fails, in which case the
   * startup lifecycle reconciliation is the backstop).
   */
  settleAppend(outcome: 'committed' | 'failed'): void {
    if (this.#pending === null) return
    const pending = this.#pending
    this.#pending = null
    if (outcome === 'committed') return
    try {
      pending.compensate()
    } catch (cause) {
      this.#input.logger?.error(
        'workstream-realize',
        `${pending.workstreamId}: the RR-010 file compensation FAILED after the append rolled back — the startup lifecycle reconciliation will converge file/DB: ${causeMessage(cause)}`,
      )
      throw cause
    }
    this.#input.logger?.warn(
      'workstream-realize',
      `${pending.workstreamId}: append failed after the file flip — workstream.yaml compensated back to PLANNED (RR-010)`,
    )
  }
}
