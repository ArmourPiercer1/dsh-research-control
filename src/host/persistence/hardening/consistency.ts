/**
 * WP-8.1 — hardening: check 4, the dual-真源 consistency SPOT check.
 *
 * ARCHITECTURE §4 双真源: the declarative 真源 (`.research/` files,
 * versioned by Git) and the operational 真源 (research.sqlite event log)
 * describe the SAME project from two sides. A crash inside the
 * atomic-realize window (RR-010: workstream.yaml flip inside the event
 * transaction, before COMMIT) is the canonical way they can DIVERGE.
 *
 * This check SPOT-CHECKS the agreement at startup (read-only; it reports,
 * it never converges — the convergence mechanisms are the
 * already-delivered startup reconciliations the wiring runs loud AFTER
 * this check):
 *
 *   - per workstream (a bounded sample — default
 *     {@link DEFAULT_CONSISTENCY_SAMPLE} by sorted id, `checked` says
 *     exactly what was probed): file `lifecycle` vs History emptiness
 *     (a workstream's log is non-empty ⟺ its seq-1 event exists — seq
 *     is assigned from 1, strictly +1, TC-HIST-003; the probe is the
 *     store's PK `getEvent(id, 1)`, O(1)):
 *       file REALIZED + no events  → `file-leads`  (recoverable: the
 *         lifecycle reconciliation rolls the file back to PLANNED —
 *         History is the truth 「did it happen」, RR-010 crash residue);
 *       file PLANNED    + events   → `file-trails` (recoverable: the
 *         reconciliation converges the file forward to REALIZED);
 *       DROPPED         → skipped in both directions (a dropped WS with
 *         or without history is consistent — the declarative 真源
 *         stands; same rule the reconciliation documents);
 *   - project scope: `.research/project.yaml` id vs the registered
 *     project id under which the DB lives (DSH_ADAPTER §9 data dir): a
 *     mismatch is UNRECOVERABLE — the plugin must not guess which side
 *     to rewrite (is the DB the wrong project's, or the file edited?) →
 *     startup refuses with the guidance to restore one of the two.
 *
 * Workstreams whose file was rejected by the loader (doc: null) are NOT
 * probed — their breakage is already reported by the tree check; this
 * check must not re-guess about a broken 真源 (the reconciliation's
 * same discipline: 「refusing to converge against a broken 真源」).
 *
 * If the probe itself hits a store failure (a STORE_* error surfacing on
 * a read — e.g. an unparseable JSON column), the check reports
 * `unrecoverable` with the store error: a DB that passed the open-time
 * quick_check but fails a row read is corrupt for our purposes, and that
 * must be loud, not silent.
 */

import type { ResearchStore } from '../store/index.js'
import { StoreError } from '../store/index.js'
import type {
  ConsistencyCheckResult,
  ConsistencyFinding,
  DualTruthConsistencyInput,
} from './types.js'
import { DEFAULT_CONSISTENCY_SAMPLE } from './types.js'

interface ProbedWorkstream {
  readonly workstreamId: string
  readonly lifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
}

/**
 * Run the dual-真源 consistency spot check. READ-ONLY: the store handle
 * is used for `getEvent` probes only; the caller keeps ownership.
 */
export function checkDualTruthConsistency(input: DualTruthConsistencyInput): ConsistencyCheckResult {
  const maxSample = input.maxSample ?? DEFAULT_CONSISTENCY_SAMPLE
  if (!Number.isSafeInteger(maxSample) || maxSample < 1) {
    throw new TypeError('checkDualTruthConsistency: maxSample must be a positive safe integer')
  }

  const findings: ConsistencyFinding[] = []
  let projectIdChecked = false

  // ---- project-scope cross-check --------------------------------------
  const projectDoc = input.tree.project
  if (projectDoc !== null) {
    projectIdChecked = true
    if (projectDoc.id !== input.projectId) {
      findings.push({
        kind: 'project-id-mismatch',
        message:
          `the declarative 真源 declares project ${JSON.stringify(projectDoc.id)} (.research/project.yaml) ` +
          `but the operational store lives under the registered scope ${JSON.stringify(input.projectId)} (DSH_ADAPTER §9 data dir) — ` +
          'the two 真源 disagree about WHICH project this is',
      })
    }
  }

  // ---- the workstream sample -------------------------------------------
  const candidates: ProbedWorkstream[] = []
  for (const topic of input.tree.topics) {
    for (const ws of topic.workstreams) {
      const doc = ws.doc
      if (doc === null) continue // broken file: the tree check reports it; do not re-guess
      candidates.push({ workstreamId: ws.id, lifecycle: doc.lifecycle })
    }
  }
  candidates.sort((a, b) => (a.workstreamId < b.workstreamId ? -1 : a.workstreamId > b.workstreamId ? 1 : 0))
  const sample = candidates.slice(0, maxSample)

  const checked: string[] = []
  let divergent = false

  for (const ws of sample) {
    checked.push(ws.workstreamId)
    if (ws.lifecycle === 'DROPPED') continue // consistent in both directions (documented rule)
    let hasEvents: boolean
    try {
      hasEvents = input.store.getEvent(ws.workstreamId, 1) !== null
    } catch (e) {
      if (e instanceof StoreError) {
        return {
          status: 'unrecoverable',
          checked,
          findings,
          projectIdChecked,
          message: `consistency probe of ${ws.workstreamId} failed with a store error (${e.code}): ${e.message}`,
          guidance: [
            `the operational database FAILED A ROW READ during the consistency probe (${e.code}: ${e.message}) — it passed the open-time quick_check but is corrupt for our purposes; treat it as the TC-DB-002 corruption case (structured error, no repair attempt, operational data not recoverable)`,
          ],
        }
      }
      throw e
    }
    if (ws.lifecycle === 'REALIZED' && !hasEvents) {
      findings.push({
        kind: 'file-leads',
        workstreamId: ws.workstreamId,
        message:
          `${ws.workstreamId}: the file says lifecycle=REALIZED but History has NO events (RR-010 crash-window residue) ` +
          '— recoverable: the startup lifecycle reconciliation rolls the file back to PLANNED (loud; History is the truth 「did it happen」)',
      })
      divergent = true
    } else if (ws.lifecycle === 'PLANNED' && hasEvents) {
      findings.push({
        kind: 'file-trails',
        workstreamId: ws.workstreamId,
        message:
          `${ws.workstreamId}: History HAS events but the file says lifecycle=PLANNED (the flip half was lost) ` +
          '— recoverable: the startup lifecycle reconciliation converges the file forward to REALIZED (loud)',
      })
      divergent = true
    }
  }

  const mismatch = findings.some((f) => f.kind === 'project-id-mismatch')
  const status: ConsistencyCheckResult['status'] = mismatch
    ? 'unrecoverable'
    : divergent
      ? 'recoverable'
      : 'pass'

  const guidance: string[] = []
  if (mismatch) {
    for (const f of findings) if (f.kind === 'project-id-mismatch') guidance.push(f.message)
    guidance.push(
      `remedy (user action, never automatic — the plugin must not guess which side to rewrite): restore the correct side (e.g. .research/project.yaml via \`git restore --source=<commit> -- .research/project.yaml\`, or the matching data dir under $DSH_HOME/research-control/<project-id>/), then restart`,
    )
  } else if (divergent) {
    for (const f of findings) guidance.push(f.message)
    guidance.push(
      'no automatic convergence happens at this check (it is read-only): the wiring\'s startup reconciliation (lifecycle convergence → run-vs-history → semantics rebuild) applies the fixes LOUD after this report',
    )
  }

  return {
    status,
    checked,
    findings,
    projectIdChecked,
    message:
      findings.length === 0
        ? `consistent: ${String(checked.length)} workstream(s) spot-checked (file lifecycle vs History)` +
          (projectIdChecked ? '; project scope matches' : '; project doc absent — scope check not applicable')
        : `${String(findings.length)} consistency finding(s): ${findings.map((f) => f.kind).join(', ')}`,
    guidance,
  }
}
