/**
 * EB2 — docs kernel（唯一规则源）.
 *
 * `docs:probe` / `docs:check` / `docs:sync` 三个薄入口和 vitest 的 PoC 测试都
 * 从这里取规则——不存在「本地一套、CI 一套」的双规则（G2 判据）。
 * 纯函数 + 显式 root：CLI 传 process.cwd()，测试传 fixture 目录。
 *
 * 边界（AD-EB-02）：本内核只裁决**静态一致性**（文件在不在、哈希、链接、
 * 归属、状态词汇）。它不能也不需要声称任何实证/真机结论——那是 Gate 记录里
 * evidence 指针的职责；把静态一致当作「verified」正是本内核拒绝的形态。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/* ------------------------------------------------------------------ *
 * 受限 YAML 子集（我们自己写的两个 dev/ 文件用；无第三方依赖）
 * 支持：`key:`、`key: value`、嵌套 map（2 空格缩进）、flow list `[a, b]`、
 * block list（`- item`）、`#` 注释。不支持的东西一律抛错（宁可红不误读）。
 * ------------------------------------------------------------------ */
export function parseMiniYaml(text, where = 'yaml') {
  const lines = text.split('\n').filter((l) => !/^\s*(#.*)?$/.test(l))
  const unq = (v) => (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) ? v.slice(1, -1) : v
  const parseScalar = (raw) => {
    const v = raw.trim()
    if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map((x) => unq(x.trim())).filter(Boolean)
    return unq(v)
  }
  const pos = { i: 0 }
  const parseMapInto = (obj, indent) => {
    while (pos.i < lines.length && countIndent(lines[pos.i]) === indent && !/^\s*-\s/.test(lines[pos.i])) {
      const m = lines[pos.i].match(/^\s*([^:]+):\s*(.*)$/)
      if (!m) throw new Error(`${where}: unparsable line: ${lines[pos.i]}`)
      const key = m[1].trim()
      const rest = m[2]
      pos.i += 1
      if (rest === '') {
        const next = lines[pos.i]
        obj[key] = next !== undefined && countIndent(next) > indent ? parseBlock(countIndent(next)) : {}
      } else obj[key] = parseScalar(rest)
    }
  }
  const parseBlock = (indent) => {
    const first = lines[pos.i]
    if (first === undefined || countIndent(first) < indent) return undefined
    if (/^\s*-\s/.test(first)) {
      const arr = []
      while (pos.i < lines.length && countIndent(lines[pos.i]) === indent && /^\s*-\s/.test(lines[pos.i])) {
        const content = lines[pos.i].slice(indent + 1).trim()
        const km = content.match(/^([^:]+):\s*(.*)$/)
        if (!km) {
          arr.push(parseScalar(content))
          pos.i += 1
          continue
        }
        const item = {}
        pos.i += 1 // consume the "- key: ..." line
        if (km[2] !== '') item[km[1].trim()] = parseScalar(km[2])
        else {
          const next = lines[pos.i]
          item[km[1].trim()] = next !== undefined && countIndent(next) > indent + 2 ? parseBlock(countIndent(next)) : {}
        }
        if (pos.i < lines.length && countIndent(lines[pos.i]) === indent + 2 && !/^\s*-\s/.test(lines[pos.i])) parseMapInto(item, indent + 2)
        arr.push(item)
      }
      return arr
    }
    const obj = {}
    parseMapInto(obj, indent)
    return obj
  }
  const out = parseBlock(0)
  if (pos.i !== lines.length) throw new Error(`${where}: trailing unparsable content at line ${pos.i + 1}: ${lines[pos.i]}`)
  return out ?? {}
}
const countIndent = (line) => (line.match(/^ */)?.[0].length ?? 0)

/* ------------------------------------------------------------------ *
 * glob（`a/**`、`*.md`、`a|b` 并联）与归属
 * ------------------------------------------------------------------ */
export const globToRe = (glob) =>
  new RegExp(
    `^${glob
      .split('/')
      .map((seg) => {
        if (seg === '**') return '(?:[^/]+/)*[^/]*'
        return seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '.')
      })
      .join('/')}$`,
  )
const matchAny = (glob, path) => glob.split('|').some((g) => globToRe(g.trim()).test(path))

export function loadOwnership(root) {
  const p = join(root, 'dev', 'engineering', 'doc-ownership.yaml')
  if (!existsSync(p)) throw new Error(`doc-ownership.yaml missing at ${relative(root, p)}`)
  return parseMiniYaml(readFileSync(p, 'utf8'), 'doc-ownership.yaml').rules ?? []
}

/** 最具体优先 = 列表顺序优先（文件头部有说明；第一命中即生效）。 */
export function ownershipFor(rules, path) {
  for (const r of rules) if (matchAny(r.glob, path)) return r
  return { glob: null, owner: 'UNOWNED', risk: 'advisory', note: 'no ownership rule matched' }
}

/* ------------------------------------------------------------------ *
 * docs:probe — 变更影响映射（read-only；advisory 语义，不改退出码语义）
 * ------------------------------------------------------------------ */
const PROBE_RULES = [
  {
    glob: 'schema/**|SNAPSHOT.md',
    codes: ['CONTRACT_SURFACE'],
    docs: ['DOMAIN_SCHEMA.md', 'SNAPSHOT.md', 'docs/packaging.md'],
    tests: ['tests/engineering/eb1-canonical.test.ts', 'tests/store'],
    gate: 'T2',
    actions: ['冻结变更流程：改契约文件 → pnpm run snapshot:update → 同一提交评审', '构建双向 sha256 门必须看到新清单'],
  },
  {
    glob: 'src/host/history/**',
    codes: ['EVENT_REPLAY_SEMANTICS', 'HISTORY_CONTRACT'],
    docs: ['HISTORY_EVENT_CATALOG.md', 'ARCHITECTURE.md'],
    tests: ['tests/history-registry', 'tests/history-replay', 'tests/store'],
    gate: 'T2',
    actions: ['事件目录若变化，须走冻结变更流程并同步 HISTORY_EVENT_CATALOG.md'],
  },
  {
    glob: 'src/host/dsh-adapter/**',
    codes: ['HOST_ADAPTER_PIN', 'T3_GATE_REQUIRED'],
    docs: ['DSH_ADAPTER.md', 'dev/engineering/registry.yaml', 'docs/engineering-baseline/EXECUTION_PLAN.md'],
    tests: ['scripts/e2e-run.sh', 'tests/discovery'],
    gate: 'T3（真实 Host：宿主加载/RPC/权限/unload）',
    actions: ['宿主 pin 若有变，更新 registry.yaml host_pins 并跑 T3 实机门'],
  },
  {
    glob: 'src/host/persistence/**|src/host/audit/**|src/host/git/**',
    codes: ['PERSISTENCE_OR_PERMISSION'],
    docs: ['GIT_INTEGRATION.md', 'ARCHITECTURE.md'],
    tests: ['tests/store', 'tests/audit-strict', 'tests/git'],
    gate: 'T2（数据/权限语义变化 → 停工向用户确认）',
    actions: ['数据/权限语义变化是停工条目——不得借机改冻结语义'],
  },
  {
    glob: 'src/client/**',
    codes: ['CLIENT_UI'],
    docs: ['ARCHITECTURE.md'],
    tests: ['tests/components', 'tests/views-shell', 'tests/settings'],
    gate: 'T1',
    actions: ['UI 面无 GUI E2E 时须标明未验证'],
  },
  {
    glob: 'src/**',
    codes: ['SOURCE_CHANGE'],
    docs: [],
    tests: ['（按被改模块就近选择）'],
    gate: 'T1（默认）',
    actions: [],
  },
  {
    glob: 'scripts/docs/**',
    codes: ['DOCS_KERNEL_TOUCHED'],
    docs: ['docs/development.md'],
    tests: ['tests/engineering/eb2-docs.test.ts'],
    gate: 'T0 + 双 PoC 全跑',
    actions: ['改规则内核 = 改规则本身：正反 PoC 必须同 PR 演示'],
  },
  {
    glob: 'scripts/**|package.json|tsconfig.json|vitest.config.ts|tsdown.config.ts|.github/**',
    codes: ['TOOLING_OR_GATE'],
    docs: ['docs/packaging.md', 'README.md'],
    tests: ['pnpm run pack:verify'],
    gate: 'T0（但门禁变化需本地红/绿证据）',
    actions: ['门禁/发布面变化须在 PR 里贴出红→绿证据'],
  },
  {
    glob: 'lib/**|dist/**|factory-dist/**',
    codes: ['PREBUILT_ARTIFACTS'],
    docs: ['docs/packaging.md'],
    tests: ['pnpm run check:freshness'],
    gate: 'T0',
    actions: ['产物只能随其源码同 PR 更新（freshness 门）'],
  },
  {
    glob: 'docs/**|README.md|AGENTS.md',
    codes: ['DOCS_ONLY'],
    docs: ['docs/README.md'],
    tests: ['pnpm run docs:check'],
    gate: 'T0',
    actions: ['若派生索引过期 → pnpm run docs:sync --write'],
  },
  { glob: 'tests/**', codes: ['TEST_CHANGE'], docs: [], tests: [], gate: 'T0', actions: [] },
  { glob: 'dev/**', codes: ['DEV_REGISTRY'], docs: ['docs/development.md'], tests: ['tests/engineering/eb2-docs.test.ts'], gate: 'T0', actions: ['registry/doc-ownership 是人工文件：sync 不得写'] },
]

export function probeFindings(root, files) {
  const rules = loadOwnership(root)
  const hits = []
  const seen = new Set()
  for (const f of files) {
    const own = ownershipFor(rules, f)
    if (own.owner === 'UNOWNED' && !seen.has(`UNOWNED:${f}`)) {
      seen.add(`UNOWNED:${f}`)
      hits.push({ path: f, codes: ['DOC_IMPACT_UNOWNED'], severity: 'advisory', note: `未归属：${f} —— 在 doc-ownership.yaml 增加条目或确认忽略` })
    }
    for (const r of PROBE_RULES) {
      if (matchAny(r.glob, f)) {
        const key = r.codes.join('+')
        let entry = hits.find((h) => h.key === key)
        if (!entry) {
          entry = { key, codes: r.codes, severity: own.risk === 'blocking' ? 'blocking' : 'advisory', docs: r.docs, tests: r.tests, gate: r.gate, actions: r.actions, owners: new Set([own.owner]), paths: [] }
          hits.push(entry)
        }
        if (!entry.owners.has(own.owner)) entry.owners.add(own.owner)
        if (entry.paths.length < 6 && !entry.paths.includes(f)) entry.paths.push(f)
        break
      }
    }
  }
  for (const h of hits) if (h.owners) h.owners = [...h.owners]
  return hits.filter((h) => h.key || h.codes[0] === 'DOC_IMPACT_UNOWNED')
}

/* ------------------------------------------------------------------ *
 * docs:check — 全量静态一致性（read-only，零写入）
 * ------------------------------------------------------------------ */
export const GATE_VERDICTS = ['PASS', 'BLOCKED', 'PENDING', 'UNKNOWN']
export const ADR_STATUSES = ['proposed', 'accepted', 'implemented', 'verified', 'released']
const FROZEN_SET = new Set(['SNAPSHOT.md', 'ARCHITECTURE.md', 'DOMAIN_SCHEMA.md', 'DSH_ADAPTER.md', 'GIT_INTEGRATION.md', 'HISTORY_EVENT_CATALOG.md', 'PLAN_FORK_SPEC.md', 'SUBAGENT_ROUTING.md', 'TEST_MATRIX.md'])

export const isLinkChecked = (p) => !FROZEN_SET.has(p) && !p.startsWith('schema/') && !p.startsWith('docs/evidence/') && !p.startsWith('docs/BASELINE_')

export function checkLinks(root, mdFiles) {
  const problems = []
  for (const f of mdFiles.filter(isLinkChecked)) {
    const text = readFileSync(join(root, f), 'utf8')
    for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1]
      if (/^(https?:|mailto:|#|\/)/.test(target)) continue
      const rel = target.split('#')[0]
      if (!rel) continue
      const abs = resolve(root, dirname(f), rel)
      if (!existsSync(abs)) problems.push({ code: 'BROKEN_LINK', where: `${f}`, detail: `](${target}) → 不存在` })
    }
  }
  return problems
}

export function checkAdrs(root, mdFiles) {
  const problems = []
  const ids = new Map()
  for (const f of mdFiles.filter((x) => x.startsWith('docs/decisions/') && /[A-Za-z]/.test(x))) {
    const text = readFileSync(join(root, f), 'utf8')
    const fm = text.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) {
      problems.push({ code: 'ADR_FRONTMATTER', where: f, detail: '缺 frontmatter（id/status/title/date）' })
      continue
    }
    let meta
    try {
      meta = parseMiniYaml(fm[1], f)
    } catch (e) {
      problems.push({ code: 'ADR_FRONTMATTER', where: f, detail: String(e.message) })
      continue
    }
    for (const k of ['id', 'status', 'title', 'date']) if (!meta[k]) problems.push({ code: 'ADR_FRONTMATTER', where: f, detail: `缺字段 ${k}` })
    if (meta.status && !ADR_STATUSES.includes(meta.status)) problems.push({ code: 'ADR_STATUS', where: f, detail: `status=${meta.status} 不在词汇表 ${ADR_STATUSES.join('|')}` })
    if ((meta.status === 'verified' || meta.status === 'released') && !meta.evidence) {
      problems.push({ code: 'EVIDENCE_MISSING', where: f, detail: `status=${meta.status} 是实证声称，必须带 evidence 路径（静态一致 ≠ 已验证）` })
    }
    if (meta.evidence) {
      for (const ev of Array.isArray(meta.evidence) ? meta.evidence : [meta.evidence]) {
        if (!existsSync(join(root, String(ev)))) problems.push({ code: 'EVIDENCE_MISSING', where: f, detail: `evidence 指向不存在的文件：${ev}（虚假证据）` })
      }
    }
    if (meta.id) {
      if (ids.has(meta.id)) problems.push({ code: 'ADR_DUP_ID', where: f, detail: `id=${meta.id} 与 ${ids.get(meta.id)} 重复` })
      else ids.set(meta.id, f)
      if (!f.includes(String(meta.id))) problems.push({ code: 'ADR_ID_FILE', where: f, detail: `id=${meta.id} 与文件名不一致` })
    }
  }
  // 类别感知（EB3/G3 遗留项 3）：上游设计线（PR #9）docs/architecture/adr/ 的
  // 原则性 Draft ADR 不是 docs/decisions/ 的严格 frontmatter 类——它自带词汇
  // （自认「非冻结实现契约」），受本类四条：id 唯一 / id↔文件名 / 状态行存在 /
  // 被索引收录（孤儿=第二权威入口的预防）。不强行映射实现状态词汇——映射与
  // 升级规则在 #10 PoC 通过后另行裁决（状态词汇不互推同样约束这个方向）。
  const dIds = new Map()
  for (const f of mdFiles.filter((x) => x.startsWith('docs/architecture/adr/') && /\/D\d+/.test(x))) {
    const base = f.split('/').pop()
    const m = base.match(/^(D\d+)_/)
    if (!m) {
      problems.push({ code: 'ADR_ID_FILE', where: f, detail: '原则性 ADR 文件名应为 D<NN>_<NAME>.md' })
      continue
    }
    const id = m[1]
    if (dIds.has(id)) problems.push({ code: 'ADR_DUP_ID', where: f, detail: `D-id=${id} 与 ${dIds.get(id)} 重复` })
    else dIds.set(id, f)
    const text = readFileSync(join(root, f), 'utf8')
    if (!/\*\*状态\*\*[:：]/.test(text)) problems.push({ code: 'ADR_STATUS', where: f, detail: '原则性 ADR 缺 **状态** 行（该类词汇自由，但存在性必查；存在 ≠ 实证状态）' })
  }
  const dIdx = join(root, 'docs/architecture/adr/README.md')
  if (existsSync(dIdx)) {
    const idx = readFileSync(dIdx, 'utf8')
    for (const [, f] of dIds) {
      const stem = f.split('/').pop().replace(/\.md$/, '')
      if (!idx.includes(stem)) problems.push({ code: 'ADR_ORPHAN', where: f, detail: '未入 docs/architecture/adr/README.md 索引（决策孤儿）' })
    }
  }
  return problems
}

export function checkRegistry(root) {
  const problems = []
  const regPath = join(root, 'dev', 'engineering', 'registry.yaml')
  if (!existsSync(regPath)) return [{ code: 'REGISTRY_MISSING', where: 'dev/engineering/registry.yaml', detail: '人工注册表缺席' }]
  let reg
  try {
    reg = parseMiniYaml(readFileSync(regPath, 'utf8'), 'registry.yaml')
  } catch (e) {
    return [{ code: 'REGISTRY_UNPARSABLE', where: 'dev/engineering/registry.yaml', detail: String(e.message) }]
  }
  for (const [stage, s] of Object.entries(reg.stages ?? {})) {
    if (!GATE_VERDICTS.includes(s.verdict)) {
      problems.push({ code: 'GATE_VERDICT', where: stage, detail: `verdict=${s.verdict} 不在词汇表 ${GATE_VERDICTS.join('|')}` })
      continue
    }
    if (s.verdict === 'PENDING') continue
    const gateAbs = join(root, String(s.gate ?? ''))
    if (!s.gate || !existsSync(gateAbs)) {
      problems.push({ code: 'GATE_FILE_MISSING', where: stage, detail: `verdict=${s.verdict} 但 Gate 记录不存在：${s.gate}` })
      continue
    }
    const text = readFileSync(gateAbs, 'utf8')
    const declared = text.match(/结果：\*{0,2}(PASS|BLOCKED|UNKNOWN|PENDING)/)?.[1] ?? text.match(/\|\s*\*\*(PASS|BLOCKED|UNKNOWN|PENDING)\*\*\s*\|/)?.[1]
    if (declared && declared !== s.verdict) problems.push({ code: 'DUAL_AUTHORITY_MISMATCH', where: stage, detail: `registry=${s.verdict} 而 ${s.gate} 写 ${declared}` })
    for (const ev of Array.isArray(s.evidence) ? s.evidence : []) {
      const p = join(root, String(ev))
      if (!existsSync(p) || statSync(p).size === 0) problems.push({ code: 'EVIDENCE_MISSING', where: stage, detail: `verdict=PASS 的证据不可用（虚假 verified）：${ev}` })
    }
  }
  return problems
}

/** 复用 EB1 的正本门作为 docs:check 的一条规则（同一内核，不分叉）。 */
export function checkSnapshot(root) {
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'snapshot-release.mjs')], { encoding: 'utf8', stdio: 'pipe' })
    return []
  } catch (e) {
    return [{ code: 'CONTRACT_DRIFT', where: 'scripts/snapshot-release.mjs', detail: String(`${e.stdout ?? ''}${e.stderr ?? ''}`).trim().slice(0, 300) }]
  }
}

/* ------------------------------------------------------------------ *
 * docs:sync — 派生索引白名单（唯一可写面）
 * ------------------------------------------------------------------ */
export const SYNC_WHITELIST = ['docs/README.md']

const DOC_TIERS = [
  { glob: 'docs/engineering-baseline/**|docs/decisions/**|docs/development.md|docs/testing.md|docs/README.md|docs/G0_REPRODUCIBLE_TEST_ROOT.md|docs/packaging.md', tier: 'Current' },
  // V3 设计线（#9 架构权威目录 + #10 PoC 计划）：README 图例的 Proposed 层
  // （未生效提案——不 Current、不是历史）。长稿 design/ 已自标 HISTORICAL
  // DESIGN RECORD，归 Historical。
  { glob: 'docs/architecture/**|docs/poc/**', tier: 'Proposed' },
  { glob: 'docs/design/**|docs/BASELINE_**|docs/G[1-5]_**|docs/TOOLS_TRACEABILITY.md|docs/evidence/**', tier: 'Historical' },
]
export const docTier = (p) => {
  for (const r of DOC_TIERS) if (matchAny(r.glob, p)) return r.tier
  return 'Unranked'
}

export function generateDocsIndex(root, trackedMd) {
  const rows = trackedMd
    .filter((p) => !p.startsWith('docs/evidence/') && !p.includes('deepseek-harness'))
    .sort()
    .map((p) => `| \`${p}\` | ${docTier(p)} |`)
  return ['| 文件 | 层级 |', '|---|---|', ...rows].join('\n')
}

export const INDEX_BEGIN = '<!-- docs:sync:begin -->'
export const INDEX_END = '<!-- docs:sync:end -->'
export const spliceIndex = (text, generated) => {
  const b = text.indexOf(INDEX_BEGIN)
  const e = text.indexOf(INDEX_END)
  if (b === -1 || e === -1 || e < b) throw new Error('docs/README.md 缺 docs:sync 标记——请手工补一次标记，sync 不会自动发明')
  return `${text.slice(0, b + INDEX_BEGIN.length)}\n${generated}\n${text.slice(e)}`
}

/** 根入口：全量 docs:check（CLI 与测试共用）。 */
export function checkAll(root, trackedFiles, { trackedMd } = {}) {
  const md = trackedMd ?? trackedFiles.filter((f) => f.endsWith('.md'))
  const problems = [...checkLinks(root, md), ...checkAdrs(root, md), ...checkRegistry(root), ...checkSnapshot(root)]
  const readme = join(root, 'docs', 'README.md')
  if (existsSync(readme)) {
    try {
      const cur = readFileSync(readme, 'utf8')
      const want = spliceIndex(cur, generateDocsIndex(root, md))
      if (want !== cur) problems.push({ code: 'DOCS_INDEX_STALE', where: 'docs/README.md', detail: '派生索引过期：pnpm run docs:sync --write（只此文件可自动写）' })
    } catch (e) {
      problems.push({ code: 'DOCS_INDEX_STALE', where: 'docs/README.md', detail: String(e.message) })
    }
  }
  return problems
}
