/**
 * WP-1.4 — MergeContract (`merges/<TE-id>/contract.md`, DOMAIN_SCHEMA §3.2)
 * + the realize pre-validator (`validateRealize`, HISTORY_EVENT_CATALOG §5.8).
 *
 * §3.2 contract rules (implemented verbatim):
 *  - 纯 Markdown 自由内容 — the file is stored byte-for-byte; the plugin
 *    performs NO content validation (no schema, no field check; 「插件不检查
 *    contract 满足度、不因此阻塞或提示」);
 *  - 归属由路径决定 — the directory name IS the TE id; the only path-level
 *    checks are (a) the directory name is a well-formed TE id (§1.1) and
 *    (b) that TE id names an existing topology edge (loader §16.1(h) analog);
 *  - 可选 YAML front-matter (`title`, `updated_at`) — not parsed, not
 *    validated, not touched;
 *  - 无 ContractRevision — version history/diff/restore belong to Git
 *    (INV-GIT-8, WP-1.2's restoreFile/ logFile); this module has no
 *    revision machinery and never deletes a contract.
 *
 * `edgeIds` is a CONSTRUCTION-TIME SNAPSHOT (the read-only boundary: the
 * caller assembles it from the loaded ResearchTree —
 * `tree.topics.flatMap(t => t.topology?.topology.edges.map(e => e.id) ?? [])`).
 * A contract write is checked against the snapshot it was built with; the
 * service layer rebuilds the store when the topology changes.
 *
 * Layer rules: all I/O through the injected `TopologyFileIo` (loader pattern);
 * no HistoryEvent is written (realize event emission is Phase 2); the plan
 * and other declarative files are read-only for this module.
 */

import { pjoin } from '../loader/index.js'
import type { TopologyDoc } from '../loader/index.js'
import {
  assertWellFormedTeId,
  TMP_FILE_SUFFIX,
  TopologyStoreError,
  type RealizeIssue,
  type RealizeValidation,
  type TopologyFileIo,
} from './types.js'

/* ------------------------------------------------------------------ *
 * validateRealize — HISTORY_EVENT_CATALOG §5.8 pre-realize checks
 * ------------------------------------------------------------------ */

/**
 * Pre-validation for TOPOLOGY_FORK_REALIZED / TOPOLOGY_MERGE_REALIZED
 * (HISTORY_EVENT_CATALOG §5.8 「校验与副作用」), called by the Phase 2 event
 * handler BEFORE emission. WP-1.4 validates only — no event, no write, no
 * side effect (pure function).
 *
 * Checks, in order (all are aggregated — one edge can violate several):
 *  1. EDGE_NOT_FOUND        — `teId` does not name an edge of the provided
 *                              topology document (§5.8 「存在」);
 *  2. REALIZE_NOT_PLANNED   — the edge lifecycle is not PLANNED (§5.8 「PLANNED」;
 *                              a re-realized or dropped edge cannot realize again);
 *  3. REALIZE_ARITY         — V1 owner-disambiguation arity (§5.8 「V1 要求
 *                              realized FORK 边 inputs 恰为 1 项、MERGE 边 outputs
 *                              恰为 1 项（消除 owner 歧义的工程默认）」):
 *                              FORK edge: inputs.length === 1 (owner = inputs[0]);
 *                              MERGE edge: outputs.length === 1 (owner = outputs[0]).
 *                              The COMPLEMENTARY side is unconstrained (FORK is
 *                              typically 1→N, MERGE N→1; the frozen schema only
 *                              requires ≥1 + unique — 「V1 不强制基数」, §3.1).
 *
 * Workstream existence is NOT re-checked here: that is the INV-STRUCT-2
 * invariant maintained by the loader (full tree load) and by
 * `TopologyStore` (per-topic CRUD) — this validator takes a topology
 * document and judges the edge itself only.
 */
export function validateRealize(topology: TopologyDoc, teId: string): RealizeValidation {
  const issues: RealizeIssue[] = []
  const edge = topology.topology.edges.find((e) => e.id === teId)
  if (edge === undefined) {
    issues.push({
      code: 'EDGE_NOT_FOUND',
      teId,
      message: `topology edge ${teId} does not exist in the provided topology document (HISTORY_EVENT_CATALOG §5.8 「存在」)`,
    })
    return { ok: false, issues }
  }

  if (edge.lifecycle !== 'PLANNED') {
    issues.push({
      code: 'REALIZE_NOT_PLANNED',
      teId,
      message: `topology edge ${teId} has lifecycle ${edge.lifecycle}; only PLANNED edges can be realized (HISTORY_EVENT_CATALOG §5.8 「PLANNED」)`,
    })
  }

  if (edge.operation === 'FORK' && edge.inputs.length !== 1) {
    issues.push({
      code: 'REALIZE_ARITY',
      teId,
      message:
        `FORK edge ${teId} must have exactly 1 input to be realized (V1 owner-disambiguation default, ` +
        `HISTORY_EVENT_CATALOG §5.8); got ${edge.inputs.length}: [${edge.inputs.join(', ')}]`,
    })
  }
  if (edge.operation === 'MERGE' && edge.outputs.length !== 1) {
    issues.push({
      code: 'REALIZE_ARITY',
      teId,
      message:
        `MERGE edge ${teId} must have exactly 1 output to be realized (V1 owner-disambiguation default, ` +
        `HISTORY_EVENT_CATALOG §5.8); got ${edge.outputs.length}: [${edge.outputs.join(', ')}]`,
    })
  }

  return { ok: issues.length === 0, issues }
}

/* ------------------------------------------------------------------ *
 * Atomic write (shared with TopologyStore)
 * ------------------------------------------------------------------ */

function ioMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Atomic write protocol: write the FULL new content to `<path>.dshrc-tmp`,
 * then `rename` it into place (atomic on POSIX). On a failed rename the temp
 * file is unlinked (best effort — a cleanup failure does not mask the
 * original error) and the error propagates. On success the target always
 * holds a complete document: the previous content is either fully present
 * (write/rename failed) or fully replaced (rename succeeded) — never a
 * mix (tests/topology/atomic-write.test.ts).
 */
export function atomicWrite(io: TopologyFileIo, path: string, rel: string, content: string): void {
  const tmp = path + TMP_FILE_SUFFIX
  try {
    io.writeFile(tmp, content)
  } catch (cause) {
    throw new TopologyStoreError('WRITE', `atomic write of ${rel}: temp-file write failed: ${ioMessage(cause)}`, { file: rel })
  }
  try {
    io.rename(tmp, path)
  } catch (cause) {
    try {
      io.unlink(tmp)
    } catch {
      // best-effort cleanup; the rename failure is the reported error
    }
    throw new TopologyStoreError('WRITE', `atomic write of ${rel}: rename into place failed: ${ioMessage(cause)}`, { file: rel })
  }
}

/* ------------------------------------------------------------------ *
 * MergeContractStore
 * ------------------------------------------------------------------ */

export interface MergeContractStoreOptions {
  /** The injected I/O port (loader pattern — the only file access). */
  io: TopologyFileIo
  /** The `.research/` root exactly as passed to `io` (e.g. `/ws/.research`). */
  researchRoot: string
  /**
   * Construction-time snapshot of ALL topology edge ids (all topics),
   * assembled by the caller from the loaded ResearchTree (read-only
   * boundary). `writeContract` refuses edges not in the snapshot (§3.2
   * ownership by path, §16.1(h)).
   */
  edgeIds: readonly string[]
}

/**
 * Read/write access to `.research/merges/<TE-id>/contract.md` (§3.2).
 * Content is free Markdown, stored byte-for-byte (no validation, no
 * parsing, no revision tracking — INV-GIT-8).
 */
export class MergeContractStore {
  private readonly io: TopologyFileIo
  private readonly researchRoot: string
  private readonly edgeIdSet: ReadonlySet<string>

  constructor(options: MergeContractStoreOptions) {
    this.io = options.io
    this.researchRoot = options.researchRoot
    this.edgeIdSet = new Set(options.edgeIds)
  }

  /** `.research/merges/<TE-id>/contract.md` (absolute, as given to io). */
  contractPath(teId: string): string {
    return pjoin(this.researchRoot, 'merges', teId, 'contract.md')
  }

  /** Root-relative POSIX path (loader error-location convention). */
  private relPath(teId: string): string {
    return `merges/${teId}/contract.md`
  }

  /**
   * Read the contract content (raw Markdown, byte-for-byte).
   * @throws INVALID_ID — teId is not a well-formed TE id;
   *         READ       — io failure;
   *         CONTRACT_NOT_FOUND — the file does not exist.
   */
  readContract(teId: string): string {
    assertWellFormedTeId(teId)
    let text: string | null
    try {
      text = this.io.readFile(this.contractPath(teId))
    } catch (cause) {
      throw new TopologyStoreError('READ', `read of ${this.relPath(teId)} failed: ${ioMessage(cause)}`, {
        teId,
        file: this.relPath(teId),
      })
    }
    if (text === null) {
      throw new TopologyStoreError(
        'CONTRACT_NOT_FOUND',
        `merge contract for ${teId} does not exist (${this.relPath(teId)}, DOMAIN_SCHEMA §3.2)`,
        { teId, file: this.relPath(teId) },
      )
    }
    return text
  }

  /**
   * Write the contract content (full replacement, atomic — §3.2 free
   * Markdown is stored verbatim; optional front-matter is not parsed).
   * @throws INVALID_ID           — teId is not a well-formed TE id;
   *         CONTRACT_TE_UNKNOWN  — teId names no existing topology edge
   *                                (snapshot, §16.1(h));
   *         WRITE                — atomic-write failure (previous content intact).
   */
  writeContract(teId: string, content: string): string {
    assertWellFormedTeId(teId)
    if (!this.edgeIdSet.has(teId)) {
      throw new TopologyStoreError(
        'CONTRACT_TE_UNKNOWN',
        `merge contract for ${teId} references a topology edge that does not exist (DOMAIN_SCHEMA §3.2/§16.1)`,
        { teId, file: this.relPath(teId) },
      )
    }
    atomicWrite(this.io, this.contractPath(teId), this.relPath(teId), content)
    return content
  }
}
