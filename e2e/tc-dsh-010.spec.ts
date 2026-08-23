/**
 * TC-DSH-010 — read-only Investigator（机器半 — G7 补充轮 S2）。
 *
 * 真实隔离环境（e2e-run.sh: 强制 smoke $DSH_HOME / 端口 3199 / CLI
 * 0.1.0-rc.8 / playwright chromium / factory 已把研究数据 seed 进
 * $E2E_REPO; 插件本 run 刚 rebuild + force-relink）。
 *
 * 机器断言（G7 S2 逐项）:
 *  1. GUI 一键启动: 干预页问题输入 + 「调查此事项」⇒ 通道（DSH 内置
 *     commands/execute 网关域 — 宿主 UI 执行 `/` 命令的同一载体; pin
 *     版 session.prompt 载包无命令分发, 见通道模块头注）返回被启动
 *     调查会话 id ⇒ 自动跳入调查员页 ⇒ 面板绑定该 investigator 会话
 *     （data-investigator-page; 客户端零 host 直调 — 纯载包 fetch）;
 *  2. 生产数据面（G7 S1「保存按钮解禁」同批 — AnalysisDataProvider
 *     生产实现的实机链）: 调查员页 transient 面板经
 *     `/research-transient-read` 命令加载（会话事实行 present=true —
 *     三读端口 → 线形 DTO 回渲染; 空保存列表 = 诚实空态）;
 *  3. 用户显式保存端到端（INV-PERM-3 生产可达半边）: GUI 保存流
 *     （保存按钮 → 对话框 → 确认）⇒ AN-1 落库 + 列表刷新 + 宿主
 *     `/research-analysis-list` 真源回读逐字（source_ref 携带保存时
 *     关联 + dshSessionId 持久化 launcher 会话指针 — S3 定案面）;
 *  4. session.list（宿主真源）: 该 investigator 会话存在 +
 *     agentPreset='research-investigator' + cwd=$E2E_REPO;
 *  5. agentPreset.read: preset 闭集 = 恰好 2 行（dsh-tool-bash +
 *     dsh-tool-fs-search）, 且 §7.2 可写 7 工具零出现（tool-surface
 *     全盘点无写路径工具 — INV-PERM-3 第一层, 实机文件面）;
 *  6. session.history: command/run(name=permission) + command/done +
 *     permission/preset {preset:'read-only'} + sandbox/mode
 *     {mode:'read-only'} — /permission 结算发生在 followup 之前,
 *     无 key 环境仍能捕获完整结算轨迹（launch + permission 证据不
 *     依赖 LLM）;
 *  7. 写拒绝: 真实「模型发起写被 sandbox 拒绝」需 LLM 实机调工具 —
 *     smoke home 无 API key（followup turn = MISSING_CREDENTIAL）
 *     ⇒ 记录环境限制, 指向单元级等价证据（五层防御单测: 闭集请求
 *     4 字段 / 运行面守卫 / preset 闭集 / tools.restrict deny /
 *     read-only sandbox 后端）+ G8 重跑条件（有 key 环境实机跑
 *     完整 turn 并断言 tool 调用被拒）— 报告如实。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

import { ensureSessionOpen, gotoApp, researchTab } from './helpers.js'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3199'
const REPO = process.env.E2E_REPO ?? ''
const DSH_HOME = process.env.DSH_HOME ?? ''

/** §7.2 可写 7 工具（WP-3.3 冻结面单源镜像 — 仅本断言用, 不 import
 *  宿主模块: e2e 跑在 playwright 的 node 侧, 零插件依赖纪律）。 */
const WRITE_TOOL_NAMES = [
  'research_fact_record',
  'research_claim_record',
  'research_artifact_register',
  'research_intervention_create',
  'research_next_action_create',
  'research_plan_fork_create',
  'research_run_checkpoint',
]

/** preset 闭集只读工具行（WP-7.1 单源镜像）。 */
const READONLY_PRESET_TOOL_NAMES = [
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-fs-search',
]

const SESSION_TITLE = 'TC-DSH-010 只读调查'
const QUESTION = 'TC-DSH-010: 为什么该事项被触发? 请只读检查相关上下文。'

/* ------------------------------------------------------------------ *
 * 载包面（与 smoke 同口径 — /api 载包, 插件域 method 形如
 * `researchControl/<method>`, 内置域形如 `session.list`）。
 * ------------------------------------------------------------------ */
async function carrier(
  path: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(new URL(path, BASE_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `tc010-${Math.random().toString(36).slice(2)}`, method, payload }),
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body }
}

function unwrap(body: Record<string, unknown>): Record<string, unknown> {
  const envelope = body as { type?: string; result?: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } }
  expect(envelope.type, `envelope: ${JSON.stringify(body).slice(0, 200)}`).toBe('server-response')
  expect(envelope.result?.ok, `rpc error: ${JSON.stringify(envelope.result?.error)}`).toBe(true)
  return envelope.result!.value as Record<string, unknown>
}

interface SessionListItem {
  sessionId: string
  blank?: boolean
  running?: boolean
  cwd?: string
  agentPreset?: string
}

interface HistoryEntry {
  event: { type: string; seq: number; time: number; data: Record<string, unknown> }
}

test('TC-DSH-010: 一键调查实机链 — launch + preset 闭集 + /permission 结算（机器半）', async ({ page }) => {
  // ----------------------------------------------------------------
  // 0. 环境前提（大声 — 不满足直接失败, 不猜环境）。
  // ----------------------------------------------------------------
  expect(REPO, 'E2E_REPO env (smoke research workspace) is required').toBeTruthy()
  expect(DSH_HOME, 'DSH_HOME env (smoke home) is required').toBeTruthy()

  // ----------------------------------------------------------------
  // 1. GUI: 打开 app + 确保一个非空会话（调查通道以当前宿主会话为
  //    载体 — session.prompt 发到该会话, 命令在其注册表解析）。
  // ----------------------------------------------------------------
  await gotoApp(page, BASE_URL)
  await ensureSessionOpen(page, SESSION_TITLE)
  await researchTab(page).click()
  await page.waitForSelector('[data-cockpit-nav]', { timeout: 60_000 })

  // ----------------------------------------------------------------
  // 2. 宿主真源选一个可操作 Intervention（OPEN/PENDING — CLOSED 行
  //    无调查按钮, §13 终态）。经插件自己的 getDashboard RPC（载包
  //    面, 与 GUI 同一真源 — 不虚构 client echo）。
  // ----------------------------------------------------------------
  const dashBody = await carrier('/api/researchControl/getDashboard', 'researchControl/getDashboard', { args: {} })
  expect(dashBody.status, 'getDashboard carrier must be 200 (plugin loaded)').toBe(200)
  const dash = unwrap(dashBody.body) as {
    openInterventions: Array<{ id: string; title: string }>
    pendingInterventions: Array<{ id: string; title: string }>
  }
  const actionable = [...(dash.openInterventions ?? []), ...(dash.pendingInterventions ?? [])]
  expect(actionable.length, 'seeded interventions must include an OPEN/PENDING row').toBeGreaterThan(0)
  const iv = actionable[0]!

  // ----------------------------------------------------------------
  // 3. 一键: 干预页问题输入 + 「调查此事项」。
  // ----------------------------------------------------------------
  await page.click('[data-cockpit-nav-item="intervention"]')
  const investigateBtn = page.locator(`[data-iv-id="${iv.id}"] [data-iv-investigate="${iv.id}"]`)
  await investigateBtn.waitFor({ timeout: 30_000 })
  await page.fill(`[data-iv-question="${iv.id}"]`, QUESTION)
  await investigateBtn.click()

  // ----------------------------------------------------------------
  // 4. 成功面: 自动跳入调查员页 + 面板绑定被启动 investigator 会话
  //    （通道把命令成功文本里的会话 id 回解给 GUI — 单一真源
  //    INVESTIGATION_SUCCESS_TEXT / parseInvestigationSessionId）。
  // ----------------------------------------------------------------
  const panel = page.locator('[data-cockpit-page="investigator"] [data-investigator-page]')
  await panel.waitFor({ timeout: 90_000 })
  const launchedSid = (await panel.getAttribute('data-investigator-page')) ?? ''
  expect(launchedSid, 'launched investigator session id (investigator-<uuid>)').toMatch(/^investigator-/)

  // ----------------------------------------------------------------
  // 5. 生产数据面 — transient 面板（G7 S1「AnalysisDataProvider 生产
  //    实现注入」的实机链: 页面挂载 → provider（DSH 内置
  //    commands/execute 网关域）→ 宿主 `/research-transient-read`
  //    命令 → `AnalysisTransientReader.read` 三读端口 → 线形 DTO 回
  //    渲染 — 13-RPC 零 diff 的实机证明）。
  // ----------------------------------------------------------------
  const transientPanel = page.locator(`[data-transient-panel="${launchedSid}"]`)
  await transientPanel.waitFor({ timeout: 30_000 })
  // 会话事实行: 被启动会话在 live 列表中 ⇒ data-present="true"（缺席
  // 诚实透出面 — 若面板显示 present=false/无行 = 数据面未接通, 红）。
  const sessionFact = transientPanel.locator('[data-fact="session"]')
  await sessionFact.waitFor({ timeout: 30_000 })
  expect(await sessionFact.getAttribute('data-present'), 'the launched session must be live in the host session list (transient data face wired)').toBe('true')
  // 已保存记录区: 本 run 全新 seed（--reset）⇒ 空列表 0 条（诚实空态 —
  // 不虚构记录）。
  await expect(transientPanel.locator('[data-saved-count="0"]')).toBeVisible({ timeout: 30_000 })

  // ----------------------------------------------------------------
  // 6. 用户显式保存（INV-PERM-3「仅用户显式保存」的生产可达半边 —
  //    G7 不通过面 ② 的实机闭合: 保存按钮已解禁, GUI 保存流端到端
  //    落库 + 列表刷新 + 宿主真源回读）。
  // ----------------------------------------------------------------
  const savedContent = 'TC-DSH-010: 只读调查结论 — 该事项由 flooding 检测触发（window=300s forks 超阈值）; 只读证据见 session 事件面, 无任何写操作。'
  await transientPanel.getByRole('button', { name: '保存为 AnalysisRecord' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 30_000 })
  // sourceRef 预填 kind=INTERVENTION（对话框默认）, id 必填 — 填被
  // 调查 Intervention 的 id（S3 定案的「保存时关联」— source_ref
  // 承载引用关系）。
  await dialog.locator('input[placeholder="IV-5"]').fill(iv.id)
  await dialog.locator('textarea').fill(savedContent)
  // dshSessionId 预填 = 被启动 investigator 会话（initialSaveFieldValues
  // 预填面 — 断言预填真值, 不虚构绑定）。JSX 属性字面量的 HTML 实体在
  // DOM 面已解码（占位符实值 = `investigator-<uuid>`）— getByPlaceholder
  // 按属性实值匹配, 不用转义形态。
  expect(await dialog.getByPlaceholder('investigator-<uuid>').inputValue(), 'the dialog must pre-fill the launched investigator session id').toBe(launchedSid)
  await dialog.locator(`[data-save-confirm="${launchedSid}"]`).click()

  // 成功面: 保存 chip（AN id — 本项目首个 AnalysisRecord = AN-1）+
  // 已保存列表 1 条（保存后自动刷新 — 宿主是数据真值, 本地不镜像）。
  // chip 在容器层（transient 面板的兄弟节点, 非后代 — 作用域 = 调查员页）。
  const chip = page.locator('[data-cockpit-page="investigator"] [data-saved-chip]')
  await chip.waitFor({ timeout: 60_000 })
  const savedAnId = (await chip.getAttribute('data-saved-chip')) ?? ''
  expect(savedAnId, 'the saved record id must be a well-formed AN id').toMatch(/^AN-[1-9][0-9]*$/)
  expect(savedAnId, 'fresh seed: the first saved record is AN-1 (shared project-scoped allocator)').toBe('AN-1')
  const savedList = transientPanel.locator('[data-saved-count]')
  await expect(savedList).toHaveAttribute('data-saved-count', '1', { timeout: 30_000 })
  expect(await transientPanel.locator(`[data-saved-id="${savedAnId}"]`).count()).toBe(1)

  // 宿主真源回读（同一网关域 — GUI 与断言不共享 client echo: 直接经
  // 宿主 `/research-analysis-list` 命令读 operational DB 真值）。
  const recordsBody = await carrier('/api/commands/execute', 'commands/execute', {
    args: { agentId: launchedSid, line: '/research-analysis-list', images: [] },
  })
  expect(recordsBody.status).toBe(200)
  const recordsExec = unwrap(recordsBody.body) as { result: { kind: string; text?: string } }
  expect(recordsExec.result.kind, 'the list command must settle as success').toBe('success')
  const records = JSON.parse(recordsExec.result.text ?? '[]') as Array<{
    id: string
    sourceRef: { kind: string; id: string }
    dshSessionId: string | null
    content: string
    createdAt: number
  }>
  expect(records, 'the host DB must carry exactly the one saved record').toHaveLength(1)
  expect(records[0]?.id).toBe(savedAnId)
  expect(records[0]?.sourceRef, 'source_ref carries the save-time association (S3 定案 — 保守读法的引用半边)').toEqual({ kind: 'INTERVENTION', id: iv.id })
  expect(records[0]?.dshSessionId, 'the record persists the launcher session pointer (INV-DB-2 — 指针, 不复制 raw log)').toBe(launchedSid)
  expect(records[0]?.content).toBe(savedContent)

  // ----------------------------------------------------------------
  // 7. session.list（宿主真源）: 该会话存在 + preset 绑定 + cwd。
  // ----------------------------------------------------------------
  const listBody = await carrier('/api/session.list', 'session.list', {})
  expect(listBody.status).toBe(200)
  const list = unwrap(listBody.body) as { items: SessionListItem[] }
  const inv = list.items.find((s) => s.sessionId === launchedSid)
  expect(inv, `session.list must carry the launched session ${launchedSid}`).toBeTruthy()
  expect(inv!.agentPreset, 'the session must run under the research-investigator preset').toBe('research-investigator')
  expect(inv!.cwd, 'the session cwd must be the smoke research workspace (sandbox boundary)').toBe(REPO)

  // ----------------------------------------------------------------
  // 8. agentPreset.read: preset 组合闭集盘点（实机落盘文件面 —
  //    首次 launch 的 ensure 步已把闭集组合写入 $DSH_HOME）。
  // ----------------------------------------------------------------
  const presetBody = await carrier(
    '/api/agentPreset.read',
    'agentPreset.read',
    { agentPreset: 'research-investigator' },
  )
  expect(presetBody.status, 'agentPreset.read must be 200').toBe(200)
  const preset = unwrap(presetBody.body) as { agentPreset: string; trust: string; content: string }
  expect(preset.agentPreset).toBe('research-investigator')
  expect(preset.trust, 'plugin-ensured preset lives in the user root').toBe('user')

  // 恰好 2 行工具注册（多一行/少一行都 = 组合漂移, 拒）。
  const idRows = preset.content.match(/^\s*- id: .+$/gm) ?? []
  expect(idRows, `preset tool rows: ${preset.content}`).toHaveLength(2)
  // 行名 = 闭集只读工具（逐字）。
  const nameRows = (preset.content.match(/^\s*name: '.+?'/gm) ?? []).map((n) => n.replace(/.*'(.+?)'.*$/, '$1'))
  expect(nameRows).toEqual([...READONLY_PRESET_TOOL_NAMES])
  // §7.2 可写 7 工具零出现（tool-surface 全盘点无写路径 — S2 断言）。
  for (const w of WRITE_TOOL_NAMES) {
    expect(preset.content, `write-path tool "${w}" must not appear in the preset`).not.toContain(w)
  }
  // ensure 落点实物存在（$DSH_HOME/.agent-presets/research-investigator/
  // agent.cordis.yml — 与 read 面同一文件, 文件面旁证）。
  expect(
    existsSync(join(DSH_HOME, '.agent-presets', 'research-investigator', 'agent.cordis.yml')),
    'the ensured preset file must exist under the smoke DSH home',
  ).toBe(true)

  // ----------------------------------------------------------------
  // 9. session.history: /permission read-only 结算轨迹（followup 之前
  //    完成 — 无 key 环境亦在）。
  // ----------------------------------------------------------------
  const histBody = await carrier('/api/session.history', 'session.history', { sessionId: launchedSid })
  expect(histBody.status).toBe(200)
  const hist = unwrap(histBody.body) as { events: HistoryEntry[] }
  const events = hist.events
  const types = events.map((e) => e.event.type)

  // 任务提交（user message — followup 在 /permission 结算之后）。
  const userMsg = events.find((e) => e.event.type === 'user/message')
  expect(userMsg, 'the investigation task must be submitted as a user message').toBeTruthy()
  expect(JSON.stringify(userMsg!.event.data)).toContain('TC-DSH-010')

  // /permission 命令生命周期（命令执行不开 turn — log-only 事件对）。
  const cmdRun = events.find((e) => e.event.type === 'command/run')
  expect(cmdRun, 'the /permission command must have run (command/run event)').toBeTruthy()
  expect(cmdRun!.event.data.name).toBe('permission')
  const cmdDone = events.find((e) => e.event.type === 'command/done')
  expect(cmdDone, 'the /permission command must have settled (command/done event)').toBeTruthy()
  expect(cmdDone!.event.data.kind, 'the /permission command must settle as success').toBe('success')

  // 权限 preset 事件 + sandbox 模式事件（read-only 折叠生效 —
  // 该会话此后每次受限调用都读到 read-only, last-event-wins）。
  // 宿主在 session/created 时先 pin 组合缺省（web 组合 = workspace-write
  // — `pinInitialPermission` 首事件）, 插件的 /permission read-only 结算
  // 在 setup 期追加后胜 — 断言取**最后**一事件（与宿主
  // `effectivePermissionPreset` 的 last-event-wins 折叠同口径）。
  const lastByType = (type: string): HistoryEntry | undefined => {
    const matches = events.filter((e) => e.event.type === type)
    return matches.length === 0 ? undefined : matches[matches.length - 1]
  }
  const permPreset = lastByType('permission/preset')
  expect(permPreset, 'permission/preset event must be recorded').toBeTruthy()
  expect(permPreset!.event.data.preset, 'the effective permission preset must be read-only (last-event-wins over the session/created workspace-write pin)').toBe('read-only')
  const sandboxMode = lastByType('sandbox/mode')
  expect(sandboxMode, 'sandbox/mode event must be recorded').toBeTruthy()
  expect(sandboxMode!.event.data.mode, 'the effective sandbox mode must be read-only').toBe('read-only')

  // 结算序: permission 事件全部先于任务消息（不降级启动的时序证据）。
  const permSeq = Math.max(permPreset!.event.seq, sandboxMode!.event.seq)
  expect(permSeq, '/permission must settle BEFORE the task prompt (no degraded launch)').toBeLessThan(userMsg!.event.seq)

  // ----------------------------------------------------------------
  // 10. 写拒绝面（如实记录 — 环境限制 + G8 重跑条件）。
  //
  // 真实「模型发起写 ⇒ sandbox 拒绝」需 LLM 实机驱动 tool 调用;
  // smoke home 无 API key（followup turn = MISSING_CREDENTIAL）。
  // 这里只记录可机检的部分, 不伪造写拒绝证据:
  //  - 若 turn 已失败（无 key）⇒ 记录为环境限制（诚实 — 报告引用）;
  //  - 若 turn 在跑/成功（有 key 环境）⇒ 本 spec 不额外断言
  //    （G8 重跑条件: 加 tool 调用被拒断言 — 报告引用）。
  // 单元级等价证据（本 run 单测全绿）: 五层防御链 —
  //  ① 闭集请求 4 字段断言; ② 运行面只读守卫; ③ preset 闭集组合
  //  （本 spec 第 8 段 = 第 3 层的实机面）; ④ tools.restrict deny
  //  可写 7 工具; ⑤ read-only sandbox 后端（本 spec 第 9 段 = 第 5
  //  层的结算事件面）。
  // ----------------------------------------------------------------
  const turnFailedNoKey = events.some(
    (e) =>
      (e.event.type === 'turn/end' || e.event.type === 'step/end') &&
      JSON.stringify(e.event.data).includes('MISSING_CREDENTIAL'),
  )
  const turnRunning = (inv!.running ?? false) === true
  if (!turnFailedNoKey && !turnRunning) {
    // 既无失败也无 running 标志的 turn: 记录实际轨迹供报告引用
    // （不猜 turn 状态机 — 如实）。
    const assistantEvents = events.filter((e) => e.event.type === 'assistant/message')
    const toolCalls = events.filter((e) => e.event.type === 'tool/call')
    // 有 key 环境: 若模型已发起 tool 调用, 写路径工具必然不在可见面
    // （第 3/4 层）— 断言出现的 tool 名无一可写。
    for (const tc of toolCalls) {
      const name = String((tc.event.data as { name?: unknown }).name ?? '')
      for (const w of WRITE_TOOL_NAMES) {
        expect(name, `investigator tool call "${name}" must not be a write-path tool`).not.toBe(w)
      }
    }
    void assistantEvents
  }
})
