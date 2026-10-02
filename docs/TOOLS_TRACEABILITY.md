# TOOLS_TRACEABILITY — 11 工具闭环验收追溯（G5，非冻结补充文档）

> **定位**：本文件是 G5 的**非冻结**追溯与验收记录（BASELINE_PLAN §2e 授权的非冻结补充文档；
> `TEST_MATRIX.md` 为 Frozen V1 快照、正源在仓库外层工作区根——canonical 正源更新未获授权，
> 故追溯仅存本文件，不改 Frozen 面）。基线 = origin/main `12712653c58f`（tree `4f2326a85f`），
> 分支 `feat/g5-real-registry-acceptance`。
>
> **本轮新增的验收层**：在此前各组「captured-defs 宿主缝」（`ctx.tools.register` 捕获 + 直接
> `execute`）之上，新增**真实 registry 层**——真实 cordis `Context` + 真实安装的
> `@deepseek-ai/dsh-tools@0.1.2-alpha.3` 的 `ToolRuntime`（即真实宿主挂载为 `ctx.tools` 的
> registry 服务本体）。11 工具的注册经 `ToolRuntime.register`（真实
> `assertSupportedJsonSchema` 注册门），每次调用经 `ToolRuntime.execute` 的完整分发管线，
> 成功值由**真实 output validator**（`validateJsonSchemaValue`，violation 折为
> `INVALID_TOOL_OUTPUT`）校验、真实 `output.render` 投影成 content blocks。
> 本层不是「在 fake 注册 context 里调 execute」。

## 1. 真实 / 模拟 分层（精确口径，勿笼统）

| 层 | 状态 | 说明 |
|---|---|---|
| `@deepseek-ai/cordis` Context（root，reflect/events/effect/fiber） | **真实** | `new Context()`（pin 版本包），非结构 double |
| 工具 registry = `@deepseek-ai/dsh-tools` `ToolRuntime` | **真实** | 注册门 + 分发 + 输出值校验 + render 投影全部为钉死包本体 |
| 输出 validator（`assertSupportedJsonSchema` / `validateJsonSchemaValue`） | **真实** | registry 在 register/execute 内部自行执行；套件 §C.1 有负面对照（不支持的 schema 注册即抛；违 schema 的成功值折为 `INVALID_TOOL_OUTPUT`） |
| `ResearchControlService`（`[Service.init]`、发现、wiring、11 注册） | **真实** | 插件宿主服务本体 |
| 项目工作区（`.research` 树、git 仓、`research.sqlite`、冻结 schema） | **真实** | temp 目录 + `node:sqlite` + 真 git 进程 |
| USER 车道（`registerRun` / `ProductionResearchRpcServices.selectPlanFork` / `createPlanItem` / `rescan`） | **真实** | 生产类 + 生产构造参数（GUI lane 同一实现） |
| `systemPrompt` 服务 | **模拟（已披露）** | `ToolRuntime` 构造需要的主机面；native 模式下仅注册回调，三个成员最小实现。pin 包不单独发布本体 |
| `workspaceRegistry.list()` | **模拟（已披露）** | 返回挂载的 temp 工作区列表（生产由 DSH app 持有该列表） |
| `sessions.list()` | **模拟（已披露）** | 空列表（会话查询读面的活会话 face，测试内无活会话） |
| `exec.agent` | **模拟载体（已披露）** | 纯 `{ sessionId }`；ToolRuntime 把 `exec.agent` 当不透明 scope token，插件只读 `.sessionId`（与生产解析路径同） |
| 稳定 DSH 服务 / 3180 实例 / 用户 profile | **未触碰** | 全程仅隔离 temp 世界；无稳定服务重启 |

**分层验收强度排序**（自下而上）：单元/服务层（G2/G3/G4 各组套件）→ captured-defs 宿主缝
（`tests/discovery/host-*.test.ts`）→ **真实 registry 层（本轮 `tests/g5-real-registry/`）** →
真机 UI e2e（`pnpm run test:e2e` / Playwright，**本轮 NOT_RUN**，未授权）。

## 2. 11 工具逐项验收（全部经真实 registry + 真实 output validator 的成功输出）

工具面 = `ToolRuntime.schemas()` 恰 11 个名字（workflow §A.1）。逐项：成功调用点（均在
`tests/g5-real-registry/workflow.test.ts`，除注明外）、冻结契约来源、既有测试锚。

| # | 工具 | G5 真实-registry 成功点（workflow 步） | 输出经真实 codec 的额外证明 | 既有锚（非 G5） |
|---|---|---|---|---|
| 1 | `research_context_get` | 步 0（未绑 `bound:false` 诚实空）+ 步 2（可信 run 绑定后回读）+ §C.3 重启后 | registry 成功值 = `validateJsonSchemaValue` 零违规（闭根 schema） | `tests/tools/read-tools.test.ts`、`tests/discovery/host-read-tools-g2.test.ts`（真实 host codec 双层） |
| 2 | `research_plan_get` | 步 5（USER SELECT 物化后 `ordered_items` 含新 T、逐字文件序）| 同上 | 同上 + harness smoke |
| 3 | `research_history_query` | 步 12（全事件流回放 + 游标协议 + exhausted 密度规则）| 同上；envelope 冻结 camelCase 字段逐字 | 同上 |
| 4 | `research_contract_read` | 步 13（TE-2 契约字节级内容）| 同上 | 同上 |
| 5 | `research_plan_fork_create` | 步 3（可信 run AGENT 创建；真实 8 步链 + 真实 git OID 捕获）| 同上 | `tests/tools/plan-fork-create.test.ts`、`tests/discovery/host-tools-reinit.test.ts` |
| 6 | `research_fact_record` | 步 6（`created_by_run`=R-1）+ 步 7 事件/行双证 | 同上 | `tests/tools/semantic-create.test.ts`、`tests/discovery/host-tools-semantic-write.test.ts` |
| 7 | `research_claim_record` | 步 6 | 同上 | 同上 |
| 8 | `research_artifact_register` | 步 6（BY REFERENCE + related_task）| 同上 | 同上 |
| 9 | `research_intervention_create` | 步 9（multi-WS + typed refs，OPEN 行 + INTERVENTION_CREATED 事件、owner 锚定头位）+ 步 10（无 WS 关联 `event_id:null`）| 同上 | `tests/intervention/write-lane.test.ts`、`tests/discovery/host-attention-write.test.ts` |
| 10 | `research_next_action_create` | 步 8（带 WS 与省缺 optional WS 两形态；PROPOSED 行）| 同上 | `tests/tools/next-action-create.test.ts` |
| 11 | `research_run_checkpoint` | 步 11（own-run 注记落行）| 同上 | `tests/tools/run-checkpoint.test.ts` |

**可信 run 与 USER 决策边界**（workflow 步 1→4）：
- run 由**真实** `RunBindingService.registerRun`（USER 车道）建立并绑定 agent 会话（生产
  GUI/运维入口；agent 工具面无对应暴露）；
- Agent 经真实 registry 创建 PlanFork（OPEN）；
- **USER 选择经真实生产用户车道类** `ProductionResearchRpcServices.selectPlanFork`
  （WP-3.4 在运行时复认 `actor.kind===USER`）→ SELECTED 事务 + plan.yaml 物化 + 新闭包 OID；
- Agent 不能越权：`research_plan_fork_select` / `..._dismiss` / `research_plan_reorder` /
  `research_intervention_update_state` / `research_next_action_promote|dismiss` /
  `research_claim_retract` / `research_artifact_mark_missing` / `research_checkpoint_commit` /
  `research_git_restore` / `research_history_mutation` 在真实 registry 一律
  `UNKNOWN_TOOL`（permission-boundaries §B.1）——这些操作在 agent 面**不存在**，
  USER-only 车道不可从工具触达（服务侧 SELECT_ACTOR_NOT_USER 精确钉在 tests/select，WP-3.4）。

**权限与身份边界**（`permission-boundaries.test.ts`，全部含「零部分写」快照：事件计数 +
派生语义行 id + `.research` 树 sha256）：
- Investigator persona（无 formal run 的会话）：4 只读成功；7 写全部
  `TOOL_RUN_REQUIRED`（registry 折叠后的机器码 `error.info.code`）且零增量；
- 伪造身份：4 个注入键（`actor`/`run_id`/`created_by_run`/`caller`）× 11 面 → `TOOL_INPUT`
  在冻结 key-set 门拒绝、零增量；唯一例外 = `run_checkpoint` 的合法 target 键 `run_id`
  （B2 门随后强制 target===caller）；
- 跨 run checkpoint：`TOOL_SERVICE` + refusal 文本（服务码 `RB_CHECKPOINT_FOREIGN_RUN` 的
  精确等值断言在 G1 宿主层 `host-tools-reinit.test.ts`——registry 层的机器码即
  `TOOL_SERVICE`，`detail.serviceCode` 在插件/宿主错误对象上），R-2 行未被触碰。

**连续性与 restart**（`continuity-authenticity.test.ts`）：
- rescan（生产 mutation 面）后：同一批注册定义继续成功（live dispatch，注册数恒 11）、
  boot wiring 的表句柄确已关闭、fresh wiring 上 checkpoint/fact 续写成功；
- restart：全部 effect disposer 运行（wiring/store/rpc 连接关闭）→ 新 root Context + 新
  ToolRuntime + 新宿主服务 over 同一 temp 状态 → 11 重注册、run/事件/语义行/PF 状态可见、
  **续写继续**（fact id 从 `F-1` 递增到 `F-2`，sqlite meta 计数器持久）；
- G4 post-boot 回归在真实 registry 层复跑：GUI `createPlanItem` 新 T 无 rescan 即可被引用；
  删除的 T-1 引用被拒（`TOOL_SERVICE [IV_INPUT]`、行/事件零增量）；存活任务照常通过（无
  blanket fail-closed）；改坏 GATE doc 后引用被拒（doc-null guard）。完整 G4 面（含 milestone
  变体与 boot-fallback BLOCK 史）保留在 `tests/discovery/host-attention-write.test.ts`。

## 3. 门禁记录（G5 最终轮，真实 exit）

环境：node v24.21.0 / pnpm 11.7.0 / vitest 4.1.11 / tsc 7.0.2（`pnpm install --frozen-lockfile`
后；原始完整 stdout/stderr 日志留存于运行机会话侧仓库外目录（不入库），本表为入库精简摘要）。

| 门 | 命令 | 结果（真实 exit） |
|---|---|---|
| tsc | `npx tsc -p tsconfig.json` | **EXIT=1**（known-fail 基线）；正文 40 行与 `docs/BASELINE_TSC_BASELINE.md` **逐行 diff = 空**（非计数；无新增/无行号漂移；含本轮新套件后复跑仍空） |
| lint | `node scripts/check-imports.mjs` | **EXIT=0**（INV-PERM-5；新套件对 `@deepseek-ai/*` 的导入与 tests/discovery 同豁免类，src 零违规） |
| build | `pnpm run build` | **EXIT=0**；`lib/index.js` + `e2e/factory-dist/factory.mjs` 由最终源码重建入库；机器 churn（`lib/client.js` region 注释、`SNAPSHOT.md` 时间戳/源根行）按 BASELINE_PROGRESS §5 先例回退不入库 |
| full tests | `npx vitest run` | **EXIT=0** — 347 files passed \| 6 skipped (353)；**4981 passed \| 21 skipped (5002)**；含 `tests/g5-real-registry/` 3 文件 23 案全绿 |
| perf（隔离复跑） | `npx vitest run --config tests/perf/vitest.perf.config.ts` | **EXIT=0** — 6 files / 21 tests 全过；TC-PERF-006 本轮 10k median 87.7 ms（预算 1000 ms、亚二次 pin 58.13x < 100x）——已知时序波动项，本次通过，如实记录，未调阈值 |
| pack（隔离复跑） | `node scripts/pack-verify.mjs` | **EXIT=0** — `dsh-research-control-0.1.0.tgz` 521 entries，发布面完整、无 dev 泄漏，解包 main/typert/remote import SMOKE OK |
| e2e / 18 UI journeys | — | **NOT_RUN**（本轮未授权；分层见 §1） |

环境：node v24.21.0 / pnpm 11.7.0 / vitest 4.1.11 / tsc 7.0.2 / tsdown pinned /
`@deepseek-ai/dsh-tools` 0.1.2-alpha.3（peer 精确 pin）。完整 stdout/stderr 日志留存运行机会话侧
（不入库）；本表为入库精简摘要，每门可由上表命令在任意 clone 复现（perf 波动属已知敏感项）。

## 4. 简短用户指南（agent 侧 + 用户侧闭环）

**Agent（工具面，11 个）**——推荐序：
1. `research_context_get` 看自己绑定的 run（未绑定 = 只读身份：读面可用、写面拒）；
2. `research_plan_get` / `research_history_query` / `research_contract_read` 读现状；
3. 有新证据 → `research_fact_record` / `research_claim_record` / `research_artifact_register`
   （自动归属当前 run，args 里没有也无法传身份键）；
4. 需要人类注意 → `research_intervention_create`（可带 workstream 与 typed source_refs；
   无 WS 关联时只入队不发事件）；下一步建议 → `research_next_action_create`（PROPOSED，
   提升/驳回属用户）；
5. 计划要变 → `research_plan_fork_create`（提案，永不直写规范计划）；
6. 阶段汇报 → `research_run_checkpoint`（只能给自己的 run）。

**用户（GUI/RPC 面）**：审阅 OPEN PlanFork → SELECT（物化进规范计划，链式 STALE 判定）或
DISMISS；干预状态 OPEN/PENDING/CLOSED、NextAction PROMOTE/DISMISS、规范计划排序、git
checkpoint/restore 均为用户专属操作，agent 工具面无入口。

## 5. 已知边界（G5 时点）

- **tsc 债**：`docs/BASELINE_TSC_BASELINE.md` 的 21 错/40 行 known-fail 快照仍在（Q3 独立小
  PR 清偿）；G5 判定 = 逐行 diff 为空（EXIT=1 是基线既有状态，非「全零错误」）。
- **perf 波动**：TC-PERF-006 为已知时序敏感门；G5 如实记录真实失败与复跑结果，不调阈值。
- **真实 registry vs isolated host vs UI**：本文 §1 表——G5 证明到真实 registry 分发层；
  captured-defs 宿主缝（`tests/discovery`）与真机 UI e2e 是另外两层，本轮 e2e NOT_RUN。
- **scope 外（非禁止）**：Claim 撤回 / Artifact 标记缺失在冻结 §6 矩阵对 AGENT 为 ✅，但
  当前 11-tool API 未暴露（`src/host/tools/types.ts` 的 G3 注释已按此精确口径修正）；
  Merge Contract 编辑同理（工具面仅 `research_contract_read`）。
- **`tests/tools/stubs.test.ts`** 保留为「无桩活性防火墙」（11/11 活性 + 冻结面 + actor 门
  前置钉），未删；`makeStubDefinition` 等共用 helper 保留（禁止为零 stub 指标盲删）。
- **Frozen 面零改动**：本分支未触碰 `schema/**`、8 份冻结文档、`TEST_MATRIX.md` 包内快照。
