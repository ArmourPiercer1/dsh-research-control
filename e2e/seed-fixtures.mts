/**
 * V2 验收世界种子（正式入口的一部分：e2e/world-bootstrap.sh 调用；审查意见
 * P0#2「V2 验收有明确入口」）。NOT a spec, NOT src。
 *
 * 在 $E2E_V2_WORLD（默认 tests/dsh-homes/e2e-v2，AGENTS §3 隔离区内）构建
 * t61 + t63 的 fixture 工作区，复用仓 OWN fixture 助手（writeResearchTree /
 * initGitRepo / serializeRegistry），保证树对本提交 loader 字节有效。
 */
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { serializeRegistry } from '../src/host/domain/registry/index.js'
import { makeFile } from '../tests/registry/fixtures.js'
import { baseTreeFiles } from '../tests/loader/fixtures.js'

/** tests/wiring/helpers.writeResearchTree (vitest-free copy for the probe). */
function writeResearchTree(root: string): string {
  const researchRoot = join(root, '.research')
  for (const [rel, content] of Object.entries(baseTreeFiles())) {
    const abs = join(researchRoot, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return researchRoot
}

/** tests/wiring/helpers.initGitRepo (vitest-free copy for the probe). */
function initGitRepo(root: string): void {
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git(['init', '-q', '--initial-branch=main'])
  git(['config', 'user.email', 'e2e-v2@local'])
  git(['config', 'user.name', 'e2e-v2'])
  git(['add', '-A'])
  git(['commit', '-q', '--allow-empty', '-m', 'e2e-v2 seed'])
}

import process from 'node:process'
const WORLD = process.env['E2E_V2_WORLD'] ?? new URL('../tests/dsh-homes/e2e-v2', import.meta.url).pathname

function workspaceJson(entries: { path: string; title: string }[]): string {
  const workspaces: Record<string, unknown> = {}
  const ids: string[] = []
  entries.forEach((e, i) => {
    const id = `00000000-0000-4000-8000-00000000000${i}`
    ids.push(id)
    workspaces[id] = {
      path: e.path,
      title: e.title,
      sessionIds: [],
      createdAt: '2026-10-26T12:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
    }
  })
  return JSON.stringify(
    {
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: ids, archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces },
    },
    null,
    2,
  )
}

function entry(id: string, path: string) {
  return {
    id,
    path,
    displayName: '机器人视觉定位系统',
    status: 'active' as const,
    boundAt: 1770000000000,
    archivedAt: null,
  }
}

/* ---------------- t61 world: .acceptance/v2-t61/{hub-ws,proj-1} ---------------- */
const T61 = join(WORLD, '.acceptance', 'v2-t61')
const t61Hub = join(T61, 'hub-ws')
const t61Proj = join(T61, 'proj-1')
mkdirSync(join(t61Hub, '.research-control'), { recursive: true })
writeFileSync(join(t61Hub, '.research-control', 'registry.yaml'), serializeRegistry(makeFile([entry('PRJ-1', t61Proj)])), 'utf8')
mkdirSync(t61Proj, { recursive: true })
writeResearchTree(t61Proj)
// PRE-RENAME on disk: the case-1 「磁盘已同步」 state (.research → .research-x)
renameSync(join(t61Proj, '.research'), join(t61Proj, '.research-x'))
initGitRepo(t61Proj)
mkdirSync(join(WORLD, '.dsh-dev', 'storages'), { recursive: true })
writeFileSync(join(WORLD, '.dsh-dev', 'storages', 'workspace.json'),
  workspaceJson([{ path: t61Hub, title: 'hub-ws' }, { path: t61Proj, title: 'proj-1' }]), 'utf8')

/* ---------------- t63 world: t63-ws/{hub-ws,tree-ws} ---------------- */
const T63WS = join(WORLD, 't63-ws')
const t63Hub = join(T63WS, 'hub-ws')
const t63Tree = join(T63WS, 'tree-ws')
mkdirSync(join(t63Hub, '.research-control'), { recursive: true })
writeFileSync(join(t63Hub, '.research-control', 'registry.yaml'), serializeRegistry(makeFile([entry('PRJ-1', t63Tree)])), 'utf8')
mkdirSync(t63Tree, { recursive: true })
writeResearchTree(t63Tree)
initGitRepo(t63Tree)
mkdirSync(join(WORLD, '.dsh-dev-clean', 'storages'), { recursive: true })
writeFileSync(join(WORLD, '.dsh-dev-clean', 'storages', 'workspace.json'),
  workspaceJson([{ path: t63Hub, title: 'hub-ws' }, { path: t63Tree, title: 'tree-ws' }]), 'utf8')

console.log('seeded:', { t61Hub, t61Proj, t63Hub, t63Tree })
