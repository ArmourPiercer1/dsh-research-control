/**
 * EB1 (AD-EB-01) — in-repo canonical surface gates.
 *
 * The release-time SI-001 parent-copy mechanism is retired: `schema/**` +
 * the 8 root docs inside THIS repo are the single canonical source, and
 * `scripts/snapshot-release.mjs` is a verify-mode validator with an explicit
 * --update regeneration mode. These tests pin the migration contract:
 *
 *  V1  verify mode passes on a fixture matching its manifest (hermetic mini
 *      repo — never the real tree, so mutation cases cannot damage it);
 *  V2  DSH_SNAPSHOT_SOURCE_ROOT (any value) is FATAL — no external source
 *      can be resurrected, hostile parent roots are inert;
 *  V3  corruption of a schema file is caught (CONTRACT_DRIFT);
 *  V4  a file present in the tree but absent from the manifest is caught
 *      (bidirectional set check, both directions);
 *  V5  --update is deterministic (byte-identical re-runs; no timestamps or
 *      machine paths leak into the manifest);
 *  V6  build-artifact freshness: check-build-freshness passes on a fresh
 *      mini repo, flags tampered committed artifacts (LIB_STALE), and
 *      normalizes ONLY the documented rcm-css build-path pattern.
 *
 * The real-repo real-manifest assertion (V7) is cheap and read-only: it
 * re-locks the ratified surface (G0-inventory) against SNAPSHOT.md.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO = dirname(dirname(__dirname))
const SCRIPT = join(REPO, 'scripts', 'snapshot-release.mjs')
const FRESHNESS = join(REPO, 'scripts', 'check-build-freshness.mjs')
const DOCS = [
  'ARCHITECTURE.md',
  'DOMAIN_SCHEMA.md',
  'DSH_ADAPTER.md',
  'GIT_INTEGRATION.md',
  'HISTORY_EVENT_CATALOG.md',
  'PLAN_FORK_SPEC.md',
  'SUBAGENT_ROUTING.md',
  'TEST_MATRIX.md',
]

const roots: string[] = []
const mkFixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'eb1-fixture-'))
  roots.push(dir)
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'schema'), { recursive: true })
  copyFileSync(SCRIPT, join(dir, 'scripts', 'snapshot-release.mjs'))
  copyFileSync(FRESHNESS, join(dir, 'scripts', 'check-build-freshness.mjs'))
  for (const d of DOCS) writeFileSync(join(dir, d), `# ${d}\nfixture doc\n`)
  writeFileSync(join(dir, 'schema', 'common.schema.json'), '{"$schema":"https://json-schema.org/draft/2020-12/schema"}\n')
  writeFileSync(join(dir, 'schema', 'extra.schema.json'), '{"title":"extra"}\n')
  return dir
}
const runScript = (dir: string, args: string[] = [], env: Record<string, string> = {}) => {
  try {
    const out = execFileSync(process.execPath, [join(dir, 'scripts', 'snapshot-release.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: (e as { status?: number }).status ?? -1, out: `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` }
  }
}
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=eb1-fixture', '-c', 'user.email=eb1@fixture', ...args], { cwd: dir, encoding: 'utf8' })

afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('EB1 V1/V2/V3/V4/V5 — snapshot-release.mjs is an in-repo validator', () => {
  it('V1 verify mode passes when tree and manifest agree', () => {
    const dir = mkFixture()
    expect(runScript(dir, ['--update']).code).toBe(0)
    const r = runScript(dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('verified: 10 canonical files')
  })

  it('V2 DSH_SNAPSHOT_SOURCE_ROOT is refused for any value (hostile parent roots are inert)', () => {
    const dir = mkFixture()
    runScript(dir, ['--update'])
    for (const value of [dir, '/nonexistent-parent-fixture', '']) {
      const r = runScript(dir, [], { DSH_SNAPSHOT_SOURCE_ROOT: value })
      expect(r.code).toBe(1)
      expect(r.out).toContain('EXTERNAL_SOURCE_RETIRED')
    }
    // and the surface survived untouched:
    expect(runScript(dir).code).toBe(0)
  })

  it('V3 a corrupted schema file is caught (CONTRACT_DRIFT)', () => {
    const dir = mkFixture()
    runScript(dir, ['--update'])
    writeFileSync(join(dir, 'schema', 'extra.schema.json'), '{"title":"CORRUPTED"}\n')
    const r = runScript(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('CONTRACT_DRIFT')
    expect(r.out).toContain('schema/extra.schema.json')
  })

  it('V4 both set-difference directions are caught', () => {
    const dir = mkFixture()
    runScript(dir, ['--update'])
    unlinkSync(join(dir, 'schema', 'extra.schema.json'))
    const gone = runScript(dir)
    expect(gone.code).toBe(1)
    expect(gone.out).toContain('absent from tree')
    writeFileSync(join(dir, 'schema', 'extra.schema.json'), '{"title":"extra"}\n')
    writeFileSync(join(dir, 'schema', 'smuggled.schema.json'), '{"title":"undeclared"}\n')
    const extra = runScript(dir)
    expect(extra.code).toBe(1)
    expect(extra.out).toContain('not declared in SNAPSHOT.md')
  })

  it('V5 --update is deterministic: byte-identical reruns, no volatile content', () => {
    const dir = mkFixture()
    expect(runScript(dir, ['--update']).code).toBe(0)
    const first = readFileSync(join(dir, 'SNAPSHOT.md'), 'utf8')
    execFileSync(process.execPath, ['--version'])
    expect(runScript(dir, ['--update']).code).toBe(0)
    const second = readFileSync(join(dir, 'SNAPSHOT.md'), 'utf8')
    expect(second).toBe(first)
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/) // no generation timestamp
    expect(first).not.toContain(process.env['HOME'] ?? '/home/NOPE') // no machine paths
  })
})

describe('EB1 V6 — committed build artifacts are freshness-checked', () => {
  it('passes when HEAD artifacts equal the tree, flags tampering, normalizes only rcm-css noise', () => {
    const dir = mkFixture()
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'lib', 'index.js'), 'export const a = 1\n//#region \\0rcm-css:/machine/one/path\n')
    git(dir, 'init', '-q', '.').trim()
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', 'fixture baseline')
    const run = () => {
      try {
        return { code: 0, out: execFileSync(process.execPath, [join(dir, 'scripts', 'check-build-freshness.mjs')], { encoding: 'utf8', env: { ...process.env, HOME: dir } }) }
      } catch (e) {
        return { code: (e as { status?: number }).status ?? -1, out: `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` }
      }
    }
    expect(run().code).toBe(0)
    // the documented noise pattern normalizes away:
    writeFileSync(join(dir, 'lib', 'index.js'), 'export const a = 1\n//#region \\0rcm-css:/machine/TWO/other-path\n')
    expect(run().code).toBe(0)
    // any other byte is real drift:
    writeFileSync(join(dir, 'lib', 'index.js'), 'export const a = 2\n//#region \\0rcm-css:/machine/TWO/other-path\n')
    const stale = run()
    expect(stale.code).toBe(1)
    expect(stale.out).toContain('LIB_STALE')
  })
})

describe('EB1 V7 — the real ratified surface', () => {
  beforeAll(() => {
    expect(readFileSync(join(REPO, 'package.json'), 'utf8')).toContain('snapshot:update')
  })
  it('the repo tree matches SNAPSHOT.md exactly (ratified content survives the migration byte-for-byte)', () => {
    const r = runScript(REPO)
    expect(r.code).toBe(0)
    expect(r.out).toContain('verified: 31 canonical files')
  })
  it('every G0-ratified hash still matches the working tree', () => {
    const inv = JSON.parse(readFileSync(join(REPO, 'docs', 'engineering-baseline', 'gates', 'G0-inventory.yaml'), 'utf8'))
    const sha = (p: string) => createHash('sha256').update(readFileSync(join(REPO, p))).digest('hex')
    for (const f of [...inv.root_docs, ...inv.schema.files]) {
      expect(sha(f.path), f.path).toBe(f.sha256)
    }
    expect(sha('SNAPSHOT.md')).not.toBe('') // regenerated manifest exists and is readable
  })
})
