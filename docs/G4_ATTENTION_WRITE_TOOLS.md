# G4 — 注意力写面两工具落地（research_intervention_create / research_next_action_create）

> 非 Frozen 证据文件。分支 `feat/g4-attention-write-tools`，base `899d49d`（origin/main）。
> 本文件记录 G4 的设计决策、落地面与验证证据；契约本体仍以
> ARCHITECTURE §6/§7.2、DOMAIN_SCHEMA §9.2/§9.3/§13/§16、HISTORY_EVENT_CATALOG §5.7 为准。

## 1. 范围

stub 表里的两个 AGENT 可调用写工具转为真实转发（WP-3.3 冻结面不变）：

| 工具 | 转发服务（不复制校验） | 冻结面要点 |
|---|---|---|
| `research_intervention_create` | `InterventionService.createMechanicalIntervention`（WP-5.1）| 参数面 4 键（title/detail/workstream_ids/source_refs）；**无 trigger/origin/state 键** |
| `research_next_action_create` | `ActionsService.createNextAction`（独立 WP-5.2 车道，非 intervention 服务）| 参数面 3 键（workstream_id/statement/rationale）；**无 status/actor 键** |

不改动：USER 创建/状态迁移车道、PROMOTE/DISMISS（用户专属，矩阵 ✅/❌ — 不暴露为工具）、
事件先行/行第二写入顺序、幂等/队列/事件语义、`ACT_*`/`IV_*` 服务错误分类。
不新增「单 WS」「WS 必填」「仅 RUNNING run」等未经契约的政策。

## 2. 决策记录

1. **trigger 由接线闭合，不进参数面。** wiring 端口闭包固定
   `trigger: 'AGENT_REPORT_REQUIRES_HUMAN'`（§6 脚注¹「运行时明确要求人工判断的 Agent
   report」通道 ⇒ origin=AGENT_REPORT 由服务内冻结映射推导）。工具参数与 actor 均无
   trigger/origin 入口。
2. **可信 actor 链不复制、不伪造。** 宿主 `exec.agent.sessionId → getRunBySessionId` 解析
   AGENT actor（G1 缝）；工具 handler 以 `ctx.runId`（INV-PERM-1 门保证的正式 R id）构造
   `MechanicalActorRef`/`ActorRef`（**无 session_id** — 冻结 actorRef 形状），服务再各自
   复查（`MECHANICAL_TRIGGER_ACTOR_KIND` 配对 / `assertNextActionCreator`）。
3. **生产校验上下文 = G4 的缺口本体。** `create.ts` 的
   `interventionService.externalState` 原为 `{ workstreams: liveWorkstreams }`（runs/tasks/
   claims/facts/artifacts 缺省空 map）⇒ 任何带 source_refs 或 AGENT actor 的 WS 关联创建
   在冻结 registry 处必死。新 `attentionValidationState()` 每次创建现读：
   runs = `tables.listAllRuns()`（run 表）、claims/facts/artifacts = RR-011(b) 折叠行
   （`readSemanticState()`，与 plan-fork trigger resolver 同源）、tasks/gates/milestones/
   workstreams = 启动树快照。
4. **source_refs 写入时存在性预校验（§16 规则 2）。** 服务 `#create` 在号预留前按注入
   map 拒绝悬挂 typedRef（`IV_INPUT`，消息含 `FACT "F-404"` 式定位）——覆盖**无事件车道**
   （无 WS 关联时 registry 不在场）。只查冻结 registry 建模的 workstream-local kinds
   （validate.ts `WS_LOCAL_KINDS` 同集合，注释互指）；map 未注入 = 维持冻结 V1 的
   shape-only 口径（不发明更严政策）。事件路径仍由 registry 二次校验（同一注入面，双钉）。
5. **可选 map 的向后兼容。** `InterventionExternalState` 新增 6 个可选 map 字段，既有
   注入方（flooding 钩子测试等）零改动；`#buildEventContext` 对缺省 map 回退空 map
   （与旧行为逐位一致）。
6. **成功值 = 冻结记录快照。** Intervention: `{status:'created', intervention, event_id}`
   （`event_id:null` ⇔ 无 WS 关联不发事件，TC-DOM-023/§5.7）；NextAction:
   `{status:'created', next_action}`（PROPOSED 行；目录无 NA 事件 — 行即记录）。
   均经 `toToolJsonValue` 损失性快照。
7. **机器码经 `TOOL_SERVICE` 保持。** 服务错误 → `ToolError('TOOL_SERVICE', '<tool>:
   [<CODE>] <cause message>', {cause, detail:{serviceCode}})`；宿主 codec 提升为
   `ResearchToolHostError.code='TOOL_SERVICE'`。测试钉 `detail.serviceCode` **精确相等**，
   消息 `[CODE]` 前缀仅作佐证（G1 Review-#1 纪律）。
8. **INV-PLAN-3 依赖面扩张是显式评审点。** `keyof ResearchToolDeps` 从 2 键钉到 4 键
   （新增 `interventionCreate`/`nextActionCreate`，类型逐字 = 冻结服务面；plan 写口
   缺席钉全保留）。

## 3. 落地面

- 新增：`src/host/tools/{intervention-create,next-action-create}.ts`（真实定义 + 参数面
  解析 + 冻结输出 schema）；`tests/{intervention/write-lane,tools/intervention-create,
  tools/next-action-create,discovery/host-attention-write}.test.ts`。
- 修改（★ = 与 G2/G3/G5 共享的接缝，只加 G4 条目）：
  - `src/host/tools/types.ts` ★（deps +2 端口）、`src/host/tools/index.ts` ★（注入 +
    assertDeps 两新钉）、`src/host/service/wiring/create.ts` ★（liveGates/liveMilestones、
    `attentionValidationState`、toolsDeps 两端口闭包）
  - `src/host/service/intervention/{types,service,index}.ts`（可选 map、预校验+ctx、
    `TypedRef` 重导出）、`src/host/history/registry/index.ts`（`ArtifactSnapshot`
    导出补齐——snapshot 家族此前唯一漏项）
  - 测试接缝：`tests/tools/{fixtures,stubs,definitions,inv-plan-3,permissions}.test.ts`、
    `tests/store/tc-db-004.test.ts`（stubs 表退场 2 条目 + deps 面 4 键钉 + 严格 schema 钉）

## 4. 验证（全真实 stdout/stderr + exit code，`.g4-logs/` 不入库）

| 门 | 命令 | 结果 |
|---|---|---|
| RED（改前） | focused 3 文件 | 3 files failed / 15 failed 12 passed — 工具面全部 stub `TOOL_NOT_IMPLEMENTED`；write-lane 失败于缺口本体（注入 map 被空 ctx 无视 ⇒ registry `OBJECT_NOT_FOUND`；无 IV_INPUT 预校验；无事件车道不设防） |
| RED（改前·宿主） | host-attention-write | 1 file failed / 8 failed（EXIT=1） |
| GREEN focused | write-lane + 2 工具 + stubs + definitions + inv-plan-3 | 6 files / 77 passed（EXIT=0） |
| GREEN 邻接 | tools+intervention+actions | 22 files / 347 passed |
| GREEN 广域 | wiring store discovery history-registry flooding runbinding inbox attention semantics(+records) | 83 files / 1161 passed（EXIT=0） |
| GREEN 宿主缺口证明 | host-attention-write（真实 wiring + `tables.listAllRuns()` 校验面 + 真 H 事件 actor + OPEN 行 + 严格注册 schema 投影） | 8 passed（EXIT=0） |
| tsc | `npx tsc -p tsconfig.json`（EXIT=1 = 已知失败） | 输出正文 40 行，与 `docs/BASELINE_TSC_BASELINE.md` 40 行**逐行 diff = 空**（no-new-errors 判定规则满足；不比较计数） |
| lint | `node scripts/check-imports.mjs` | EXIT=0（INV-PERM-5 无违规） |
| build | `pnpm run build`（先 `pnpm install --frozen-lockfile` RC=0） | EXIT=0；**功能性产物随 PR 入库**（本项目 git-install 依赖已跟踪 dist：`lib/index.js` +363/−40 与 `e2e/factory-dist/factory.mjs` +363/−40，均含 G4 符号）；机器特异 churn 逐类甄别后排除——`lib/client.js` 36 行全为 `//#region` 机器路径注释（功能 diff=0，G4 未触 src/client）、`SNAPSHOT.md` 时间戳/源根 2 行；`pack-verify` PASS RC=0（519 entries / 59 descriptors，解包冒烟导入干净） |
| e2e | — | **NOT_RUN**（本组未授权） |

USER 回归：`createUserIntervention` 车道逐位不变（write-lane 套件钉 INBOX_ITEM/WORKSTREAM
refs + USER actor 拒绝机械面 + IV_ACTOR_FORBIDDEN 双面），且
`tests/intervention`/`tests/actions` 全套通过。

产物重建逐行证据（完整原始日志留运行机 `.g4-logs/{artifact-install,build-artifact,pack-verify-artifact}.log`，
同 BASELINE 文档惯例不入库）：

```
$ pnpm install --frozen-lockfile            RC=0   (node v24.21.0, pnpm 11.7.0)
$ pnpm run build                            RC=0
  ✔ Build complete in 1067ms
  [snapshot-release] snapshot complete: 31 files (8 docs + 23 schema); read-only; provenance in SNAPSHOT.md
$ node scripts/pack-verify.mjs              RC=0
  [pack-verify] PASS: dsh-research-control-0.1.0.tgz — 519 entries, complete published surface,
  no dev leakage, unpacked main/typert/remote import cleanly under node
churn 甄别: lib/index.js 363/40 + factory.mjs 363/40 = 功能（含 AGENT_REPORT_REQUIRES_HUMAN/
attentionValidationState/nextActionCreate 符号）; lib/client.js 18/18 全部匹配
^[+-]\s*// （rcm-css region 机器路径注释, 功能 diff=0）; SNAPSHOT.md 2/2 = 生成时间+源根。
```

## 5. PR5 评审修正轮（两项 material BLOCK, 同一 PR 合并交付）

### 5a. owner 锚点位置性（review 输入 bug #1）

**输入 bug（reviewer 实证）**: `#buildCreatedEvent` 以 `some()`（owner WORKSTREAM
ref 出现在**任意位置**）判断是否 prepend ⇒ `[RUN:R-1(∈WS-1), WORKSTREAM:WS-2]` +
owner WS-2 时 RUN 保持首位，被冻结 registry 的
`firstWs = source_refs.map(workstreamOf).find(≠undefined)`（validate.ts
OWNER_MISMATCH 分支）判 WS-1≠WS-2 拒事件；删掉尾部 WS ref 反而成功（走 prepend
车道）。

**修正**: 锚点改为**位置性**——payload 恒以 `WORKSTREAM:<owner>` 打头，调用方
该 ref 的重复项折入锚点（去重不丢 ref），其余 ref 保持相对顺序；记录行仍逐字
保留参数 source_refs（§9.2）。不新增 same-WS 限制，跨 WS ref 合法如常。

| 门（修正轮） | 范围 | 结果（真实 exit） |
|---|---|---|
| RED 先跑 | 新锚点回归 4+2 例 | 4 failed 逐字 `IV_EVENT ... OWNER_MISMATCH`（head-order 孪生例与 prepend 车道绿 = 预期不变面） |
| GREEN | tests/intervention + intervention-create | 6 files / 76 passed |
| GREEN 消费方 | flooding brief history-registry semantics store wiring | 61 files / 866 passed |
| GREEN host codec | tests/discovery（含 host 缺口证明 8 例） | 60 passed, EXIT=0 |
| GREEN tools 全套 | tests/tools（含 permissions override 修正） | 9 files / 148 passed |
| tsc | 逐行 diff vs BASELINE 40 行 | 正文 diff=**空**（EXIT=1 为已知失败）。更正记录：上一轮 push 的 HEAD 上，permissions override 补写先于该 tsc 证据重跑，曾引入 1 行额外错误（`workstream_ids`/`source_refs` 必填缺失）；本轮修正记录后 diff 复为空——该 1 行属本组自引入，非基线漂移 |
| lint | check-imports | EXIT=0 |
| build/pack | 同 §4 产物甄别规则 | 功能产物 `lib/index.js`/`factory.mjs` 随本 commit 更新（含锚点修正）；client/SNAPSHOT churn 复归除 |

新增回归：service 4 例（tail-order 成功+payload 锚定+行逐字、双序等价、owner ref
去重、无 owner ref 车道逐字不变）+ tool 2 例（真实服务面 tail/head 两序端到端）。

### 5b. 声明式侧 fresh 读（review 输入 bug #2）

**输入 bug（reviewer 实证 + 本机复现）**: `attentionValidationState` 的
tasks/gates/milestones 取**启动树快照**（create.ts 启动 loop 507–518 一次性
填充），但 GUI 计划编辑/NextAction promote 经 rpc `createPlanItem` 面直写
plan.yaml **不 rewire wiring**（rpc-services.ts:1417–1438；host/index.ts:1314）。
常见序列「启动 → GUI 建 Task → agent report 引用新 T」被误拒：RED 复现
`TOOL_SERVICE [IV_INPUT] ... TASK "T-5" does not exist`，直到 rescan。

**修正**: 声明式侧改**每次创建 fresh** `loadResearchTree(reader, researchRoot,
declarativeDir)`（hierarchy 面 1025 的既有先例——无缓存、刚建节点下次读即可见；
不发明 invalidation bus）。map 形状与启动 loop 逐字一致（tree=真源：gates 未
评估、milestones PLANNED 的存在性/owner 口径）。fresh 读取失败**不阻塞创建**
（声明式树破损时人工上报必须可用）——回退启动快照 + logger.warn（rescan 仍是
修复路径）。runs/claims/facts/artifacts 原本已 fresh；权限、multiWS/optionalWS、
幂等/队列语义不变。

| 门（5b 轮） | 范围 | 结果（真实 exit） |
|---|---|---|
| RED 复现 | host 回归（真实 RPC createPlanItem → report T-5） | `× TOOL_SERVICE [IV_INPUT] TASK "T-5" does not exist` |
| GREEN host codec | tests/discovery/host-attention-write 全 9 例 | 9 passed, EXIT=0 |
| tsc 逐行 | vs BASELINE 40 行 | diff=空（EXIT=1 已知） |
| lint | check-imports | EXIT=0 |
| build/pack/广域 | 与 5a 合并 commit 后统一复跑（下表） | — |

新增 host 回归（真实 API）：initPlane → `svc.createPlanItem`（GUI rpc 面）建
TASK → **无 rescan** report 该 ref 成功 + event_id 非空；`T-404` 仍拒
（TOOL_SERVICE+IV_INPUT）且**零部分写**（行数/事件数前后相等 = 预校验在号预留
前，事件先行/行第二窗口不被破坏）。

### 5c. 合并轮统一门禁（5a+5b 同一 commit）

| 门 | 结果 |
|---|---|
| tests/intervention+tools+actions+wiring+store+flooding+inbox+attention+discovery+history-registry | **1185 passed, EXIT=0**（`.g4-logs/green-round2-broad.log`） |
| tsc | 逐行 diff vs BASELINE = 空 |
| lint | EXIT=0 |
| build+pack-verify | 功能产物 `lib/index.js`/`e2e/factory-dist/factory.mjs` 更新入库；client/SNAPSHOT churn 复除 |

## 6. 未跟随的邀请 / 开放项

- gate/milestone 快照取「存在性」口径（`lastResult:null`、`status:'PLANNED'`）：注册事件
  的评估态校验不在本车道；若后续要把 GATE/MILESTONE 评估态纳入注意力校验，接线处有单一
  插入点（`attentionValidationState`）。
- `readSemanticState` 每次全折叠读（与 trigger resolver 同开销）；创建频率极低，暂不做
  缓存——如成为热点，与 G5 的统一接线一并处理。
- 事件 map 未注入时 source_refs 维持 V1 shape-only——若未来把 PROJECT/TOPIC/RELATION 等
  纳入快照，同步扩 `#sourceRefExistence` 与 `WS_LOCAL_KINDS` 双处（注释互指）。
