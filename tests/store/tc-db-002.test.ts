/**
 * WP-2.1 — TC-DB-002 (TEST_MATRIX §3.5): 「DB 损坏恢复：损坏 sqlite ->
 * 明确报错；.research/+Git 完好；operational 数据不可恢复（派生列重建
 * 能力由 TC-HIST-006 单独保证，前提为事件表完好）」.
 *
 * DB 半边 (this WP): a corrupted research.sqlite is refused at open with
 * a structured, specific error (STORE_CORRUPT / STORE_OPEN) — never a raw
 * driver exception, never a repair attempt. INV-DB-3 half: the store only
 * ever writes its OWN file, so `.research/` and the Git repo remain
 * byte-identical after the corruption + failed open (asserted by hash).
 *
 * Operational data is NOT recovered here (TC-HIST-006 owns the rebuild
 * capability; its precondition — an intact event table — is precisely what
 * corruption breaks).
 */
import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  openDatabase,
  StoreCorruptError,
  StoreError,
  StoreOpenError,
} from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

/** sha256 of every file under `dir` (recursive) → sorted "hash  relpath". */
function treeHash(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const st = lstatSync(p)
      if (st.isDirectory()) walk(p)
      else if (!st.isSymbolicLink()) {
        const h = createHash('sha256').update(readFileSync(p)).digest('hex')
        out.push(`${h}  ${p.slice(dir.length + 1)}`)
      }
    }
  }
  walk(dir)
  return out
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

/** A minimal declarative 真源 tree + a real git repo around it. */
function makeResearchRepo(root: string): void {
  const research = join(root, '.research')
  const wsDir = join(research, 'topics', 'TPC-1', 'workstreams', 'WS-1')
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(research, 'schema-version'), '1\n')
  writeFileSync(
    join(research, 'project.yaml'),
    'id: PRJ-1\ntitle: Test Project\ncreated_at: "2026-08-22T00:00:00Z"\n',
  )
  writeFileSync(
    join(research, 'topics', 'TPC-1', 'topic.yaml'),
    'id: TPC-1\nproject_id: PRJ-1\ntitle: Topic\ndescription: d\ncreated_at: "2026-08-22T00:00:00Z"\n',
  )
  writeFileSync(
    join(wsDir, 'workstream.yaml'),
    'id: WS-1\ntopic_id: TPC-1\ntitle: WS\nlifecycle: PLANNED\ncreated_at: "2026-08-22T00:00:00Z"\n',
  )
  // 「DB 文件本身永不进 Git」(DOMAIN_SCHEMA §15 通则) — the repo ignores it
  writeFileSync(join(root, '.gitignore'), 'research.sqlite\nresearch.sqlite-wal\nresearch.sqlite-shm\n')
  execFileSync('git', ['init', '-q', root], { stdio: 'pipe' })
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'baseline .research tree')
}

function assertDeclarativeIntact(root: string, before: string[]): void {
  // .research/ byte-identical
  expect(treeHash(join(root, '.research'))).toEqual(before)
  // git repo healthy and clean (no corruption, no stray modifications)
  expect(git(root, 'status', '--porcelain')).toBe('')
  git(root, 'fsck', '--full') // throws on non-zero exit
}

describe('TC-DB-002: corrupted sqlite → structured error, declarative 真源 intact', () => {
  it('garbage bytes over the DB file → STORE_CORRUPT at open; .research/ + Git untouched', () => {
    const root = makeTempDir('wp21-tcdb002-')
    makeResearchRepo(root)
    const researchBefore = treeHash(join(root, '.research'))

    const store = openDatabase(dbPath(root))
    store.appendEvents([
      makeEvent({ eventId: 'H-1' }),
      makeEvent({ eventId: 'H-2', ownerWorkstreamId: 'WS-2' }),
    ])
    store.meta().bumpCounter('id-counter:PRJ-1:TASK', 2)
    store.close()

    // corrupt: overwrite with non-sqlite bytes
    writeFileSync(dbPath(root), 'CERTAINLY NOT SQLITE. '.repeat(64))

    let err: unknown
    try {
      openDatabase(dbPath(root))
    } catch (e) {
      err = e
    }
    // 明确报错 — structured, specific, not a raw exception
    expect(err).toBeInstanceOf(StoreCorruptError)
    expect(err).toBeInstanceOf(StoreError)
    expect((err as StoreError).code).toBe('STORE_CORRUPT')
    expect((err as StoreError).message.length).toBeGreaterThan(10)

    assertDeclarativeIntact(root, researchBefore)
  })

  it('a truncated DB file → structured error; .research/ + Git untouched', () => {
    const root = makeTempDir('wp21-tcdb002t-')
    makeResearchRepo(root)
    const researchBefore = treeHash(join(root, '.research'))

    const store = openDatabase(dbPath(root))
    store.appendEvents([makeEvent({ eventId: 'H-1' }), makeEvent({ eventId: 'H-2' })])
    store.close()

    const bytes = readFileSync(dbPath(root))
    writeFileSync(dbPath(root), bytes.subarray(0, Math.floor(bytes.length * 0.4)))

    let err: unknown
    try {
      openDatabase(dbPath(root))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreError)
    expect((err as StoreError).code).toBe('STORE_CORRUPT')
    assertDeclarativeIntact(root, researchBefore)
  })

  it('operational data is NOT silently recovered: the open simply fails (no partial read API)', () => {
    const root = makeTempDir('wp21-tcdb002r-')
    makeResearchRepo(root)
    const store = openDatabase(dbPath(root))
    store.appendEvents([makeEvent({ eventId: 'H-1' })])
    store.close()
    writeFileSync(dbPath(root), 'corruption here'.repeat(32))
    expect(() => openDatabase(dbPath(root))).toThrowError(StoreCorruptError)
    // the store exposes no "open anyway / salvage" path — the only handles
    // are the open ones; there is nothing left to read from here
  })

  it('a path pointing at a directory → STORE_OPEN (bad file, structured)', () => {
    const root = makeTempDir('wp21-tcdb002d-')
    makeResearchRepo(root)
    const researchBefore = treeHash(join(root, '.research'))
    mkdirSync(dbPath(root))
    let err: unknown
    try {
      openDatabase(dbPath(root))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(StoreOpenError)
    assertDeclarativeIntact(root, researchBefore)
  })

  it('a healthy DB next to a healthy .research/ still opens (control)', () => {
    const root = makeTempDir('wp21-tcdb002c-')
    makeResearchRepo(root)
    const researchBefore = treeHash(join(root, '.research'))
    const store = openDatabase(dbPath(root))
    store.appendEvents([makeEvent({ eventId: 'H-1' })])
    store.close()
    const again = openDatabase(dbPath(root))
    expect(again.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    again.close()
    // the data dir itself is owner-only (0o700) and the DB 0o600 (DSH_ADAPTER §9)
    expect(statSync(dbPath(root)).mode & 0o777).toBe(0o600)
    assertDeclarativeIntact(root, researchBefore)
  })
})
