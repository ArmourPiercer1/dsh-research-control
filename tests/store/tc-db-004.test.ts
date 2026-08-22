/**
 * WP-2.10 — TC-DB-004 (TEST_MATRIX §3.5 L201) + ARCHITECTURE §5.11 INV-DB-1:
 * 「无 secrets：DB 内无 key/token 列；写入含 secret 值的调用被拒绝」.
 *
 * Carries supplement-list A-1 (G2 r1 reviewer-inv-attacker) in full. The
 * L201 口径, per INV-DB-1 (「operational DB 不存 API key/secrets；模型/
 * provider secrets 由 DSH credential system 负责」), is asserted as the
 * absence of CREDENTIAL-SHAPED storage columns/keys — NOT a value-content
 * review:
 *
 *  (i)   All `CREATE TABLE` targets in `src/` (the 3 store tables + the 2
 *        runbinding tables; collected by a source-level DDL scan below AND
 *        audited live via `PRAGMA table_info`): column names carry no
 *        /key|token|secret|credential|password/i shape, and every table's
 *        column set is pinned EXACTLY (order as declared) so a future
 *        column — of any shape — cannot sneak in silently.
 *  (ii)  The frozen input type faces (HistoryEventInput / RunRecord /
 *        DiscoveredSessionRecord / SessionPointer / meta value) carry no
 *        credential-shaped fields — compile-time key-set pinning (a new
 *        field breaks the build) + runtime object-key scan over
 *        fully-populated instances (incl. the real `encodePointer` JSON).
 *  (iii) Full-loop scan: a runbinding + sessionlink round trip on ONE
 *        research.sqlite (both services' own test harnesses) with FORGED
 *        `sk-…`/`Bearer …` probes injected through the LEGITIMATE session
 *        summary field path (the session title → `discovered_session.
 *        summary`, §6.2 明认的摘要位). After the loop: every table's every
 *        TEXT column is scanned — (a) no credential-shaped column names
 *        (one pinned exception, below), (b) no credential-shaped JSON key
 *        anywhere in any structured TEXT value, (c) no credential-shaped
 *        meta KV key identifier, and (d) the probes, once inside the
 *        legitimate summary field, exist NOWHERE ELSE in the DB (the
 *        summary cell is the only container).
 *  (iv)  The 「写入含 secret 值的调用被拒绝」 half: V1 HAS NO write face that
 *        receives credentials — no tools surface (`src/host/tools/` is
 *        empty), no RPC accepting credentials (the typert artifact's
 *        `invocations` is exactly `['ping']`), no secret-shaped parameter
 *        on any store/service method (structural assertion below + the
 *        (ii) type-face pinning is the type-level proof). 口径留痕 (A 组 1
 *        原文): 「无此面 + 扫描兜底」— there is no rejection path to fake;
 *        the guard is the absence of the surface itself plus the (iii)
 *        scan net that would catch any future value landing off-surface.
 *
 * The single pinned exception to (a): the `meta` table's `key` column —
 * the KV PRIMARY KEY mandated by §15 L628 (「meta PK key; ID counters +
 * DB schema version」). Its "key" is the KV lookup identifier (a
 * namespace string such as `id-counter:PRJ-1:RUN` or
 * `sessionlink:pointer:<sessionId>`), not a credential; its values are
 * canonical decimal counter strings or the SessionPointer JSON whose key
 * set is whitelisted in (iii)(b). The exception is pinned to EXACTLY this
 * one column: any other credential-shaped column anywhere fails the test.
 *
 * Compatibility: pure `tests/**` addition — zero src/ change, zero frozen-
 * doc change, zero behavior change (G2 r1 补充清单 A-1 兼容性论证).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  type ActorRefJson,
  type AppendEventsOptions,
  type DerivedStatePatch,
  type HistoryEventInput,
  type HistoryEventRecord,
  type ResearchStore,
  type SourceRefJson,
} from '../../src/host/persistence/store/index.js'
import {
  openRunBindingDatabase,
  DISCOVERED_SESSION_TABLE,
  RUN_TABLE,
  type BindParams,
  type DiscoveredSessionRecord,
  type RegisterRunParams,
  type RunRecord,
} from '../../src/host/service/runbinding/index.js'
import {
  encodePointer,
  SessionLinkService,
  type SessionPointer,
  type WireBinding,
} from '../../src/host/service/sessionlink/index.js'
import {
  WORKSTREAMS,
  FakeSessionAdapter as SessionLinkFakeAdapter,
} from '../sessionlink/fixtures.js'
import { USER, makeHarness, makeSession } from '../runbinding/helpers.js'
import { dbPath, makeTempDir } from './helpers.js'

/* ------------------------------------------------------------------ *
 * The invariant pattern + the pinned exception
 * ------------------------------------------------------------------ */

/** The credential shape (L201 / A-1): /key|token|secret|credential|password/i. */
const CREDENTIAL_SHAPE = /key|token|secret|credential|password/i

/**
 * The single documented exception to the column-name scan (see header):
 * the §15 L628 `meta` KV primary key. Pinned to exactly this (table,
 * column) pair — a second match anywhere is a failure.
 */
const PINNED_COLUMN_EXCEPTIONS: ReadonlyMap<string, string[]> = new Map([
  ['meta', ['key']],
])

/* ------------------------------------------------------------------ *
 * (i) Source-level DDL inventory + live column-set pinning
 * ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = resolve(HERE, '..', '..', 'src')

/** Recursively collect every `.ts` file under `dir`. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...collectTsFiles(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

/**
 * Extract every `CREATE TABLE` target name from `src/`. `${IDENT}`
 * references are resolved against the runbinding schema's exported
 * constants (the only template-form targets in the tree).
 */
function scanSourceDdlTargets(): string[] {
  const templateResolve: Record<string, string> = {
    RUN_TABLE,
    DISCOVERED_SESSION_TABLE,
  }
  const targets = new Set<string>()
  // The trailing `\s*\(` distinguishes REAL DDL (the column list opens on
  // the name) from prose mentions (e.g. the runbinding schema header's
  // 「`CREATE TABLE IF NOT EXISTS` makes (re)open idempotent」).
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*|\$\{([A-Za-z_$][\w$]*)\})\s*\(/gi
  for (const file of collectTsFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) {
      const direct = m[1]
      const viaTemplate = m[2]
      const name =
        viaTemplate === undefined
          ? direct
          : templateResolve[viaTemplate]
      if (name === undefined) {
        throw new Error(`unresolvable CREATE TABLE target \${${viaTemplate}} in ${file} — update scanSourceDdlTargets`)
      }
      targets.add(name)
    }
  }
  return [...targets].sort()
}

/** All five §15 tables this plugin creates (3 store + 2 runbinding), sorted. */
const ALL_TABLES = ['derived_state', 'discovered_session', 'history_event', 'meta', 'run']

/**
 * The EXACT column set of every table (order as declared in the DDL) —
 * pinning prevents a future column from appearing silently, of ANY shape.
 */
const PINNED_COLUMNS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'history_event',
    [
      'event_id',
      'owner_workstream_id',
      'event_seq',
      'event_type',
      'schema_version',
      'occurred_at',
      'recorded_at',
      'actor',
      'source',
      'payload',
      'payload_run_id',
      'payload_task_id',
    ],
  ],
  ['derived_state', ['object_kind', 'object_id', 'state']],
  ['meta', ['key', 'value']],
  [
    'run',
    [
      'run_id',
      'workstream_id',
      'task_id',
      'dsh_session_id',
      'status',
      'intent',
      'initiated_by',
      'started_at',
      'ended_at',
      'summary',
      'last_checkpoint_at',
      'last_checkpoint_note',
    ],
  ],
  [
    'discovered_session',
    [
      'id',
      'dsh_session_id',
      'workspace_root',
      'discovered_at',
      'state',
      'bound_run_id',
      'summary',
    ],
  ],
])

// NOTE: `table_xinfo` (NOT `table_info`) — it also reports the WP-2.9
// VIRTUAL generated columns (hidden=2), the same face the store's own
// structure gate (STORE_SCHEMA_STALE) audits.
function tableColumns(raw: DatabaseSync, table: string): string[] {
  const rows = raw.prepare(`PRAGMA table_xinfo(${table})`).all() as { name: string }[]
  return rows.map((r) => r.name)
}

function textColumns(raw: DatabaseSync, table: string): string[] {
  const rows = raw.prepare(`PRAGMA table_xinfo(${table})`).all() as { name: string; type: string }[]
  return rows.filter((r) => /TEXT/i.test(r.type)).map((r) => r.name)
}

describe('TC-DB-004 (i): no credential-shaped columns; exact column sets pinned', () => {
  it('src contains EXACTLY the five known CREATE TABLE targets (no new table can land unreviewed)', () => {
    expect(scanSourceDdlTargets()).toEqual(ALL_TABLES)
  })

  it('the live DB exposes exactly the five tables, each with its pinned column set', () => {
    const dir = makeTempDir('wp210-tcdb004-')
    const db = openRunBindingDatabase(dbPath(dir))
    try {
      const raw = new DatabaseSync(db.store.path)
      try {
        const tables = (
          raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as {
            name: string
          }[]
        )
          .map((r) => r.name)
          .sort()
        expect(tables).toEqual(ALL_TABLES)
        for (const table of ALL_TABLES) {
          expect(tableColumns(raw, table), `column set of ${table}`).toEqual([...PINNED_COLUMNS.get(table)!])
        }
      } finally {
        raw.close()
      }
    } finally {
      db.tables.close()
      db.store.close()
    }
  })

  it('no column name carries a credential shape — the one pinned §15 exception (meta.key) is the ONLY match', () => {
    const dir = makeTempDir('wp210-tcdb004c-')
    const db = openRunBindingDatabase(dbPath(dir))
    try {
      const raw = new DatabaseSync(db.store.path)
      try {
        const matches: string[] = []
        for (const table of ALL_TABLES) {
          for (const column of tableColumns(raw, table)) {
            if (!CREDENTIAL_SHAPE.test(column)) continue
            const allowed = PINNED_COLUMN_EXCEPTIONS.get(table) ?? []
            if (!allowed.includes(column)) matches.push(`${table}.${column}`)
          }
        }
        // INV-DB-1 / L201: no credential-shaped storage column.
        expect(matches).toEqual([])
        // …and the exception set itself is exactly the pinned one (a
        // silently DROPPED exception would fail here — the pin is the
        // document of the reading, not a silent skip).
        const actualExceptions: string[] = []
        for (const table of ALL_TABLES) {
          for (const column of tableColumns(raw, table)) {
            if (CREDENTIAL_SHAPE.test(column)) actualExceptions.push(`${table}.${column}`)
          }
        }
        expect(actualExceptions.sort()).toEqual(['meta.key'])
      } finally {
        raw.close()
      }
    } finally {
      db.tables.close()
      db.store.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * (ii) Frozen input type faces: no credential-shaped fields
 * ------------------------------------------------------------------ */

// ---- compile-time key-set pinning (the type-level proof) -------------
// Each frozen input face carries EXACTLY the pinned keys: a future
// credential-shaped field (apiKey / token / …) added to ANY of these
// types breaks the build here. The runtime key scan below is the value-
// side mirror (a field added WITHOUT a type update, or a JSON carrier
// key, is caught at runtime instead).

type Expect<T extends true> = T
type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false

type _PinHistoryEventInput = Expect<
  Equal<
    keyof HistoryEventInput,
    'eventId' | 'ownerWorkstreamId' | 'eventType' | 'schemaVersion' | 'occurredAt' | 'actor' | 'source' | 'payload'
  >
>
type _PinHistoryEventRecord = Expect<
  Equal<
    keyof HistoryEventRecord,
    | 'eventId'
    | 'ownerWorkstreamId'
    | 'eventType'
    | 'schemaVersion'
    | 'occurredAt'
    | 'actor'
    | 'source'
    | 'payload'
    | 'eventSeq'
    | 'recordedAt'
  >
>
type _PinActorRefJson = Expect<Equal<keyof ActorRefJson, 'kind' | 'user_id' | 'run_id' | 'session_id' | 'label'>>
type _PinSourceRefJson = Expect<
  Equal<keyof SourceRefJson, 'kind' | 'session_id' | 'path' | 'commit_oid' | 'interaction_id' | 'note'>
>
type _PinRunRecord = Expect<
  Equal<
    keyof RunRecord,
    | 'id'
    | 'workstream_id'
    | 'task_id'
    | 'dsh_session_id'
    | 'status'
    | 'intent'
    | 'initiated_by'
    | 'started_at'
    | 'ended_at'
    | 'summary'
    | 'last_checkpoint_at'
    | 'last_checkpoint_note'
  >
>
type _PinDiscoveredSessionRecord = Expect<
  Equal<
    keyof DiscoveredSessionRecord,
    'id' | 'dsh_session_id' | 'workspace_root' | 'discovered_at' | 'state' | 'bound_run_id' | 'summary'
  >
>
type _PinSessionPointer = Expect<
  Equal<keyof SessionPointer, 'workstreamId' | 'intent' | 'taskId' | 'lastSeq' | 'runId' | 'runStartedAt'>
>
type _PinBindParams = Expect<Equal<keyof BindParams, 'workstreamId' | 'taskId' | 'intent'>>
type _PinRegisterRunParams = Expect<Equal<keyof RegisterRunParams, 'workstreamId' | 'taskId' | 'dshSessionId' | 'intent'>>
type _PinWireBinding = Expect<Equal<keyof WireBinding, 'workstreamId' | 'intent' | 'taskId'>>
type _PinAppendEventsOptions = Expect<Equal<keyof AppendEventsOptions, 'derivedState' | 'validate' | 'realize'>>
type _PinDerivedStatePatch = Expect<Equal<keyof DerivedStatePatch, 'objectKind' | 'objectId' | 'state'>>

/** Recursively collect every object key under `value` (JSON carriers). */
function collectKeys(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      collectKeys(v, out)
    }
  }
}

/** Assert no key of `value` (deep) carries a credential shape. */
function expectNoCredentialKeys(label: string, value: unknown): void {
  const keys: string[] = []
  collectKeys(value, keys)
  expect(keys.filter((k) => CREDENTIAL_SHAPE.test(k)), `${label}: credential-shaped key(s) present`).toEqual([])
}

describe('TC-DB-004 (ii): frozen input type faces carry no credential-shaped fields', () => {
  it('fully-populated HistoryEventInput (incl. full actor/source/payload) — no credential-shaped key', () => {
    const input: HistoryEventInput = {
      eventId: 'H-1',
      ownerWorkstreamId: 'WS-1',
      eventType: 'RUN_STARTED',
      schemaVersion: 1,
      occurredAt: 1_700_000_000_000,
      actor: { kind: 'USER', user_id: 'u-1', run_id: 'R-1', session_id: 'sess-1', label: 'full' },
      source: {
        kind: 'DSH_SESSION',
        session_id: 'sess-1',
        path: 'a/b',
        commit_oid: 'abc123',
        interaction_id: 'i-1',
        note: 'n',
      },
      payload: { run_id: 'R-1', task_id: 'T-1', dsh_session_id: 'sess-1', intent: 'i', initiated_by: { kind: 'USER' } },
    }
    expectNoCredentialKeys('HistoryEventInput', JSON.parse(JSON.stringify(input)))
  })

  it('fully-populated RunRecord (all 12 keys) — no credential-shaped key', () => {
    const record: RunRecord = {
      id: 'R-1',
      workstream_id: 'WS-1',
      task_id: 'T-1',
      dsh_session_id: 'sess-1',
      status: 'FINISHED',
      intent: 'i',
      initiated_by: { kind: 'USER', user_id: 'u-1', label: 'l' },
      started_at: 1_700_000_000_000,
      ended_at: 1_700_000_001_000,
      summary: 's',
      last_checkpoint_at: 1_700_000_000_500,
      last_checkpoint_note: 'n',
    }
    expectNoCredentialKeys('RunRecord', JSON.parse(JSON.stringify(record)))
  })

  it('fully-populated DiscoveredSessionRecord — no credential-shaped key', () => {
    const ds: DiscoveredSessionRecord = {
      id: 'DS-1',
      dsh_session_id: 'sess-1',
      workspace_root: '/ws',
      discovered_at: 1_700_000_000_000,
      state: 'BOUND',
      bound_run_id: 'R-1',
      summary: 's',
    }
    expectNoCredentialKeys('DiscoveredSessionRecord', JSON.parse(JSON.stringify(ds)))
  })

  it('SessionPointer + the REAL encodePointer JSON (the meta value face) — no credential-shaped key', () => {
    const pointer: SessionPointer = {
      workstreamId: 'WS-1',
      intent: 'i',
      taskId: 'T-1',
      lastSeq: 7,
      runId: 'R-1',
      runStartedAt: 1_700_000_000_000,
    }
    expectNoCredentialKeys('SessionPointer', JSON.parse(JSON.stringify(pointer)))
    // The actual PERSISTED carrier (meta.value for `sessionlink:pointer:*`):
    expectNoCredentialKeys('encodePointer JSON', JSON.parse(encodePointer(pointer)))
    // Counter values are canonical decimal strings (no keys at all):
    expectNoCredentialKeys('meta counter value', JSON.parse('"7"'))
  })

  it('the service operation-parameter faces (BindParams/RegisterRunParams/WireBinding) — no credential-shaped key', () => {
    const bind: BindParams = { workstreamId: 'WS-1', taskId: 'T-1', intent: 'i' }
    const register: RegisterRunParams = { workstreamId: 'WS-1', taskId: 'T-1', dshSessionId: 'sess-1', intent: 'i' }
    const wire: WireBinding = { workstreamId: 'WS-1', intent: 'i', taskId: 'T-1' }
    expectNoCredentialKeys('BindParams', JSON.parse(JSON.stringify(bind)))
    expectNoCredentialKeys('RegisterRunParams', JSON.parse(JSON.stringify(register)))
    expectNoCredentialKeys('WireBinding', JSON.parse(JSON.stringify(wire)))
  })
})

/* ------------------------------------------------------------------ *
 * (iii) Full loop: runbinding + sessionlink on ONE DB, probes injected
 *       through the legitimate session summary field path, then the
 *       whole-DB scan net
 * ------------------------------------------------------------------ */

/** Forged probes (the sensitive shapes L201 names) — injected ONLY via
 *  the session title, the legitimate write surface of the §6.2 summary
 *  field (`discovered_session.summary`). */
const PROBE_SK = 'sk-tcdb4-probe-0001'
const PROBE_BEARER = 'Bearer tcdb4-probe-0002'
const PROBE_TITLE = `probe session (${PROBE_SK} / ${PROBE_BEARER})`

/** One (table, column, value) TEXT cell of the whole DB. */
interface Cell {
  readonly table: string
  readonly column: string
  readonly value: string
}

/** Dump every TEXT cell of the five tables (raw connection — the scan
 *  must see what the disk holds, not the service's projection). */
function dumpTextCells(store: ResearchStore): Cell[] {
  const raw = new DatabaseSync(store.path)
  try {
    const cells: Cell[] = []
    for (const table of ALL_TABLES) {
      for (const column of textColumns(raw, table)) {
        const rows = raw.prepare(`SELECT "${column}" AS v FROM ${table}`).all() as { v: unknown }[]
        for (const row of rows) {
          if (typeof row.v === 'string') cells.push({ table, column, value: row.v })
        }
      }
    }
    return cells
  } finally {
    raw.close()
  }
}

/** Recursively collect every JSON key inside a (possibly nested) document. */
function jsonKeys(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) jsonKeys(item, out)
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k)
      jsonKeys(v, out)
    }
  }
}

describe('TC-DB-004 (iii): full runbinding+sessionlink loop — whole-DB credential-shape scan', () => {
  it('the probes ride the legitimate summary field and exist NOWHERE else; no credential-shaped column/key', () => {
    // ---- the loop (runbinding harness + sessionlink service, ONE DB) --
    const h = makeHarness()
    try {
      // runbinding half: discovery (title = probe injection via the
      // legitimate §6.2 summary path) → user BIND → run → finish.
      const created = h.service.reconcileSessions([
        makeSession({ id: 'sess-tcdb4-rb', cwd: h.rootA, title: PROBE_TITLE }),
      ])
      expect(created).toHaveLength(1)
      const bind = h.service.bindDiscoveredSession(created[0]!.id, { workstreamId: 'WS-1' }, USER)
      h.service.finishRun(bind.run.id, { outcomeSummary: 'clean finish' }, USER)
      // the probe is in the DS summary row — and in NO run field
      expect(h.service.getDiscoveredSession(created[0]!.id)?.summary).toBe(PROBE_TITLE)
      expect(bind.run.summary).toBeUndefined()

      // sessionlink half on the SAME store (the production composition):
      // wire → turn/start → RUN_STARTED, turn/end → RUN_FINISHED.
      const adapter = new SessionLinkFakeAdapter()
      const link = new SessionLinkService({
        store: h.store,
        registry: h.registry,
        adapter,
        ids: h.allocator,
        projectId: 'PRJ-1',
        workstreams: WORKSTREAMS,
        now: h.now,
      })
      link.wireSession('sess-tcdb4-sl', { workstreamId: 'WS-2' })
      const dispose = link.start()
      adapter.emit({ sessionId: 'sess-tcdb4-sl', type: 'turn/start', seq: 1 })
      adapter.emit({ sessionId: 'sess-tcdb4-sl', type: 'turn/end', seq: 2 })
      dispose()

      const events = [...h.store.listRange('WS-1', 1), ...h.store.listRange('WS-2', 1)]
      expect(events.map((e) => e.eventType)).toEqual([
        'RUN_STARTED',
        'RUN_FINISHED',
        'RUN_STARTED',
        'RUN_FINISHED',
      ])

      // ---- the whole-DB scan net --------------------------------------
      const cells = dumpTextCells(h.store)
      expect(cells.length).toBeGreaterThan(0)

      // (a) no credential-shaped column names (the pinned exception is
      // the only possible match — re-asserted on the DATA-LOADED DB).
      const badColumns: string[] = []
      for (const cell of cells) {
        if (CREDENTIAL_SHAPE.test(cell.column)) {
          const allowed = PINNED_COLUMN_EXCEPTIONS.get(cell.table) ?? []
          if (!allowed.includes(cell.column)) badColumns.push(`${cell.table}.${cell.column}`)
        }
      }
      expect([...new Set(badColumns)]).toEqual([])

      // (b) no credential-shaped JSON key in any structured TEXT value
      // (payload / actor / source / initiated_by / state / meta pointer
      // JSON — the key face of every stored document).
      const badJsonKeys: string[] = []
      for (const cell of cells) {
        let parsed: unknown
        try {
          parsed = JSON.parse(cell.value)
        } catch {
          continue // not a JSON document (plain text / number) — keys N/A
        }
        if (typeof parsed !== 'object' || parsed === null) continue
        const keys: string[] = []
        jsonKeys(parsed, keys)
        for (const k of keys) if (CREDENTIAL_SHAPE.test(k)) badJsonKeys.push(`${cell.table}.${cell.column}: ${k}`)
      }
      expect(badJsonKeys).toEqual([])

      // (c) no credential-shaped meta KV key identifier.
      const badMetaKeys: string[] = []
      for (const cell of cells) {
        if (cell.table === 'meta' && cell.column === 'key' && CREDENTIAL_SHAPE.test(cell.value)) {
          badMetaKeys.push(cell.value)
        }
      }
      expect(badMetaKeys).toEqual([])

      // (d) probe containment: each forged probe entered the DB through
      // exactly ONE legitimate field (`discovered_session.summary`) and
      // exists NOWHERE else — no event payload, no run row, no meta
      // value, no derived state. (This is the 扫描兜底: a future write
      // face landing a secret-shaped value off-surface fails here.)
      for (const probe of [PROBE_SK, PROBE_BEARER]) {
        const hits = cells.filter((c) => c.value.includes(probe))
        expect(hits.map((c) => `${c.table}.${c.column}`), `probe ${JSON.stringify(probe)} must exist only in the legitimate summary field`).toEqual([
          'discovered_session.summary',
        ])
      }
    } finally {
      h.close()
    }
  })
})

/* ------------------------------------------------------------------ *
 * (iv) The 「写入含 secret 值的调用被拒绝」 half — V1 has NO credential-
 *     receiving write face; carried as a structural assertion.
 *
 *     口径留痕 (G2 r1 inv-attacker 补充清单 A-1 原文): 「『写入含 secret
 *     值的调用被拒绝』在 V1 无对应调用面（无工具/无 secret 参数），按矩阵
 *     脚注口径记为『无此面 + 扫描兜底』并在测试注释留痕，避免虚构拒绝
 *     路径」. The structural proof is two-layered:
 *       1. this test — no store/service method name or parameter name
 *          carries a credential shape (runtime API-face scan);
 *       2. the (ii) compile-time key-set pinning — no input TYPE carries
 *          a credential-shaped field (the type-level proof).
 *     Plus the documented surface inventory: `src/host/tools/` is empty
 *     (no agent tool face), the typert artifact's `invocations` is
 *     exactly `['ping']` (no RPC accepting credentials), and the
 *     session data plane is the WP-0.4 port projecting only
 *     `{sessionId, type, seq}` (the plugin never SEES session content).
 *     The (iii) scan net is the 兜底 that catches any future value
 *     landing off-surface.
 * ------------------------------------------------------------------ */

/** Extract the top-level parameter names of a function's source. */
function parameterNames(fn: (...args: unknown[]) => unknown): string[] {
  const src = fn.toString()
  const start = src.indexOf('(')
  if (start === -1) return []
  let depth = 0
  let end = -1
  for (let i = start; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return []
  const sig = src.slice(start + 1, end)
  const parts: string[] = []
  let cur = ''
  let nest = 0
  for (const ch of sig) {
    if (ch === '(' || ch === '[' || ch === '{') nest++
    else if (ch === ')' || ch === ']' || ch === '}') nest--
    if (ch === ',' && nest === 0) {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim() !== '') parts.push(cur)
  return parts
    .map((p) => (p.trim().startsWith('...') ? p.trim().slice(3) : p.trim()).split(/[=:]/)[0]!.trim())
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
}

/** The public method face of `obj`: own function properties (the store
 *  handle is a plain sealed record) + prototype-chain methods (the
 *  services are classes). */
function publicMethodFace(obj: object): [string, (...a: unknown[]) => unknown][] {
  const seen = new Set<string>()
  const out: [string, (...a: unknown[]) => unknown][] = []
  const take = (name: string, v: unknown): void => {
    if (typeof v !== 'function' || seen.has(name)) return
    seen.add(name)
    out.push([name, v as (...a: unknown[]) => unknown])
  }
  for (const [name, v] of Object.entries(obj)) take(name, v)
  let proto = Object.getPrototypeOf(obj)
  while (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue
      take(name, (proto as Record<string, unknown>)[name])
    }
    proto = Object.getPrototypeOf(proto)
  }
  return out
}

describe('TC-DB-004 (iv): no credential-receiving write face (structural assertion)', () => {
  it('store handle / RunBindingService / SessionLinkService: no method or parameter named like a credential', () => {
    const service = makeHarness()
    try {
      // The store face (plain sealed record — own properties are the API).
      const storeFace = publicMethodFace(service.store)
      expect(storeFace.map(([n]) => n).sort()).toEqual(['appendEvents', 'close', 'getEvent', 'listRange', 'meta'])
      const bindingFace = publicMethodFace(service.service)
      const link = new SessionLinkService({
        store: service.store,
        registry: service.registry,
        adapter: new SessionLinkFakeAdapter(),
        ids: service.allocator,
        projectId: 'PRJ-1',
        workstreams: WORKSTREAMS,
        now: service.now,
      })
      const linkFace = publicMethodFace(link)

      for (const [face, label] of [
        [storeFace, 'store handle'],
        [bindingFace, 'RunBindingService'],
        [linkFace, 'SessionLinkService'],
      ] as const) {
        expect(face.length, `${label}: at least one public method expected`).toBeGreaterThan(0)
        for (const [name, fn] of face) {
          expect(name, `${label}.${name}: method name carries a credential shape`).not.toMatch(CREDENTIAL_SHAPE)
          for (const param of parameterNames(fn)) {
            expect(
              param,
              `${label}.${name}(${param}): parameter carries a credential shape — V1 has no credential-receiving write face`,
            ).not.toMatch(CREDENTIAL_SHAPE)
          }
        }
      }
    } finally {
      service.close()
    }
  })

  it('the non-store write surfaces are empty/ping-only (documented inventory, re-verified at runtime)', () => {
    // src/host/tools/ is empty in V1 (no agent tool face) — the DDL scan
    // helper already walks src; assert the tools dir holds no .ts module.
    const toolsDir = join(SRC_ROOT, 'host', 'tools')
    const toolModules = statSync(toolsDir).isDirectory()
      ? readdirSync(toolsDir).filter((f) => f.endsWith('.ts'))
      : []
    expect(toolModules).toEqual([])
  })
})
