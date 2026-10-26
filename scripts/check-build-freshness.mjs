#!/usr/bin/env node
/**
 * EB1 — build-artifact freshness gate（对 `lib/` 等预构建产物的真实新鲜度检查）.
 *
 * 背景：`lib/`（及 `factory-dist/`，若入库）是随 Git 提交的预构建运行面，
 * git-install 直接消费——「记得 build 后 push」不是保证。本脚本把该保证机器化：
 * 先 `pnpm run build`，再比较**工作区构建产物**与 **HEAD 提交的产物**；
 * 任何实质差异 = `LIB_STALE`（提交的产物不是提交源码的构建输出）。
 *
 * 唯一豁免的归一化：tsdown/rolldown 在 chunk 里写的
 * `//#region \0rcm-css:<构建机绝对路径>` 注释（AGENTS.md §4 / G0 记录：
 * 构建机路径噪声，非功能差异）。归一化后的差异一律算实质漂移。
 *
 * 用法：`pnpm run check:freshness`（在 build 之后运行）。
 * 非 git 环境（tarball 解包等）→ FRESHNESS_UNVERIFIABLE（exit 1），
 * 因为跳过检查冒充绿色正是本门要消灭的形态。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['lib', 'factory-dist']

const fail = (code, message) => {
  console.error(`[check-freshness] FATAL ${code}: ${message}`)
  process.exit(1)
}

let tracked
try {
  tracked = execFileSync('git', ['ls-files', '--', ...DIRS], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
} catch (e) {
  fail('FRESHNESS_UNVERIFIABLE', `git ls-files failed (${e.message}) — freshness must be checked inside a git checkout`)
}
if (tracked.length === 0) {
  fail('FRESHNESS_UNVERIFIABLE', `no tracked build artifacts under ${DIRS.join('/') || 'lib/'} at HEAD — nothing to compare; refusing to report green`)
}

/** Neutralize the known build-machine noise (single documented pattern). */
const normalize = (text) => text.replace(/\/\/#region \\0rcm-css:[^\n]*/g, '//#region \\0rcm-css:<normalized-build-path>')

const stale = []
for (const rel of tracked) {
  let committed
  try {
    committed = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 })
  } catch {
    stale.push(`${rel}: present in the index but not in HEAD`)
    continue
  }
  const workPath = join(ROOT, rel)
  if (!existsSync(workPath)) {
    stale.push(`${rel}: committed artifact missing from the working tree (was the build run?)`)
    continue
  }
  const working = readFileSync(workPath)
  if (committed.equals(working)) continue
  if (normalize(committed.toString('utf8')) === normalize(working.toString('utf8'))) continue
  stale.push(`${rel}: working-tree build output ≠ HEAD artifact (${working.length} vs ${committed.length} bytes; not explainable by the rcm-css build-path pattern)`)
}

if (stale.length > 0) {
  fail(
    'LIB_STALE',
    `${stale.length} committed build artifact(s) do not match a fresh build of the committed sources — ` +
      'commit the rebuilt artifacts (build → stage lib/ → one commit) or revert the source change:' +
      stale.map((s) => `\n  - ${s}`).join(''),
  )
}
console.log(`[check-freshness] fresh: ${tracked.length} committed artifact(s) match the current build (only the documented rcm-css build-path noise normalized away)`)
