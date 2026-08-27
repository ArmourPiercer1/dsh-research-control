/**
 * WP-8.1 — the startup integrity orchestrator (crash recovery 面):
 * `runStartupIntegrityChecks` + `assertStartup` over REAL artifacts
 * (real `.research` tree, real git repo, real research.sqlite, real
 * frozen schemas). Every broken form is injected and the AGGREGATION
 * contract pinned:
 *
 *   - 聚合而非短路: a dead DB still yields the tree/git/consistency
 *     states (the §10 SQLite 损坏行's 「断言声明式真源完好」 assertion
 *     needs them);
 *   - outcome: fatal (any unrecoverable) > degraded (only recoverable)
 *     > ok;
 *   - surface narrowing: readonly ⟺ tree partially broken; checkpoint
 *     refused by managed-mode refusal / conflict-in-progress / broken
 *     tree (dirty does NOT — TC-GIT-001);
 *   - 绝不静默: every non-ok outcome has guidance + loud log entries +
 *     a summary; `assertStartup` throws `HardeningFatalError` (with the
 *     FULL report) on fatal.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

import {
  assertStartup,
  HardeningFatalError,
  HardeningError,
  runStartupIntegrityChecks,
  type StartupIntegrityReport,
} from '../../src/host/persistence/hardening/index.js'
import {
  corruptDbWithGarbage,
  DECLARATIVE_SCHEMA_DIR,
  FsReader,
  initializeDbWithEvent,
  initializeValidDb,
  makeCollectingLogger,
  makeTempDir,
  makeWorkspace,
} from './helpers.js'
import { WS1_YAML } from '../loader/fixtures.js'

async function run(options: {
  readonly treePatch?: Record<string, string | null>
  readonly git?: boolean
  readonly projectId?: string
  readonly maxConsistencySample?: number
  readonly preDb?: (dbPath: string) => void
} = {}): Promise<{ report: StartupIntegrityReport; logger: ReturnType<typeof makeCollectingLogger> }> {
  const ws = makeWorkspace({ treePatch: options.treePatch, git: options.git })
  if (options.preDb) options.preDb(ws.dbPath)
  const logger = makeCollectingLogger()
  const report = await runStartupIntegrityChecks({
    dbPath: ws.dbPath,
    repoRoot: ws.repoRoot,
    researchRoot: ws.researchRoot,
    schemaDir: DECLARATIVE_SCHEMA_DIR,
    projectId: options.projectId ?? 'PRJ-1',
    reader: new FsReader(),
    maxConsistencySample: options.maxConsistencySample,
    logger,
  })
  return { report, logger }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

describe('runStartupIntegrityChecks — the healthy startup (ok)', () => {
  it('all four checks pass: outcome ok, full surface, no guidance, assertStartup silent', async () => {
    const { report, logger } = await run({})
    expect(report.outcome).toBe('ok')
    expect(report.db.status).toBe('pass')
    expect(report.db.userVersion).toBe(1)
    expect(report.tree.status).toBe('pass')
    expect(report.git.status).toBe('pass')
    expect(report.consistency.status).toBe('pass')
    expect(report.consistency.checked).toEqual(['WS-1', 'WS-2', 'WS-3'])
    expect(report.readSurface).toBe('ok')
    expect(report.managedMode).toBe('ok')
    expect(report.checkpointAllowed).toBe(true)
    expect(report.guidance).toEqual([])
    expect(report.summary).toContain('ok')
    // the check-1 handle is closed (the db file re-opens cleanly — no lock leak)
    const raw = new DatabaseSync(report.dbPath)
    raw.close()
  })
})

describe('runStartupIntegrityChecks — SQLite corruption (TC-DB-002 + §10 行)', () => {
  it('corrupted DB + clean tree + clean git: FATAL; the declarative 真源 intactness is ASSERTED from the real check results', async () => {
    const { report, logger } = await run({
      preDb: (p) => {
        initializeValidDb(p)
        corruptDbWithGarbage(p)
      },
    })
    expect(report.outcome).toBe('fatal')
    expect(report.db.status).toBe('unrecoverable')
    expect(report.db.code).toBe('STORE_CORRUPT')
    // the aggregation ran the other checks (聚合而非短路)
    expect(report.tree.status).toBe('pass')
    expect(report.git.status).toBe('pass')
    // the consistency check was SKIPPED — with the reason stated (never silent)
    expect(report.consistency.status).toBe('skipped')
    expect(report.consistency.skipReason).toContain('unavailable')
    // the §10 row assertion: the declarative 真源 is INTACT (from the real results)
    const all = report.guidance.join('\n')
    expect(all).toContain('INTACT')
    expect(all).toContain('separate file')
    expect(all).toContain('NOT recoverable')
    // the surface is moot on fatal, but the flags are coherent
    expect(report.readSurface).toBe('ok') // the tree is clean — the readonly gate is tree-driven
    // loud: an error-level log entry for the db check
    expect(logger.entries.some((e) => e.level === 'error' && e.step === 'db')).toBe(true)
    // assertStartup throws the structured fatal error carrying the FULL report
    expect(() => assertStartup(report)).toThrow(HardeningFatalError)
    try {
      assertStartup(report)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HardeningFatalError)
      expect((e as HardeningFatalError).report).toBe(report)
    }
  })

  it('corrupted DB + BROKEN tree too: fatal, and the guidance does NOT over-claim the 真源 intact', async () => {
    const { report } = await run({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': 'id: T-99\nworkstream_id: WS-1\ntitle: x\ngoal: y\ncreated_by: { kind: USER, label: t }\ncreated_at: 2026-08-21T09:30:00Z\n',
      },
      preDb: (p) => {
        initializeValidDb(p)
        corruptDbWithGarbage(p)
      },
    })
    expect(report.outcome).toBe('fatal')
    expect(report.db.code).toBe('STORE_CORRUPT')
    expect(report.tree.status).toBe('recoverable') // partial breakage is still reported
    const all = report.guidance.join('\n')
    expect(all).toContain('NOT clean either')
    expect(all).not.toContain('is INTACT')
    expect(report.consistency.status).toBe('skipped')
  })
})

describe('runStartupIntegrityChecks — the version gate (pre-release 不迁移)', () => {
  it('a foreign user_version: FATAL with the no-migration remedy', async () => {
    const { report } = await run({
      preDb: (p) => {
        initializeValidDb(p)
        const raw = new DatabaseSync(p)
        raw.exec('PRAGMA user_version = 2')
        raw.close()
      },
    })
    expect(report.outcome).toBe('fatal')
    expect(report.db.code).toBe('STORE_VERSION')
    expect(report.guidance.join('\n')).toContain('does not migrate')
  })
})

describe('runStartupIntegrityChecks — the §10 broken-tree row (degraded readonly surface)', () => {
  it('a broken optional file: DEGRADED — readonly surface, checkpoint refused, loud, the rest load', async () => {
    const { report, logger } = await run({
      treePatch: {
        'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml': 'id: T-99\nworkstream_id: WS-1\ntitle: x\ngoal: y\ncreated_by: { kind: USER, label: t }\ncreated_at: 2026-08-21T09:30:00Z\n',
      },
    })
    expect(report.outcome).toBe('degraded')
    expect(report.db.status).toBe('pass')
    expect(report.tree.status).toBe('recoverable')
    // the tree check still carried the loaded tree (the §10 row: 其余文件正常加载)
    expect(report.tree.load.tree.topics[0]!.workstreams[0]!.tasks.find((t) => t.id === 'T-2')!.doc).not.toBeNull()
    // surface narrowing: readonly (write surface over a partially broken 真源 is refused)
    expect(report.readSurface).toBe('readonly')
    // checkpoint refused (it must not commit a partially broken 真源)
    expect(report.checkpointAllowed).toBe(false)
    expect(report.managedMode).toBe('ok')
    // the consistency check RAN (the DB is open + the tree usable) and passed
    expect(report.consistency.status).toBe('pass')
    expect(report.consistency.checked).toEqual(['WS-1', 'WS-2', 'WS-3'])
    // loud: warn entries + precisely-located guidance
    expect(logger.entries.some((e) => e.level === 'warn' && e.step === 'tree')).toBe(true)
    const all = report.guidance.join('\n')
    expect(all).toContain('[tree]')
    expect(all).toContain('T-1.yaml')
    expect(all).toContain('READONLY')
    // a degraded report does NOT throw (it proceeds, narrowed + loud)
    expect(() => assertStartup(report)).not.toThrow()
  })

  it('a missing project.yaml: FATAL (the tree cannot serve as a 真源)', async () => {
    const { report } = await run({ treePatch: { 'project.yaml': null } })
    expect(report.outcome).toBe('fatal')
    expect(report.tree.status).toBe('unrecoverable')
    expect(report.guidance.join('\n')).toContain('git restore')
    // the consistency check was skipped — with the reason (the tree is unusable)
    expect(report.consistency.status).toBe('skipped')
    expect(report.consistency.skipReason).toContain('unusable')
  })
})

describe('runStartupIntegrityChecks — the Git boundary (§5.1 + §10 + TC-GIT-001)', () => {
  it('an in-progress merge: DEGRADED — checkpoint EXPLICITLY refused, read surface stays ok (the tree is intact)', async () => {
    const ws = makeWorkspace()
    const root = ws.repoRoot
    // a conflicting merge on a NON-.research file (the .research tree stays
    // intact — this isolates the git boundary semantics; a conflict INSIDE
    // .research would additionally degrade the tree — covered by the §10 row)
    const notes = join(root, 'notes.md')
    writeFileSync(notes, 'baseline\n')
    git(root, ['add', 'notes.md'])
    git(root, ['commit', '-qm', 'notes'])
    git(root, ['checkout', '-q', '-b', 'feature'])
    writeFileSync(notes, 'feature edit\n')
    git(root, ['commit', '-qam', 'f'])
    git(root, ['checkout', '-q', 'main'])
    writeFileSync(notes, 'main edit\n')
    git(root, ['commit', '-qam', 'm'])
    // a real conflicting merge (git exits ≠ 0 — tolerate it; MERGE_HEAD remains)
    const merge = spawnSync('git', ['-C', root, 'merge', 'feature'], { encoding: 'utf8' })
    expect(merge.status).not.toBe(0)
    expect(existsSync(join(root, '.git', 'MERGE_HEAD'))).toBe(true)

    const logger = makeCollectingLogger()
    const report = await runStartupIntegrityChecks({
      dbPath: ws.dbPath,
      repoRoot: ws.repoRoot,
      researchRoot: ws.researchRoot,
      schemaDir: DECLARATIVE_SCHEMA_DIR,
      projectId: 'PRJ-1',
      reader: new FsReader(),
      logger,
    })
    expect(report.outcome).toBe('degraded')
    expect(report.git.reason).toBe('conflict-in-progress')
    expect(report.git.conflictFlags?.mergeHead).toBe(true)
    // the explicit checkpoint refusal (INV-GIT-4)
    expect(report.checkpointAllowed).toBe(false)
    // but: managed mode ok + the read surface is NOT read-only (the declarative files are intact)
    expect(report.managedMode).toBe('ok')
    expect(report.readSurface).toBe('ok')
    expect(report.consistency.status).toBe('pass')
    const all = report.guidance.join('\n')
    expect(all).toContain('[git]')
    expect(all).toContain('EXPLICITLY REFUSED')
    expect(logger.entries.some((e) => e.level === 'warn' && e.step === 'git')).toBe(true)
    expect(() => assertStartup(report)).not.toThrow()
  })

  it('a merge conflict INSIDE .research: compound — the git refusal AND the §10 broken-file degradation (readonly surface)', async () => {
    const ws = makeWorkspace()
    const root = ws.repoRoot
    const file = join(ws.researchRoot, 'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')
    const original = readFileSync(file, 'utf8')
    git(root, ['checkout', '-q', '-b', 'feature'])
    writeFileSync(file, original + '# feature\n')
    git(root, ['commit', '-qam', 'f'])
    git(root, ['checkout', '-q', 'main'])
    writeFileSync(file, original + '# main\n')
    git(root, ['commit', '-qam', 'm'])
    const merge = spawnSync('git', ['-C', root, 'merge', 'feature'], { encoding: 'utf8' })
    expect(merge.status).not.toBe(0)

    const report = await runStartupIntegrityChecks({
      dbPath: ws.dbPath,
      repoRoot: ws.repoRoot,
      researchRoot: ws.researchRoot,
      schemaDir: DECLARATIVE_SCHEMA_DIR,
      projectId: 'PRJ-1',
      reader: new FsReader(),
    })
    expect(report.outcome).toBe('degraded')
    // both sides report their finding (aggregation):
    expect(report.git.reason).toBe('conflict-in-progress')
    expect(report.tree.status).toBe('recoverable') // the conflicted T-1.yaml is a broken file (conflict markers)
    expect(report.tree.degradedErrors.some((e) => e.file === 'topics/TPC-1/workstreams/WS-1/items/tasks/T-1.yaml')).toBe(true)
    // the narrowed surface reflects BOTH: readonly (tree) + checkpoint refused (git)
    expect(report.readSurface).toBe('readonly')
    expect(report.checkpointAllowed).toBe(false)
    // the broken file is still REJECTED, the rest load (the §10 row holds mid-conflict)
    expect(report.tree.load.tree.topics[0]!.workstreams[0]!.tasks.find((t) => t.id === 'T-2')!.doc).not.toBeNull()
  })

  it('a dirty working tree: the checkpoint REMAINS allowed (TC-GIT-001) — outcome ok', async () => {
    const ws = makeWorkspace()
    writeFileSync(join(ws.repoRoot, 'stray.txt'), 'untracked\n')
    const report = await runStartupIntegrityChecks({
      dbPath: ws.dbPath,
      repoRoot: ws.repoRoot,
      researchRoot: ws.researchRoot,
      schemaDir: DECLARATIVE_SCHEMA_DIR,
      projectId: 'PRJ-1',
      reader: new FsReader(),
    })
    expect(report.git.status).toBe('pass')
    expect(report.git.dirty).toBe(true)
    expect(report.outcome).toBe('ok')
    expect(report.checkpointAllowed).toBe(true)
  })

  it('a workspace that is not a git repo: DEGRADED — managed mode refused, explicit init entry, never silent', async () => {
    const { report } = await run({ git: false })
    expect(report.outcome).toBe('degraded')
    expect(report.git.reason).toBe('not-a-repo')
    expect(report.managedMode).toBe('refused')
    expect(report.checkpointAllowed).toBe(false)
    // the read surface stays ok (the .research files do not need git to be read)
    expect(report.readSurface).toBe('ok')
    expect(report.consistency.status).toBe('pass')
    expect(report.guidance.join('\n')).toContain('Initialize Git Repository')
    expect(() => assertStartup(report)).not.toThrow()
  })
})

describe('runStartupIntegrityChecks — the crash-residue consistency finding (recoverable, loud)', () => {
  it('file-leads (a REALIZED file with no events — the RR-010 window residue): DEGRADED + the reconciliation named', async () => {
    const { report, logger } = await run({
      treePatch: {
        // the legal lifecycle value (schema-valid) with no events in History:
        // exactly the RR-010 crash-window residue (the flip outlived a rolled-back append)
        'topics/TPC-1/workstreams/WS-1/workstream.yaml': WS1_YAML + 'lifecycle: REALIZED\n',
      },
    })
    expect(report.outcome).toBe('degraded')
    expect(report.db.status).toBe('pass')
    expect(report.tree.status).toBe('pass') // the file itself is VALID — only the agreement is broken
    expect(report.consistency.status).toBe('recoverable')
    expect(report.consistency.findings).toHaveLength(1)
    expect(report.consistency.findings[0]!.kind).toBe('file-leads')
    expect(report.consistency.findings[0]!.workstreamId).toBe('WS-1')
    // the read surface is NOT narrowed (the declarative files are intact) and the
    // checkpoint stays allowed (git clean, tree not broken) — the divergence is
    // a file/History agreement the wiring's reconciliation converges loud after
    expect(report.readSurface).toBe('ok')
    expect(report.checkpointAllowed).toBe(true)
    // loud: the finding + the named mechanism in the guidance
    const all = report.guidance.join('\n')
    expect(all).toContain('[consistency]')
    expect(all).toContain('WS-1')
    expect(all).toContain('reconciliation')
    expect(logger.entries.some((e) => e.level === 'warn' && e.step === 'consistency')).toBe(true)
    expect(() => assertStartup(report)).not.toThrow()
  })

  it('file-trails (History has events, the file says PLANNED): DEGRADED + the forward convergence named', async () => {
    const { report } = await run({
      preDb: (p) => initializeDbWithEvent(p, 'WS-2'),
    })
    expect(report.outcome).toBe('degraded')
    expect(report.consistency.status).toBe('recoverable')
    expect(report.consistency.findings[0]!.kind).toBe('file-trails')
    expect(report.consistency.findings[0]!.workstreamId).toBe('WS-2')
    expect(report.guidance.join('\n')).toContain('forward')
  })

  it('a project-id scope mismatch: FATAL — the plugin must not guess which side to rewrite', async () => {
    const { report } = await run({ projectId: 'PRJ-9' })
    expect(report.outcome).toBe('fatal')
    expect(report.consistency.status).toBe('unrecoverable')
    expect(report.consistency.findings.some((f) => f.kind === 'project-id-mismatch')).toBe(true)
    const all = report.guidance.join('\n')
    expect(all).toContain('PRJ-9')
    expect(all).toContain('must not guess which side to rewrite')
    expect(() => assertStartup(report)).toThrow(HardeningFatalError)
  })
})

describe('runStartupIntegrityChecks — the sample bound + input validation', () => {
  it('maxConsistencySample bounds the probe (checked says what was probed)', async () => {
    const { report } = await run({ maxConsistencySample: 1 })
    expect(report.consistency.checked).toEqual(['WS-1'])
    expect(report.outcome).toBe('ok')
  })

  it('malformed input is a structured HARDENING_INPUT error (never a raw throw)', async () => {
    const badPath = await runStartupIntegrityChecks({
      dbPath: 'relative/path',
      repoRoot: '/abs',
      researchRoot: '/abs/.research',
      schemaDir: '/abs/schema',
      projectId: 'PRJ-1',
      reader: new FsReader(),
    }).catch((e: unknown) => e)
    expect(badPath).toBeInstanceOf(HardeningError)
    expect((badPath as HardeningError).code).toBe('HARDENING_INPUT')

    const badId = await runStartupIntegrityChecks({
      dbPath: '/abs',
      repoRoot: '/abs',
      researchRoot: '/abs/.research',
      schemaDir: '/abs/schema',
      projectId: 'not-an-id',
      reader: new FsReader(),
    }).catch((e: unknown) => e)
    expect(badId).toBeInstanceOf(HardeningError)
    expect((badId as HardeningError).code).toBe('HARDENING_INPUT')
    expect((badId as HardeningError).message).toContain('PRJ-')
  })

  it('Windows absolute paths pass input validation (cross-platform — the DSH host hands native paths)', async () => {
    // The user's rescan failure (`repoRoot must be an absolute path
    // (got "D:\Projects\AIUED")`): the POSIX-only check rejected the
    // native workspace path. The validator must ACCEPT it; the checks
    // then RESOLVE with an aggregated report (the Windows location is
    // absent on this platform — findings, never an input throw).
    const dbPath = makeTempDir('wp81-win-')
    const report = await runStartupIntegrityChecks({
      dbPath,
      repoRoot: 'D:\\Projects\\AIUED',
      researchRoot: 'D:\\Projects\\AIUED\\.research',
      schemaDir: DECLARATIVE_SCHEMA_DIR,
      projectId: 'PRJ-1',
      reader: new FsReader(),
    }).catch((e: unknown) => e)
    expect(report).not.toBeInstanceOf(HardeningError)
    expect((report as StartupIntegrityReport).outcome).toBeDefined()
  })

  it('every non-ok outcome is loud: guidance non-empty + a warn/error log entry + a summary', async () => {
    const forms: Array<() => Promise<{ report: StartupIntegrityReport; logger: ReturnType<typeof makeCollectingLogger> }>> = [
      () => run({ preDb: (p) => { initializeValidDb(p); corruptDbWithGarbage(p) } }), // fatal
      () => run({ treePatch: { 'project.yaml': null } }), // fatal (tree)
      () => run({ git: false }), // degraded (git)
    ]
    for (const form of forms) {
      const { report, logger } = await form()
      expect(report.outcome).not.toBe('ok')
      expect(report.guidance.length).toBeGreaterThan(0)
      expect(report.summary.length).toBeGreaterThan(0)
      expect(
        logger.entries.some((e) => (e.level === 'warn' || e.level === 'error') && e.step !== 'startup-integrity'),
      ).toBe(true)
    }
  })
})
