/**
 * V2-T2.3 — shared fixtures for the registry module tests
 * (parse / serialize / state machine / reconciliation).
 */

import type { RegistryEntry, RegistryFile } from '../../src/host/domain/registry/index.js'

/** One active entry (POSIX path, CJK display name — the common case). */
export const ACTIVE_ENTRY: RegistryEntry = {
  id: 'PRJ-1',
  path: '/workspaces/robot-vision',
  displayName: '机器人视觉定位系统',
  status: 'active',
  boundAt: 1770000000000,
  archivedAt: null,
}

/** One archived entry (the 解绑 tombstone shape). */
export const ARCHIVED_ENTRY: RegistryEntry = {
  id: 'PRJ-2',
  path: '/workspaces/old-survey',
  displayName: '旧调研项目',
  status: 'archived',
  boundAt: 1760000000000,
  archivedAt: 1765000000000,
}

/** A third active entry (multi-project registries). */
export const THIRD_ENTRY: RegistryEntry = {
  id: 'PRJ-3',
  path: 'C:\\repos\\quant-models',
  displayName: 'Quant Models',
  status: 'active',
  boundAt: 1771000000000,
  archivedAt: null,
}

/** A plain (non-frozen) registry file; default = the two-entry fixture. */
export function makeFile(entries: readonly RegistryEntry[] = [ACTIVE_ENTRY, ARCHIVED_ENTRY]): RegistryFile {
  return { version: 1, projects: [...entries] }
}

/** The design §3.2 example, verbatim (header comment + one active entry). */
export const DESIGN_EXAMPLE_YAML = [
  '# registry.yaml —— 研究管理中枢的项目登记册（声明真源，人工/插件共同维护）',
  'version: 1',
  'projects:',
  '  - id: PRJ-1',
  '    path: /abs/path/to/ws',
  '    displayName: 机器人视觉定位系统',
  '    status: active',
  '    boundAt: 1770000000000',
  '    archivedAt: null',
].join('\n') + '\n'

/** A hand-formatted two-entry file: shuffled key order + extra comments. */
export const HAND_WRITTEN_YAML = [
  '# my hub registry',
  '# (hand-edited)',
  'projects:',
  '  - status: active',
  '    id: PRJ-1',
  '    displayName: 机器人视觉定位系统',
  '    boundAt: 1770000000000',
  '    path: /workspaces/robot-vision',
  '    archivedAt: null',
  '  - id: PRJ-2',
  '    path: /workspaces/old-survey',
  '    displayName: 旧调研项目',
  '    status: archived',
  '    boundAt: 1760000000000',
  '    archivedAt: 1765000000000',
  'version: 1',
].join('\n') + '\n'
