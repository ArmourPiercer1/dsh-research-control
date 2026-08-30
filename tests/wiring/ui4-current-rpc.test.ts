/**
 * UI-4 (D §10, D1) — 7 个 attention RPC 的生产接线（真实 wiring +
 * 真实 research.sqlite + 真实声明式树）:
 *
 *  - getWorkstreamCurrent: 读面全量（ADJ-6 目标集 / ADJ-5 显式 blocker
 *    作用域 / ADJ-3+4 derived 投影 / PROPOSED NA / ADJ-7 intervention
 *    直通）+ 结果过冻结 strict schema;
 *  - derived 机械规则经 RPC 面端到端: CF focus + appendEvents 种事件
 *    （RELATION_ADDED / GATE_EVALUATED / TASK_EXECUTION_CHANGED — 全过
 *    冻结 registry 校验）⇒ 两规则点火; 执行面折叠 + 审计序覆盖清除;
 *    重复读深相等（reload-no-drift 门单元面）;
 *  - updateObjective: statement RMW / status 迁移 / 组合编辑 / 双缺省与
 *    未知 id 拒绝（ACT_INPUT / OBJ_NOT_FOUND 经 #mapActionsError 载体）;
 *  - next actions: create（PROPOSED 面）→ promote 物化（T-5 定义文件 +
 *    plan.yaml 重写 + 回执逐字）→ dismiss（离开 PROPOSED 面）;
 *  - blockers: create（explicitBlockers 面）→ clear（CLEARED + clearedAt,
 *    行仍在 zone 面）/ 悬空 WS 与未知 id 拒绝。
 *
 * 接线先例: tests/reporting/rpc-wiring.test.ts（第二连接 raw 回读 +
 * afterEach 三层 close）。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ProductionResearchRpcServices } from '../../src/host/dsh-adapter/host/rpc-services.js'
import {
  ClearBlockerResultSchema,
  CreateBlockerResultSchema,
  CreateNextActionResultSchema,
  DismissNextActionResultSchema,
  GetWorkstreamCurrentResultSchema,
  PromoteNextActionResultSchema,
  UpdateObjectiveResultSchema,
} from '../../src/shared/rpc-contracts.js'
import type { HistoryEventInput } from '../../src/host/persistence/store/index.js'
import { T0, makeClock, makeWiring, WR_SCHEMA_ROOT, type WiringBundle } from './helpers.js'

/** A full 9-field envelope builder (the store assigns seq/recordedAt). */
function evt(
  over: Partial<HistoryEventInput> & {
    eventType: string
    payload: Record<string, unknown>
    ownerWorkstreamId: string
    eventId: string
  },
  i: number,
): HistoryEventInput {
  return {
    schemaVersion: 1,
    occurredAt: T0 + i * 1000,
    actor: { kind: 'USER', user_id: 'u-1' },
    ...over,
  }
}

const WS1_PLAN = 'topics/TPC-1/workstreams/WS-1/plan.yaml'

describe('UI-4 attention RPC — 生产接线 (7 面)', () => {
  let bundle: WiringBundle
  let services: ProductionResearchRpcServices
  let raw: DatabaseSync | undefined

  afterEach(() => {
    raw?.close()
    services?.close()
    bundle.wiring.close()
  })

  function open(): void {
    bundle = makeWiring({ now: makeClock(T0) })
    services = new ProductionResearchRpcServices({ wiring: bundle.wiring, schemaRoot: WR_SCHEMA_ROOT, now: bundle.now })
    raw = new DatabaseSync(join(bundle.dataDir, 'research.sqlite'))
    raw.exec('PRAGMA busy_timeout = 5000')
  }

  /* ================================================================== *
   * getWorkstreamCurrent — 读面
   * ================================================================ */

  describe('getWorkstreamCurrent', () => {
    it('happy path: 基线树目标集在（ADJ-6）, 其余四面空; 结果过冻结 schema（含可选 projectId 面）', async () => {
      open()
      const res = await services.getWorkstreamCurrent({ workstreamId: 'WS-1', projectId: 'PRJ-1' })
      GetWorkstreamCurrentResultSchema.parse(res)
      expect(res.workstreamId).toBe('WS-1')
      // 基线 objectives.yaml OBJ-1（ACTIVE + linked_refs 含 WS-1 ⇒ 入集）—
      // 逐字 DTO（scope TOPIC / 无 target_date ⇒ null / linkedRefs 原序）。
      expect(res.objectives).toEqual([
        {
          id: 'OBJ-1',
          scope: 'TOPIC',
          statement: '完成亚像素级视觉定位原型',
          status: 'ACTIVE',
          priority: 'P1',
          targetDate: null,
          successCriteria: ['重投影误差 <2px'],
          linkedRefs: [
            { kind: 'WORKSTREAM', id: 'WS-1' },
            { kind: 'GATE', id: 'G-1' },
          ],
        },
      ])
      expect(res.explicitBlockers).toEqual([])
      expect(res.derivedBlockers).toEqual([])
      expect(res.nextActions).toEqual([])
      expect(res.interventions).toEqual([])
    })

    it('CF focus + 种事件 ⇒ derived 两规则点火（确定性序）; 重复读深相等（reload-no-drift 单元面）', async () => {
      open()
      bundle.wiring.currentFocus.set('WS-1', 'T-2')
      bundle.wiring.store.appendEvents([
        evt({ eventId: 'H-U1', ownerWorkstreamId: 'WS-1', eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-1', relation_type: 'DEPENDS_ON', source: { kind: 'TASK', id: 'T-2' }, target: { kind: 'TASK', id: 'T-3' } } }, 1),
        evt({ eventId: 'H-U2', ownerWorkstreamId: 'WS-1', eventType: 'GATE_EVALUATED', payload: { gate_id: 'G-1', result: 'FAILED', evaluated_by: { kind: 'USER', user_id: 'u-1' } } }, 2),
      ])

      const res = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      GetWorkstreamCurrentResultSchema.parse(res)
      expect(res.derivedBlockers).toEqual([
        {
          id: 'DERIVED-DEPENDENCY-T-3',
          source: 'DEPENDENCY',
          statement: 'Blocked by dependency on T-3',
          reasonRefs: ['REL-1', 'T-3'],
          primaryAction: { label: 'Open T-3', targetKind: 'TASK', targetId: 'T-3' },
        },
        {
          id: 'DERIVED-GATE-G-1',
          source: 'GATE',
          statement: 'Blocked by Gate G-1',
          reasonRefs: ['G-1'],
          primaryAction: { label: 'Open G-1', targetKind: 'GATE', targetId: 'G-1' },
        },
      ])

      // 第二次读（无新事件）⇒ 字节级同面（纯投影, 无随机面）。
      const again = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(again).toEqual(res)
    })

    it('执行面折叠 + 审计序覆盖清除投影（EXECUTED 目标 / LATEST PASSED / removed 边 ⇒ []）', async () => {
      open()
      bundle.wiring.currentFocus.set('WS-1', 'T-2')
      bundle.wiring.store.appendEvents([
        evt({ eventId: 'H-U1', ownerWorkstreamId: 'WS-1', eventType: 'RELATION_ADDED', payload: { relation_id: 'REL-1', relation_type: 'DEPENDS_ON', source: { kind: 'TASK', id: 'T-2' }, target: { kind: 'TASK', id: 'T-3' } } }, 1),
        evt({ eventId: 'H-U2', ownerWorkstreamId: 'WS-1', eventType: 'GATE_EVALUATED', payload: { gate_id: 'G-1', result: 'FAILED', evaluated_by: { kind: 'USER', user_id: 'u-1' } } }, 2),
        evt({ eventId: 'H-U3', ownerWorkstreamId: 'WS-1', eventType: 'TASK_EXECUTION_CHANGED', payload: { task_id: 'T-3', from: 'PLANNED', to: 'EXECUTED', reason: 'done' } }, 3),
        evt({ eventId: 'H-U4', ownerWorkstreamId: 'WS-1', eventType: 'GATE_EVALUATED', payload: { gate_id: 'G-1', result: 'PASSED', evaluated_by: { kind: 'USER', user_id: 'u-1' } } }, 4),
        evt({ eventId: 'H-U5', ownerWorkstreamId: 'WS-1', eventType: 'RELATION_REMOVED', payload: { relation_id: 'REL-1', source: { kind: 'TASK', id: 'T-2' }, relation_type: 'DEPENDS_ON', target: { kind: 'TASK', id: 'T-3' }, reason: 'dep resolved' } }, 5),
      ])

      const res = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(res.derivedBlockers).toEqual([])
    })

    it('未知 WS ⇒ 拒绝（消息携带 op + id）', async () => {
      open()
      await expect(services.getWorkstreamCurrent({ workstreamId: 'WS-99' })).rejects.toThrow('getWorkstreamCurrent: workstream WS-99 does not exist')
    })
  })

  /* ================================================================== *
   * updateObjective — RMW / status 面
   * ================================================================ */

  describe('updateObjective', () => {
    it('statement-only RMW: schema 有效, status 不变, 下次读反映新陈述', async () => {
      open()
      const res = await services.updateObjective({ objectiveId: 'OBJ-1', statement: '新的目标陈述' })
      UpdateObjectiveResultSchema.parse(res)
      expect(res.objectiveId).toBe('OBJ-1')
      expect(res.status).toBe('ACTIVE')
      expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)
      expect(res.updatedAt).toBeGreaterThanOrEqual(T0)

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.objectives).toHaveLength(1)
      expect(after.objectives[0]!.statement).toBe('新的目标陈述')
      // 其余字段不动（RMW 只改 statement）:
      expect(after.objectives[0]!.successCriteria).toEqual(['重投影误差 <2px'])
    })

    it('status-only（ACTIVE → ACHIEVED）: 目标离开 current 集', async () => {
      open()
      const res = await services.updateObjective({ objectiveId: 'OBJ-1', status: 'ACHIEVED' })
      UpdateObjectiveResultSchema.parse(res)
      expect(res.status).toBe('ACHIEVED')

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.objectives).toEqual([])
    })

    it('组合编辑（statement + status 一次调用）: 终态 status 回执; 读面反映两者', async () => {
      open()
      const res = await services.updateObjective({ objectiveId: 'OBJ-1', statement: '组合编辑陈述', status: 'DROPPED' })
      UpdateObjectiveResultSchema.parse(res)
      expect(res.status).toBe('DROPPED')
      expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.objectives).toEqual([]) // DROPPED 非 ACTIVE ⇒ 出集
      // 文件面回读（statement 落盘了, 只是状态面把它挤出 ACTIVE 集）:
      const objectivesYaml = readFileSync(join(bundle.researchRoot, 'objectives.yaml'), 'utf8')
      expect(objectivesYaml).toContain('组合编辑陈述')
      expect(objectivesYaml).toContain('status: DROPPED')
    })

    it('双缺省 ⇒ ACT_INPUT; 未知 objectiveId ⇒ OBJ_NOT_FOUND（#mapActionsError 载体）', async () => {
      open()
      await expect(services.updateObjective({ objectiveId: 'OBJ-1' })).rejects.toThrow('[research-control] ACT_INPUT')
      await expect(services.updateObjective({ objectiveId: 'OBJ-99', statement: 'x' })).rejects.toThrow('OBJ_NOT_FOUND')
    })
  })

  /* ================================================================== *
   * next actions — create / promote / dismiss
   * ================================================================ */

  describe('next actions', () => {
    it('createNextAction 落 PROPOSED 面: schema 有效 + Current zone 可见', async () => {
      open()
      const res = await services.createNextAction({ workstreamId: 'WS-1', statement: '跑下一组标定', rationale: '基线不稳' })
      CreateNextActionResultSchema.parse(res)
      expect(res.nextAction).toMatchObject({
        id: 'NA-1',
        workstreamId: 'WS-1',
        statement: '跑下一组标定',
        rationale: '基线不稳',
        status: 'PROPOSED',
        promotedToTaskId: null,
      })

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.nextActions).toHaveLength(1)
      expect(after.nextActions[0]!.id).toBe('NA-1')
    })

    it('promoteNextAction 物化 T-5: 回执逐字 + plan.yaml 重写（raw 字节面）+ NA 离开 PROPOSED 面', async () => {
      open()
      await services.createNextAction({ workstreamId: 'WS-1', statement: '标定数据清洗' })
      const res = await services.promoteNextAction({ nextActionId: 'NA-1', workstreamId: 'WS-1', index: 1 })
      PromoteNextActionResultSchema.parse(res)
      expect(res).toEqual({
        nextActionId: 'NA-1',
        taskId: 'T-5',
        workstreamId: 'WS-1',
        planPath: res.planPath, // 根相对面（同 WP-5.2 pin）— 断言在下方
        newOrder: ['G-1', 'T-5', 'T-1', 'T-2', 'T-3', 'M-1', 'T-4', 'G-2'],
        managementActionId: res.managementActionId,
      })
      expect(res.taskId).toBe('T-5')
      expect(res.planPath).toBe(WS1_PLAN)
      expect(res.managementActionId).toMatch(/^MA-[1-9][0-9]*$/)

      // raw 声明式面: plan.yaml 新序 + T-5 定义文件物化（§4.1）。
      const planBytes = readFileSync(join(bundle.researchRoot, WS1_PLAN), 'utf8')
      expect(planBytes).toContain('ordered_items: [G-1, T-5, T-1, T-2, T-3, M-1, T-4, G-2]')
      expect(readFileSync(join(bundle.researchRoot, 'topics/TPC-1/workstreams/WS-1/items/tasks/T-5.yaml'), 'utf8')).toContain('id: T-5')

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.nextActions).toEqual([]) // NA-1 已 PROMOTED ⇒ 出 PROPOSED 面
    })

    it('dismissNextAction: DISMISSED 回执 + 离开 PROPOSED 面', async () => {
      open()
      await services.createNextAction({ workstreamId: 'WS-1', statement: '暂缓项' })
      const res = await services.dismissNextAction({ nextActionId: 'NA-1' })
      DismissNextActionResultSchema.parse(res)
      expect(res.nextAction).toMatchObject({ id: 'NA-1', status: 'DISMISSED' })

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.nextActions).toEqual([])
    })

    it('createNextAction 悬空 workstream ⇒ ACT_INPUT（§16.3, RPC 面）', async () => {
      open()
      await expect(services.createNextAction({ workstreamId: 'WS-99', statement: 'x' })).rejects.toThrow('ACT_INPUT')
      expect((await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })).nextActions).toEqual([])
    })
  })

  /* ================================================================== *
   * blockers — create / clear
   * ================================================================ */

  describe('blockers', () => {
    it('createBlocker 落 explicitBlockers 面: schema 有效 + affects 往返', async () => {
      open()
      const res = await services.createBlocker({
        statement: '数据集中缺一组姿态',
        affects: [
          { kind: 'WORKSTREAM', id: 'WS-1' },
          { kind: 'TASK', id: 'T-2' },
        ],
        source: 'UI 手工登记',
      })
      CreateBlockerResultSchema.parse(res)
      expect(res.blocker).toMatchObject({
        id: 'BLK-1',
        statement: '数据集中缺一组姿态',
        status: 'ACTIVE',
        source: 'UI 手工登记',
        references: null,
        clearedAt: null,
      })

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.explicitBlockers).toHaveLength(1)
      expect(after.explicitBlockers[0]!.affects).toEqual([
        { kind: 'WORKSTREAM', id: 'WS-1' },
        { kind: 'TASK', id: 'T-2' },
      ])
    })

    it('clearBlocker: CLEARED + clearedAt; 行仍在 zone 面（状态面携带, ADJ-5 不过滤）', async () => {
      open()
      await services.createBlocker({ statement: '暂阻', affects: [{ kind: 'WORKSTREAM', id: 'WS-1' }], source: 'UI' })
      const res = await services.clearBlocker({ blockerId: 'BLK-1' })
      ClearBlockerResultSchema.parse(res)
      expect(res.blocker.status).toBe('CLEARED')
      expect(res.blocker.clearedAt).toBeTypeOf('number')

      const after = await services.getWorkstreamCurrent({ workstreamId: 'WS-1' })
      expect(after.explicitBlockers).toHaveLength(1)
      expect(after.explicitBlockers[0]!.status).toBe('CLEARED')
    })

    it('createBlocker 悬空 WS ⇒ 拒绝; clearBlocker 未知 id ⇒ 拒绝', async () => {
      open()
      await expect(
        services.createBlocker({ statement: 'x', affects: [{ kind: 'WORKSTREAM', id: 'WS-99' }], source: 'UI' }),
      ).rejects.toThrow('WS-99')
      await expect(services.clearBlocker({ blockerId: 'BLK-99' })).rejects.toThrow('BLK-99')
      expect(raw!.prepare('SELECT COUNT(*) AS n FROM blocker').get() as { n: number }).toEqual({ n: 0 })
    })
  })
})
