/**
 * WP-3.3 — tool permission assertions (task goal 4 + TC face; TEST_MATRIX
 * TC-DOM-013 「Agent 能力矩阵：§7.2 工具逐项：可写集合内放行、外拒绝（含
 * Intervention 状态、awareness、Git restore、History delete）」;
 * ARCHITECTURE §6 矩阵 A 列; INV-PERM-1/2).
 *
 * Layers:
 *  1. ACTOR GATE — every tool × every non-AGENT kind (USER/PLUGIN/SYSTEM)
 *     is refused with TOOL_ACTOR_FORBIDDEN before any handler work;
 *  2. RUN REQUIREMENT — every write tool × an AGENT actor without run_id
 *     is refused with TOOL_RUN_REQUIRED (INV-PERM-1 run attribution);
 *  3. ALLOWED LANE — an AGENT actor with a run passes the gate on all 11
 *     tools (the 2 live tools serve; the 9 stubs fail ONLY with
 *     NOT_IMPLEMENTED — the gate is the sole permission layer);
 *  4. NO TOOL OUTSIDE THE MATRIX — the §7.2 forbidden-operation list and
 *     the §6 ❌ rows have no tool: the name set is exactly the 11 and no
 *     name/export carries a forbidden operation;
 *  5. MATRIX COLUMN A MAPPING — each of the 11 tools maps to exactly one
 *     RESEARCH_AGENT-allowed matrix row (the map is asserted, not prose).
 */

import { describe, expect, it } from 'vitest'

import * as toolsModule from '../../src/host/tools/index.js'
import {
  INVESTIGATOR_TOOL_NAMES,
  READ_TOOL_NAMES,
  RESEARCH_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  createResearchTools,
} from '../../src/host/tools/index.js'
import { NON_AGENT_ACTORS, expectToolErrorAsync, makeExec, makeRecordingDeps } from './fixtures.js'
import { openRecord } from '../planfork/fixtures.js'

const deps = makeRecordingDeps()
// The 2 live tools get fixed success impls so the PERMISSION GATE is the
// only variable under test (the forwarding fidelity is a separate suite).
deps.setPlanForkCreate((params) => ({ ...openRecord(), created_by_run: params.createdByRun }))
deps.setRecordCheckpoint((runId) => ({
  id: runId,
  workstream_id: 'WS-1',
  status: 'RUNNING',
  initiated_by: { kind: 'AGENT', run_id: runId },
  started_at: 1,
  last_checkpoint_at: 1,
}))
const tools = createResearchTools(deps)

/** One accepted minimal argument set per tool (passes the wire face). */
const VALID_ARGS: Record<string, unknown> = {
  research_fact_record: { workstream_id: 'WS-1', statement: 's' },
  research_claim_record: { workstream_id: 'WS-1', statement: 's' },
  research_artifact_register: { workstream_id: 'WS-1', type: 'DATASET', title: 't', uri: 'u' },
  research_intervention_create: { title: 't' },
  research_next_action_create: { statement: 's' },
  research_plan_fork_create: {
    workstream_id: 'WS-1',
    fork_anchor: 'G-1',
    merge_anchor: 'G-2',
    proposed_items: [{ action: 'KEEP', kind: 'TASK', ref: 'T-3' }],
    trigger_refs: [{ kind: 'FACT', id: 'F-31' }],
    reason: 'r',
    necessity: 'n',
  },
  research_run_checkpoint: { run_id: 'R-1' },
  research_context_get: {},
  research_plan_get: { workstream_id: 'WS-1' },
  research_history_query: { workstream_id: 'WS-1' },
  research_contract_read: { edge_id: 'TE-1' },
}

describe('TC-DOM-013 layer 1: actor gate (every tool × every non-AGENT kind)', () => {
  for (const tool of tools) {
    it(`${tool.name} refuses USER/PLUGIN/SYSTEM with TOOL_ACTOR_FORBIDDEN (message names the tool)`, async () => {
      for (const { name, actor } of NON_AGENT_ACTORS) {
        const error = await expectToolErrorAsync(
          () => tool.execute(VALID_ARGS[tool.name], makeExec({ actor })),
          'TOOL_ACTOR_FORBIDDEN',
        )
        expect(error.message).toContain(tool.name)
        expect(error.message).toContain(name)
      }
    })
  }
})

describe('TC-DOM-013 layer 2: run requirement on the write set (INV-PERM-1)', () => {
  for (const tool of tools.filter((t) => WRITE_TOOL_NAMES.includes(t.name))) {
    it(`${tool.name} refuses an AGENT actor without run_id (TOOL_RUN_REQUIRED)`, async () => {
      const error = await expectToolErrorAsync(
        () => tool.execute(VALID_ARGS[tool.name], makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
        'TOOL_RUN_REQUIRED',
      )
      expect(error.message).toContain(tool.name)
    })
  }
  it('read tools do NOT require a run (an investigator session may have no formal run)', async () => {
    for (const tool of tools.filter((t) => READ_TOOL_NAMES.includes(t.name))) {
      // the gate must pass the run check: the refusal (when any) is the
      // stub's NOT_IMPLEMENTED, never TOOL_RUN_REQUIRED
      await expectToolErrorAsync(
        () => tool.execute(VALID_ARGS[tool.name], makeExec({ actor: { kind: 'AGENT', session_id: 's' } })),
        'TOOL_NOT_IMPLEMENTED',
      )
    }
  })
})

describe('TC-DOM-013 layer 3: the allowed lane (AGENT + run passes the gate on all 11)', () => {
  it.each([...RESEARCH_TOOL_NAMES])('%s serves an AGENT actor with a run (live tools succeed, stubs fail only with NOT_IMPLEMENTED)', async (name) => {
    const tool = tools.find((t) => t.name === name)!
    try {
      const result = (await tool.execute(VALID_ARGS[name], makeExec())) as { status: string }
      // the 2 live tools
      expect(['created', 'ok']).toContain(result.status)
    } catch (e) {
      // the 9 stubs: the ONLY failure mode past the gate is NOT_IMPLEMENTED
      await expectToolErrorAsync(
        () => {
          throw e
        },
        'TOOL_NOT_IMPLEMENTED',
      )
    }
  })
})

describe('TC-DOM-013 layer 4: no tool outside the matrix (INV-PERM-2)', () => {
  // The §7.2 forbidden list (原文) + the §6 ❌ rows the agent must not
  // reach. Each token must appear in NO tool name and NO module export.
  const FORBIDDEN_OPERATIONS = [
    'select', // SELECT PlanFork (user only)
    'dismiss', // DISMISS PlanFork / NextAction DISMISS (user only)
    'reorder', // canonical plan reorder (user only)
    'restore', // Git restore (user only)
    'delete', // topology delete / History delete (nobody; agent ❌)
    'promote', // NextAction PROMOTE (user only)
    'awareness', // user awareness state (user only)
    'topology', // topology edit/rewrite (user only)
    'intervention_state', // Intervention OPEN/PENDING/CLOSED (user only, INV-PERM-4)
    'save_research_checkpoint', // git checkpoint (user only, INV-GIT-2)
    'history_delete', // History mutation/delete (nobody)
    'history_update',
    'plan_delete', // canonical plan delete (user only)
    'plan_insert', // canonical plan insert (user only)
    'flooding', // PlanFork flooding (PLUGIN mechanical trigger, not an agent tool)
  ] as const

  it('the tool name set is exactly the 11 frozen names (nothing extra exists)', () => {
    expect([...RESEARCH_TOOL_NAMES].sort()).toEqual(
      [
        'research_artifact_register',
        'research_claim_record',
        'research_contract_read',
        'research_context_get',
        'research_fact_record',
        'research_history_query',
        'research_intervention_create',
        'research_next_action_create',
        'research_plan_fork_create',
        'research_plan_get',
        'research_run_checkpoint',
      ].sort(),
    )
  })

  it('no forbidden operation appears in any tool name', () => {
    for (const token of FORBIDDEN_OPERATIONS) {
      const offenders = RESEARCH_TOOL_NAMES.filter((n) => n.includes(token))
      expect(offenders, `forbidden token "${token}" in tool names`).toEqual([])
    }
  })

  it('no module export names a forbidden operation (the handler surface is equally absent)', () => {
    const exportNames = Object.keys(toolsModule)
    for (const token of FORBIDDEN_OPERATIONS) {
      const offenders = exportNames.filter((n) => n.toLowerCase().includes(token))
      expect(offenders, `forbidden token "${token}" in module exports`).toEqual([])
    }
  })

  it('the matrix column A mapping: each tool ↔ exactly one RESEARCH_AGENT-allowed row', () => {
    // §6 row (原文摘要) → tool. The map's values are EXACTLY the 11 names.
    const ROW_TO_TOOL: Record<string, string> = {
      '记录 Fact / Claim / Artifact (✅)': 'research_fact_record',
      '记录 Artifact (✅) [same row, dedicated tool]': 'research_artifact_register',
      '记录 Claim (✅) [same row, dedicated tool]': 'research_claim_record',
      'Intervention 创建 (✅)': 'research_intervention_create',
      'NextAction 创建 (✅)': 'research_next_action_create',
      '创建 PlanFork (✅ 经校验)': 'research_plan_fork_create',
      'Run 生命周期事件 (✅ checkpoint 报告触发)': 'research_run_checkpoint',
      '只读查询（矩阵无独立行；agent 读面） context': 'research_context_get',
      '只读查询（矩阵无独立行；agent 读面） canonical plan': 'research_plan_get',
      'History append 受限读面（query）': 'research_history_query',
      'Merge Contract 读（编辑经 workspace 文件，脚注 ²）': 'research_contract_read',
    }
    const mapped = Object.values(ROW_TO_TOOL)
    expect(mapped.sort()).toEqual([...RESEARCH_TOOL_NAMES].sort())
  })

  it('the Investigator preset subset carries no write tool (INV-PERM-3 layer 1)', () => {
    for (const name of INVESTIGATOR_TOOL_NAMES) {
      expect(WRITE_TOOL_NAMES, `${name} must not be investigator-eligible`).not.toContain(name)
    }
    expect(INVESTIGATOR_TOOL_NAMES).toHaveLength(4)
  })
})
