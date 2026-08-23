/**
 * WP-7.4 / G7 S1a — wiring 级生产装配测试（investigator + analysis 半边）。
 *
 * 覆盖（真 createHostWiring + 真 sqlite + 真冻结 schema — 同 wiring.test.ts
 * 纪律, 假面仅限两个宿主端口: session adapter / launcher adapter）:
 *  - 装配在位: `wiring.investigator`（launcher over 注入端口）+
 *    `wiring.analysisStore` / `analysisService` / `analysisTransient`
 *    （第 4 条第二连接 + 真实冻结 provenance schema）;
 *  - 启动链经 wiring 到底: `launchFromIntervention`（record + question +
 *    repoRoot）→ 假端口恰好 1 次, 入参 = 闭集 4 字段逐字（presetId /
 *    permissionPreset 字面量; cwd = repoRoot; task = 冻结 prompt 格式）;
 *  - 端口失败透传: 假端口抛错 = 同实例上抛（无包装吞错）;
 *  - WIRING_INVESTIGATOR: 坏端口（launchInvestigator 非函数）⇒ 结构化
 *    HostWiringError + 零泄漏（资源回卷, 同 wiring.test.ts 泄漏面）;
 *  - WIRING_ANALYSIS: operational schema 缺 analysis 文件 ⇒ 结构化失败
 *    （不猜、不降级 — 无形状网的 AnalysisRecord 拒绝装配）;
 *  - 用户门保存链（真库往返）: saveAsAnalysisRecord（USER actor）→
 *    AN-1 落库 + 读面回读逐字; 伪造 actor ⇒ 零写入;
 *  - transient 读面（全真: sessionlink 指针 + adapter 列表 + run 表
 *    dshSessionId 面）: 绑定会话 = 三段齐全; 未绑定会话 = 三段 null
 *    （诚实透出, 不虚构）;
 *  - close(): analysis 第二连接随单一 disposer 关闭（文件仍可用 —
 *    回卷不损坏, 同 wiring.test.ts 泄漏钉）。
 */

import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildInvestigationContext,
  investigationTask,
  INVESTIGATOR_PRESET_ID,
  READ_ONLY_PERMISSION_PRESET,
} from '../../src/host/service/investigator/index.js'
import { USER_ACTOR } from '../../src/host/service/analysis/index.js'
import type { InterventionRecord } from '../../src/host/service/flooding/index.js'
import { HostWiringError, createHostWiring } from '../../src/host/service/wiring/index.js'
import {
  makeFakeLauncherAdapter,
  makeTempDir,
  makeWiring,
  rawDb,
  WR_SCHEMA_ROOT,
} from './helpers.js'

/** 一个最小合法 Intervention record（flooding 种子同款形状）。 */
function makeRecord(overrides?: Partial<InterventionRecord>): InterventionRecord {
  return {
    id: 'IV-1',
    title: 'Review accumulated agent plan forks [WS-1]',
    detail: 'window=300s forks=6 threshold=5',
    origin: 'AUTO_FLOODING',
    workstream_ids: ['WS-1'],
    source_refs: [{ kind: 'PLAN_FORK', id: 'PF-1' }],
    status: 'OPEN',
    created_by: { kind: 'PLUGIN', label: 'flooding-detector' },
    created_at: 1_700_000_000_000,
    ...overrides,
  }
}

describe('wiring investigator 装配（WP-7.4 / G7 S1a）', () => {
  it('装配在位 + launchFromIntervention 经 wiring 到底（假端口 1 次, 入参闭集逐字）', async () => {
    const { repoRoot, launcherAdapter, wiring } = makeWiring()
    try {
      expect(wiring.investigator).toBeDefined()
      const result = await wiring.investigator.launchFromIntervention(makeRecord(), '为什么 PF 在堆积?', repoRoot)
      // 端口恰好 1 次, 入参 = 闭集 4 字段（构造链 buildInvestigationContext
      // + buildRequest 的同一真源产物 — 逐字段钉）。
      expect(launcherAdapter.requests).toHaveLength(1)
      const request = launcherAdapter.requests[0]!
      const context = buildInvestigationContext(makeRecord(), '为什么 PF 在堆积?', repoRoot)
      expect(request.presetId).toBe(INVESTIGATOR_PRESET_ID)
      expect(request.permissionPreset).toBe(READ_ONLY_PERMISSION_PRESET)
      expect(request.cwd).toBe(repoRoot)
      expect(request.task).toBe(investigationTask(context))
      expect(result.sessionId).toBe('investigator-fake-1')
    } finally {
      wiring.close()
    }
  })

  it('端口失败透传（同实例上抛 — 无包装吞错）', async () => {
    const boom = new Error('host agent factory rejected the launch')
    const { repoRoot, launcherAdapter, wiring } = makeWiring()
    ;(launcherAdapter as { failWith?: Error }).failWith = boom
    try {
      await expect(wiring.investigator.launchFromIntervention(makeRecord(), 'q', repoRoot)).rejects.toBe(boom)
    } finally {
      wiring.close()
    }
  })

  it('WIRING_INVESTIGATOR: 坏端口（launchInvestigator 非函数）⇒ 结构化失败 + 零泄漏', () => {
    // 借用一个有效树: makeWiring 的 repo 写树 + git（wiring.test.ts
    // attempt 模式 — 这里用 bundle 的 repo + dataDir 重放直接
    // createHostWiring, 只替换坏端口）.
    const bundle = makeWiring()
    const { repoRoot, dataDir, adapter } = bundle
    bundle.wiring.close()
    let code: string | undefined
    try {
      createHostWiring({
        repoRoot,
        schemaRoot: WR_SCHEMA_ROOT,
        projectId: 'PRJ-1',
        dataDir,
        adapter,
        launcherAdapter: {} as never, // 坏端口: 缺 launchInvestigator 函数
        workspaceRoots: [repoRoot],
      })
    } catch (e) {
      expect(e).toBeInstanceOf(HostWiringError)
      code = (e as HostWiringError).code
    }
    expect(code).toBe('WIRING_INVESTIGATOR')
    // 零泄漏: 回卷后文件可用（store 连接已关闭 — 可重开查询）。
    if (existsSync(join(dataDir, 'research.sqlite'))) {
      const db = rawDb(dataDir)
      try {
        db.prepare('SELECT user_version FROM pragma_user_version').get()
      } finally {
        db.close()
      }
    }
  })
})

describe('wiring analysis 装配（WP-7.4 / G7 S1a）', () => {
  it('WIRING_ANALYSIS: operational schema 缺 analysis 文件 ⇒ 结构化失败', () => {
    const schemaRoot = makeTempDir('wp74-schema-')
    cpSync(WR_SCHEMA_ROOT, schemaRoot, { recursive: true })
    // 删掉 analysis 的冻结 schema（loader 的 required 文件 — 不可用即拒）。
    // provenance.schema.json 是 AnalysisRecord 形状网的唯一来源。
    rmSync(join(schemaRoot, 'operational', 'provenance.schema.json'), { force: true })
    const { repoRoot, adapter } = makeWiring()
    let code: string | undefined
    try {
      createHostWiring({
        repoRoot,
        schemaRoot,
        projectId: 'PRJ-1',
        dataDir: makeTempDir('wp74-ad-'),
        adapter,
        launcherAdapter: makeFakeLauncherAdapter(),
        workspaceRoots: [repoRoot],
      })
    } catch (e) {
      expect(e).toBeInstanceOf(HostWiringError)
      code = (e as HostWiringError).code
    }
    expect(code).toBe('WIRING_ANALYSIS')
  })

  it('用户门保存链（真库往返）: USER actor 落库 + 读面回读逐字; 伪造 actor 零写入', () => {
    const { wiring } = makeWiring()
    try {
      const saved = wiring.analysisService.saveAsAnalysisRecord(
        { sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: '结论: PF 堆积源于 gate 未闭合。' },
        USER_ACTOR,
      )
      expect(saved.record.id).toBe('AN-1')
      expect(saved.record.source_ref).toEqual({ kind: 'INTERVENTION', id: 'IV-1' })
      expect(saved.record.content).toBe('结论: PF 堆积源于 gate 未闭合。')
      // 读面回读（无隐藏过滤器 — 全量 1 行）。
      const listed = wiring.analysisService.listAnalysisRecords()
      expect(listed).toHaveLength(1)
      expect(listed[0]).toEqual(saved.record)
      expect(wiring.analysisService.getAnalysisRecord('AN-1')).toEqual(saved.record)
      // 伪造 actor ⇒ 零写入（用户门先验 — 行数不变, 无 AN-2）。
      expect(() =>
        wiring.analysisService.saveAsAnalysisRecord(
          { sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'x' },
          { kind: 'AGENT', session_id: 'sess-fake' } as never,
        ),
      ).toThrow()
      expect(wiring.analysisService.listAnalysisRecords()).toHaveLength(1)
      expect(wiring.analysisService.getAnalysisRecord('AN-2')).toBeNull()
    } finally {
      wiring.close()
    }
  })

  it('transient 读面（全真端口）: 绑定会话三段齐全; 未绑定会话三段 null', () => {
    const { adapter, wiring } = makeWiring()
    const SID = 'sess-investigator-1'
    adapter.addSession({ id: SID, cwd: '/ws', title: 'investigator', running: false, blank: false, createdAt: 1_700_000_000_000 })
    try {
      // 全真三段: sessionlink 指针（wireSession）+ adapter 列表（上面）
      // + run 表 dshSessionId 面（registerRun）。
      wiring.sessionLink.wireSession(SID, { workstreamId: 'WS-1', intent: 'investigate IV-1' })
      wiring.runBinding.registerRun({ workstreamId: 'WS-1', dshSessionId: SID, intent: 'investigate IV-1' })

      const snapshot = wiring.analysisTransient.read(SID)
      expect(snapshot.sessionId).toBe(SID)
      expect(snapshot.session).not.toBeNull()
      expect(snapshot.session?.id).toBe(SID)
      expect(snapshot.pointer).not.toBeNull()
      expect(snapshot.pointer?.workstreamId).toBe('WS-1')
      expect(snapshot.run).not.toBeNull()
      expect(snapshot.run?.workstreamId).toBe('WS-1')
      expect(snapshot.run?.startedAt).toBeGreaterThan(0)

      // 未绑定会话: 列表在但无指针无 run — 诚实透出 null（不虚构绑定）。
      adapter.addSession({ id: 'sess-stray', cwd: '/ws', running: false, blank: false, createdAt: 1_700_000_001_000 })
      const stray = wiring.analysisTransient.read('sess-stray')
      expect(stray.session?.id).toBe('sess-stray')
      expect(stray.pointer).toBeNull()
      expect(stray.run).toBeNull()

      // 完全未知会话: 三段全 null。
      const unknown = wiring.analysisTransient.read('sess-never-existed')
      expect(unknown.session).toBeNull()
      expect(unknown.pointer).toBeNull()
      expect(unknown.run).toBeNull()
    } finally {
      wiring.close()
    }
  })

  it('close(): analysis 第二连接随单一 disposer 关闭（文件仍可用 — 回卷不损坏）', () => {
    const { dataDir, wiring } = makeWiring()
    wiring.analysisService.saveAsAnalysisRecord(
      { sourceRef: { kind: 'INTERVENTION', id: 'IV-1' }, content: 'close 前落一行' },
      USER_ACTOR,
    )
    wiring.close()
    wiring.close() // 幂等
    // 回卷后文件可用: 新连接可开可查（AN-1 仍在 — close 不删数据）。
    const db = rawDb(dataDir)
    try {
      const row = db.prepare('SELECT id FROM analysis_record ORDER BY id DESC LIMIT 1').get() as { id: string } | undefined
      expect(row?.id).toBe('AN-1')
    } finally {
      db.close()
    }
    // 关闭后的业务面不可用（fail loud — 不静默服务）。
    expect(() => wiring.analysisService.listAnalysisRecords()).toThrow()
  })
})
