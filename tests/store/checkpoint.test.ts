/**
 * WP-2.1 — TC-DB-003 (DB half): 「checkpoint 中断：步骤 3/4 间 kill ->
 * 仓库仍合法（最坏 staged 残留），无损坏」 — at the operational-store
 * layer this means: a HARD PROCESS DEATH (SIGKILL) MID-TRANSACTION leaves
 * the SQLite file recoverable: WAL recovery rolls back the uncommitted
 * transaction, the DB reopens cleanly, the pre-transaction state is intact
 * (no partial event), and appending continues. INV-DB-3: the store never
 * writes outside its own file, so `.research/` is byte-identical.
 *
 * Method: a real child node process opens the SAME file, begins a
 * transaction, inserts a row, signals readiness (flag file), then kills
 * ITSELF with SIGKILL without closing the handle (no rollback runs — the
 * uncommitted WAL frame stays on disk). The parent then reopens through
 * the store's own openDatabase (quick_check + WAL recovery) and audits.
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/host/persistence/store/index.js'
import { dbPath, makeEvent, makeTempDir } from './helpers.js'

const FLAG_TIMEOUT_MS = 15_000

function waitForFlag(flag: string, deadline: number): void {
  while (!existsSync(flag)) {
    if (Date.now() > deadline) {
      throw new Error('child never signalled readiness (flag missing)')
    }
    // synchronous wait: the parent must not progress until the kill point
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
}

describe('TC-DB-003 (DB half): SIGKILL mid-transaction → clean WAL recovery', () => {
  it('a killed append leaves NO partial event; the DB reopens and appends continue', async () => {
    const root = makeTempDir('wp21-tcdb003-')
    const marker = join(root, '.research', 'marker.txt')
    mkdirSync(join(root, '.research'), { recursive: true })
    writeFileSync(marker, 'declarative truth — must survive the crash')
    const markerBefore = readFileSync(marker)

    const path = dbPath(root)
    const first = openDatabase(path)
    first.appendEvents([makeEvent({ eventId: 'H-1' })]) // committed: WS-1 seq 1
    first.close()

    // child: open raw, BEGIN, INSERT, signal, SIGKILL self (no close)
    const script = join(root, 'kill-child.mjs')
    const flag = join(root, 'ready.flag')
    writeFileSync(
      script,
      [
        `import { DatabaseSync } from 'node:sqlite'`,
        `import { writeFileSync } from 'node:fs'`,
        `const [dbFile, flagFile] = process.argv.slice(2)`,
        `const d = new DatabaseSync(dbFile)`,
        `d.exec('PRAGMA busy_timeout = 5000')`,
        `d.exec('BEGIN')`,
        `d.exec("INSERT INTO history_event (event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, source, payload) VALUES ('H-999', 'WS-1', 99, 'RUN_STARTED', 1, 1, 1, '{\\"kind\\":\\"PLUGIN\\"}', NULL, '{}')")`,
        `writeFileSync(flagFile, 'ready')`,
        `setTimeout(() => process.kill(process.pid, 'SIGKILL'), 250)`,
        ``,
      ].join('\n'),
    )

    const child = spawn(process.execPath, [script, path, flag], { stdio: 'ignore' })
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on('exit', (code, signal) => resolve({ code, signal }))
      },
    )
    // the flag is written BEFORE the kill — it must exist after the death
    expect(existsSync(flag)).toBe(true)
    // it really died hard (no graceful close → no library rollback)
    expect(exit.signal).toBe('SIGKILL')
    expect(exit.code).toBeNull()

    // parent reopens THROUGH THE STORE (quick_check + WAL recovery)
    const reopened = openDatabase(path)
    // the killed row is GONE (rolled back by WAL recovery)
    expect(reopened.getEvent('WS-1', 99)).toBeNull()
    // pre-transaction state intact
    expect(reopened.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    expect(reopened.listRange('WS-1', 1).map((e) => e.eventId)).toEqual(['H-1'])
    // appending continues seamlessly from the committed state
    const r = reopened.appendEvents([makeEvent({ eventId: 'H-2' })])
    expect(r.events[0].eventSeq).toBe(2)
    reopened.close()

    // INV-DB-3: the declarative 真源 never saw the crash
    expect(readFileSync(marker)).toEqual(markerBefore)
    // no lock residue: a final reopen is clean
    const third = openDatabase(path)
    expect(third.getEvent('WS-1', 2)?.eventId).toBe('H-2')
    third.close()
  })

  it('a killed process cannot corrupt the file for the next open (quick_check passes)', async () => {
    const root = makeTempDir('wp21-tcdb003q-')
    const path = dbPath(root)
    const first = openDatabase(path)
    first.appendEvents([makeEvent({ eventId: 'H-1' })])
    first.close()
    // a second append, killed the same way
    const script = join(root, 'kill-child.mjs')
    const flag = join(root, 'ready.flag')
    writeFileSync(
      script,
      [
        `import { DatabaseSync } from 'node:sqlite'`,
        `import { writeFileSync } from 'node:fs'`,
        `const [dbFile, flagFile] = process.argv.slice(2)`,
        `const d = new DatabaseSync(dbFile)`,
        `d.exec('BEGIN')`,
        `d.exec("INSERT INTO history_event (event_id, owner_workstream_id, event_seq, event_type, schema_version, occurred_at, recorded_at, actor, source, payload) VALUES ('H-500', 'WS-1', 500, 'RUN_STARTED', 1, 1, 1, '{\\"kind\\":\\"PLUGIN\\"}', NULL, '{}')")`,
        `writeFileSync(flagFile, 'ready')`,
        `setTimeout(() => process.kill(process.pid, 'SIGKILL'), 250)`,
        ``,
      ].join('\n'),
    )
    const child = spawn(process.execPath, [script, path, flag], { stdio: 'ignore' })
    // the flag is written BEFORE the kill — wait for it, then for the death
    waitForFlag(flag, Date.now() + FLAG_TIMEOUT_MS)
    await new Promise<void>((resolve) => child.on('exit', () => resolve()))
    // the file (main DB) is the only durable artifact; it must be intact
    expect(statSync(path).size).toBeGreaterThan(0)
    const reopened = openDatabase(path)
    expect(reopened.getEvent('WS-1', 500)).toBeNull()
    expect(reopened.getEvent('WS-1', 1)?.eventId).toBe('H-1')
    reopened.close()
  })
})
