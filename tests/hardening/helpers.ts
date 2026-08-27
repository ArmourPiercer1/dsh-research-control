/**
 * WP-8.1 test infrastructure (tests/hardening/).
 *
 * Every test runs against REAL artifacts (the tests/wiring/ precedent):
 *   - a REAL temp directory tree (mkdtemp, afterAll cleanup) carrying a
 *     REAL `.research/` tree (the loader fixtures' complete valid tree,
 *     patched per test) and, where a Git boundary is under test, a REAL
 *     temp Git repository (tests spawn git directly — test bench, not
 *     business code, the tests/git/ precedent);
 *   - a REAL research.sqlite under a temp data dir (the store's own
 *     `openDatabase` — the same open path the production wiring runs);
 *   - the REAL frozen schemas at the WR root (SI-001 layout: `schema/`
 *     lives at the workspace root, never copied into the plugin repo).
 *
 * Reused from tests/wiring/helpers.ts (same WR-root resolution, same
 * tree writer, same git init) + the store's event fixture
 * (tests/store/helpers.ts `makeEvent` — a valid HistoryEventInput).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  makeTempDir,
  writeResearchTree,
  initGitRepo,
  WR_SCHEMA_ROOT,
  WR_DECLARATIVE_SCHEMA_DIR,
  makeClock,
  T0,
} from '../wiring/helpers.js'
import { makeEvent } from '../store/helpers.js'
import { openDatabase } from '../../src/host/persistence/store/index.js'
import type { ResearchFileReader } from '../../src/host/domain/loader/index.js'
import type { IntegrityLogger } from '../../src/host/persistence/hardening/index.js'

/** The real frozen schema root (re-export for the test files). */
export const SCHEMA_ROOT = WR_SCHEMA_ROOT
export const DECLARATIVE_SCHEMA_DIR = WR_DECLARATIVE_SCHEMA_DIR

/** A deterministic clock for the suites that need one (shared T0). */
export const CLOCK0 = T0
export function makeTestClock(): () => number {
  return makeClock(CLOCK0)
}

/** Tracked temp dir (re-export — the suites that only need one scratch dir). */
export { makeTempDir }

export { existsSync, statSync }

/**
 * The production-shaped fs reader (the same shape the wiring's private
 * `FsReader` implements — `ResearchFileReader` for the tree load):
 * null for a missing dir/file, throws for the I/O-failure injection.
 */
export class FsReader implements ResearchFileReader {
  constructor(readonly failPaths: readonly string[] = []) {}
  readDir(path: string): ReturnType<ResearchFileReader['readDir']> {
    if (this.failPaths.includes(path)) throw new Error(`injected read failure: ${path}`)
    if (!existsSync(path) || !statSync(path).isDirectory()) return null
    return readdirSync(path, { withFileTypes: true }).map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
    }))
  }
  readFile(path: string): string | null {
    if (this.failPaths.includes(path)) throw new Error(`injected read failure: ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}

/** A collecting logger (the wiring's `makeCollectingLogger` shape). */
export function makeCollectingLogger(): IntegrityLogger & {
  readonly entries: { level: 'info' | 'warn' | 'error'; step: string; message: string }[]
} {
  const entries: { level: 'info' | 'warn' | 'error'; step: string; message: string }[] = []
  const push = (level: 'info' | 'warn' | 'error') => (step: string, message: string) => {
    entries.push({ level, step, message })
  }
  return {
    entries,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  }
}

/**
 * A workspace bundle for the orchestrator tests: a temp repo root with
 * the real `.research` tree (patched) + (by default) a real git repo +
 * a temp data dir. The DB file is NOT pre-created — `checkDatabase`
 * initializes it on first open (the first-startup shape).
 */
export interface HardeningWorkspace {
  readonly repoRoot: string
  readonly researchRoot: string
  readonly dataDir: string
  readonly dbPath: string
}

export function makeWorkspace(options: {
  readonly treePatch?: Record<string, string | null>
  readonly git?: boolean
} = {}): HardeningWorkspace {
  const repoRoot = makeTempDir('wp81-repo-')
  const researchRoot = writeResearchTree(repoRoot, options.treePatch)
  if (options.git !== false) initGitRepo(repoRoot)
  const dataDir = join(makeTempDir('wp81-data-'), 'dsh')
  mkdirSync(dataDir, { recursive: true })
  return {
    repoRoot,
    researchRoot,
    dataDir,
    dbPath: join(dataDir, 'research.sqlite'),
  }
}

/** Corrupt the DB file with garbage bytes (the TC-DB-002 form). */
export function corruptDbWithGarbage(dbPath: string): void {
  writeFileSync(
    dbPath,
    Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from('not a sqlite file at all'), Buffer.from([0xff, 0xfe, 0xfd])]),
  )
  for (const sibling of ['-wal', '-shm']) {
    if (existsSync(dbPath + sibling)) rmSync(dbPath + sibling)
  }
}

/** Truncate the DB file to 40% (the TC-DB-002 form). */
export function truncateDb40(dbPath: string): void {
  const buf = readFileSync(dbPath)
  writeFileSync(dbPath, buf.subarray(0, Math.floor(buf.length * 0.4)))
  for (const sibling of ['-wal', '-shm']) {
    if (existsSync(dbPath + sibling)) rmSync(dbPath + sibling)
  }
}

/** A fresh, VALID database at `dbPath` (initialized + closed). */
export function initializeValidDb(dbPath: string): void {
  const store = openDatabase(dbPath)
  store.close()
}

/** A valid database with ONE committed event for `wsId` (closed after). */
export function initializeDbWithEvent(dbPath: string, wsId: string): void {
  const store = openDatabase(dbPath, { now: makeClock() })
  store.appendEvents([makeEvent({ ownerWorkstreamId: wsId, eventType: 'WS_REALIZED', payload: { workstream_id: wsId } })])
  store.close()
}

/** A plain temp data dir (no DB file yet) — first-startup shape. */
export function makeDataDir(): string {
  const dir = join(makeTempDir('wp81-data-'), 'dsh')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Write one raw file under a root (test-bench file surgery). */
export function writeFileUnder(root: string, rel: string, content: string): string {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return abs
}

/** Delete a file under a root (test-bench file surgery). */
export function deleteFileUnder(root: string, rel: string): void {
  rmSync(join(root, rel), { force: true })
}
