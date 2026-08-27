/**
 * WP-1.1 — real schemaDir test (TC-DOM-027 brief: "用真实 WR/schema/declarative
 * 做 schemaDir 的至少一个真实 schema 校验用例").
 *
 * Unlike the in-memory suites (which still read the REAL frozen schema JSON),
 * this suite exercises the FULL real-path pipeline: an fs-backed reader,
 * absolute schemaDir = <WR>/schema/declarative (the loader resolves
 * `../common.schema.json` through real directory traversal), and a real
 * on-disk `.research/` tree in a temp dir.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import type { DirEntry, ResearchFileReader, ResearchLoadError, ResearchTree } from '../../src/host/domain/loader/index.js'
import { loadResearchTree, loadSchemas } from '../../src/host/domain/loader/index.js'
import { baseTreeFiles, WR_SCHEMA_DIR } from './fixtures.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/** fs-backed ResearchFileReader (tests may do I/O; the domain kernel may not). */
class FsReader implements ResearchFileReader {
  readFile(path: string): string | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }

  readDir(path: string): DirEntry[] | null {
    if (!isAbsolute(path)) throw new Error(`FsReader requires absolute paths, got ${path}`)
    if (!existsSync(path) || !statSync(path).isDirectory()) return null
    return readdirSync(path, { withFileTypes: true }).map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
    }))
  }
}

describe('WP-1.1 loader — real schemaDir (WR/schema/declarative, fs paths)', () => {
  const reader = new FsReader()
  let tmp: string
  let researchRoot: string
  const researchFiles = baseTreeFiles()

  beforeAll(() => {
    // hard precondition: the real frozen schema dir exists at the expected WR location
    expect(existsSync(WR_SCHEMA_DIR), `real schema dir missing: ${WR_SCHEMA_DIR}`).toBe(true)
    expect(readdirSync(WR_SCHEMA_DIR).filter((f) => f.endsWith('.schema.json')).length).toBe(11)
    tmp = join(tmpdir(), `wp11-real-schema-${process.pid}-${Date.now()}`)
    researchRoot = join(tmp, '.research')
    for (const [rel, content] of Object.entries(researchFiles)) {
      const p = join(researchRoot, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    }
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function loadTree(root: string): { tree: ResearchTree; errors: { code: string; file: string; path?: string; message: string }[] } {
    const result = loadResearchTree(reader, root, WR_SCHEMA_DIR)
    return result
  }

  it('full valid tree loads with zero errors against the real frozen schemas (incl. ../common.schema.json $refs)', () => {
    const result = loadTree(researchRoot)
    if (result.errors.length > 0) {
      throw new Error(
        `expected zero errors with real schemaDir, got ${result.errors.length}:\n` +
          result.errors.map((e) => `  [${e.code}] ${e.file} ${e.path ?? ''} ${e.message}`).join('\n'),
      )
    }
    expect(result.tree.project!.id).toBe('PRJ-1')
    expect(result.tree.project!.created_at).toBe(Date.parse('2026-08-21T09:00:00Z')) // §1.2 conversion on real path
    expect(result.tree.topics[0]!.workstreams[0]!.plan!.ordered_items).toEqual(['G-1', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'])
    expect(result.tree.topics[0]!.topology!.topology.edges.map((e) => e.id)).toEqual(['TE-1', 'TE-2'])
    expect(result.tree.mergeContracts[0]!.edgeId).toBe('TE-2')
    expect(result.tree.policy!.flooding!.threshold).toBe(5)
    expect(result.tree.workspace!.audit!.ignored).toEqual(['cache/', 'build/', 'tmp/'])
  })

  it('real schema constraints: importance maximum 5 → SCHEMA at /importance', () => {
    const bad = join(researchRoot, '..', 'bad-importance')
    const root = join(bad, '.research')
    writeTree(root, { 'project.yaml': 'id: PRJ-1\ntitle: 超限\nimportance: 9\ncreated_at: 2026-08-21T09:00:00Z\n' })
    const result = loadTree(root)
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/importance')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(e!.file).toBe('project.yaml')
    expect(e!.message).toContain('5')
    expect(result.tree.project).toBeNull()
  })

  it('real schema constraints: id pattern from ../common.schema.json $ref → SCHEMA pattern error', () => {
    const bad = join(researchRoot, '..', 'bad-id-pattern')
    const root = join(bad, '.research')
    writeTree(root, {
      'project.yaml': 'id: PRJ-1\ntitle: p\ncreated_at: 2026-08-21T09:00:00Z\n',
      'topics/TPC-1/topic.yaml': 'id: TPC-1\nproject_id: PRJ-1\ntitle: t\ncreated_at: 2026-08-21T09:05:00Z\n',
      'topics/TPC-1/workstreams/WS-1/workstream.yaml': 'id: ws-1\ntopic_id: TPC-1\ntitle: t\ncreated_at: 2026-08-21T09:10:00Z\n',
    })
    const result = loadTree(root)
    // schema pattern failure (frozen common.schema.json idWorkstream pattern);
    // the file is rejected at the schema stage (path-id checks run on valid docs only)
    const schemaErr = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/id')
    expect(schemaErr, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(schemaErr!.file).toBe('topics/TPC-1/workstreams/WS-1/workstream.yaml')
    expect(schemaErr!.message).toContain('WS-')
    expect(result.tree.topics[0]!.workstreams[0]!.doc).toBeNull()
  })

  it('real schema constraints: invalid date-time format → SCHEMA format error (ajv-formats)', () => {
    const bad = join(researchRoot, '..', 'bad-date')
    const root = join(bad, '.research')
    writeTree(root, {
      'project.yaml': 'id: PRJ-1\ntitle: p\ncreated_at: 2026-08-21T09:00:00Z\n',
      'topics/TPC-1/topic.yaml': 'id: TPC-1\nproject_id: PRJ-1\ntitle: t\ncreated_at: 2026-08-21T09:05:00Z\n',
      'topics/TPC-1/workstreams/WS-1/workstream.yaml': 'id: WS-1\ntopic_id: TPC-1\ntitle: t\ncreated_at: not-a-timestamp\n',
    })
    const result = loadTree(root)
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.file === 'topics/TPC-1/workstreams/WS-1/workstream.yaml')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(e!.path).toBe('/created_at')
    expect(e!.message.toLowerCase()).toContain('date-time')
    expect(e!.message).toContain('"not-a-timestamp"')
  })

  it('real schemaDir resolution: a schema dir missing common.schema.json ⇒ SCHEMA_LOAD, no document validated', () => {
    const broken = join(tmp, 'broken-schema-dir')
    mkdirSync(broken, { recursive: true })
    // copy the 11 declarative schemas but NOT the parent common.schema.json
    for (const f of readdirSync(WR_SCHEMA_DIR)) {
      writeFileSync(join(broken, f), readFileSync(join(WR_SCHEMA_DIR, f), 'utf8'), 'utf8')
    }
    const root = join(broken, '.research')
    writeTree(root, { 'schema-version': '1\n', 'project.yaml': 'id: PRJ-1\ntitle: p\ncreated_at: 2026-08-21T09:00:00Z\n' })
    // load against the BROKEN dir: its `../common.schema.json` does not exist
    const result = loadResearchTree(reader, root, broken)
    expect(result.errors.some((e) => e.code === 'SCHEMA_LOAD' && e.message.includes('common.schema.json'))).toBe(true)
    expect(result.errors.some((e) => e.code === 'SCHEMA_UNAVAILABLE' && e.file === 'project.yaml')).toBe(true)
    expect(result.tree.project).toBeNull()
  })
})

/** Write a root-relative file map to a real `.research` dir. */
function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }
}

/**
 * The user's Windows failure: the DSH host hands NATIVE workspace paths
 * (drive roots like `D:\Projects\…` / `C:\Users\…`), and the schema root is
 * resolved to a drive path too. The kernel join must (a) preserve the
 * drive root and (b) resolve `schemaDir/..` → `common.schema.json` — the
 * old POSIX-only `pjoin` collapsed `C:\…\schema\declarative` + `..` into a
 * bare `common.schema.json` (drive lost), so the frozen set looked "not
 * found" on every Windows startup.
 *
 * A Windows path is a LEGAL POSIX string, so we exercise the real fs
 * pipeline on this runner too: chdir into a scratch dir and build the
 * literal `C:/…` tree there — the kernel's normalized forward-slash output
 * resolves through the real reader exactly as it does on Windows.
 */
describe('WP-1.1 loader — Windows-native drive root (real fs, `..` resolution)', () => {
  // The on-disk (scratch-relative) mirror of `C:\…\schema\…`.
  const MIRROR_ROOT = 'C:/Users/user/.dsh/profiles/web/node_modules/dsh-research-control/schema'
  // The NATIVE Windows schemaDir the host would hand in (backslashes).
  const WIN_SCHEMA_DIR = 'C:\\Users\\user\\.dsh\\profiles\\web\\node_modules\\dsh-research-control\\schema\\declarative'

  class RelFsReader implements ResearchFileReader {
    readFile(path: string): string | null {
      if (!existsSync(path) || !statSync(path).isFile()) return null
      return readFileSync(path, 'utf8')
    }
    readDir(path: string): DirEntry[] | null {
      if (!existsSync(path) || !statSync(path).isDirectory()) return null
      return readdirSync(path, { withFileTypes: true }).map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
    }
  }

  const reader = new RelFsReader()
  let scratch: string
  let previousCwd: string

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'wp11-win-root-'))
    previousCwd = process.cwd()
    process.chdir(scratch)
    // mirror the frozen schema root under a literal `C:/…` dir
    const mirrorDeclarative = join(MIRROR_ROOT, 'declarative')
    mkdirSync(mirrorDeclarative, { recursive: true })
    for (const f of readdirSync(WR_SCHEMA_DIR)) {
      if (f.endsWith('.schema.json')) writeFileSync(join(mirrorDeclarative, f), readFileSync(join(WR_SCHEMA_DIR, f), 'utf8'))
    }
    writeFileSync(join(MIRROR_ROOT, 'common.schema.json'), readFileSync(join(dirname(WR_SCHEMA_DIR), 'common.schema.json'), 'utf8'))
  })

  afterAll(() => {
    process.chdir(previousCwd)
    rmSync(scratch, { recursive: true, force: true })
  })

  it('drive-root schemaDir: common.schema.json resolves via `..` and all 11 validators compile', () => {
    const errors: ResearchLoadError[] = []
    const { validators, commonFailed } = loadSchemas(reader, WIN_SCHEMA_DIR, errors)
    expect(errors, `unexpected schema errors: ${JSON.stringify(errors)}`).toEqual([])
    expect(commonFailed).toBe(false)
    expect(validators.size).toBe(11)
  })
})
