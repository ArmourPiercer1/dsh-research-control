# G3 — 三个语义写工具闭环（research_fact_record / research_claim_record / research_artifact_register）

> 分支 `feat/g3-semantic-write-tools`，base `899d49d33fc29fd44a5d3907b4bcd3204f9ba859`（main = G1 合并后）。
> 单写者工作树 `.worktrees/g3`；本文档 + `docs/evidence/G3/` 为组内证据。G5 统一全量/集成。
> 范围红线：**只做语义创建**。Claim 撤回 / artifact 标记缺失属冻结矩阵中 AGENT 可发起但本组不做
> （非禁止，留待后续组）；SELECT/DISMISS/规范计划晋升/NextAction 提升维持 USER-only，未触碰。

## 1. 交付

三个 stub → live：参数面（冻结 wire face，逐 key 不变）→ 严格成功输出 → 真实 host codec 成功路径 →
结构化错误。事件由冻结历史发射器（U/A）发出：`FACT_RECORDED` #9 / `CLAIM_RECORDED` #10 /
`ARTIFACT_REGISTERED` #12，actor 为 `{kind:'AGENT', run_id, session_id?}`，payload 含
`created_by_run`（DOMAIN_SCHEMA §7 冻结形状，registry AGENT 跨字段校验 + 无计划状态校验全部在场）。

## 2. 窄 agent 创建通道（不伪造、不绕行）

`SemanticsService` 新增三个平行入口（USER 入口一字未动）：

```
recordFactAsAgent(args, caller: SemanticAgentActor)
recordClaimAsAgent(args, caller)
registerArtifactAsAgent(args, caller)
```

- `caller` **必传且类型钉死 AGENT**（USER 在类型面不可传入）；由工具层从
  `ToolExecContext`（G1 host 身份链：sessionId→runBinding→actor/run_id）构造，
  **args 中的任何身份键都在冻结 key-set 面直接 TOOL_INPUT 拒绝**（`created_by_run`/`run_id`/`actor`/`caller`…）。
- 服务侧 `#agentLane()` 逐条复核（在 reserve/append 之前，任何写入不发生）：
  1. 非 AGENT / 空 run_id → `INVALID_ENVELOPE`；
  2. 组合缺 `options.runs` 端口 → `TypeError`（组合 bug 响亮失败，非数据错误）；
  3. run 不在真实 run 注册表 → `OBJECT_NOT_FOUND`（`/actor/run_id`）；
  4. run 的 `workstream_id` ≠ args.workstream_id → `OWNER_MISMATCH`（`/workstream_id`）。
- 校验通过后，caller run 注入冻结 registry 校验 ctx（`ctx.runs`：USER 通道仍为空 Map，
  行为逐字不变），满足 HISTORY_EVENT_CATALOG §5「actor.run_id 与 created_by_run 必须存在于 runs」。
- 写入复用既有唯一协议路径（reserve→precheck→append(registry hook+fold seam)→commit）；
  reducer 从 payload/envelope 落 `created_by_run`/`created_by`，**无任何新旁路、无泛化写端口**。
- 依赖面 `ResearchToolDeps` 从 2 端口扩到 3：`semanticAgentCreate.{recordFact,recordClaim,registerArtifact}`
  （INV-PLAN-3 编译面钉随扩，无 plan 写口）。组合期缺失该端口 `createResearchTools` 响亮 TypeError。
- 错误映射：服务错误载体 `[research-control] <CODE>: msg` → `ToolError('TOOL_SERVICE', …,
  detail.serviceCode=<CODE>)`（run-checkpoint 先例；host 以 code-first 上抛）。

## 3. 严格输出

`status:'ok'` + 创建行（`additionalProperties:false`）：`id/workstream_id/…/status(const
ACTIVE|REGISTERED)/created_by_run(required)/recorded_at(int)/event_id`。成功值由
`projectNodeToDshSubset` host codec 逐字投射（const/enum 收窄在场）——身份与分配值必须出现。

## 4. 红→绿与门禁（真实 exit；原始日志在 `docs/evidence/G3/`）

| 步骤 | 结果 |
| --- | --- |
| 实现前红（三新套件） | `18 failed / 6 passed (24)`，exit 1 — `focused-red-prerefix.log` |
| 组内绿（tools+semantics-records+runbinding+host lane） | `25 files / 317 passed`，exit 0 |
| 全量（pinned 工具链，`pnpm install --frozen-lockfile` 后） | `336 files passed / 6 skipped；4871 passed / 21 skipped`（基线 4844+21；净 +27，其中新增 it：服务层 10、工具层 11、host 通道 3、trusted-boundary +1），exit 0 |
| tsc | exit 1（known-fail 基线），正文 40 行与 `docs/BASELINE_TSC_BASELINE.md` **逐行 diff 为空**（非计数） |
| lint（check-imports） | exit 0 |
| build（tsdown 0.22.14 = lockfile 钉死） | exit 0；`lib/index.js`、`e2e/factory-dist/factory.mjs` 为真实重建产物；机器路径 churn（`SNAPSHOT.md`、`lib/client.js` region 注释）已按 BASELINE_PROGRESS §5 剔除不提交 |

运行时：node v24.21.0 / pnpm 11.7.0 / vitest 4.1.11 / tsc 7.0.2。
注：g3 工作树首轮工具运行走了上层 node_modules（tsdown 0.22.2 ≠ lockfile 0.22.14；vitest/tsc 版本与
lockfile 一致），发现后已 `pnpm install --frozen-lockfile` 并以钉死版本重跑 build/tsc/全量；上表
除「实现前红」（发生于 install 之前，vitest 同版本）外均为 pinned 结果。

## 5. 共享接缝（G2/G4/G5 集成注记）

- `tools/types.ts`：`ResearchToolDeps` 新增 `semanticAgentCreate`（追加式；与 G2 读端口/G4 干预端口互不冲突）。
- `tools/index.ts`：三个 factory 调用改为传 deps；`assertDeps` 增加 lane 校验；导出新增
  `semanticCallerFrom`/`toSemanticToolServiceError`（重导出列表按字母序插入）。
- `wiring/create.ts`：`toolsDeps` 增加 `semanticAgentCreate`（每调用新建 records service：
  新鲜树 plan 索引 + wrapped store + run 端口 over runBinding；partial-tree 语义按 loader 契约，
  权威校验在 derived-row registry hook）。
- `tests/tools/fixtures.ts`：`makeRecordingDeps()` 增加 recording lane + `setSemanticAgentCreate`（追加式）。
- `tests/semantics-records/harness.ts`：`makeService(plans?, options?)` 增加 `runs` 透传（可选参，默认不变）。
- 预期合并冲突点（G5 处置）：`tests/tools/stubs.test.ts`（G3/G2/G4 各自删除自己的 stub 条目）、
  `tests/tools/inv-plan-3.test.ts` deps-face 钉（合并后应为全部端口的并集）、`tools/index.ts` 头注释计数。

## 6. 未决与边界

- e2e：NOT_RUN（沿纪律）；perf 方差保留原样。稳定服务/部署/安全模型未触碰。
- 全量套件最终裁定归 G5；G3 未跑「改动后二次全量」（除非源码再变）。
- Claim 撤回 / artifact 标记缺失：冻结矩阵允许 AGENT 发起，本组未实现（范围外，非禁止）。
- `supersedes` 语义沿用冻结 registry 校验（存在性 + 同 WS），无额外策略发明。
