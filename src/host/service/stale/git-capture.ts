/**
 * WP-3.2 — git-backed closure blob capture (W3 batch + W11 HEAD).
 *
 * Frozen contract (PLAN_FORK_SPEC §3.2 + GIT_INTEGRATION §7 W3):
 *
 *   ```text
 *   对 closure 中每个文件:  git hash-object -- <path>
 *   保存 base_plan_objects: { path, git_blob_oid }[]（稳定集合）
 *   同时记录 base_git_commit（当时 HEAD，信息性，不参与 stale 判定）
 *   ```
 *
 *   - `hash-object` 对 **working copy** 内容计算，无需 commit → stale 检测
 *     不依赖用户 commit 频率（§5.2 实测: 内容一致时 hash-object ==
 *     rev-parse HEAD:path; 修改后 OID 改变）;
 *   - 相同内容重写（无实质变化）OID 不变，不误报（TC-GIT-004 语义）。
 *
 * ## 性能约束: 「batch hash-object (W13/W3 组合)」的落地口径
 *
 * The frozen W3 whitelist row (GIT_INTEGRATION §3, 冻结) is EXACTLY
 * `git hash-object -- <path>` — ONE path per invocation
 * (src/host/git/whitelist.ts: `a.length === 3`). Native git accepts
 * multiple paths in one `hash-object` call, but that argv shape is NOT in
 * the frozen whitelist and unreachable without amending the frozen contract
 * (本 WP 无此权限 — spec-issue 通道, 见报告). W13 (`git ls-files --
 * <pathspec>`) enumerates TRACKED paths (index state) — it cannot produce
 * working-copy blob OIDs (an UNTRACKED new closure file — e.g. a just-added
 * T-5.yaml the user never committed — is exactly the state §3.2 must cover),
 * so W13 cannot replace W3 here; running it would ADD a process per
 * capture without removing any.
 *
 * The per-file process storm is therefore avoided at the ORCHESTRATION
 * level: all W3 invocations of one closure run through a bounded
 * concurrency pool (default 8 in-flight, `mapWithConcurrency` below) —
 * wall time ≈ ⌈N/8⌉ × (spawn + hash) instead of N × (spawn + hash).
 * Process count stays N (+1 for the informational W11 HEAD read) — the
 * measurement is recorded in the WP-3.2 report (§测试结果).
 *
 * Missing-file semantics (§5 「文件缺失视为不同」): a closure path that is
 * not a regular file in the working copy is classified AS a result entry
 * (`oid: null`) instead of aborting the recheck — the §5 set comparison
 * then reports it as a `missing` diff. For the CREATION face (base capture)
 * a missing file is an anomaly (a consistent canonical plan cannot reference
 * a nonexistent definition file) and fails loud (`STALE_CAPTURE`; the
 * creation path re-wraps it as `PF_BASE_CAPTURE`, §4 步骤 3).
 *
 * Layer rule (ARCHITECTURE §2.2): this module only calls the named git
 * operations (W3 `hashObject`, W11 `revParseHead`) — the git layer is the
 * sole spawn point (INV-GIT-6). The `fs` calls here are READ-ONLY
 * classification (is-regular-file), not git logic.
 */

import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  GitCommandError,
  hashObject,
  revParseHead,
  type GitOptions,
} from '../../git/index.js'
import type { ClosureBlobBase, ClosureBlobCapturer } from '../../domain/planfork/index.js'
import { StaleServiceError } from './types.js'
import type { CurrentClosureEntry } from './closure.js'

/** The fixed git options one capture call is made with (immutable per service). */
export interface GitClosureOptions {
  readonly repoRoot: string
  readonly researchDir: string
  readonly git: GitOptions | undefined
  readonly concurrency: number
}

/** One closure capture result: per-path OIDs (input order, deduplicated) + informational HEAD. */
export interface HashedClosure {
  /** One entry per UNIQUE input path, INPUT order preserved (`oid: null` = not a regular file). */
  readonly entries: readonly CurrentClosureEntry[]
  /** HEAD at capture completion (信息性 — §3.2: 不参与 stale 判定; undefined = no commits yet). */
  readonly gitCommit?: string
}

/* ------------------------------------------------------------------ *
 * Bounded concurrency pool (the "batch" — see module 头注)
 * ------------------------------------------------------------------ */

/**
 * Map `items` through async `fn` with at most `limit` in-flight calls,
 * preserving INPUT order in the result. Fail-fast: the first rejection
 * rejects the whole promise once in-flight calls settle (git processes are
 * short-lived; no cancellation of in-flight W3 calls).
 *
 * `limit` must be a positive integer (validated by the caller). Exported
 * for unit testing (tests/stale — max-in-flight / order / error semantics).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workerCount = Math.min(limit, items.length)
  const workers: Promise<void>[] = []
  for (let w = 0; w < workerCount; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const i = next++
          if (i >= items.length) return
          results[i] = await fn(items[i]!)
        }
      })(),
    )
  }
  await Promise.all(workers)
  return results
}

/* ------------------------------------------------------------------ *
 * Path helpers
 * ------------------------------------------------------------------ */

function assertClosurePath(rel: string, researchDir: string): string {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new StaleServiceError('STALE_INPUT', `closure path must be a non-empty string (got ${JSON.stringify(rel)})`)
  }
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('/') || rel.includes('\0')) {
    throw new StaleServiceError(
      'STALE_INPUT',
      `closure path must be .research-relative POSIX (no absolute / .. / NUL), got: ${JSON.stringify(rel)}`,
    )
  }
  return `${researchDir}/${rel}`
}

/** True iff `abs` is a regular file (stat failures — races — count as absent). */
function isRegularFile(abs: string): boolean {
  try {
    if (!existsSync(abs)) return false
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Per-file W3 (with missing-file classification)
 * ------------------------------------------------------------------ */

async function hashOne(opts: GitClosureOptions, rel: string): Promise<CurrentClosureEntry> {
  const repoRel = assertClosurePath(rel, opts.researchDir)
  const abs = join(opts.repoRoot, repoRel)
  if (!isRegularFile(abs)) {
    // §5 「文件缺失视为不同」 — a recheck result, not an error.
    return { path: rel, oid: null }
  }
  try {
    const oid = await hashObject(opts.repoRoot, repoRel, opts.git)
    return { path: rel, oid }
  } catch (cause) {
    // TOCTOU: the file may have vanished between the stat and the hash.
    if (!isRegularFile(abs)) return { path: rel, oid: null }
    throw cause
  }
}

/**
 * The informational HEAD read (W11). A repository with NO commits yet is a
 * legal state (working-copy basis — §3.2 「无需 commit」): `rev-parse HEAD`
 * fails with git's standard no-history message ⇒ `gitCommit: undefined`
 * (the model field is optional). Any OTHER git error fails loud (GIT
 * INTEGRATION §9: repo 损坏 → 原样展示; 插件不尝试修复).
 */
const NO_HEAD_RE = /does not have any commits yet|unknown revision 'HEAD'|ambiguous argument 'HEAD'/

async function readHeadOrUndefined(opts: GitClosureOptions): Promise<string | undefined> {
  try {
    return await revParseHead(opts.repoRoot, opts.git)
  } catch (cause) {
    if (cause instanceof GitCommandError && NO_HEAD_RE.test(cause.stderr)) return undefined
    throw cause
  }
}

/** Deduplicate preserving first-occurrence order (a closure is a SET — §5). */
function dedupeInOrder(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The capture faces
 * ------------------------------------------------------------------ */

/**
 * Recheck face (stale detection): hash every closure path with the bounded
 * W3 pool; missing files become `oid: null` entries (the §5 comparison
 * turns them into `missing` diffs). Git infrastructure errors (GitError
 * family) propagate UNWRAPPED — the service classifies them (STALE_GIT) and
 * NO state change happens (the transition only runs after a successful
 * recompute).
 */
export async function hashClosure(opts: GitClosureOptions, closure: readonly string[]): Promise<HashedClosure> {
  const unique = dedupeInOrder(closure)
  const entries = await mapWithConcurrency(unique, opts.concurrency, (rel) => hashOne(opts, rel))
  const gitCommit = unique.length > 0 ? await readHeadOrUndefined(opts) : undefined
  return { entries, ...(gitCommit !== undefined ? { gitCommit } : {}) }
}

/**
 * Creation face (§3.2 base capture): same bounded W3 pool + HEAD, but a
 * missing closure file FAILS LOUD (`STALE_CAPTURE`) — a base closure must be
 * fully present (the §4 步骤 2 canonical consistency check guarantees this
 * for a valid creation; this is the belt-and-suspenders face). The service
 * creation path re-wraps the error as `PF_BASE_CAPTURE` (step 3) so the
 * domain error taxonomy stays single-sourced.
 */
export async function captureGitClosureBase(opts: GitClosureOptions, closure: readonly string[]): Promise<ClosureBlobBase> {
  const { entries, gitCommit } = await hashClosure(opts, closure)
  const missing = entries.find((e) => e.oid === null)
  if (missing !== undefined) {
    throw new StaleServiceError(
      'STALE_CAPTURE',
      `closure file missing from working copy: ${missing.path} (PLAN_FORK_SPEC §3.1 — every closure file must be a regular file for a base capture)`,
    )
  }
  return {
    objects: entries.map((e) => ({ path: e.path, git_blob_oid: e.oid! })),
    ...(gitCommit !== undefined ? { gitCommit } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * The sync port adapter (async-then-sync seam for the domain port)
 * ------------------------------------------------------------------ */

/**
 * Wrap an ALREADY-CAPTURED base for the WP-3.1 `ClosureBlobCapturer` port
 * (which is SYNCHRONOUS — the pure domain layer never awaits).
 *
 * The service pre-captures asynchronously (git), then injects this adapter
 * into the §4 chain's context; step 3 re-computes the closure from the plan
 * view and calls `capture` synchronously. The adapter returns the pre-
 * captured base ONLY when the requested (wsDir, closure) is IDENTICAL to
 * the one it was built for (first call records the expectation; any other
 * request throws — the domain wraps it as PF_BASE_CAPTURE). The mismatch
 * can only mean the canonical plan changed between pre-capture and step-3
 * recompute — exactly the race INV-PLAN-6 forbids (base is always
 * server-recomputed, never client-supplied or stale).
 */
export function withCapturedBase(captured: ClosureBlobBase): ClosureBlobCapturer {
  let expectedWsDir: string | null = null
  let expectedKey: string | null = null
  const keyOf = (wsDir: string, closure: readonly string[]): string => `${wsDir}\u0000${closure.join('\u0000')}`
  return {
    capture(wsDir: string, closure: readonly string[]): ClosureBlobBase {
      const key = keyOf(wsDir, closure)
      if (expectedWsDir === null) {
        expectedWsDir = wsDir
        expectedKey = key
        return captured
      }
      if (wsDir !== expectedWsDir || key !== expectedKey) {
        throw new Error(
          `pre-captured base closure does not match the requested closure ` +
            `(wsDir=${JSON.stringify(wsDir)}; ${closure.length} paths) — the canonical plan changed between ` +
            `server-side capture and step-3 recompute; re-run creation (INV-PLAN-6: base is always server-recomputed)`,
        )
      }
      return captured
    },
  }
}
