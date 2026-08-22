/**
 * WP-3.6 (RR-011 (a) / RR-010 崩溃后一致性) — the startup
 * workstream-lifecycle reconciliation: the DETECTION PATH for file/DB
 * divergence left by a crash inside the RR-010 window.
 *
 * ## The window and its residue
 *
 * The atomic-realize flip (workstream-flip.ts) writes workstream.yaml
 * INSIDE the event transaction, before COMMIT. A crash between the file
 * write and the COMMIT (or a failed RR-010 compensation) leaves:
 *
 *   - file `lifecycle: REALIZED` while the workstream has NO events in
 *     History — the file LEADS the truth. History is the 真源 for "did it
 *     happen": no event ⇒ it did not happen ⇒ the flip is residue ⇒ roll
 *     the file back to PLANNED.
 *   - conversely, file `lifecycle: PLANNED` while the workstream HAS
 *     events — the file TRAILS the truth (e.g. the flip was undone, or
 *     the wiring landed after events already existed). The forward
 *     convergence is the flip itself (idempotent, one-shot semantics
 *     preserved: the workstream is realized — its first event exists).
 *
 * Both directions are converged at STARTUP (the [Service.init] wiring
 * runs this before any service is used) and are reported loudly: every
 * convergence is a structured finding in the result AND a log entry. A
 * workstream whose file is missing/unreadable or whose non-PLANNED/
 * REALIZED state cannot be interpreted is NOT converged silently — the
 * reconciliation fails loud (the tree and the DB disagree in a way this
 * mechanism must not guess about).
 *
 * DROPPED workstreams are out of scope in both directions: a dropped WS
 * with history is consistent (it was realized, then dropped), and a
 * dropped WS without history is simply never used — the declarative
 * 真源 (DROPPED) stands.
 *
 * No DSH imports (INV-PERM-5).
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseDocument, YAMLMap } from 'yaml'

import type { ResearchStore } from '../../persistence/store/index.js'
import { TMP_FILE_SUFFIX } from '../../domain/topology/types.js'
import { HostWiringError, type HostWiringLogger } from './types.js'
import { workstreamYamlRelPath } from './workstream-flip.js'

export interface LifecycleReconcileWorkstream {
  readonly workstreamId: string
  readonly topicId: string
}

export interface LifecycleReconcileFinding {
  readonly workstreamId: string
  /** The file lifecycle BEFORE the reconciliation touched it. */
  readonly fileLifecycle: 'PLANNED' | 'REALIZED' | 'DROPPED'
  /** Whether the workstream has ≥1 event in History (the 真源). */
  readonly hasEvents: boolean
  /** What the reconciliation did (none = already consistent). */
  readonly action:
    | 'none'
    | 'file-rolled-back-to-planned'
    | 'file-flipped-to-realized'
    | 'skipped-dropped'
}

export interface LifecycleReconcileReport {
  readonly findings: readonly LifecycleReconcileFinding[]
  /** Number of files actually rewritten. */
  readonly changed: number
}

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

/** Read + parse one workstream.yaml; fail loud on any unreadable/illegal
 *  file (the reconciliation must not guess about a broken 真源). Returns
 *  the root mapping (narrowed — the doc must be a mapping to be legal). */
function readLifecycleDoc(
  researchRoot: string,
  ws: LifecycleReconcileWorkstream,
): { absPath: string; map: YAMLMap } {
  const absPath = join(researchRoot, workstreamYamlRelPath(ws.topicId, ws.workstreamId))
  let text: string
  try {
    text = readFileSync(absPath, 'utf8')
  } catch (cause) {
    throw new HostWiringError(
      'WIRING_RECONCILE',
      `lifecycle reconciliation: ${absPath} is missing or unreadable for tree-claimed workstream ${ws.workstreamId} — refusing to converge against a broken 真源: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const doc = parseDocument(text)
  if (doc.errors.length > 0 || !(doc.contents instanceof YAMLMap)) {
    throw new HostWiringError(
      'WIRING_RECONCILE',
      `lifecycle reconciliation: ${absPath} is not a well-formed YAML mapping — refusing to converge ${ws.workstreamId} against a broken 真源`,
    )
  }
  const raw = doc.contents.get('lifecycle')
  const lifecycle = raw === undefined || raw === null ? 'PLANNED' : String(raw)
  if (lifecycle !== 'PLANNED' && lifecycle !== 'REALIZED' && lifecycle !== 'DROPPED') {
    throw new HostWiringError(
      'WIRING_RECONCILE',
      `lifecycle reconciliation: ${absPath} carries lifecycle ${JSON.stringify(lifecycle)} — not a legal WsLifecycle; refusing to converge ${ws.workstreamId} (loader error surface)`,
    )
  }
  return { absPath, map: doc.contents }
}

/**
 * Reconcile every listed workstream's declarative lifecycle against its
 * History truth (file/DB divergence → converge the FILE toward the DB,
 * loud report). `store` must be the live wiring store (read face only is
 * used for the event probe).
 */
export function reconcileWorkstreamLifecycles(input: {
  readonly store: ResearchStore
  readonly researchRoot: string
  readonly workstreams: readonly LifecycleReconcileWorkstream[]
  readonly logger?: HostWiringLogger
}): LifecycleReconcileReport {
  const findings: LifecycleReconcileFinding[] = []
  let changed = 0

  for (const ws of input.workstreams) {
    const { absPath, map } = readLifecycleDoc(input.researchRoot, ws)
    const raw = map.get('lifecycle')
    const fileLifecycle = (raw === undefined || raw === null ? 'PLANNED' : String(raw)) as
      | 'PLANNED'
      | 'REALIZED'
      | 'DROPPED'
    const hasEvents = input.store.listRange(ws.workstreamId, 1, 1).length > 0

    if (fileLifecycle === 'DROPPED') {
      findings.push({ workstreamId: ws.workstreamId, fileLifecycle, hasEvents, action: 'skipped-dropped' })
      continue
    }

    if (fileLifecycle === 'REALIZED' && !hasEvents) {
      // RR-010 crash residue: the flip outlived a rolled-back/never-
      // committed append. History says "it did not happen" — roll the
      // file back.
      map.set('lifecycle', 'PLANNED')
      const newContent = map.toString()
      try {
        atomicWriteText(absPath, newContent)
      } catch (cause) {
        throw new HostWiringError(
          'WIRING_RECONCILE',
          `lifecycle reconciliation: could not roll ${ws.workstreamId}'s workstream.yaml back to PLANNED: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
      input.logger?.error(
        'lifecycle-reconcile',
        `${ws.workstreamId}: file said REALIZED but History has no events (RR-010 crash window residue) — file rolled back to PLANNED`,
      )
      findings.push({ workstreamId: ws.workstreamId, fileLifecycle, hasEvents, action: 'file-rolled-back-to-planned' })
      changed += 1
      continue
    }

    if (fileLifecycle === 'PLANNED' && hasEvents) {
      // Forward convergence: the workstream is realized (it has events)
      // but the file never carried the flip.
      map.set('lifecycle', 'REALIZED')
      const newContent = map.toString()
      try {
        mkdirSync(dirname(absPath), { recursive: true })
        atomicWriteText(absPath, newContent)
      } catch (cause) {
        throw new HostWiringError(
          'WIRING_RECONCILE',
          `lifecycle reconciliation: could not flip ${ws.workstreamId}'s workstream.yaml to REALIZED: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        )
      }
      input.logger?.error(
        'lifecycle-reconcile',
        `${ws.workstreamId}: History has events but the file said PLANNED (flipped half lost) — file flipped to REALIZED`,
      )
      findings.push({ workstreamId: ws.workstreamId, fileLifecycle, hasEvents, action: 'file-flipped-to-realized' })
      changed += 1
      continue
    }

    findings.push({ workstreamId: ws.workstreamId, fileLifecycle, hasEvents, action: 'none' })
  }

  return { findings, changed }
}
