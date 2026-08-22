/**
 * WP-1.1 — workspace.yaml (§14.1 工程默认结构) and agent-plan-fork policy
 * (PLAN_FORK_SPEC §9) dedicated parse/validate cases.
 */
import { describe, expect, it } from 'vitest'

import {
  POLICY_YAML_EXAMPLE,
  WORKSPACE_YAML_EXAMPLE,
  baseTreeFiles,
  load,
  mutate,
} from './fixtures.js'

describe('workspace.yaml (§14.1 工程默认结构)', () => {
  it('parses the §14.1 example verbatim into the full audit structure', () => {
    const result = load()
    expect(result.errors).toHaveLength(0)
    const w = result.tree.workspace!
    expect(w.workspace).toEqual({ root: '.', git_required: true })
    expect(w.audit).toEqual({
      strict_tracked: { paths: [] },
      discovery_zones: [
        { path: 'results/', artifact_types: ['DATASET', 'FIGURE'] },
        { path: 'docs/' },
      ],
      ignored: ['cache/', 'build/', 'tmp/'],
    })
    // byte-exact frozen example
    expect(baseTreeFiles()['workspace.yaml']).toBe(WORKSPACE_YAML_EXAMPLE)
  })

  it('git_required defaults to true when absent (INV-GIT-1 工程默认)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: experiments/\n',
    }))
    expect(result.errors).toHaveLength(0)
    expect(result.tree.workspace!.workspace).toEqual({ root: 'experiments/', git_required: true })
  })

  it('git_required false is preserved (managed mode opt-out)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\n  git_required: false\n',
    }))
    expect(result.errors).toHaveLength(0)
    expect(result.tree.workspace!.workspace.git_required).toBe(false)
  })

  it('discovery_zones artifact_types validated against the frozen ArtifactType enum', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\naudit:\n  discovery_zones:\n    - path: results/\n      artifact_types: [DATASET, FIGURE, NOT_A_TYPE]\n',
    }))
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/audit/discovery_zones/0/artifact_types/2')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(e!.message).toContain('DATASET')
    expect(result.tree.workspace).toBeNull()
  })

  it('unknown workspace field → SCHEMA additionalProperties (additionalProperties: false)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'workspace.yaml': 'workspace:\n  root: .\n  extra: 1\n',
    }))
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/workspace')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(e!.message).toContain('extra')
  })
})

describe('agent-plan-fork policy (PLAN_FORK_SPEC §9)', () => {
  it('parses the §9 example verbatim', () => {
    const result = load()
    expect(result.errors).toHaveLength(0)
    expect(result.tree.policy).toEqual({
      enabled: true,
      anchors: { allow_boundary_sentinels: true, required_item_types: [] },
      flooding: { threshold: 5 },
      triggers: {
        require_at_least_one: true,
        allowed_kinds: ['CLAIM', 'FACT', 'ARTIFACT', 'MILESTONE', 'OBJECTIVE'],
      },
    })
    expect(baseTreeFiles()['policies/agent-plan-fork.yaml']).toBe(POLICY_YAML_EXAMPLE)
  })

  it('empty policy {} → schema defaults (enabled true)', () => {
    const result = load(mutate(baseTreeFiles(), {
      'policies/agent-plan-fork.yaml': '{}\n',
    }))
    expect(result.errors).toHaveLength(0)
    expect(result.tree.policy!.enabled).toBe(true)
    expect(result.tree.policy!.anchors).toBeUndefined()
  })

  it('flooding.threshold minimum 1 → SCHEMA when 0', () => {
    const result = load(mutate(baseTreeFiles(), {
      'policies/agent-plan-fork.yaml': 'enabled: true\nflooding:\n  threshold: 0\n',
    }))
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/flooding/threshold')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(result.tree.policy).toBeNull()
  })

  it('triggers.allowed_kinds validated against the frozen trigger-kind enum', () => {
    const result = load(mutate(baseTreeFiles(), {
      'policies/agent-plan-fork.yaml': 'enabled: true\ntriggers:\n  allowed_kinds: [CLAIM, RUN]\n',
    }))
    const e = result.errors.find((x) => x.code === 'SCHEMA' && x.path === '/triggers/allowed_kinds/1')
    expect(e, `errors: ${JSON.stringify(result.errors)}`).toBeDefined()
    expect(result.tree.policy).toBeNull()
  })
})
