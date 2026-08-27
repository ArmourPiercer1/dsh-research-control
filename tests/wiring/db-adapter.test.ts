/**
 * V2 修复（纵深防御）— the `adaptDatabaseSync` CLOSED-CONNECTION guard.
 *
 * The re-init bug class（the user-visible 「database is not open」）: a
 * stale reference holding the wiring's second connection AFTER
 * `#reinitResearchPlane` closed it executes statements on a DEAD handle
 * — node:sqlite raises the raw C-level 「database is not open」 far from
 * the cause. The guard pre-checks `DatabaseSync.isOpen` on EVERY
 * operation and fails loud with the structured, ACTIONABLE
 * `WIRING_CLOSED` error instead（cause + remedy — never a driver
 * internal）. The primary fix is the command channel's live
 * `() => this.#wiring` re-resolution（see
 * tests/discovery/host-commands-reinit.test.ts）; this guard is the
 * safety net for every OTHER stale-reference path（the 11 tools'
 * documented T3.x boundary included）.
 *
 * Style: the tests/wiring real-artifact discipline — a REAL temp-file
 * `DatabaseSync` handle, NO mocks.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { adaptDatabaseSync } from '../../src/host/service/wiring/db-adapter.js'
import { HostWiringError } from '../../src/host/service/wiring/types.js'

/* ------------------------------------------------------------------ *
 * Temp plumbing（tracked roots, afterAll sweep）
 * ------------------------------------------------------------------ */

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** Assert `fn` throws the structured `WIRING_CLOSED` for `op`（and NOT
 * the raw driver text）. */
function expectClosed(fn: () => unknown, op: string): void {
  try {
    fn()
  } catch (cause) {
    expect(cause).toBeInstanceOf(HostWiringError)
    const error = cause as HostWiringError
    expect(error.code).toBe('WIRING_CLOSED')
    expect(error.message).toContain(`closed before ${op}`)
    expect(error.message).not.toContain('database is not open')
    return
  }
  expect.unreachable(`a closed-handle ${op} must throw WIRING_CLOSED`)
}

/* ------------------------------------------------------------------ *
 * The matrix
 * ------------------------------------------------------------------ */

describe('adaptDatabaseSync WIRING_CLOSED guard（closed-handle 纵深防御）', () => {
  it('open DB: 全部 5 个操作成功（守卫对正常路径透明）', () => {
    const root = makeTemp('db-adapter-open-')
    const db = new DatabaseSync(join(root, 'w.sqlite'))
    const port = adaptDatabaseSync(db)
    port.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    expect(port.run('INSERT INTO t (v) VALUES (?)', 'a')).toBe(1)
    expect(port.get('SELECT v FROM t WHERE id = ?', 1)).toEqual({ v: 'a' })
    expect(port.all('SELECT * FROM t')).toEqual([{ id: 1, v: 'a' }])
    port.transaction(() => {
      port.run('INSERT INTO t (v) VALUES (?)', 'b')
    })
    expect(port.all('SELECT v FROM t ORDER BY id')).toEqual([{ v: 'a' }, { v: 'b' }])
    db.close()
  })

  it('closed DB: 5 个操作全部抛出结构化 WIRING_CLOSED（无裸驱动文本）', () => {
    const root = makeTemp('db-adapter-closed-')
    const db = new DatabaseSync(join(root, 'w.sqlite'))
    const port = adaptDatabaseSync(db)
    port.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.close()

    expectClosed(() => port.exec('CREATE TABLE x (id INTEGER)'), 'exec')
    expectClosed(() => port.run('INSERT INTO t (v) VALUES (?)', 'a'), 'run')
    expectClosed(() => port.get('SELECT * FROM t WHERE id = ?', 1), 'get')
    expectClosed(() => port.all('SELECT * FROM t'), 'all')
    expectClosed(() => port.transaction(() => port.run('INSERT INTO t (v) VALUES (?)', 'a')), 'BEGIN IMMEDIATE')
  })

  it('closed DB: 消息可操作（原因 + 补救）— 用户看到为什么与怎么办', () => {
    const root = makeTemp('db-adapter-msg-')
    const db = new DatabaseSync(join(root, 'w.sqlite'))
    const port = adaptDatabaseSync(db)
    db.close()
    expect(() => {
      port.all('SELECT * FROM t ORDER BY id')
    }).toThrow(HostWiringError)
    try {
      port.all('SELECT * FROM t ORDER BY id')
    } catch (cause) {
      const error = cause as HostWiringError
      expect(error.name).toBe('HostWiringError')
      expect(error.message).toContain('the wiring second connection was closed before all')
      expect(error.message).toContain('re-initialized or torn down')
      expect(error.message).toContain('a live console re-resolves the wiring on its next call')
      expect(error.message).toContain('reload the console if this error persists')
      expect(error.message).toContain('(statement: SELECT * FROM t ORDER BY id)')
    }
  })
})
