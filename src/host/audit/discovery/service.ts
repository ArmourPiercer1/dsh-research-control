/**
 * WP-6.2 — discovery zone scanner: the service face (operational KV
 * snapshot persistence + error classification).
 *
 * Composition (thin over the pure modules):
 *  - `scan` = read previous snapshot (KV) → `scanWorkspace` (read-only
 *    fs walk + classify + diff) → persist the new snapshot (KV `set`)
 *    → report. A FAILED scan persists NOTHING — the previous baseline
 *    stays intact (a failed audit must never destroy the incremental
 *    baseline);
 *  - `scanFromUntracked` = the WP-6.1 `AuditReport.untracked` seam
 *    (pure pass-through over `feedUntracked` — no fs, no KV: the
 *    strict layer's W4 facts are already in the list);
 *  - `readSnapshot` / `clearSnapshot` = KV diagnostics/reset.
 *
 * Error face (`DiscoveryScannerError.code`, stable for dispatch):
 *  - `DISC_ROOT_MISSING`  — workspace root absent / not a directory;
 *  - `DISC_SNAPSHOT_CORRUPT` — stored snapshot fails decode (fail loud,
 *    同 MetaStore 损坏 guard 口径 — never silently reset the baseline);
 *  - `DISC_POLICY_INVALID` — policy misconfiguration (rethrown from
 *    `normalizePolicy` at the wiring boundary; `scan` trusts an
 *    already-normalized `DiscoveryPolicy`).
 *
 * Read-only: the ONLY write this service performs is the snapshot
 * `set` into the injected `MetaStore` (operational KV, §15). The
 * workspace itself is never written (scan.ts 只读契约).
 */

import type { MetaStore } from '../../persistence/meta/index.js'
import { DiscoveryPolicyError, normalizePolicy } from './policy.js'
import { decodeSnapshot, DiscoverySnapshotError, encodeSnapshot, SNAPSHOT_KEY } from './snapshot.js'
import { feedUntracked, scanWorkspace } from './scan.js'
import type {
  DiscoveryPolicy,
  DiscoveryScanReport,
  DiscoverySnapshot,
  UntrackedFeedResult,
  UntrackedFileRef,
} from './types.js'
import type { WorkspaceDoc } from '../../domain/loader/index.js'

/** Service-layer error with a stable machine code. */
export class DiscoveryScannerError extends Error {
  readonly code: 'DISC_ROOT_MISSING' | 'DISC_SNAPSHOT_CORRUPT'
  constructor(code: DiscoveryScannerError['code'], message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DiscoveryScannerError'
    this.code = code
  }
}

/** The scanner service (stateless — all state lives in the KV store). */
export class DiscoveryScanner {
  constructor(
    private readonly meta: MetaStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The operational-KV key of the latest scan snapshot (exposed for
   * diagnostics; `meta` is per-project — §15 — so no project prefix).
   */
  static readonly snapshotKey = SNAPSHOT_KEY

  /**
   * Read the previous snapshot from the operational KV.
   * @returns `null` when none stored yet (first scan).
   * @throws DiscoveryScannerError(`DISC_SNAPSHOT_CORRUPT`) on a stored
   *   value that fails structural decode (fail loud).
   */
  readSnapshot(): DiscoverySnapshot | null {
    const raw = this.meta.get(SNAPSHOT_KEY)
    if (raw === null) return null
    try {
      return decodeSnapshot(raw)
    } catch (cause) {
      if (cause instanceof DiscoverySnapshotError) {
        throw new DiscoveryScannerError('DISC_SNAPSHOT_CORRUPT', cause.message, { cause })
      }
      throw cause
    }
  }

  /**
   * One discovery scan of the workspace (read-only) + incremental diff
   * vs the previous snapshot + snapshot persistence (on success only).
   *
   * @param args.workspaceRoot absolute path (the caller resolves
   *   `workspace.root` against the Git repo root — §14.1; git-free here)
   * @param args.policy normalized policy (`normalizePolicy` output)
   */
  scan(args: { readonly workspaceRoot: string; readonly policy: DiscoveryPolicy }): DiscoveryScanReport {
    const prev = this.readSnapshot()
    let report: DiscoveryScanReport
    try {
      report = scanWorkspace({
        root: args.workspaceRoot,
        policy: args.policy,
        now: this.now,
        prevSnapshot: prev,
      })
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('walkWorkspaceFiles:')) {
        throw new DiscoveryScannerError('DISC_ROOT_MISSING', cause.message, { cause })
      }
      throw cause
    }
    // persist AFTER a successful scan — a failure never overwrites the
    // baseline (the previous snapshot stays for the next run)
    this.meta.set(SNAPSHOT_KEY, encodeSnapshot(report.snapshot))
    return report
  }

  /**
   * The WP-6.1 seam: feed a normalized `AuditReport.untracked` list
   * (types.ts `UntrackedFileRef` contract) → classified candidates +
   * reasoned skips. Pure (no fs, no KV) — see `feedUntracked`.
   */
  scanFromUntracked(args: {
    readonly policy: DiscoveryPolicy
    readonly untracked: readonly UntrackedFileRef[]
  }): UntrackedFeedResult {
    return feedUntracked(args.policy, args.untracked)
  }

  /** Delete the stored snapshot (reset the incremental baseline). */
  clearSnapshot(): void {
    this.meta.delete(SNAPSHOT_KEY)
  }
}

/**
 * Convenience: normalize a raw §14.1 `audit` block (wiring boundary).
 * Accepts the full loader `WorkspaceDoc` or just its `audit` face
 * (`null` = no workspace.yaml → all engineering defaults).
 */
export function policyFromWorkspaceDoc(
  doc: WorkspaceDoc | Pick<WorkspaceDoc, 'audit'> | null | undefined,
): DiscoveryPolicy {
  return normalizePolicy(doc?.audit ?? null)
}

export type { DiscoveryPolicy, DiscoveryScanReport, DiscoverySnapshot, UntrackedFeedResult, UntrackedFileRef }
export { DiscoveryPolicyError }
