/**
 * WP-3.6 (RR-011) test infrastructure (tests/wiring/).
 *
 * Every test runs against REAL artifacts:
 *   - a REAL temp Git repository (mkdtemp) carrying a REAL `.research/`
 *     tree (the loader fixtures' complete valid tree — every declarative
 *     file type, all refs resolving) and a REAL `research.sqlite` under a
 *     temp data dir;
 *   - the REAL frozen schemas at the WR root (SI-001 layout: `schema/`
 *     lives at the workspace root, never copied into the plugin repo).
 *
 * `makeWiring` composes the FULL host wiring (`createHostWiring`) over
 * such a repo — the same composition the dsh-adapter's `[Service.init]`
 * runs in production (the adapter half — home resolution, workspace
 * registry, tool registration — is exercised there; here we drive the
 * business graph directly, which is what RR-011 ledger items (a)–(f)
 * name).
 *
 * The `.research` tree writer patches the loader base tree per test
 * (e.g. a `lifecycle: REALIZED` file to simulate a crash residue);
 * `initGitRepo` makes the repo a Git repository (the stale service's W3/
 * W11 capture and the content-hash capture's equivalence proof need it).
 * Tests MAY spawn git (the INV-GIT-6 sole-spawn-point rule binds business
 * code, not the test bench — tests/git/ sets the precedent).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

import { FakeSessionAdapter } from '../runbinding/helpers.js'
import { baseTreeFiles } from '../loader/fixtures.js'
import { createHostWiring, type HostWiring } from '../../src/host/service/wiring/index.js'
import type {
  DshAgentLauncherAdapter,
  InvestigatorLaunchRequest,
  InvestigatorLaunchResult,
} from '../../src/host/service/investigator/index.js'
import type { UserActorRef } from '../../src/host/service/runbinding/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** WR root (three levels up: tests/wiring → tests → plugin repo → WR). */
export const WR_ROOT = resolve(HERE, '..', '..', '..')
/** The real frozen schema root (SI-001: the canonical copy at the WR root). */
export const WR_SCHEMA_ROOT = join(WR_ROOT, 'schema')
export const WR_HISTORY_SCHEMA_DIR = join(WR_SCHEMA_ROOT, 'history')
export const WR_DECLARATIVE_SCHEMA_DIR = join(WR_SCHEMA_ROOT, 'declarative')
export const WR_OPERATIONAL_SCHEMA_DIR = join(WR_SCHEMA_ROOT, 'operational')

/* ------------------------------------------------------------------ *
 * Temp dirs + git repos (afterAll cleanup)
 * ------------------------------------------------------------------ */

const roots: string[] = []

/** Fresh temp directory (tracked for afterAll cleanup). */
export function makeTempDir(prefix = 'wp36-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/**
 * The WP-7.4 fake investigator launcher port (the `DshAgentLauncherAdapter`
 * seam the wiring consumes — the production host half is the DSH-touching
 * `HostAgentLauncherAdapter`; tests/factory never launch real agents).
 *
 * Records every request (the launch-request closed-set assertion surface)
 * and returns a deterministic echo result. A `failWith` option lets the
 * failure-path tests pin the structured error propagation.
 */
export class FakeLauncherAdapter implements DshAgentLauncherAdapter {
  readonly requests: InvestigatorLaunchRequest[] = []
  constructor(readonly failWith?: Error) {}
  async launchInvestigator(request: InvestigatorLaunchRequest): Promise<InvestigatorLaunchResult> {
    this.requests.push(request)
    if (this.failWith !== undefined) throw this.failWith
    return {
      sessionId: 'investigator-fake-1',
      presetId: request.presetId,
      permissionPreset: request.permissionPreset,
      task: request.task,
    }
  }
}

/** The default wiring fake launcher (no failures). */
export function makeFakeLauncherAdapter(): FakeLauncherAdapter {
  return new FakeLauncherAdapter()
}

afterAll(() => {
  for (const r of roots) {
    rmSync(r, { recursive: true, force: true })
  }
})

/** Reference "now" (epoch ms, 2026-08-22T09:00:00Z) + the clock. */
export const T0 = Date.parse('2026-08-22T09:00:00Z')

/** A deterministic advancing clock (monotonic, +1s per call). */
export function makeClock(start = T0): () => number {
  let t = start
  return () => (t += 1_000)
}

/** The common USER actor (the frozen actorRef surface). */
export const USER: UserActorRef = { kind: 'USER', user_id: 'u-1', label: 'wiring-tester' }

/**
 * Write the complete valid `.research/` tree (the loader fixtures'
 * `baseTreeFiles`) under `<root>/.research/`, applying optional patches
 * (`null` deletes a file; a string replaces its content).
 */
export function writeResearchTree(root: string, patch: Record<string, string | null> = {}): string {
  const researchRoot = join(root, '.research')
  const files = { ...baseTreeFiles(), ...patch }
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue
    const abs = join(researchRoot, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return researchRoot
}

/**
 * Turn `root` into a Git repository with the test identity and (when
 * `initialCommit`) one initial commit of everything present. Tests spawn
 * git directly (test bench, not business code — see module header).
 * The commit is `--allow-empty`: an empty repo (no `.research` yet) is a
 * legal fixture for the input-validation failure cases.
 */
export function initGitRepo(root: string, initialCommit = true): void {
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git(['init', '-q', '--initial-branch=main'])
  git(['config', 'user.email', 'wiring-test@local'])
  git(['config', 'user.name', 'wiring-test'])
  if (initialCommit) {
    git(['add', '-A'])
    git(['commit', '-q', '--allow-empty', '-m', 'initial .research tree'])
  }
}

/** The current HEAD commit oid of the repo (the W11 face, test-side). */
export function gitHead(root: string): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

/** One file's git blob OID via `git hash-object -- <path>` (the W3 face, test-side). */
export function gitBlobOidOf(root: string, relPath: string): string {
  return execFileSync('git', ['-C', root, 'hash-object', '--', relPath], { encoding: 'utf8' }).trim()
}

/**
 * A `.research`-relative path's git blob OID — the record's
 * `base_plan_objects[].path` vocabulary (POSIX, `.research`-relative; the
 * W3 call itself runs repo-root-relative as `.research/<rel>`).
 */
export function gitBlobOidOfResearch(root: string, researchDir: string, relPath: string): string {
  return gitBlobOidOf(root, `${researchDir}/${relPath}`)
}

/* ------------------------------------------------------------------ *
 * The wiring factory
 * ------------------------------------------------------------------ */

export interface WiringOptions {
  /** Patch the `.research` tree files (see {@link writeResearchTree}). */
  readonly treePatch?: Record<string, string | null>
  /** Skip the `git init` (for the non-git failure cases). */
  readonly git?: boolean
  /** The startup reconciliation policy (default `rebuild`). */
  readonly reconcileRuns?: 'rebuild' | 'failLoud'
  /** A pre-made session adapter (default: a fresh FakeSessionAdapter). */
  readonly adapter?: FakeSessionAdapter
  /** A pre-made investigator launcher port (default: a fresh
   *  {@link FakeLauncherAdapter} — records requests, no real launch). */
  readonly launcherAdapter?: FakeLauncherAdapter
  /** A fixed now() (default: a fresh deterministic clock). */
  readonly now?: () => number
  /** Project id (default `PRJ-1` — the fixture tree's project). */
  readonly projectId?: string
  /** Override the schema root (default: the REAL WR schema). */
  readonly schemaRoot?: string
  /** A scratch dir for the tree/repo (default: a fresh temp dir). */
  readonly repoRoot?: string
}

export interface WiringBundle {
  readonly repoRoot: string
  readonly researchRoot: string
  readonly dataDir: string
  readonly adapter: FakeSessionAdapter
  readonly launcherAdapter: FakeLauncherAdapter
  readonly wiring: HostWiring
  readonly now: () => number
}

/**
 * A complete host wiring over a fresh temp repo (tree + git + data dir +
 * the real frozen schemas). The returned bundle keeps the pieces the
 * test needs (repo for file assertions, the adapter for session edges).
 */
export function makeWiring(options: WiringOptions = {}): WiringBundle {
  const repoRoot = options.repoRoot ?? makeTempDir('wp36-repo-')
  const dataDir = join(makeTempDir('wp36-data-'), 'dsh')
  const researchRoot = writeResearchTree(repoRoot, options.treePatch)
  if (options.git !== false) {
    initGitRepo(repoRoot)
  }
  const adapter = options.adapter ?? new FakeSessionAdapter()
  const launcherAdapter = options.launcherAdapter ?? makeFakeLauncherAdapter()
  const now = options.now ?? makeClock()
  const wiring = createHostWiring({
    repoRoot,
    schemaRoot: options.schemaRoot ?? WR_SCHEMA_ROOT,
    projectId: options.projectId ?? 'PRJ-1',
    dataDir,
    adapter,
    launcherAdapter,
    workspaceRoots: [repoRoot],
    now,
    ...(options.reconcileRuns !== undefined ? { reconcileRuns: options.reconcileRuns } : {}),
  })
  return { repoRoot, researchRoot, dataDir, adapter, launcherAdapter, wiring, now }
}

/** A raw second connection to the wiring's research.sqlite (test bench
 *  access for divergence simulation; the business surface never exposes
 *  the canonical connection). `dataDir` is the wiring's data dir itself
 *  (the db file lives at `<dataDir>/research.sqlite`). */
export function rawDb(dataDir: string): DatabaseSync {
  return new DatabaseSync(join(dataDir, 'research.sqlite'))
}

export { existsSync }
