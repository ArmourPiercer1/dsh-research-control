/**
 * V2-UI-0.4 (Task 3) — `HierarchyService` unit suite (createTopic /
 * createWorkstream).
 *
 * Real artifacts, no mocks of the production path:
 *   - a REAL temp tree (the loader fixtures' complete valid base tree,
 *     `writeResearchTree` — PRJ-1 / TPC-1 / WS-1..WS-3);
 *   - the REAL frozen schemas at the WR root (`schema/declarative` —
 *     the loader validates the written files against them on the
 *     post-write reload);
 *   - the REAL fs ports (`FsResearchReader`-backed fresh load +
 *     pre-write probe, `FsPlanFileWriter` tmp+rename).
 *
 * The ONLY fakes are the seam itself (the TOCTOU collision cases: the
 * loader reports a clean tree WITHOUT the candidate id while the
 * pre-write probe sees the file — a concurrent creator between load
 * and write; the HIER_WRITE case: a writer that throws) — everything
 * else runs through the production implementations.
 *
 * The service kernel is I/O-injected (module doc), so every case here
 * also pins the injected-port contract (fresh load per call, probe
 * over the target FILE path, writer over the absolute path).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterAll, describe, expect, it } from 'vitest'

import { loadResearchTree } from '../../src/host/domain/loader/index.js'
import { FsResearchReader } from '../../src/host/service/checkpoint/index.js'
import { isoTimestampUtc } from '../../src/host/service/scaffold/index.js'
import { FsPlanFileWriter } from '../../src/host/service/fs/index.js'
import {
  HierarchyError,
  HierarchyService,
  isHierarchyError,
  topicYamlText,
  workstreamYamlText,
  type HierarchyLoadSnapshot,
} from '../../src/host/service/hierarchy/index.js'
import { WR_SCHEMA_ROOT, writeResearchTree } from '../wiring/helpers.js'

/** The pinned clock (the `created_at` source — one deterministic stamp). */
const NOW = 1_755_000_000_000
const NOW_ISO = isoTimestampUtc(NOW)
const DECLARATIVE_DIR = join(WR_SCHEMA_ROOT, 'declarative')

const dirs: string[] = []

function freshTree(patch: Record<string, string | null> = {}): {
  root: string
  researchRoot: string
  svc: HierarchyService
} {
  const root = mkdtempSync(join(tmpdir(), 'hierarchy-'))
  dirs.push(root)
  const researchRoot = writeResearchTree(root, patch)
  const reader = new FsResearchReader(researchRoot)
  const svc = new HierarchyService({
    loadTree: (): HierarchyLoadSnapshot =>
      loadResearchTree(reader, researchRoot, DECLARATIVE_DIR),
    writer: new FsPlanFileWriter(),
    fileExists: (absPath: string) => reader.readFile(absPath) !== null,
    researchRoot,
    now: () => NOW,
  })
  return { root, researchRoot, svc }
}

afterAll(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true })
  }
})

/** Reload the tree through the REAL loader over the REAL frozen
 *  schemas — the written file must come back clean (the minimal
 *  file-set discipline is proven by the loader itself). */
function reloadClean(researchRoot: string): HierarchyLoadSnapshot {
  const snap = loadResearchTree(new FsResearchReader(researchRoot), researchRoot, DECLARATIVE_DIR)
  expect(snap.errors).toEqual([])
  return snap
}

/** The error-family assertion helper (the CF suite's `expectCfCode`
 *  precedent): run `fn`, require a `HierarchyError` of `code`, and an
 *  optional substring of the message. Returns the error for extra
 *  assertions (cause preservation). */
function expectHierCode(fn: () => unknown, code: string, msgPart?: string): HierarchyError {
  try {
    fn()
  } catch (cause) {
    expect(cause).toBeInstanceOf(HierarchyError)
    const e = cause as HierarchyError
    expect(e.code).toBe(code)
    if (msgPart !== undefined) expect(e.message).toContain(msgPart)
    return e
  }
  expect.unreachable(`expected HierarchyError(code=${code}) but nothing was thrown`)
}

describe('hierarchy — pure YAML text builders (frozen key order, lineWidth 0)', () => {
  it('topicYamlText: the frozen required trio in schema property order, created_at last', () => {
    expect(topicYamlText({ id: 'TPC-2', projectId: 'PRJ-1', title: 'My topic', createdAtMs: NOW })).toBe(
      `id: TPC-2\nproject_id: PRJ-1\ntitle: My topic\ncreated_at: ${NOW_ISO}\n`,
    )
  })

  it('topicYamlText: description appears between title and created_at, only when supplied', () => {
    expect(
      topicYamlText({ id: 'TPC-2', projectId: 'PRJ-1', title: 'T', description: 'why', createdAtMs: NOW }),
    ).toBe(`id: TPC-2\nproject_id: PRJ-1\ntitle: T\ndescription: why\ncreated_at: ${NOW_ISO}\n`)
  })

  it('workstreamYamlText: id / topic_id / title / created_at (lifecycle deliberately absent — the frozen default materializes at load)', () => {
    expect(workstreamYamlText({ id: 'WS-4', topicId: 'TPC-1', title: 'New lane', createdAtMs: NOW })).toBe(
      `id: WS-4\ntopic_id: TPC-1\ntitle: New lane\ncreated_at: ${NOW_ISO}\n`,
    )
  })

  it('workstreamYamlText: summary between title and created_at, only when supplied', () => {
    expect(
      workstreamYamlText({ id: 'WS-4', topicId: 'TPC-1', title: 'T', summary: 'what', createdAtMs: NOW }),
    ).toBe(`id: WS-4\ntopic_id: TPC-1\ntitle: T\nsummary: what\ncreated_at: ${NOW_ISO}\n`)
  })

  it('both builders quote when YAML requires it (the wire text round-trips)', () => {
    const tricky = 'a: b # not a comment, just a value'
    // js-yaml-style quoting is picked by the `yaml` package (double for
    // this payload); the invariant is that the special characters
    // SURVIVE a real parse back to the original value.
    const t = topicYamlText({ id: 'TPC-2', projectId: 'PRJ-1', title: tricky, createdAtMs: NOW })
    const doc = parse(t) as { title: string; id: string; project_id: string; created_at: string }
    expect(doc.title).toBe(tricky)
    expect(doc.id).toBe('TPC-2')
    expect(doc.project_id).toBe('PRJ-1')
    expect(doc.created_at).toBe(NOW_ISO)
    const w = workstreamYamlText({ id: 'WS-4', topicId: 'TPC-1', title: tricky, createdAtMs: NOW })
    const wdoc = parse(w) as { title: string; id: string; topic_id: string }
    expect(wdoc.title).toBe(tricky)
    expect(wdoc.id).toBe('WS-4')
    expect(wdoc.topic_id).toBe('TPC-1')
  })
})

describe('hierarchy — createTopic (real tree, real fs, real frozen schemas)', () => {
  it('allocates TPC-2 and writes the minimal valid topic.yaml (loader-clean on reload)', () => {
    const { researchRoot, svc } = freshTree()
    const res = svc.createTopic({ title: 'Audit trail' })
    expect(res).toEqual({
      topicId: 'TPC-2',
      title: 'Audit trail',
      path: 'topics/TPC-2/topic.yaml',
      createdAt: NOW,
    })
    // The file IS the doc — the real loader over the real frozen schemas
    // accepts it (path-id rule, project_id ref, title bounds, ISO stamp).
    const snap = reloadClean(researchRoot)
    const topic = snap.tree.topics.find((t) => t.id === 'TPC-2')
    expect(topic?.doc).toEqual({
      id: 'TPC-2',
      project_id: 'PRJ-1',
      title: 'Audit trail',
      objective_refs: [],
      created_at: NOW,
    })
    // The directory holds ONLY topic.yaml (the minimal file set — no
    // fabricated topology.yaml / workstreams/).
    expect(existsSync(join(researchRoot, 'topics/TPC-2'))).toBe(true)
    expect(existsSync(join(researchRoot, 'topics/TPC-2/topic.yaml'))).toBe(true)
    expect(existsSync(join(researchRoot, 'topics/TPC-2/topology.yaml'))).toBe(false)
    expect(existsSync(join(researchRoot, 'topics/TPC-2/workstreams'))).toBe(false)
    // No tmp residue (the write protocol leaves nothing behind).
    expect(existsSync(join(researchRoot, 'topics/TPC-2/topic.yaml.dshrc-tmp'))).toBe(false)
  })

  it('carries the optional description into the written doc', () => {
    const { researchRoot, svc } = freshTree()
    svc.createTopic({ title: 'T', description: 'the why' })
    const snap = reloadClean(researchRoot)
    expect(snap.tree.topics.find((t) => t.id === 'TPC-2')?.doc?.description).toBe('the why')
  })

  it('is monotonic and gap-preserving: a burned TPC-2 is never reused (TPC-3 present ⇒ next is TPC-4)', () => {
    const tpc3 = `id: TPC-3\nproject_id: PRJ-1\ntitle: Third\ncreated_at: ${NOW_ISO}\n`
    const { svc } = freshTree({ 'topics/TPC-3/topic.yaml': tpc3 })
    const a = svc.createTopic({ title: 'A' })
    const b = svc.createTopic({ title: 'B' })
    expect(a.topicId).toBe('TPC-4')
    expect(b.topicId).toBe('TPC-5')
  })

  it('HIER_INPUT: an empty / over-long title is refused before any I/O', () => {
    const { svc } = freshTree()
    for (const title of ['', 'x'.repeat(201)]) {
      expectHierCode(() => svc.createTopic({ title }), 'HIER_INPUT')
    }
  })

  it('HIER_TREE_BROKEN: a rejected topic.yaml fails loud (no creation over a broken tree)', () => {
    // title minLength 1 — the frozen schema rejects it.
    const broken = `id: TPC-1\nproject_id: PRJ-1\ntitle: ""\ncreated_at: ${NOW_ISO}\n`
    const { svc } = freshTree({ 'topics/TPC-1/topic.yaml': broken })
    expectHierCode(() => svc.createTopic({ title: 'Nope' }), 'HIER_TREE_BROKEN', 'load error')
  })

  it('HIER_TREE_BROKEN: a load provider that throws is wrapped (cause preserved)', () => {
    const boom = new Error('disk on fire')
    const svc = new HierarchyService({
      loadTree: () => {
        throw boom
      },
      writer: new FsPlanFileWriter(),
      fileExists: () => false,
      researchRoot: '/x',
      now: () => NOW,
    })
    const e = expectHierCode(() => svc.createTopic({ title: 'T' }), 'HIER_TREE_BROKEN')
    expect(e.cause).toBe(boom)
  })

  it('HIER_TOPIC_EXISTS (TOCTOU): a clean load + a pre-write probe hit refuses the write (the id is burned, never overwritten)', () => {
    const root = mkdtempSync(join(tmpdir(), 'hierarchy-'))
    dirs.push(root)
    const researchRoot = writeResearchTree(root)
    const reader = new FsResearchReader(researchRoot)
    // The candidate file appears on disk AFTER the load (a concurrent
    // creator) — the real writer would rename over it; the probe must
    // catch that first.
    const raced = join(researchRoot, 'topics/TPC-2/topic.yaml')
    const svc = new HierarchyService({
      loadTree: () => loadResearchTree(reader, researchRoot, DECLARATIVE_DIR),
      writer: new FsPlanFileWriter(),
      fileExists: (p: string) =>
        p === raced ? true : reader.readFile(p) !== null,
      researchRoot,
      now: () => NOW,
    })
    expectHierCode(() => svc.createTopic({ title: 'Raced' }), 'HIER_TOPIC_EXISTS', 'TPC-2')
    // Nothing was written (the existing file — whatever it is — survives
    // untouched; here it never existed, which proves the no-partial-write).
    expect(existsSync(raced)).toBe(false)
  })

  it('HIER_WRITE: a writer failure is wrapped with the cause preserved', () => {
    const root = mkdtempSync(join(tmpdir(), 'hierarchy-'))
    dirs.push(root)
    const researchRoot = writeResearchTree(root)
    const reader = new FsResearchReader(researchRoot)
    const boom = new Error('EACCES')
    const svc = new HierarchyService({
      loadTree: () => loadResearchTree(reader, researchRoot, DECLARATIVE_DIR),
      writer: {
        writeAtomic(): void {
          throw boom
        },
      },
      fileExists: (p: string) => reader.readFile(p) !== null,
      researchRoot,
      now: () => NOW,
    })
    const e = expectHierCode(() => svc.createTopic({ title: 'T' }), 'HIER_WRITE')
    expect(e.cause).toBe(boom)
    // And nothing landed on disk (the failure is total, no partial file).
    expect(existsSync(join(researchRoot, 'topics/TPC-2'))).toBe(false)
  })

  it('HIER_WRITE: a pre-write probe that throws is wrapped (cannot-probe form, cause preserved)', () => {
    const root = mkdtempSync(join(tmpdir(), 'hierarchy-'))
    dirs.push(root)
    const researchRoot = writeResearchTree(root)
    const reader = new FsResearchReader(researchRoot)
    const boom = new Error('probe I/O gone')
    const svc = new HierarchyService({
      loadTree: () => loadResearchTree(reader, researchRoot, DECLARATIVE_DIR),
      writer: new FsPlanFileWriter(),
      fileExists: () => {
        throw boom
      },
      researchRoot,
      now: () => NOW,
    })
    const e = expectHierCode(
      () => svc.createTopic({ title: 'T' }),
      'HIER_WRITE',
      'createTopic: cannot probe topics/TPC-2/topic.yaml before writing: probe I/O gone',
    )
    expect(e.cause).toBe(boom)
    // And nothing landed on disk (the failure is total, no partial file).
    expect(existsSync(join(researchRoot, 'topics/TPC-2'))).toBe(false)
  })

  it('the constructor gates the port shape (HIER_INPUT, standalone safety)', () => {
    expect(() => new HierarchyService({} as never)).toThrow(HierarchyError)
  })
})

describe('hierarchy — createWorkstream (real tree, real fs, real frozen schemas)', () => {
  it('allocates WS-4 PROJECT-WIDE (max over all topics) and writes the minimal valid workstream.yaml', () => {
    const { researchRoot, svc } = freshTree()
    const res = svc.createWorkstream({ topicId: 'TPC-1', title: 'New lane' })
    expect(res).toEqual({
      workstreamId: 'WS-4',
      topicId: 'TPC-1',
      title: 'New lane',
      path: 'topics/TPC-1/workstreams/WS-4/workstream.yaml',
      createdAt: NOW,
    })
    const snap = reloadClean(researchRoot)
    const ws = snap.tree.topics
      .find((t) => t.id === 'TPC-1')
      ?.workstreams.find((w) => w.id === 'WS-4')
    expect(ws?.doc).toEqual({
      id: 'WS-4',
      topic_id: 'TPC-1',
      title: 'New lane',
      // The frozen default materialized at the loader boundary (the file
      // itself carries no lifecycle key).
      lifecycle: 'PLANNED',
      created_at: NOW,
    })
    // The directory holds ONLY workstream.yaml (no-plan-is-valid — the
    // factory's WS-2/WS-3 precedent).
    expect(existsSync(join(researchRoot, 'topics/TPC-1/workstreams/WS-4/workstream.yaml'))).toBe(true)
    expect(existsSync(join(researchRoot, 'topics/TPC-1/workstreams/WS-4/plan.yaml'))).toBe(false)
    expect(existsSync(join(researchRoot, 'topics/TPC-1/workstreams/WS-4/items'))).toBe(false)
  })

  it('carries the optional summary into the written doc', () => {
    const { researchRoot, svc } = freshTree()
    svc.createWorkstream({ topicId: 'TPC-1', title: 'T', summary: 'the what' })
    const snap = reloadClean(researchRoot)
    const ws = snap.tree.topics
      .find((t) => t.id === 'TPC-1')
      ?.workstreams.find((w) => w.id === 'WS-4')
    expect(ws?.doc?.summary).toBe('the what')
  })

  it('the scan is project-wide, not per-topic: a new topic with no workstreams still gets WS-4 (not WS-1)', () => {
    const tpc2 = `id: TPC-2\nproject_id: PRJ-1\ntitle: Second\ncreated_at: ${NOW_ISO}\n`
    const { researchRoot, svc } = freshTree({ 'topics/TPC-2/topic.yaml': tpc2 })
    const res = svc.createWorkstream({ topicId: 'TPC-2', title: 'New lane' })
    expect(res.workstreamId).toBe('WS-4')
    const snap = reloadClean(researchRoot)
    expect(snap.tree.topics.find((t) => t.id === 'TPC-2')?.workstreams.map((w) => w.id)).toEqual(['WS-4'])
  })

  it('HIER_TOPIC_NOT_FOUND: a topic that is not a node of this project is refused (the cross-project statement)', () => {
    const { researchRoot, svc } = freshTree()
    expectHierCode(
      () => svc.createWorkstream({ topicId: 'TPC-9', title: 'Ghost' }),
      'HIER_TOPIC_NOT_FOUND',
      'TPC-9',
    )
    // Nothing was written (the gate runs BEFORE allocation/write).
    expect(existsSync(join(researchRoot, 'topics/TPC-9'))).toBe(false)
  })

  it('HIER_INPUT: an empty topicId / over-long title is refused before any I/O', () => {
    const { svc } = freshTree()
    expectHierCode(() => svc.createWorkstream({ topicId: '', title: 'T' }), 'HIER_INPUT')
    expectHierCode(() => svc.createWorkstream({ topicId: 'TPC-1', title: 'x'.repeat(201) }), 'HIER_INPUT')
  })

  it('HIER_WORKSTREAM_EXISTS (TOCTOU): a clean load + a pre-write probe hit refuses the write', () => {
    const root = mkdtempSync(join(tmpdir(), 'hierarchy-'))
    dirs.push(root)
    const researchRoot = writeResearchTree(root)
    const reader = new FsResearchReader(researchRoot)
    const raced = join(researchRoot, 'topics/TPC-1/workstreams/WS-4/workstream.yaml')
    const svc = new HierarchyService({
      loadTree: () => loadResearchTree(reader, researchRoot, DECLARATIVE_DIR),
      writer: new FsPlanFileWriter(),
      fileExists: (p: string) => (p === raced ? true : reader.readFile(p) !== null),
      researchRoot,
      now: () => NOW,
    })
    expectHierCode(() => svc.createWorkstream({ topicId: 'TPC-1', title: 'Raced' }), 'HIER_WORKSTREAM_EXISTS', 'WS-4')
    expect(existsSync(raced)).toBe(false)
  })
})

describe(
  'hierarchy — allocation fail-loud (a node id that does not parse as its kind ⇒ HIER_TREE_BROKEN, never silently skipped — review F1)',
  () => {
    // The real loader can never hand these shapes over (its PATH_RULE
    // rejects such node directories at load time) — the injected seam
    // (loadTree) is the only route into the defensive branch.
    it('createTopic: a topic id that does not parse as a TOPIC id in a clean load fails loud', () => {
      const { researchRoot } = freshTree()
      const reader = new FsResearchReader(researchRoot)
      const base = loadResearchTree(reader, researchRoot, DECLARATIVE_DIR)
      const svc = new HierarchyService({
        loadTree: (): HierarchyLoadSnapshot => ({
          tree: { ...base.tree, topics: [...base.tree.topics, { ...base.tree.topics[0], id: 'TPC-x', path: 'topics/TPC-x' }] },
          errors: [],
        }),
        writer: new FsPlanFileWriter(),
        fileExists: (p: string) => reader.readFile(p) !== null,
        researchRoot,
        now: () => NOW,
      })
      expectHierCode(
        () => svc.createTopic({ title: 'T' }),
        'HIER_TREE_BROKEN',
        'node id "TPC-x" does not parse as a TOPIC id',
      )
    })

    it('createWorkstream: an unparseable workstream id — or a valid id of the WRONG kind — fails loud', () => {
      const { researchRoot } = freshTree()
      const reader = new FsResearchReader(researchRoot)
      const base = loadResearchTree(reader, researchRoot, DECLARATIVE_DIR)
      const poison = (badId: string): HierarchyService =>
        new HierarchyService({
          loadTree: (): HierarchyLoadSnapshot => ({
            tree: {
              ...base.tree,
              topics: base.tree.topics.map((t) => ({
                ...t,
                workstreams: [
                  ...t.workstreams,
                  { ...t.workstreams[0], id: badId, topicId: t.id, path: `topics/${t.id}/workstreams/${badId}` },
                ],
              })),
            },
            errors: [],
          }),
          writer: new FsPlanFileWriter(),
          fileExists: (p: string) => reader.readFile(p) !== null,
          researchRoot,
          now: () => NOW,
        })
      expectHierCode(
        () => poison('WS-x').createWorkstream({ topicId: 'TPC-1', title: 'T' }),
        'HIER_TREE_BROKEN',
        'node id "WS-x" does not parse as a WORKSTREAM id',
      )
      // A VALID id of the wrong kind (a topic id in the workstream list)
      // is refused by the same fail-loud branch.
      expectHierCode(
        () => poison('TPC-9').createWorkstream({ topicId: 'TPC-1', title: 'T' }),
        'HIER_TREE_BROKEN',
        'node id "TPC-9" does not parse as a WORKSTREAM id',
      )
    })
  },
)

describe('hierarchy — error family surface', () => {
  it('isHierarchyError discriminates the family (and rejects lookalikes)', () => {
    const err = new HierarchyError({ code: 'HIER_INPUT', message: 'x' })
    expect(isHierarchyError(err)).toBe(true)
    expect(isHierarchyError(new Error('x'))).toBe(false)
    expect(isHierarchyError(undefined)).toBe(false)
    expect(err.name).toBe('HierarchyError')
    expect(err.message).toBe('x')
  })
})
