/**
 * V2-T3.2b — unit tests for the minimal research-tree scaffold
 * (src/host/service/scaffold/, design §8 接入「脚手架最小树」):
 *
 *  - TREE SHAPE: the scaffold writes exactly the 最小树
 *    (`schema-version` + `project.yaml`, SCAFFOLD_FILES) and the
 *    scaffolded tree LOADS CLEAN through the REAL frozen declarative
 *    schemas (the shape is the loader's contract — a scaffold that
 *    breaks the loader would fail the plane wiring on the next
 *    discovery, so the loader acceptance is part of the shape);
 *  - PROJECT ID: explicit ids are honored + validated; the omitted id
 *    is allocated by the ids allocator from the `knownProjectIds`
 *    no-reuse seed (max known sequence + 1; empty seed → PRJ-1);
 *  - IDEMPOTENT REJECTION: an existing OCCUPIED tree location (a dir
 *    with content or a plain file) is refused with
 *    SCAFFOLD_TREE_EXISTS and left BYTE-INTACT; an EMPTY pre-created
 *    dir is scaffoldable (the create chain's own mkdir step leaves
 *    one behind before the scaffold step runs);
 *  - INPUT REJECTION: non-absolute wsPath, a treeDir that is not a bare
 *    segment, an empty/overlong display name, a missing wsPath.
 *
 * Real temp directories (mkdtemp) + real files — the same convention as
 * the registry/storage-locations suites.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import type { DirEntry, ResearchFileReader } from '../../src/host/domain/loader/index.js'
import {
  PROJECT_YAML_FILE,
  SCAFFOLD_FILES,
  SCHEMA_VERSION_FILE,
  ScaffoldError,
  allocateProjectId,
  isoTimestampUtc,
  projectYamlText,
  scaffoldResearchTree,
} from '../../src/host/service/scaffold/index.js'
import { WR_SCHEMA_DIR } from '../loader/fixtures.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const roots: string[] = []

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

/** A bare fs-backed reader (tests may do I/O; the loader kernel may not). */
class FsReader implements ResearchFileReader {
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

function readTree(rel: string): string {
  return readFileSync(rel, 'utf8')
}

describe('scaffold — tree shape (the 最小树 the loader accepts)', () => {
  it('writes exactly schema-version + project.yaml with the frozen required trio', () => {
    const ws = makeTemp('t32b-scaffold-shape-')
    const result = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: '机器人视觉定位系统',
      projectId: 'PRJ-7',
      now: () => 1770000000000,
    })
    expect(result.treePath).toBe(join(ws, '.research'))
    expect(result.projectId).toBe('PRJ-7')
    expect(result.files).toEqual(['schema-version', 'project.yaml'])
    // the on-disk inventory matches the declared files (nothing else)
    expect(readdirSync(result.treePath).sort()).toEqual(['project.yaml', 'schema-version'])
    expect(readTree(join(result.treePath, SCHEMA_VERSION_FILE))).toBe('1\n')
    const doc = parse(readTree(join(result.treePath, PROJECT_YAML_FILE))) as Record<string, unknown>
    expect(Object.keys(doc).sort()).toEqual(['created_at', 'id', 'title'])
    expect(doc['id']).toBe('PRJ-7')
    expect(doc['title']).toBe('机器人视觉定位系统')
    expect(doc['created_at']).toBe('2026-02-02T02:40:00Z') // 1770000000000 ms, UTC second precision
  })

  it('loads CLEAN through the real frozen declarative schemas (the shape contract)', () => {
    expect(existsSync(WR_SCHEMA_DIR), `real schema dir missing: ${WR_SCHEMA_DIR}`).toBe(true)
    const ws = makeTemp('t32b-scaffold-loader-')
    const result = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: 'Scaffolded project',
      projectId: 'PRJ-1',
    })
    const load = loadResearchTree(new FsReader(), result.treePath, WR_SCHEMA_DIR)
    expect(load.errors).toEqual([])
    expect(load.tree.project?.id).toBe('PRJ-1')
    expect(load.tree.project?.title).toBe('Scaffolded project')
    // the §14.1 defaults are materialized by the loader (the scaffold
    // deliberately leaves them out of the file)
    expect(load.tree.project?.importance).toBe(3)
    expect(load.tree.project?.attention_mode).toBe('NORMAL')
  })

  it('scaffolds under a RENAMED tree dir (the configured name is parameterized)', () => {
    const ws = makeTemp('t32b-scaffold-renamed-')
    const result = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.rctrl',
      displayName: 'Renamed tree',
      projectId: 'PRJ-2',
    })
    expect(result.treePath).toBe(join(ws, '.rctrl'))
    expect(readdirSync(join(ws, '.rctrl')).sort()).toEqual(['project.yaml', 'schema-version'])
  })
})

describe('scaffold — project id allocation (the ids allocator precedent)', () => {
  it('allocates max(known)+1 when projectId is omitted (no-reuse seed)', () => {
    const ws = makeTemp('t32b-scaffold-alloc-')
    const result = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: 'Allocated',
      knownProjectIds: ['PRJ-1', 'PRJ-3'],
    })
    expect(result.projectId).toBe('PRJ-4')
    const doc = parse(readTree(join(result.treePath, PROJECT_YAML_FILE))) as Record<string, unknown>
    expect(doc['id']).toBe('PRJ-4')
  })

  it('allocates PRJ-1 from an empty seed', () => {
    expect(allocateProjectId([])).toBe('PRJ-1')
    expect(allocateProjectId(['PRJ-42'])).toBe('PRJ-43')
  })

  it('Windows absolute wsPath passes validation (cross-platform — the host hands native paths)', () => {
    // 回归钉: 用户报障 `repoRoot must be an absolute path (got
    // "D:\Projects\AIUED")` 的同一类校验面（scaffold 此前用
    // node:path.isAbsolute — 平台相关，POSIX runner 上拒 Windows 路径）。
    // On this POSIX runner the Windows path is a legal LITERAL name:
    // chdir into a scratch dir, materialize it, and let the scaffold
    // prove the validation accepted it (a rejection would throw
    // SCAFFOLD_INPUT before any write).
    const previous = process.cwd()
    const scratch = makeTemp('t32b-win-')
    process.chdir(scratch)
    try {
      mkdirSync('D:\\Projects\\AIUED', { recursive: true })
      const result = scaffoldResearchTree({
        wsPath: 'D:\\Projects\\AIUED',
        treeDir: '.research',
        displayName: 'Win',
      })
      expect(result.projectId).toBe('PRJ-1')
      expect(result.treePath).toBe(join('D:\\Projects\\AIUED', '.research'))
      expect(existsSync(join('D:\\Projects\\AIUED', '.research', SCHEMA_VERSION_FILE))).toBe(true)
    } finally {
      process.chdir(previous)
    }
  })

  it('honors an explicit projectId and refuses a malformed one (SCAFFOLD_ID)', () => {
    const ws = makeTemp('t32b-scaffold-explicit-')
    const result = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: 'Pinned',
      projectId: 'PRJ-99',
    })
    expect(result.projectId).toBe('PRJ-99')
    expect(() =>
      scaffoldResearchTree({ wsPath: ws, treeDir: '.research2', displayName: 'Bad', projectId: 'X-1' }),
    ).toThrowError(ScaffoldError)
    expect(() =>
      scaffoldResearchTree({
        wsPath: ws,
        treeDir: '.research3',
        displayName: 'Bad seed',
        knownProjectIds: ['not-an-id'],
      }),
    ).toThrowError(/not a well-formed PROJECT id/)
  })
})

describe('scaffold — idempotent rejection (the clobber guard)', () => {
  it('refuses a second scaffold at the same location and leaves the tree byte-intact', () => {
    const ws = makeTemp('t32b-scaffold-clobber-')
    const first = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: 'First',
      projectId: 'PRJ-1',
    })
    const before = readTree(join(first.treePath, PROJECT_YAML_FILE))
    let err: unknown
    try {
      scaffoldResearchTree({
        wsPath: ws,
        treeDir: '.research',
        displayName: 'Second',
        projectId: 'PRJ-2',
      })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ScaffoldError)
    expect((err as ScaffoldError).code).toBe('SCAFFOLD_TREE_EXISTS')
    // the original tree is untouched
    expect(readTree(join(first.treePath, PROJECT_YAML_FILE))).toBe(before)
    expect(readdirSync(first.treePath).sort()).toEqual(['project.yaml', 'schema-version'])
  })

  it('scaffolds into an EMPTY pre-existing tree dir (the create chain leaves one behind)', () => {
    const ws = makeTemp('t32b-scaffold-empty-')
    // the create chain's own mkdir step (D §8.5 step order) leaves a bare
    // EMPTY tree dir behind before scaffoldTree runs — empty is scaffoldable
    mkdirSync(join(ws, '.research'))
    const out = scaffoldResearchTree({
      wsPath: ws,
      treeDir: '.research',
      displayName: 'Fresh',
      projectId: 'PRJ-9',
    })
    expect(out.treePath).toBe(join(ws, '.research'))
    expect(out.files).toEqual([...SCAFFOLD_FILES])
    // every scaffold file actually landed on disk
    for (const name of SCAFFOLD_FILES) {
      expect(existsSync(join(out.treePath, name))).toBe(true)
    }
    expect(readdirSync(out.treePath).sort()).toEqual([...SCAFFOLD_FILES].sort())
  })

  it('refuses when the tree location exists as a FILE (any kind blocks the scaffold)', () => {
    const ws = makeTemp('t32b-scaffold-file-')
    writeFileSync(join(ws, '.research'), 'not a directory', 'utf8')
    expect(() =>
      scaffoldResearchTree({ wsPath: ws, treeDir: '.research', displayName: 'Blocked' }),
    ).toThrowError(/already exists/)
    expect(readFileSync(join(ws, '.research'), 'utf8')).toBe('not a directory')
  })
})

describe('scaffold — input rejection (fail loud before any write)', () => {
  it('refuses a non-absolute wsPath, a slashed treeDir, an empty/overlong display name, a missing wsPath', () => {
    const ws = makeTemp('t32b-scaffold-input-')
    const probe = (input: Parameters<typeof scaffoldResearchTree>[0]): ScaffoldError => {
      try {
        scaffoldResearchTree(input)
      } catch (e) {
        expect(e).toBeInstanceOf(ScaffoldError)
        return e as ScaffoldError
      }
      throw new Error(`expected scaffoldResearchTree to reject ${JSON.stringify(input)}`)
    }
    expect(probe({ wsPath: 'relative/.research', treeDir: '.research', displayName: 'x' }).code).toBe('SCAFFOLD_INPUT')
    expect(probe({ wsPath: ws, treeDir: 'a/b', displayName: 'x' }).code).toBe('SCAFFOLD_INPUT')
    expect(probe({ wsPath: ws, treeDir: '.research', displayName: '' }).code).toBe('SCAFFOLD_INPUT')
    expect(probe({ wsPath: ws, treeDir: '.research', displayName: 'x'.repeat(201) }).code).toBe('SCAFFOLD_INPUT')
    expect(probe({ wsPath: join(ws, 'missing'), treeDir: '.research', displayName: 'x' }).code).toBe(
      'SCAFFOLD_INPUT',
    )
    // nothing was written by the rejected probes
    expect(existsSync(join(ws, '.research'))).toBe(false)
  })
})

describe('scaffold — pure text builders (byte-stable, YAML-safe)', () => {
  it('projectYamlText is byte-stable and quotes special characters exactly when YAML requires it', () => {
    const plain = projectYamlText('PRJ-1', '机器人视觉定位系统', '2026-08-21T09:00:00Z')
    expect(plain).toBe('id: PRJ-1\ntitle: 机器人视觉定位系统\ncreated_at: 2026-08-21T09:00:00Z\n')
    // round-trip: a display name with YAML-active characters survives
    const tricky = 'a: b "c" #d\nmulti'
    const doc = parse(projectYamlText('PRJ-2', tricky, '2026-08-21T09:00:00Z')) as Record<string, unknown>
    expect(doc['title']).toBe(tricky)
  })

  it('isoTimestampUtc renders UTC second precision (the factory created_at style)', () => {
    expect(isoTimestampUtc(0)).toBe('1970-01-01T00:00:00Z')
    expect(isoTimestampUtc(1770000000123)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})
