/**
 * EB2 — docs discipline gates（计划 PoC 矩阵 → 永久回归）.
 *
 * 与 scripts/docs/kernel.mjs 同一规则源（这里既测内核函数也测 CLI 行为），
 * 本地与 CI 因此共享一致结果（G2 判据「不得两份相异规则」）。
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { checkAdrs, checkAll, checkLinks, checkRegistry, docTier, globToRe, ownershipFor, parseMiniYaml, probeFindings, SYNC_WHITELIST } from '../../scripts/docs/kernel.mjs'

const REPO = dirname(dirname(__dirname))
const roots: string[] = []
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'eb2-fixture-'))
  roots.push(d)
  mkdirSync(join(d, 'dev/engineering'), { recursive: true })
  copyFileSync(join(REPO, 'dev/engineering/doc-ownership.yaml'), join(d, 'dev/engineering/doc-ownership.yaml'))
  copyFileSync(join(REPO, 'dev/engineering/registry.yaml'), join(d, 'dev/engineering/registry.yaml'))
  mkdirSync(join(d, 'scripts'), { recursive: true })
  copyFileSync(join(REPO, 'scripts/snapshot-release.mjs'), join(d, 'scripts/snapshot-release.mjs'))
  mkdirSync(join(d, 'schema'), { recursive: true })
  writeFileSync(join(d, 'schema/common.schema.json'), '{}\n')
  for (const f of ['ARCHITECTURE.md', 'DOMAIN_SCHEMA.md', 'DSH_ADAPTER.md', 'GIT_INTEGRATION.md', 'HISTORY_EVENT_CATALOG.md', 'PLAN_FORK_SPEC.md', 'SUBAGENT_ROUTING.md', 'TEST_MATRIX.md']) writeFileSync(join(d, f), `# ${f}\n`)
  // the fixture registry references gates + evidence — give them honest stubs
  mkdirSync(join(d, 'docs/engineering-baseline/gates'), { recursive: true })
  mkdirSync(join(d, 'tests/engineering'), { recursive: true })
  // honest stubs for every non-PENDING stage the registry references (so the
  // fixture starts clean without hard-coding the current stage list)
  const reg = parseMiniYaml(readFileSync(join(d, 'dev/engineering/registry.yaml'), 'utf8'), 'reg')
  for (const s of Object.values<any>(reg.stages)) {
    if (s.verdict === 'PENDING') continue
    writeFileSync(join(d, s.gate), `# ${s.gate}\n> **结果：PASS**\n`)
    for (const ev of Array.isArray(s.evidence) ? s.evidence : []) {
      mkdirSync(dirname(join(d, ev)), { recursive: true })
      writeFileSync(join(d, ev), 'stub\n')
    }
  }
  execFileSync(process.execPath, [join(d, 'scripts/snapshot-release.mjs'), '--update'])
  return d
}

afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('EB2 P1 — docs:probe impact mapping (plan PoC matrix)', () => {
  it('src/host/history/ change → event catalog / replay contract + matching tests', () => {
    const f = probeFindings(mk(), ['src/host/history/replay-engine.ts'])
    const codes = f.flatMap((x) => x.codes)
    expect(codes).toContain('EVENT_REPLAY_SEMANTICS')
    const hit = f.find((x) => x.codes.includes('EVENT_REPLAY_SEMANTICS'))
    expect(hit?.docs).toContain('HISTORY_EVENT_CATALOG.md')
    expect(hit?.tests?.some((t) => String(t).includes('history'))).toBe(true)
  })
  it('src/host/dsh-adapter/ change → host pin + T3 gate named', () => {
    const f = probeFindings(mk(), ['src/host/dsh-adapter/host/index.ts'])
    const hit = f.find((x) => x.codes.includes('HOST_ADAPTER_PIN'))
    expect(hit?.gate).toContain('T3')
    expect(hit?.docs).toContain('DSH_ADAPTER.md')
  })
  it('schema/operational/ change → Schema/Contract impact', () => {
    const f = probeFindings(mk(), ['schema/operational/whatever.schema.json'])
    const hit = f.find((x) => x.codes.includes('CONTRACT_SURFACE'))
    expect(hit?.severity).toBe('blocking')
    expect(hit?.actions?.join()).toContain('snapshot:update')
  })
  it('unowned new dir → DOC_IMPACT_UNOWNED advisory hint (not a hard block)', () => {
    const f = probeFindings(mk(), ['brandnew/module/x.ts'])
    const un = f.find((x) => x.codes.includes('DOC_IMPACT_UNOWNED'))
    expect(un?.severity).toBe('advisory')
  })
})

describe('EB2 P2 — docs:check negatives (plan PoC: 坏链接 / 重复 ADR ID / 虚假 verified evidence)', () => {
  it('broken relative link fails', () => {
    const d = mk()
    mkdirSync(join(d, 'docs'), { recursive: true })
    writeFileSync(join(d, 'docs/x.md'), 'see [target](./missing.md)\n')
    expect(checkLinks(d, ['docs/x.md']).some((p) => p.code === 'BROKEN_LINK')).toBe(true)
    writeFileSync(join(d, 'docs/missing.md'), 'now here\n')
    expect(checkLinks(d, ['docs/x.md'])).toEqual([])
  })
  it('duplicate ADR id fails; clean ADRs pass', () => {
    const d = mk()
    mkdirSync(join(d, 'docs/decisions'), { recursive: true })
    const adr = (id: string) => `---\nid: ${id}\nstatus: accepted\ntitle: t\ndate: 2026-10-26\n---\n# x\n`
    writeFileSync(join(d, 'docs/decisions/ADR-0001-a.md'), adr('ADR-0001'))
    expect(checkAdrs(d, ['docs/decisions/ADR-0001-a.md'])).toEqual([])
    writeFileSync(join(d, 'docs/decisions/ADR-0002-b.md'), adr('ADR-0001'))
    expect(checkAdrs(d, ['docs/decisions/ADR-0001-a.md', 'docs/decisions/ADR-0002-b.md']).some((p) => p.code === 'ADR_DUP_ID')).toBe(true)
  })
  it('fake verified evidence fails: status=verified without evidence, and evidence pointing at a nonexistent file', () => {
    const d = mk()
    mkdirSync(join(d, 'docs/decisions'), { recursive: true })
    writeFileSync(join(d, 'docs/decisions/ADR-0009-fake.md'), '---\nid: ADR-0009\nstatus: verified\ntitle: t\ndate: 2026-10-26\n---\n# x\n')
    expect(checkAdrs(d, ['docs/decisions/ADR-0009-fake.md']).some((p) => p.code === 'EVIDENCE_MISSING')).toBe(true)
    writeFileSync(join(d, 'docs/decisions/ADR-0009-fake.md'), '---\nid: ADR-0009\nstatus: verified\ntitle: t\ndate: 2026-10-26\nevidence: [docs/evidence/never-ran.log]\n---\n# x\n')
    expect(checkAdrs(d, ['docs/decisions/ADR-0009-fake.md']).some((p) => p.code === 'EVIDENCE_MISSING')).toBe(true)
  })
  it('registry: gate verdict missing evidence file = EVIDENCE_MISSING; verdict vocabulary enforced; dual-authority mismatch caught', () => {
    const d = mk()
    expect(checkRegistry(d)).toEqual([])
    const reg = readFileSync(join(d, 'dev/engineering/registry.yaml'), 'utf8')
    writeFileSync(join(d, 'dev/engineering/registry.yaml'), reg.replace('      - tests/engineering/eb1-canonical.test.ts', '      - tests/engineering/eb-DOES-NOT-EXIST.test.ts'))
    expect(checkRegistry(d).some((p: { code: string }) => p.code === 'EVIDENCE_MISSING')).toBe(true)
    writeFileSync(join(d, 'dev/engineering/registry.yaml'), reg.replace('  EB0_G0:\n    verdict: PASS', '  EB0_G0:\n    verdict: GREEN'))
    expect(checkRegistry(d).some((p: { code: string }) => p.code === 'GATE_VERDICT')).toBe(true)
    mkdirSync(join(d, 'docs/engineering-baseline/gates'), { recursive: true })
    writeFileSync(join(d, 'docs/engineering-baseline/gates/G0.md'), '# g\n> **结果：BLOCKED**\n')
    writeFileSync(join(d, 'dev/engineering/registry.yaml'), reg)
    expect(checkRegistry(d).some((p: { code: string }) => p.code === 'DUAL_AUTHORITY_MISMATCH')).toBe(true)
  })
  it('checkAll is read-only: running it never modifies tracked content', () => {
    const d = mk()
    mkdirSync(join(d, 'docs'), { recursive: true })
    writeFileSync(join(d, 'docs/README.md'), `# i\n\n${'<!-- docs:sync:begin -->\nold\n<!-- docs:sync:end -->'}`)
    const before = readFileSync(join(d, 'docs/README.md'), 'utf8')
    const problems = checkAll(d, ['docs/README.md', 'SNAPSHOT.md'], { trackedMd: ['docs/README.md'] })
    expect(problems.some((p) => p.code === 'DOCS_INDEX_STALE')).toBe(true)
    expect(readFileSync(join(d, 'docs/README.md'), 'utf8')).toBe(before)
  })
})

describe('EB2 P3 — docs:sync write boundary (negative controls)', () => {
  const run = (args: string[], cwd: string) => {
    try {
      return { code: 0, out: execFileSync('node', [join(REPO, 'scripts/docs/sync.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } }) }
    } catch (e) {
      return { code: (e as { status?: number }).status ?? -1, out: `${(e as { stdout?: string }).stdout ?? ''}${(e as { stderr?: string }).stderr ?? ''}` }
    }
  }
  it('refuses AGENTS.md / frozen contract / ADR / registry / source even with --write', () => {
    for (const target of ['AGENTS.md', 'SNAPSHOT.md', 'docs/decisions/ADR-0001-in-repo-canonical-source.md', 'dev/engineering/registry.yaml', 'src/host/index.ts']) {
      const r = run(['--write', target], REPO)
      expect(r.code, target).toBe(1)
      expect(r.out, target).toContain('SYNC_REFUSED')
    }
    expect(SYNC_WHITELIST).toEqual(['docs/README.md'])
  })
  it('writes ONLY the whitelisted derived block; restoring staleness self-heals deterministically', () => {
    const readme = join(REPO, 'docs', 'README.md')
    const before = readFileSync(readme, 'utf8')
    expect(run(['--write'], REPO).code).toBe(0) // already current → byte-identical no-op
    expect(readFileSync(readme, 'utf8')).toBe(before)
    const stale = before.replace(/<!-- docs:sync:begin -->\n[\s\S]*?\n<!-- docs:sync:end -->/, '<!-- docs:sync:begin -->\nSTALE SENTENCE\n<!-- docs:sync:end -->')
    expect(stale).not.toBe(before)
    writeFileSync(readme, stale)
    try {
      expect(run(['--write'], REPO).code).toBe(0)
      expect(readFileSync(readme, 'utf8')).toBe(before)
    } finally {
      writeFileSync(readme, before)
    }
  })
})

describe('EB2 P4 — kernel integrity', () => {
  it('yaml subset parser round-trips the real registry and ownership files', () => {
    const reg = parseMiniYaml(readFileSync(join(REPO, 'dev/engineering/registry.yaml'), 'utf8'), 'registry')
    expect(reg.stages.EB0_G0.verdict).toBe('PASS')
    expect(Array.isArray(reg.stages.EB1_G1.evidence)).toBe(true)
    const own = parseMiniYaml(readFileSync(join(REPO, 'dev/engineering/doc-ownership.yaml'), 'utf8'), 'ownership')
    expect(Array.isArray(own.rules)).toBe(true)
    expect(typeof own.rules[0].glob).toBe('string') // 首位存在即可（顺序=最具体优先，内容可演进）
    expect(own.rules.some((r: { glob?: string; owner?: string }) => r.glob === 'schema/**' && r.owner === 'contract-frozen')).toBe(true)
  })
  it('导航分层兑现 docs/README 图例：Proposed 层覆盖 V3 设计线，长稿归 Historical', () => {
    expect(docTier('docs/architecture/CORE_SEMANTICS.md')).toBe('Proposed') // 设计线未生效提案
    expect(docTier('docs/poc/V3_POC_EXECUTION_PLAN.md')).toBe('Proposed') // PoC 计划=提案非 Current
    expect(docTier('docs/design/V3_TYPED_RESEARCH_EPISTEMICS_ARCHITECTURE_DRAFT.md')).toBe('Historical')
    expect(docTier('docs/engineering-baseline/gates/G3.md')).toBe('Current') // 现行层不受影响
    expect(docTier('docs/whatever-unranked.md')).toBe('Unranked') // 兜底语义保留
  })
  it('ownership: most-specific-first and OR-globs behave', () => {
    const rules = loadRules()
    expect(ownershipFor(rules, 'schema/history/e1.json').owner).toBe('contract-frozen')
    expect(ownershipFor(rules, 'src/host/dsh-adapter/host/index.ts').risk).toBe('blocking')
    expect(ownershipFor(rules, 'src/client/x.ts').owner).toBe('ui')
    expect(ownershipFor(rules, 'weird/deep/x.ts').owner).toBe('UNOWNED')
    expect(globToRe('src/**').test('src/a/b.ts')).toBe(true)
    expect(globToRe('src/*.ts').test('src/a/b.ts')).toBe(false)
  })
  it('the real repo passes the full static check (same kernel CI will run)', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(checkAll(REPO, tracked)).toEqual([])
  })
})

  it('docs:probe --paths 收到文档而非清单时 fail-loud（DX 守卫）', () => {
    const d = mk()
    const list = join(d, 'good-list.txt')
    writeFileSync(list, 'docs/development.md\nsrc/host/index.ts\n')
    const good = execFileSync('node', [join(REPO, 'scripts/docs/probe.mjs'), '--paths', list], { cwd: REPO, encoding: 'utf8' })
    expect(good).toContain('docs:probe')
    const doc = join(d, 'spec-like.md')
    writeFileSync(doc, '# 某契约文档\n\n```jsonc\n{ "x": 1 }\n```\n\n| 列 | 列 |\n|---|---|\n\n**硬规则** 正文。\n')
    let code = 0
    let err = ''
    try {
      execFileSync('node', [join(REPO, 'scripts/docs/probe.mjs'), '--paths', doc], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      code = (e as { status?: number }).status ?? -1
      err = String((e as { stderr?: string }).stderr ?? e)
    }
    expect(code, `文档当清单传必须 exit 2，实际 ${code}（当前会把正文逐行当路径吞掉）`).toBe(2)
    expect(err).toContain('--paths')
  })

describe('EB3 P5 — principled-Draft ADR class (docs/architecture/adr/, PR #9 intake)', () => {
  const adrFix = () => {
    const d = mk()
    mkdirSync(join(d, 'docs/architecture/adr'), { recursive: true })
    writeFileSync(join(d, 'docs/architecture/adr/D90_ALPHA.md'), '# D90 — alpha\n\n**状态**：原则已同意，2026-10；实现未冻结。\n')
    writeFileSync(join(d, 'docs/architecture/adr/D91_BETA.md'), '# D91 — beta\n\n**状态**：暂时同意待 PoC。\n')
    writeFileSync(join(d, 'docs/architecture/adr/README.md'), '# idx\n| D90 | [D90_ALPHA](D90_ALPHA.md) |\n| D91 | [D91_BETA](D91_BETA.md) |\n')
    return d
  }
  const adrFiles = ['docs/architecture/adr/D90_ALPHA.md', 'docs/architecture/adr/D91_BETA.md', 'docs/architecture/adr/README.md']
  it('正例：id 唯一 + 状态行 + 入索引 = clean（词汇内容自由，不做状态映射）', () => {
    expect(checkAdrs(adrFix(), adrFiles)).toEqual([])
  })
  it('负例：重复 D-id / 缺状态行 / 索引孤儿各自红', () => {
    const d = adrFix()
    writeFileSync(join(d, 'docs/architecture/adr/D90_DUP.md'), '# D90 dup\n\n**状态**：x。\n')
    writeFileSync(join(d, 'docs/architecture/adr/README.md'), '# idx\n| D90 | [D90_ALPHA](D90_ALPHA.md) | [D90_DUP](D90_DUP.md) |\n| D91 | [D91_BETA](D91_BETA.md) |\n')
    let p = checkAdrs(d, [...adrFiles, 'docs/architecture/adr/D90_DUP.md'])
    expect(p.some((x) => x.code === 'ADR_DUP_ID' && String(x.detail).includes('D90'))).toBe(true)
    const d2 = adrFix()
    writeFileSync(join(d2, 'docs/architecture/adr/D90_ALPHA.md'), '# D90 — alpha\n\n没有状态行。\n')
    p = checkAdrs(d2, adrFiles)
    expect(p.some((x) => x.code === 'ADR_STATUS' && x.where.includes('D90_ALPHA'))).toBe(true)
    const d3 = adrFix()
    writeFileSync(join(d3, 'docs/architecture/adr/README.md'), '# idx\n| D90 | [D90_ALPHA](D90_ALPHA.md) |\n')
    p = checkAdrs(d3, adrFiles)
    expect(p.some((x) => x.code === 'ADR_ORPHAN' && x.where.includes('D91'))).toBe(true)
  })
  it('正例：PR #9 真实八件套通过类规则（试运行树存在时核对）', () => {
    const adrDir = join(REPO, '.scratch/wt9/docs/architecture/adr')
    if (!existsSync(adrDir)) return // 试运行 worktree 是本地证据面，缺失不算红
    const d = mk()
    mkdirSync(join(d, 'docs/architecture/adr'), { recursive: true })
    const files = readdirSync(adrDir).map((f) => {
      copyFileSync(join(adrDir, f), join(d, 'docs/architecture/adr', f))
      return `docs/architecture/adr/${f}`
    })
    expect(files.length).toBeGreaterThanOrEqual(9) // 8 件 + 索引
    expect(checkAdrs(d, files)).toEqual([])
  })
})

const loadRules = () => parseMiniYaml(readFileSync(join(REPO, 'dev/engineering/doc-ownership.yaml'), 'utf8'), 'ownership').rules
