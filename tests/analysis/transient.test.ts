/**
 * WP-7.3 — `AnalysisTransientReader` 面审计（任务测试项「transient 零写入
 * 断言」— INV-PERM-3 行为面 + 类型面）:
 *
 *  **类型面（编译期/面审计 — 零写入「无法表达」）**:
 *   - 原型面钉死: `Object.getOwnPropertyNames(AnalysisTransientReader.prototype)`
 *     = ['constructor', 'read'] — 类上不存在任何写方法（不是「拒绝写」,
 *     而是「写不存在」— 同 WP-7.1 请求闭集纪律的读面对偶）;
 *   - 输入端口面: `AnalysisTransientReaderInput` 的三个成员全是读操作
 *     （pointerOf / listSessions / runs — 接口上无 run/exec/insert/set 成员）;
 *   - 构造缺端口 ⇒ AN_INPUT 指名（零写成员面被完整要求的反向证明）。
 *
 *  **行为面（真实 sqlite + 写计数探针 — 零写入可测）**:
 *   - transient 读取路径经 **write 计数 db 包装**执行（探针安装在 DDL 之后）:
 *     read() 前后 `analysis_record` 行数不变 + 探针 write 计数 = 0（exec/run
 *     零调用 — 纯 SELECT 语义的读取端口）;
 *   - 对照面: 同一探针连接上 `AnalysisStore.insertRecord` **会**计数（探针
 *     本身不是摆设 — 写路径确实被数到）;
 *   - 全读端口矩阵: pointer/session/run 的在场/缺席/多 session 列表命中
 *     各形态;
 *   - 读取端口失败 ⇒ AN_STORE（cause 保留 — 端口故障大声）;
 *   - 边界: 空 sessionId ⇒ AN_INPUT（先于任何端口调用 — 零 I/O 拒绝）。
 */

import { describe, expect, it } from 'vitest'

import {
  AnalysisRecordService,
  AnalysisStore,
  AnalysisTransientReader,
} from '../../src/host/service/analysis/index.js'
import type { AnalysisTransientReaderInput } from '../../src/host/service/analysis/index.js'
import {
  makeAnalysisHarness,
  makePointer,
  makeRealDbTransientInput,
  makeRunRow,
  makeSession,
  makeTransientInput,
  probeWrites,
  ref,
  seedPointer,
  seedRun,
  throwsAnalysis,
  USER,
} from './fixtures.js'

const SID = 'investigator-test-session-1'

describe('类型面（零写入「无法表达」— 面审计）', () => {
  it('原型面: 唯一公开方法 = read（无写方法存在）', () => {
    const probe = makeTransientInput().reader
    expect(probe).toBeInstanceOf(AnalysisTransientReader)
    const protoNames = Object.getOwnPropertyNames(AnalysisTransientReader.prototype).sort()
    expect(protoNames).toEqual(['constructor', 'read'])
  })

  it('输入端口面: 三个成员全是读操作（键闭集审计）', () => {
    const { input } = makeTransientInput()
    expect(Object.keys(input).sort()).toEqual(['listSessions', 'pointerOf', 'runs'])
    for (const key of Object.keys(input)) {
      expect(typeof (input as unknown as Record<string, unknown>)[key]).toBe('function')
    }
    // 写能力键在该面上**不存在**（写能力无法表达 — INV-PERM-3 零写入类型面）。
    const writeKeys = ['run', 'exec', 'insert', 'set', 'update', 'delete', 'append', 'write']
    for (const k of writeKeys) {
      expect(k in input).toBe(false)
    }
  })

  it('构造缺任一端口 ⇒ AN_INPUT 指名（读端口三缺一即大声）', () => {
    const full: AnalysisTransientReaderInput = makeTransientInput().input
    throwsAnalysis(() => new AnalysisTransientReader({ ...full, pointerOf: undefined } as never), 'AN_INPUT', /READ faces/)
    throwsAnalysis(() => new AnalysisTransientReader({ ...full, listSessions: undefined } as never), 'AN_INPUT')
    throwsAnalysis(() => new AnalysisTransientReader({ ...full, runs: undefined } as never), 'AN_INPUT')
    throwsAnalysis(() => new AnalysisTransientReader(null as never), 'AN_INPUT')
  })
})

describe('行为面（生产形状读面 + write 计数探针 — transient 路径零写入）', () => {
  it('生产形状读面（meta 指针行 + run 表 SELECT）经探针执行: 零 write + 表行数不变', () => {
    const h = makeAnalysisHarness()
    // 预置（探针安装前 — 装配动作）: 2 条 analysis_record + 1 指针行 + 1 run 行。
    h.service.saveAsAnalysisRecord({ sourceRef: ref('INTERVENTION', 'IV-5'), content: 'one' }, USER)
    h.service.saveAsAnalysisRecord({ sourceRef: ref('INBOX_ITEM', 'IN-11'), content: 'two' }, USER)
    seedPointer(h.db, SID, makePointer({ runId: 'R-81', runStartedAt: 1_700_000_000_100, lastSeq: 7 }))
    seedRun(h.db, SID, { runId: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_100, endedAt: null })
    const rowsBefore = Number(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]!.n)

    // 探针安装在装配之后 — 只数 transient 路径的调用。
    const probe = probeWrites(h.db)
    const { reader } = makeRealDbTransientInput(probe.db, {
      sessions: [makeSession(SID, { running: true }), makeSession('other-session')],
    })
    const snap = reader.read(SID)
    expect(snap.sessionId).toBe(SID)
    // 真实 db 读面确实读到值（探针读路径连通 — 不是空转）:
    expect(snap.pointer?.workstreamId).toBe('WS-1')
    expect(snap.pointer?.lastSeq).toBe(7)
    expect(snap.run?.id).toBe('R-81')
    expect(snap.session?.id).toBe(SID)

    // **零写入断言**: 探针 write 计数 = 0（exec/run 零调用 — 读面全 SELECT）
    // + analysis_record 行数不变（transient 不落任何 operational 表）。
    expect(probe.count()).toBe(0)
    expect(probe.calls).toEqual([])
    const rowsAfter = Number(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]!.n)
    expect(rowsAfter).toBe(rowsBefore)
    h.close()
  })

  it('未绑定 + 无 run（探针窗口内）: 指针/run 面 null 诚实透出, 仍零写入', () => {
    const h = makeAnalysisHarness()
    const probe = probeWrites(h.db)
    const { reader } = makeRealDbTransientInput(probe.db, { sessions: [makeSession(SID)] })
    const snap = reader.read(SID)
    expect(snap.pointer).toBeNull()
    expect(snap.run).toBeNull()
    expect(snap.session?.id).toBe(SID)
    expect(probe.count()).toBe(0)
    expect(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]).toMatchObject({ n: 0 })
    h.close()
  })

  it('对照面: 同一探针连接上 insertRecord 确实被计数（探针不是摆设）', () => {
    const h = makeAnalysisHarness()
    const probe = probeWrites(h.db)
    const store = new AnalysisStore({ db: probe.db, schemas: h.schemas })
    store.insertRecord({
      id: 'AN-1',
      source_ref: ref('INTERVENTION', 'IV-5'),
      content: 'probe control',
      created_at: 1_700_000_000_500,
    })
    // 2 次写 = store 构造 DDL exec 1 + 行 INSERT run 1（探针如实计写）。
    expect(probe.count()).toBe(2)
    expect(probe.calls.join('|')).toMatch(/INSERT INTO analysis_record/)
    h.close()
  })

  it('多次 transient read（不同 session）: 探针计数恒零', () => {
    const h = makeAnalysisHarness()
    seedPointer(h.db, SID, makePointer())
    const probe = probeWrites(h.db)
    const { reader } = makeRealDbTransientInput(probe.db, { sessions: [makeSession(SID)] })
    for (const sid of [SID, 'another-session', 'third']) {
      reader.read(sid)
    }
    expect(probe.count()).toBe(0)
    // SID 命中真实 meta 行, 其余 null（逐 session 精确读 — 无交叉污染）。
    expect(reader.read(SID).pointer?.workstreamId).toBe('WS-1')
    expect(reader.read('another-session').pointer).toBeNull()
    h.close()
  })
})

describe('读取端口矩阵（全读 + 缺席诚实透出 — 不虚构）', () => {
  it('全在场: pointer + session + run 三行齐', () => {
    const stub = makeTransientInput({
      pointer: makePointer({ taskId: 'T-3', intent: 'explain IV-5', lastSeq: 7, runId: 'R-81', runStartedAt: 1_700_000_000_100 }),
      sessions: [makeSession(SID, { cwd: '/w', title: 'investigate IV-5', running: true, createdAt: 1_699_999_999_500 })],
      runs: [makeRunRow('R-81', { status: 'RUNNING', workstreamId: 'WS-1' })],
    })
    const snap = stub.reader.read(SID)
    expect(snap.session?.id).toBe(SID)
    expect(snap.session?.title).toBe('investigate IV-5')
    expect(snap.session?.running).toBe(true)
    expect(snap.pointer).toEqual({ workstreamId: 'WS-1', intent: 'explain IV-5', taskId: 'T-3', lastSeq: 7, runId: 'R-81', runStartedAt: 1_700_000_000_100 })
    expect(snap.run).toEqual({ id: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_100, endedAt: null })
    // 三端口各恰一次（按需读取 — 无冗余 I/O; getter 面 — read 后读）。
    expect(stub.pointerCalls).toEqual([SID])
    expect(stub.listCalls).toBe(1)
    expect(stub.runCalls).toEqual([SID])
  })

  it('全缺席: 未绑定 + 不在 live 列表 + 无 run（三个 null 独立诚实透出）', () => {
    const { reader } = makeTransientInput({})
    const snap = reader.read('ghost-session')
    expect(snap).toEqual({ sessionId: 'ghost-session', session: null, pointer: null, run: null })
  })

  it('仅指针在场（未 dispose 前常见态: 绑定但 live 摘要缺席 — 不虚构 session）', () => {
    const { reader } = makeTransientInput({ pointer: makePointer() })
    const snap = reader.read(SID)
    expect(snap.pointer?.workstreamId).toBe('WS-1')
    expect(snap.session).toBeNull()
    expect(snap.run).toBeNull()
  })

  it('live 列表命中非首个 session（按 id 精确匹配 — 不取列表首行）', () => {
    const other = 'other-live'
    const { reader } = makeTransientInput({
      sessions: [makeSession(other), makeSession(SID, { running: true })],
    })
    const snap = reader.read(SID)
    expect(snap.session?.id).toBe(SID)
    expect(snap.session?.running).toBe(true)
    // 非目标 session 不得误命中。
    const snapOther = reader.read(other)
    expect(snapOther.session?.id).toBe(other)
    const snapMiss = reader.read('not-in-list')
    expect(snapMiss.session).toBeNull()
  })

  it('run 取首条（每 session 至多一条 formal run — §6.1 口径）', () => {
    const { reader } = makeTransientInput({ runs: [makeRunRow('R-1'), makeRunRow('R-2')] })
    const snap = reader.read(SID)
    expect(snap.run?.id).toBe('R-1')
  })
})

describe('边界与故障（大声 — 不静默降级）', () => {
  it('空 sessionId ⇒ AN_INPUT（先于任何端口调用 — 零 I/O 拒绝）', () => {
    const { reader, pointerCalls, listCalls, runCalls } = makeTransientInput({ pointer: makePointer() })
    throwsAnalysis(() => reader.read(''), 'AN_INPUT', /sessionId/)
    throwsAnalysis(() => reader.read(123 as unknown as string), 'AN_INPUT', /sessionId/)
    expect(pointerCalls).toEqual([])
    expect(listCalls).toBe(0)
    expect(runCalls).toEqual([])
  })

  it('pointerOf 故障 ⇒ AN_STORE（cause 保留 — 端口故障大声）', () => {
    const { reader } = makeTransientInput({ throwOn: 'pointerOf' })
    const e = throwsAnalysis(() => reader.read(SID), 'AN_STORE', /pointerOf/)
    expect(e.cause).toBeInstanceOf(Error)
    expect(String((e.cause as Error).message)).toBe('pointer face exploded')
  })

  it('listSessions 故障 ⇒ AN_STORE', () => {
    const { reader } = makeTransientInput({ throwOn: 'listSessions' })
    throwsAnalysis(() => reader.read(SID), 'AN_STORE', /listSessions/)
  })

  it('runs 故障 ⇒ AN_STORE', () => {
    const { reader } = makeTransientInput({ throwOn: 'runs' })
    throwsAnalysis(() => reader.read(SID), 'AN_STORE', /runs/)
  })
})

describe('组合面（transient 读 + 用户保存 — 同一 harness 全流）', () => {
  it('transient 读零写入 → 用户显式保存落库 → 查询面可见（INV-PERM-3 全序列）', () => {
    const h = makeAnalysisHarness()
    seedPointer(h.db, SID, makePointer())
    seedRun(h.db, SID, { runId: 'R-81', workstreamId: 'WS-1', status: 'RUNNING', startedAt: 1_700_000_000_100, endedAt: null })
    const probe = probeWrites(h.db)

    // ① transient 读取（生产形状读面 — 零写入）。
    const { reader } = makeRealDbTransientInput(probe.db, { sessions: [makeSession(SID, { running: true })] })
    const snap = reader.read(SID)
    expect(probe.count()).toBe(0)
    expect(h.rawSql('SELECT count(*) AS n FROM analysis_record')[0]).toMatchObject({ n: 0 })

    // ② 用户显式保存（携带 transient 快照的 run/session 引用 — 只存指针,
    //    INV-DB-2）。保存 store 挂同一探针连接（唯一写入口 — 探针计 1 次
    //    run 调用; DDL 经 exec 不计入窗口外的探针调用）。
    const saveStore = new AnalysisStore({ db: probe.db, schemas: h.schemas })
    const saveService = new AnalysisRecordService({ store: saveStore, allocator: h.allocator, projectId: 'PRJ-1', now: h.clock.now })
    const { record } = saveService.saveAsAnalysisRecord(
      {
        sourceRef: ref('INTERVENTION', 'IV-5'),
        content: `transient 快照（${snap.sessionId}）的分析摘录`,
        investigatorRunId: snap.run?.id,
        dshSessionId: snap.sessionId,
      },
      USER,
    )
    // 探针窗口内的写 = 保存 store 构造 DDL exec 1 + 行 INSERT run 1
    // （数据写入口仅保存流 — transient 读取零写已在 ① 断言）。
    expect(probe.count()).toBe(2)
    expect(probe.calls.join('|')).toMatch(/INSERT INTO analysis_record/)
    expect(record.dsh_session_id).toBe(SID)
    expect(record.investigator_run_id).toBe('R-81')
    // ③ 查询面可见（harness 原 store 同文件 — WAL 多连接一致性）。
    expect(h.service.listAnalysisRecords({ sourceId: 'IV-5' })).toEqual([record])
    h.close()
  })
})
