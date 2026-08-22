/**
 * WP-3.6 (RR-011 (d)) — the SYNCHRONOUS closure blob capture for the
 * agent tool face.
 *
 * ## Why a second capture path exists
 *
 * The WP-3.3 tool face freezes the creation port as SYNCHRONOUS
 * (`ResearchToolDeps.planForkCreate(params): PlanForkRecord` — the tool
 * handler calls it without `await` and serializes the returned record).
 * The production creation flow (the WP-3.2 stale service) is ASYNC because
 * the frozen W3 whitelist row is one `git hash-object -- <path>` spawn per
 * closure file (async child process). The domain's eight-step chain is
 * pure-synchronous and accepts a synchronous `ClosureBlobCapturer` — so
 * the tool face needs a synchronous capturer, and this module is it.
 *
 * ## The equivalence (documented + machine-checked)
 *
 * A git blob OID is, by definition, `sha1("blob " + byteLength + "\0" +
 * bytes)`. For working-copy content WITHOUT a clean filter (the `.research`
 * tree is plain text; a default repo has no `.gitattributes` filters — and
 * `git hash-object` does not apply clean filters either, which is exactly
 * the WP-3.2 「hash-object 对 working copy 内容计算」 premise), the
 * content-addressed OID below is BYTE-IDENTICAL to the W3 `git hash-object`
 * output. `tests/wiring/content-hash-capture.test.ts` pins this against a
 * REAL temporary git repo (async git layer + real `hash-object`) — text
 * and binary content — so any future divergence (e.g. someone configuring
 * filters on `.research/`) is a test failure, not a silent base drift.
 *
 * `gitCommit` (the informational W11 HEAD, §3.2 「不参与 stale 判定」) is
 * DELIBERATELY OMITTED here: reading HEAD through the git layer is async,
 * and the frozen record schema leaves `base_git_commit` optional. The
 * stale check (which is where the base is ever compared) recomputes the
 * CURRENT closure through the real git path (WP-3.2), so the omission
 * cannot affect staleness.
 *
 * Missing-file semantics: a closure path that is not a regular file in the
 * working copy is an anomaly on the CREATION face (a consistent canonical
 * plan cannot reference a missing definition file) — fail loud; the
 * domain chain wraps it as `PF_BASE_CAPTURE` (step 3), same as the git
 * path (WP-3.2 `captureGitClosureBase`).
 *
 * Layer rule: this module spawns NOTHING (no `child_process` at all) —
 * there is no git invocation, hence no INV-GIT-6 surface. It is pure
 * content addressing over the working copy, which the git layer's W3
 * would compute identically for unfiltered content.
 *
 * No DSH imports (INV-PERM-5).
 */

import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { ClosureBlobBase, ClosureBlobCapturer } from '../../domain/planfork/index.js'

/** The git blob header (`git hash-object` / `git-write-tree` definition). */
const BLOB_HEADER = 'blob '

/**
 * The git blob OID of a buffer: `sha1("blob <len>\0" + bytes)` — the exact
 * content addressing git uses for blobs (no filter applied; see the module
 * header for the equivalence argument + the machine check in
 * tests/wiring/content-hash-capture.test.ts).
 */
export function gitBlobOid(bytes: Uint8Array): string {
  const digest = createHash('sha1')
  digest.update(BLOB_HEADER)
  digest.update(String(bytes.length))
  digest.update('\0')
  digest.update(bytes)
  return digest.digest('hex')
}

/**
 * A synchronous `ClosureBlobCapturer` over the working copy: every closure
 * path must be a regular file under `researchRoot`; the OID is the git
 * blob OID of its bytes. Throws (any `Error`) on a missing/non-regular
 * path or an unreadable file — the §4 chain step 3 wraps the throw as
 * `PF_BASE_CAPTURE`.
 *
 * @param researchRoot - the ABSOLUTE `.research` directory (closure paths
 *  are `.research`-relative, the same basis the W3 capture uses via
 *  `researchDir`).
 */
export function makeContentHashCapturer(researchRoot: string): ClosureBlobCapturer {
  return {
    capture(wsDir: string, closure: readonly string[]): ClosureBlobBase {
      const objects: { readonly path: string; readonly git_blob_oid: string }[] = []
      for (const rel of closure) {
        const abs = join(researchRoot, rel)
        let st
        try {
          st = statSync(abs)
        } catch (cause) {
          throw new Error(
            `closure file missing from working copy: ${rel} (wsDir ${wsDir}) — ` +
              `a consistent canonical plan cannot reference a nonexistent definition file: ` +
              `${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
        if (!st.isFile()) {
          throw new Error(
            `closure path is not a regular file: ${rel} (wsDir ${wsDir}) — a consistent ` +
              'canonical plan cannot reference a non-file definition',
          )
        }
        let bytes: Buffer
        try {
          bytes = readFileSync(abs)
        } catch (cause) {
          throw new Error(
            `closure file unreadable: ${rel} (wsDir ${wsDir}): ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
        objects.push({ path: rel, git_blob_oid: gitBlobOid(bytes) })
      }
      // gitCommit intentionally ABSENT (informational only, §3.2; the
      // synchronous tool face cannot run the async W11 HEAD read — the
      // frozen record schema leaves base_git_commit optional).
      return { objects }
    },
  }
}
