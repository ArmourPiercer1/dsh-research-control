#!/usr/bin/env node
/**
 * AD-EB-01 — in-repo canonical contract validator + release manifest
 * generator（EB1 单正源迁移；取代 SI-001 的发布期复制半边）。
 *
 * 历史（superseded）：旧 SI-001 机制把仓库父目录当作开发期正源，构建时
 * 「清除 → 从父目录复制 → chmod 只读」回填包根。EB0 实测该路径在**部分
 * 污染**的父目录（schema 只来其一）下会静默清空包内 schema 并以 exit 0
 * 结束（PoC：docs/engineering-baseline/gates/G1.md，poc-old-behavior 记录）。
 * AD-EB-01（用户 2026-10-26 批准；批准基准 main@1d64d9e9，逐文件哈希见
 * docs/engineering-baseline/gates/G0-inventory.yaml）把唯一可编辑正源迁入
 * Git：本仓库的 `schema/**` 与 8 份根文档**就是**正源。构建不再读写任何
 * 仓外路径。
 *
 * 两种模式（无第三种）：
 *
 *  VERIFY（默认；`pnpm run build` 挂钩 / CI）：
 *    1. 冻结面在位（8 根文档 + schema/**，锚点 schema/common.schema.json）；
 *    2. `SNAPSHOT.md` 与文件树**双向**逐文件 sha256 一致——清单有树无 /
 *       树有清单无 / 哈希漂移，任一 = CONTRACT_DRIFT，构建失败；
 *    3. 只读校验，零写入：构建不产生清单或时间戳抖动。
 *
 *  UPDATE（`pnpm run snapshot:update`；仅冻结变更流程）：
 *    从当前文件树确定性重生成 `SNAPSHOT.md`（无时间戳、无机器绝对路径；
 *    两次运行逐字节相同）。合法的冻结面修订 = 改契约文件 + UPDATE + 契约
 *    文件与清单进同一个可评审提交。
 *
 * `DSH_SNAPSHOT_SOURCE_ROOT` 随 SI-001 复制机制退役：设置为任何值都是
 * FATAL（阻止旧调用方悄悄复活仓外写入源）。运行时部署覆盖
 * `DSH_RESEARCH_SCHEMA_ROOT`（src/host/dsh-adapter/host/index.ts
 * #resolveSchemaRoot）与本脚本无关，语义不变。
 *
 * 无依赖（node:fs / node:crypto / node:path）。
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPDATE = process.argv.includes('--update')

/** The 8 root .md docs that are part of the frozen contract surface. */
const FROZEN_DOCS = [
  'ARCHITECTURE.md',
  'DOMAIN_SCHEMA.md',
  'DSH_ADAPTER.md',
  'GIT_INTEGRATION.md',
  'HISTORY_EVENT_CATALOG.md',
  'PLAN_FORK_SPEC.md',
  'SUBAGENT_ROUTING.md',
  'TEST_MATRIX.md',
]

const fail = (code, message) => {
  console.error(`[snapshot-release] FATAL ${code}: ${message}`)
  process.exit(1)
}
const log = (message) => console.log(`[snapshot-release] ${message}`)

if (process.env['DSH_SNAPSHOT_SOURCE_ROOT'] !== undefined) {
  fail(
    'EXTERNAL_SOURCE_RETIRED',
    'DSH_SNAPSHOT_SOURCE_ROOT is no longer supported — the external snapshot source was ' +
      'retired by AD-EB-01 (docs/engineering-baseline/). schema/** and the 8 root docs in ' +
      'this repository ARE the canonical originals; unset the variable. (The runtime ' +
      'schema-root override DSH_RESEARCH_SCHEMA_ROOT is a separate interface and remains ' +
      'valid for the host service.)',
  )
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/* ------------------------------------------------------------------ *
 * Canonical surface of THIS repository (deterministic order)
 * ------------------------------------------------------------------ */

const collectFiles = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(abs))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

const repoSchema = join(PLUGIN_ROOT, 'schema')
if (!existsSync(join(repoSchema, 'common.schema.json'))) {
  fail('CONTRACT_SURFACE_MISSING', `schema/common.schema.json not found at ${repoSchema} — the in-repo canonical schema surface is damaged or absent`)
}
const missingDocs = FROZEN_DOCS.filter((name) => !existsSync(join(PLUGIN_ROOT, name)))
if (missingDocs.length > 0) {
  fail('CONTRACT_SURFACE_MISSING', `root contract docs missing: ${missingDocs.join(', ')}`)
}

const surface = [
  ...FROZEN_DOCS.map((name) => join(PLUGIN_ROOT, name)),
  ...collectFiles(repoSchema),
].map((abs) => ({
  rel: relative(PLUGIN_ROOT, abs).split('\\').join('/'),
  bytes: statSync(abs).size,
  hash: sha256(abs),
}))

/* ------------------------------------------------------------------ *
 * SNAPSHOT.md — generated release manifest (never a second source)
 * ------------------------------------------------------------------ */

const manifestPath = join(PLUGIN_ROOT, 'SNAPSHOT.md')

const renderManifest = () =>
  [
    '# SNAPSHOT.md — 发布期契约清单（生成物，勿编辑）',
    '',
    '> 生成命令：`pnpm run snapshot:update`（`scripts/snapshot-release.mjs --update`）。',
    '> 默认构建只做**校验**（与文件树双向逐文件 sha256），不写本文件。',
    '> 正源唯一且在 Git 内：本仓库的 `schema/**` 与 8 份根文档就是契约正源',
    '> （AD-EB-01；批准基准 `main@1d64d9e9`，Gate 记录 `docs/engineering-baseline/gates/`）。',
    '> 修订走冻结变更流程：改契约文件 → `pnpm run snapshot:update` → 契约文件与',
    '> 清单进同一个可评审提交。',
    '> 运行时解析（`#resolveSchemaRoot` 自 `<pkg>/schema`）与 `DSH_RESEARCH_SCHEMA_ROOT`',
    '> 显式部署覆盖的语义与本清单无关，保持不变。',
    '',
    `共 ${surface.length} 个文件（${FROZEN_DOCS.length} 文档 + ${surface.length - FROZEN_DOCS.length} schema）。`,
    '',
    '| 文件（仓内相对路径） | sha256 | 字节 |',
    '|---|---|---|',
    ...surface.map(({ rel, hash, bytes }) => `| \`${rel}\` | \`${hash}\` | ${bytes} |`),
    '',
  ].join('\n')

const parseManifest = (text) => {
  const rows = new Map()
  for (const line of text.split('\n')) {
    if (!line.startsWith('| `')) continue
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim().replace(/^`|`$/g, ''))
    if (cells.length >= 2 && cells[1]) rows.set(cells[0], cells[1])
  }
  return rows
}

if (UPDATE) {
  if (existsSync(manifestPath)) chmodSync(manifestPath, 0o644)
  writeFileSync(manifestPath, renderManifest())
  log(
    `SNAPSHOT.md regenerated from tree: ${surface.length} files — deterministic (no timestamps, no machine paths); ` +
      'commit it together with the contract change',
  )
  process.exit(0)
}

if (!existsSync(manifestPath)) {
  fail('CONTRACT_DRIFT', 'SNAPSHOT.md is absent — the release manifest is required (generate with: pnpm run snapshot:update)')
}
const declared = parseManifest(readFileSync(manifestPath, 'utf8'))
if (declared.size === 0) {
  fail('CONTRACT_DRIFT', 'SNAPSHOT.md contains no parsable manifest rows')
}

const tree = new Map(surface.map((f) => [f.rel, f.hash]))
const drift = []
for (const [rel, hash] of declared) {
  if (!tree.has(rel)) drift.push(`${rel}: declared in SNAPSHOT.md but absent from tree`)
  else if (tree.get(rel) !== hash) drift.push(`${rel}: tree sha256 ${tree.get(rel)} ≠ manifest ${hash}`)
}
for (const rel of tree.keys()) {
  if (!declared.has(rel)) drift.push(`${rel}: present in tree but not declared in SNAPSHOT.md`)
}
if (drift.length > 0) {
  const shown = drift.slice(0, 12).map((d) => `\n  - ${d}`).join('')
  fail(
    'CONTRACT_DRIFT',
    `${drift.length} drift(s) between the in-repo contract surface and SNAPSHOT.md — an ` +
      `intentional frozen-surface change must be re-manifested with \`pnpm run snapshot:update\` ` +
      `and reviewed as one commit; an unintentional one means the surface was damaged:${shown}`,
  )
}

log(`verified: ${surface.length} canonical files match SNAPSHOT.md (in-repo source, AD-EB-01; no external reads or writes)`)
