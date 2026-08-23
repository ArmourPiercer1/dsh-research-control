/**
 * WP-6.1 test fixtures.
 *
 * - `workspaceDocExample`: DOMAIN_SCHEMA §14.1 工程默认结构的 TS 对象形
 *   (与 loader fixture 的 WORKSPACE_YAML_EXAMPLE 字节等价 YAML 同构);
 * - `loadedWorkspaceDoc`: 把 workspace.yaml 文本喂给**真实 loader**
 *   (冻结 schema 校验, tests/loader/fixtures 基建) 并取 `tree.workspace`
 *   — 证明 policy 面「对齐 §14.1 schema」走 loader 面, 非第二套解析。
 */
import type { WorkspaceDoc } from '../../src/host/domain/loader/index.js'
import { baseTreeFiles, load, mutate } from '../loader/fixtures.js'

/** §14.1 示例 (TS 对象形; 字段逐字对应 WORKSPACE_YAML_EXAMPLE). */
export function workspaceDocExample(): WorkspaceDoc {
  return {
    workspace: { root: '.', git_required: true },
    audit: {
      strict_tracked: { paths: [] },
      discovery_zones: [
        { path: 'results/', artifact_types: ['DATASET', 'FIGURE'] },
        { path: 'docs/' },
      ],
      ignored: ['cache/', 'build/', 'tmp/'],
    },
  }
}

/** 全默认 policy 的最小 workspace.yaml (audit 缺省). */
export const MINIMAL_WORKSPACE_YAML = 'workspace:\n  root: .\n  git_required: true\n'

/**
 * 经真实 loader (冻结 workspace.schema.json) 得到的 `tree.workspace`。
 * @throws 若 loader 报 SCHEMA/PARSE 错误 — 测试即红 (对齐面破坏的证明)。
 */
export function loadedWorkspaceDoc(workspaceYaml: string = MINIMAL_WORKSPACE_YAML): WorkspaceDoc {
  const result = load(mutate(baseTreeFiles(), { 'workspace.yaml': workspaceYaml }))
  const rejected = result.errors.filter((e) => e.file === 'workspace.yaml')
  if (rejected.length > 0 || result.tree.workspace === null) {
    throw new Error(`fixture: loader rejected workspace.yaml: ${JSON.stringify(rejected)}`)
  }
  return result.tree.workspace
}
