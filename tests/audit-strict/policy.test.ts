/**
 * WP-6.1 — workspace policy 归一化 (目标 1, DOMAIN_SCHEMA §14.1, loader 面).
 *
 *  - 对齐 §14.1 schema: 输入 = 真实 loader (冻结 workspace.schema.json) 产出
 *    的 `WorkspaceDoc` (含 useDefaults 材料化) — 非第二套解析;
 *  - 缺省材料化: null 文档 / audit 缺省 / partial 字段;
 *  - 防御性 fail-loud: 形状违规 → AuditPolicyError (正常经 loader 不可达);
 *  - 不可变: 输出冻结 + 输入不被改动。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AUDIT_POLICY,
  normalizeWorkspacePolicy,
} from '../../src/host/audit/strict/index.js'
import { AuditPolicyError } from '../../src/host/audit/strict/index.js'
import { loadedWorkspaceDoc, workspaceDocExample } from './fixtures.js'

describe('normalizeWorkspacePolicy — §14.1 示例 (loader 面, 冻结 schema 对齐)', () => {
  it('WORKSPACE_YAML_EXAMPLE 逐字 → 完整 audit 结构 (经真实 loader 校验)', () => {
    const yaml = [
      'workspace:',
      '  root: .',
      '  git_required: true',
      'audit:',
      '  strict_tracked:',
      '    paths: [src/, results/experiment-17/]',
      '  discovery_zones:',
      '    - path: results/',
      '      artifact_types: [DATASET, FIGURE]',
      '    - path: docs/',
      '  ignored: [cache/, build/, tmp/]',
    ].join('\n')
    const policy = normalizeWorkspacePolicy(loadedWorkspaceDoc(yaml))
    expect(policy).toEqual({
      workspaceRoot: '.',
      gitRequired: true,
      strictTrackedPaths: ['src/', 'results/experiment-17/'],
      discoveryZones: [
        { path: 'results/', artifactTypes: ['DATASET', 'FIGURE'] },
        { path: 'docs/' },
      ],
      ignored: ['cache/', 'build/', 'tmp/'],
    })
  })

  it('TS 对象形 §14.1 示例 → 同结构 (直接构造输入)', () => {
    const policy = normalizeWorkspacePolicy(workspaceDocExample())
    expect(policy.workspaceRoot).toBe('.')
    expect(policy.gitRequired).toBe(true)
    expect(policy.strictTrackedPaths).toEqual([])
    expect(policy.discoveryZones).toEqual([
      { path: 'results/', artifactTypes: ['DATASET', 'FIGURE'] },
      { path: 'docs/' },
    ])
    expect(policy.ignored).toEqual(['cache/', 'build/', 'tmp/'])
  })
})

describe('normalizeWorkspacePolicy — 缺省材料化 (工程默认)', () => {
  it('null 文档 (workspace.yaml 缺失) → 全工程默认', () => {
    const policy = normalizeWorkspacePolicy(null)
    expect(policy).toEqual({
      workspaceRoot: '.',
      gitRequired: true,
      strictTrackedPaths: [],
      discoveryZones: [],
      ignored: [],
    })
    expect(policy).toEqual(DEFAULT_AUDIT_POLICY)
    // 连续调用不共享可变引用 (默认面不可被调用方篡改)
    const again = normalizeWorkspacePolicy(undefined)
    expect(again).toEqual(policy)
    expect(again.strictTrackedPaths).not.toBe(policy.strictTrackedPaths)
  })

  it('audit 缺省 → 空集; workspace.root 自定义保留; git_required 缺省 true', () => {
    const policy = normalizeWorkspacePolicy(loadedWorkspaceDoc('workspace:\n  root: experiments/\n'))
    expect(policy).toEqual({
      workspaceRoot: 'experiments/',
      gitRequired: true,
      strictTrackedPaths: [],
      discoveryZones: [],
      ignored: [],
    })
  })

  it('git_required false 保留 (managed mode opt-out)', () => {
    const policy = normalizeWorkspacePolicy(loadedWorkspaceDoc('workspace:\n  root: .\n  git_required: false\n'))
    expect(policy.gitRequired).toBe(false)
  })

  it('partial: 只给 strict_tracked.paths → 其余默认空集', () => {
    const policy = normalizeWorkspacePolicy(loadedWorkspaceDoc('workspace:\n  root: .\naudit:\n  strict_tracked:\n    paths: [src/]\n'))
    expect(policy.strictTrackedPaths).toEqual(['src/'])
    expect(policy.discoveryZones).toEqual([])
    expect(policy.ignored).toEqual([])
  })
})

describe('normalizeWorkspacePolicy — 防御性 fail-loud (loader 已校验时不可达)', () => {
  it('strict_tracked.paths 非数组 → AuditPolicyError', () => {
    expect(() =>
      normalizeWorkspacePolicy({
        workspace: { root: '.', git_required: true },
        audit: { strict_tracked: { paths: 'src/' as unknown as string[] } },
      }),
    ).toThrow(AuditPolicyError)
  })

  it('strict_tracked.paths 空字符串元素 → AuditPolicyError', () => {
    expect(() =>
      normalizeWorkspacePolicy({
        workspace: { root: '.', git_required: true },
        audit: { strict_tracked: { paths: ['src/', ''] } },
      }),
    ).toThrow(/strict_tracked\.paths\[1\]/)
  })

  it('discovery_zones 元素缺 path → AuditPolicyError', () => {
    expect(() =>
      normalizeWorkspacePolicy({
        workspace: { root: '.', git_required: true },
        audit: { discovery_zones: [{ artifact_types: ['DATASET'] }] as never[] },
      }),
    ).toThrow(/discovery_zones\[0\]\.path/)
  })

  it('ignored 非字符串元素 → AuditPolicyError', () => {
    expect(() =>
      normalizeWorkspacePolicy({
        workspace: { root: '.', git_required: true },
        audit: { ignored: [1] as unknown as string[] },
      }),
    ).toThrow(/ignored\[0\]/)
  })

  it('workspace 映射缺失 → AuditPolicyError (schema required)', () => {
    expect(() => normalizeWorkspacePolicy({ audit: {} } as never)).toThrow(/workspace/)
  })
})

describe('normalizeWorkspacePolicy — 不可变 (输出冻结 + 输入不被改动)', () => {
  it('输出对象/数组全部冻结', () => {
    const doc = workspaceDocExample()
    const policy = normalizeWorkspacePolicy(doc)
    expect(Object.isFrozen(policy)).toBe(true)
    expect(Object.isFrozen(policy.strictTrackedPaths)).toBe(true)
    expect(Object.isFrozen(policy.discoveryZones)).toBe(true)
    expect(Object.isFrozen(policy.discoveryZones[0]!)).toBe(true)
    expect(Object.isFrozen(policy.ignored)).toBe(true)
  })

  it('输入文档不被归一化改动 (深比较前后一致)', () => {
    const doc = workspaceDocExample()
    const before = JSON.stringify(doc)
    normalizeWorkspacePolicy(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})
