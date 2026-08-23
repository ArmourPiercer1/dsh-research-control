/**
 * WP-4.4 — event presentation metadata (pure unit tests).
 *
 * Pins the display mapping of the frozen catalog: all 20 V1 event types
 * carry a Chinese label + category (HISTORY_EVENT_CATALOG §4 table),
 * unknown types degrade to a readable fallback, the actor badge letter
 * follows the §4 E column (U/A/P; the frozen enum's SYSTEM → S), and the
 * timestamp rendering is deterministic UTC.
 */

import { describe, expect, it } from 'vitest'
import { EVENT_TYPE_META, actorLabel, actorLetter, eventTypeMeta, formatEpochMs } from '../../src/client/views/history/index.js'

describe('eventTypeMeta — the frozen catalog §4 table', () => {
  it('covers exactly the 20 V1 event types', () => {
    const expected = [
      'RUN_STARTED',
      'RUNS_STARTED',
      'RUN_FINISHED',
      'RUN_FAILED',
      'RUN_CANCELLED',
      'TASK_EXECUTION_CHANGED',
      'TASK_VALIDATION_CHANGED',
      'ACCEPTANCE_CRITERION_CHANGED',
      'FACT_RECORDED',
      'CLAIM_RECORDED',
      'CLAIM_RETRACTED',
      'ARTIFACT_REGISTERED',
      'ARTIFACT_MARKED_MISSING',
      'RELATION_ADDED',
      'RELATION_REMOVED',
      'GATE_EVALUATED',
      'MILESTONE_ACHIEVED',
      'INTERVENTION_CREATED',
      'TOPOLOGY_FORK_REALIZED',
      'TOPOLOGY_MERGE_REALIZED',
    ]
    expect(Object.keys(EVENT_TYPE_META).sort()).toEqual([...expected].sort())
  })

  it('maps the spot-checked rows to the §4 label/category', () => {
    expect(eventTypeMeta('RUN_STARTED')).toEqual({ label: 'Run 开始', category: 'Run' })
    expect(eventTypeMeta('RUNS_STARTED')).toEqual({ label: '批量启动 Run', category: 'Run' })
    expect(eventTypeMeta('TASK_EXECUTION_CHANGED')).toEqual({ label: 'execution 状态迁移', category: 'Task' })
    expect(eventTypeMeta('GATE_EVALUATED')).toEqual({ label: 'Gate 评估', category: 'Gate/Milestone' })
    expect(eventTypeMeta('TOPOLOGY_MERGE_REALIZED')).toEqual({ label: 'merge 边实现', category: '拓扑实现' })
  })

  it('degrades an unknown event type to a readable fallback (never throws)', () => {
    expect(eventTypeMeta('FUTURE_EVENT_TYPE')).toEqual({ label: 'FUTURE_EVENT_TYPE', category: '其他' })
  })
})

describe('actorLetter — the U/A/P badge (catalog §4 E column)', () => {
  it('maps the frozen actorRef kinds', () => {
    expect(actorLetter('USER')).toBe('U')
    expect(actorLetter('AGENT')).toBe('A')
    expect(actorLetter('PLUGIN')).toBe('P')
    expect(actorLetter('SYSTEM')).toBe('S')
  })

  it('degrades an unrecognized kind to its first character (uppercase)', () => {
    expect(actorLetter('GHOST')).toBe('G')
    expect(actorLetter('')).toBe('?')
  })
})

describe('actorLabel — the human-readable tooltip line', () => {
  it('prefers an explicit label', () => {
    expect(actorLabel({ kind: 'USER', label: '张三' })).toBe('张三')
    expect(actorLabel({ kind: 'PLUGIN', label: 'audit scanner' })).toBe('audit scanner')
  })

  it('falls back per kind (user id / agent run / defaults)', () => {
    expect(actorLabel({ kind: 'USER', user_id: 'u1' })).toBe('用户 u1')
    expect(actorLabel({ kind: 'USER' })).toBe('用户')
    expect(actorLabel({ kind: 'AGENT', run_id: 'R-2' })).toBe('Agent（Run R-2）')
    expect(actorLabel({ kind: 'AGENT' })).toBe('Agent')
    expect(actorLabel({ kind: 'PLUGIN' })).toBe('插件')
    expect(actorLabel({ kind: 'SYSTEM' })).toBe('系统')
    expect(actorLabel({ kind: 'GHOST' })).toBe('GHOST')
  })
})

describe('formatEpochMs — deterministic UTC rendering', () => {
  it('formats a known epoch exactly (no locale dependence)', () => {
    // 2025-08-12 12:00:00 UTC
    expect(formatEpochMs(1_755_000_000_000)).toBe('2025-08-12 12:00:00')
  })

  it('pads single-digit fields and rejects invalid input', () => {
    // 2026-01-02 03:04:05 UTC
    expect(formatEpochMs(1_767_323_045_000)).toBe('2026-01-02 03:04:05')
    expect(formatEpochMs(Number.NaN)).toBe('—')
  })
})
