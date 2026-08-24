#!/usr/bin/env node
/**
 * WP-8.4 — SI-001 release snapshot (build hook, runs after `tsdown`).
 *
 * SI-001（`docs/execution/spec-issues/SI-001.md`, `resolved-compatibly`）裁定的
 * 发布期半边：开发期冻结正本唯一、留在工作区根（插件仓库不复制，避免双源）；
 * 打包期按 ARCHITECTURE §2.1「目录结构（冻结目标）」把冻结产物以**内容一致
 * 的只读快照**复制进发布包。本脚本就是那个复制动作的机器执行者：
 *
 *   源（工作区根，只读消费）              目标（插件仓库根 = 包根）
 *   ---------------------------------      --------------------------------
 *   schema/**（23 文件，Frozen V1）        schema/**（同构镜像）
 *   8 份根文档（Frozen V1 7 份 +            包根同名文件
 *   SUBAGENT_ROUTING.md，见下）
 *
 * 8 份根的 .md 文件 = 计划书 §40 冻结记录表中的 7 份 Frozen V1 文档 +
 * `SUBAGENT_ROUTING.md`（状态 Active，§40 冻结要点一并记录其路由策略；
 * 工作区根恰有 8 份 .md，任务口径「8 份冻结文档」按此全量快照）。
 *
 * 快照纪律（本脚本执行并声明）：
 *  1. **只读**：每个快照文件落盘后 chmod 0444、目录 0555；重跑前先恢复
 *     写权限再清除（幂等）。
 *  2. **内容一致**：逐文件 sha256 源==目标断言（SI-001 的「内容一致」
 *     判定），任何漂移 = 构建失败。
 *  3. **正本唯一**：快照不声明自己为正源；`SNAPSHOT.md` 清单记录源根、
 *     生成时间、逐文件哈希与只读声明（内容不变则不重写——构建不产生
 *     时间戳抖动）。运行时 schema 解析
 *     （`src/host/dsh-adapter/host/index.ts #resolveSchemaRoot`）自包内
 *     `lib/` 向上一级命中 `<pkg>/schema`（§2.1 布局即解析契约）。
 *
 * 缺席语义（git install 场景，publish.md「build-script catch」）：pnpm 的
 * git 安装只拿到插件仓库树，工作区根不存在 → 本脚本**大声跳过**（不失败：
 * 冻结面（schema/ + 8 文档 + SNAPSHOT.md）已提交进版本树，跳过仅表示
 * 「不刷新」，包内快照原样随附，运行时 `#resolveSchemaRoot` 照常自
 * `<pkg>/schema` 解析；`DSH_RESEARCH_SCHEMA_ROOT` 覆盖仍然优先）。源根
 * 「部分在场」（schema 与文档只来其一）= 冻结面损坏 → 失败。
 *
 * 无依赖（node:fs / node:crypto / node:process）。环境变量：
 *   DSH_SNAPSHOT_SOURCE_ROOT  源根覆盖（测试用；默认 = 插件仓库父目录）
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOT = resolve(process.env['DSH_SNAPSHOT_SOURCE_ROOT'] ?? join(PLUGIN_ROOT, '..'))

/** The 8 workspace-root .md docs snapshotted to the package root (§2.1). */
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

const fail = (message) => {
  console.error(`[snapshot-release] FATAL: ${message}`)
  process.exit(1)
}
const log = (message) => console.log(`[snapshot-release] ${message}`)

/* ------------------------------------------------------------------ *
 * Source-root availability (the loud-skip boundary)
 * ------------------------------------------------------------------ */

const sourceSchema = join(SOURCE_ROOT, 'schema')
const schemaAnchor = join(sourceSchema, 'common.schema.json')
const presentDocs = FROZEN_DOCS.filter((name) => existsSync(join(SOURCE_ROOT, name)))

if (!existsSync(schemaAnchor)) {
  if (presentDocs.length > 0) {
    fail(
      `source root ${SOURCE_ROOT} is PARTIAL: root docs present (${presentDocs.join(', ')}) ` +
        'but schema/common.schema.json is missing — a torn frozen surface must not snapshot',
    )
  }
  log(
    `SKIP: no frozen sources at ${SOURCE_ROOT} (git-install context — the workspace root ` +
      'is not part of the plugin repo). The committed snapshot (schema/ + 8 root docs + ' +
      'SNAPSHOT.md) ships as-is; only the dev-root refresh is skipped.',
  )
  process.exit(0)
}
if (presentDocs.length !== FROZEN_DOCS.length) {
  const missing = FROZEN_DOCS.filter((name) => !existsSync(join(SOURCE_ROOT, name)))
  fail(`source root ${SOURCE_ROOT} is PARTIAL: missing root docs: ${missing.join(', ')}`)
}

/* ------------------------------------------------------------------ *
 * Collect the source file set (deterministic order)
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

const schemaFiles = collectFiles(sourceSchema).map((abs) => ({
  src: abs,
  dest: join(PLUGIN_ROOT, 'schema', relative(sourceSchema, abs)),
}))
const docFiles = FROZEN_DOCS.map((name) => ({
  src: join(SOURCE_ROOT, name),
  dest: join(PLUGIN_ROOT, name),
}))

/* ------------------------------------------------------------------ *
 * Clean the previous snapshot (restore write bits first — read-only)
 * ------------------------------------------------------------------ */

const makeWritable = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      chmodSync(abs, 0o755)
      makeWritable(abs)
    } else {
      chmodSync(abs, 0o644)
    }
  }
}

for (const name of FROZEN_DOCS) {
  const dest = join(PLUGIN_ROOT, name)
  if (existsSync(dest)) rmSync(dest)
}
const destSchema = join(PLUGIN_ROOT, 'schema')
if (existsSync(destSchema)) {
  makeWritable(destSchema)
  chmodSync(destSchema, 0o755) // unlinking entries needs the dir itself writable
  rmSync(destSchema, { recursive: true })
}
const snapshotManifestPath = join(PLUGIN_ROOT, 'SNAPSHOT.md')
const previousManifest = existsSync(snapshotManifestPath) ? readFileSync(snapshotManifestPath, 'utf8') : null
rmSync(snapshotManifestPath, { force: true })

/* ------------------------------------------------------------------ *
 * Copy + content-identity verification (sha256 source == destination)
 * ------------------------------------------------------------------ */

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const manifestRows = []
for (const { src, dest } of [...docFiles, ...schemaFiles]) {
  const rel = relative(PLUGIN_ROOT, dest)
  if (!existsSync(src)) fail(`source file vanished mid-run: ${src}`)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  const srcHash = sha256(src)
  const destHash = sha256(dest)
  if (srcHash !== destHash) fail(`content drift: ${rel} (source ${srcHash} ≠ target ${destHash})`)
  manifestRows.push({ rel, hash: srcHash, bytes: statSync(dest).size })
}

/* ------------------------------------------------------------------ *
 * Read-only declaration: 0444 files / 0555 directories
 * ------------------------------------------------------------------ */

const freezeTree = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      freezeTree(abs)
      chmodSync(abs, 0o555)
    } else {
      chmodSync(abs, 0o444)
    }
  }
}
freezeTree(destSchema)
chmodSync(destSchema, 0o555)
for (const name of FROZEN_DOCS) chmodSync(join(PLUGIN_ROOT, name), 0o444)

/* ------------------------------------------------------------------ *
 * Provenance manifest (SNAPSHOT.md — generated, read-only)
 * ------------------------------------------------------------------ */

const generatedAt = new Date().toISOString()
const manifest = [
  '# SNAPSHOT.md — 发布期快照清单（SI-001；生成物，勿编辑）',
  '',
  `> 生成时间：${generatedAt}`,
  `> 源根（开发期正本，唯一）：\`${SOURCE_ROOT}\``,
  '> 政策：`docs/execution/spec-issues/SI-001.md`（`resolved-compatibly`）+ ARCHITECTURE §2.1「目录结构（冻结目标）」。',
  '',
  '**只读声明**：本包内 `schema/**` 与 8 份根文档是工作区根冻结产物的**内容一致只读快照**',
  '（逐文件 sha256 核验，见下表）——它们**不是**契约正本；正本唯一留在源根，冻结变更只走',
  '解冻-修改-重冻结流程（计划书 §40）。快照文件权限 0444/0555；重新生成 = `pnpm run build`',
  '（`scripts/snapshot-release.mjs` 幂等重写）。',
  '',
  `共 ${manifestRows.length} 个文件（8 文档 + ${manifestRows.length - FROZEN_DOCS.length} schema）。`,
  '',
  '| 文件（包内相对路径） | sha256 | 字节 |',
  '|---|---|---|',
  ...manifestRows.map(({ rel, hash, bytes }) => `| \`${rel}\` | \`${hash}\` | ${bytes} |`),
  '',
].join('\n')
/** Drops the volatile timestamp line so two manifests compare by content alone. */
const stripVolatile = (text) => text.split('\n').filter((line) => !line.startsWith('> 生成时间：')).join('\n')

if (previousManifest !== null && stripVolatile(previousManifest) === stripVolatile(manifest)) {
  // The clean step above removed the old manifest; write the captured bytes
  // back verbatim so the committed file (timestamp included) survives intact.
  writeFileSync(snapshotManifestPath, previousManifest)
  chmodSync(snapshotManifestPath, 0o444)
  log('SNAPSHOT.md unchanged (file set + hashes identical) — restored verbatim; no timestamp churn in the version tree')
} else {
  writeFileSync(snapshotManifestPath, manifest)
  chmodSync(snapshotManifestPath, 0o444)
}

log(`snapshot complete: ${manifestRows.length} files (8 docs + ${manifestRows.length - FROZEN_DOCS.length} schema) → ${PLUGIN_ROOT}; read-only; provenance in SNAPSHOT.md`)
