/**
 * WP-3.6 (RR-011 (d)) — the W3-equivalence of the synchronous
 * content-hash capturer (the agent tool face's closure capture).
 *
 * The equivalence pinned HERE (machine-checked, real git): for
 * unfiltered working-copy content, `gitBlobOid(bytes)` (the pure
 * `sha1("blob <len>\0" + bytes)`) is BYTE-IDENTICAL to the real
 * `git hash-object -- <path>` output — text AND binary content — and
 * `makeContentHashCapturer` captures the closure of a real `.research`
 * tree with exactly those OIDs. Any future divergence (clean filters on
 * `.research/`, a header bug) is a test failure, not a silent base drift
 * between the tool face (sync) and the stale service (real git).
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  gitBlobOid,
  makeContentHashCapturer,
} from '../../src/host/service/wiring/index.js'
import { initGitRepo, gitBlobOidOf, makeTempDir, writeResearchTree } from './helpers.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

describe('content-hash capture: W3 equivalence (real git hash-object)', () => {
  it('gitBlobOid == real `git hash-object` for TEXT content (incl. CRLF/unicode/empty)', () => {
    const repo = tmp('wp36-oid-')
    initGitRepo(repo, false)
    const cases: ReadonlyArray<[string, string]> = [
      ['plain.txt', 'workstream: WS-1\nordered_items: [T-1]\n'],
      ['crlf.txt', 'line one\r\nline two\r\n'],
      ['unicode.txt', 'title: 标定数据采集方案对比\n误差目标 <2px\n'],
      ['empty.txt', ''],
      ['trailing-newline.txt', 'x\n\n\n'],
    ]
    for (const [name, content] of cases) {
      writeFileSync(join(repo, name), content)
      expect(gitBlobOid(new TextEncoder().encode(content)), `OID mismatch for ${name}`).toBe(gitBlobOidOf(repo, name))
    }
  })

  it('gitBlobOid == real `git hash-object` for BINARY content (all 256 byte values, no newline endings)', () => {
    const repo = tmp('wp36-oidb-')
    initGitRepo(repo, false)
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    writeFileSync(join(repo, 'binary.bin'), bytes)
    // Buffer view of the same bytes (the capturer reads Buffers):
    const readBack = readFileSync(join(repo, 'binary.bin'))
    expect(gitBlobOid(readBack)).toBe(gitBlobOidOf(repo, 'binary.bin'))
    expect(gitBlobOid(bytes)).toBe(gitBlobOidOf(repo, 'binary.bin'))
  })

  it('makeContentHashCapturer: a real .research tree closure captures exactly the git OIDs (and gitCommit is intentionally absent)', () => {
    const repo = makeTempDir('wp36-cap-')
    writeResearchTree(repo)
    initGitRepo(repo)
    const researchRoot = join(repo, '.research')

    const capturer = makeContentHashCapturer(researchRoot)
    const closure = [
      'topics/TPC-1/workstreams/WS-1/plan.yaml',
      'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml',
    ]
    const base = capturer.capture('topics/TPC-1/workstreams/WS-1', closure)
    expect(base.objects).toHaveLength(2)
    for (const obj of base.objects) {
      expect(gitBlobOidOf(repo, `.research/${obj.path}`), `OID mismatch for ${obj.path}`).toBe(obj.git_blob_oid)
    }
    // The sync face omits the informational HEAD (by design — the frozen
    // record schema leaves base_git_commit optional):
    expect(base).not.toHaveProperty('gitCommit')
  })

  it('a missing closure file fails loud (the §4 step-3 anomaly — no silent empty capture)', () => {
    const repo = makeTempDir('wp36-cap2-')
    writeResearchTree(repo)
    const researchRoot = join(repo, '.research')
    const capturer = makeContentHashCapturer(researchRoot)
    expect(() =>
      capturer.capture('topics/TPC-1/workstreams/WS-1', ['topics/TPC-1/workstreams/WS-1/items/tasks/NOPE.yaml']),
    ).toThrow(/missing from working copy/)
  })

  it('a non-regular closure path fails loud', () => {
    const repo = makeTempDir('wp36-cap3-')
    writeResearchTree(repo)
    const researchRoot = join(repo, '.research')
    // A DIRECTORY as the "file" (plan.yaml's parent):
    const capturer = makeContentHashCapturer(researchRoot)
    expect(() => capturer.capture('topics/TPC-1/workstreams/WS-1', ['topics/TPC-1/workstreams/WS-1'])).toThrow(/not a regular file/)
  })
})
