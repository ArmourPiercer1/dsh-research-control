# HISTORY_EVENT_CATALOG.md - ResearchHistory 事件目录（typed event schema）

> 文档状态：**Frozen V1**（2026-08-22 冻结；含独立审计修订 A-2/A-4，追溯见计划书 §40 附录）
> 上游：计划书 §13（ResearchHistory）、§12（Run）、§8–§9（Task/Gate/Milestone）、§14（Claim/Fact/Artifact）、§15（Relation）、§16（Intervention）、§5（Topology）
> 机器可读真源：`schema/history/`（`history-event-envelope.schema.json` + `history-events.schema.json`）；本文为语义真源。
> 设计原则：History 是**实际科研编年史**；plan reorder、contract edit 等管理操作进 Git/ManagementAction，**不进本目录**（计划书 §22.4）。

---

## 1. 事件信封（Envelope）

每个事件是一条信封 + 强类型 payload：

```ts
interface HistoryEventEnvelope<P> {
  eventId: string            // "H-1001"；Project 内唯一，单调递增分配
  ownerWorkstreamId: string  // 唯一 owner workstream（INV-HIST-3）
  eventSeq: number           // owner workstream 内单调递增（1,2,3,...）；append 时分配，永不改写
  eventType: string          // §4 目录中的事件类型名
  schemaVersion: number      // payload schema 版本；V1 全部为 1
  occurredAt: number         // 现实科研事件发生时间（epoch ms）
  recordedAt: number         // 插件正式登记时间（epoch ms）
  actor: ActorRef            // 谁做的
  source?: SourceRef         // 从哪来的（session/file/git/interaction/...）
  payload: P                 // eventType + schemaVersion 决定的强类型 payload
}
```

字段语义：

- `eventId` 全局（Project 内）唯一；`eventSeq` 是 **owner workstream 内**的线性序号；`UNIQUE(owner_workstream_id, event_seq)`（DOMAIN_SCHEMA §15）；
- `occurredAt` 允许早于已有事件（late registration，如补录上周的实验）；此时 `eventSeq` 仍取当前最大值 +1 —— 双时序的意义正在于此；
- `recordedAt` 由插件写入时生成，不接受调用方指定。

## 2. 双时序与回放

| 回放模式 | 排序 | 回答的问题 |
|---|---|---|
| Semantic replay | `ORDER BY occurred_at, event_seq` | 重建科研时间线（默认 UI History 时间线） |
| Audit replay | `ORDER BY event_seq` | 重建「系统何时获知」（登记顺序） |

- `occurredAt` 相等时以 `event_seq` 做 **deterministic tie-break**（测试 TC-HIST-\* 覆盖）；
- late registration 不破坏 semantic ordering（补录事件插到语义时间线的正确位置，但 audit 顺序仍在尾部）；
- 两种 replay 均可重复执行且结果一致（幂等 replay）。

## 3. 事件通用规则

1. **原子性**：一个 HistoryEvent 对应一个原子 source operation；即使来自同一 checkpoint 也不得把不同科研操作聚合为一个 semantic transaction event（INV-HIST-2/8）。唯一例外：`RUNS_STARTED`（一次 batch launch 的多个 Run 启动可作为一个原子 runtime event）；**Run 结束必须逐 Run 记录**；
2. **mutation 事件**（§4 表中 M 列）：payload 必须包含 `from -> to`；service 层校验 `from` 等于对象当前派生状态，不等即拒绝（INV-HIST-5）；
3. **owner 规则**：默认为对象所属 workstream；特例见 §4 表（TOPOLOGY 两类、INTERVENTION、RELATION）；
4. **schema 严格性**：`(eventType, schemaVersion)` 未知或 payload 校验失败 -> **拒绝写入**（INV-HIST-4）；升级 payload schema 必须 bump `schemaVersion` 并同时支持旧版本 replay；
5. **append-only**：无 update/delete API（INV-HIST-1）；撤销/失效通过 `CLAIM_RETRACTED`、`ARTIFACT_MARKED_MISSING`、`RELATION_REMOVED` 等**新事件**表达（INV-HIST-7）；
6. **事件发射者矩阵**：`USER`（GUI 手工登记/操作）、`AGENT`（经 §7.2 工具，受限事件集）、`PLUGIN`（机械自动：session 绑定、audit、flooding）。每事件允许的发射者见 §4 表 E 列；
7. 可读性聚合（按 Run 折叠阅读等）只存在于 wrapper/projection 层，底层事件不变。

## 4. 事件目录总表

E 列：U=USER，A=AGENT，P=PLUGIN。M 列：●=mutation（必含 from->to）。

| # | eventType | 类别 | M | E | owner workstream | 一句话语义 |
|---|---|---|---|---|---|---|
| 1 | `RUN_STARTED` | Run | | U A P | run 所属 WS | 一个 Run 开始 |
| 2 | `RUNS_STARTED` | Run | | U P | 每个 run 各自的 owner WS（见 §5.2） | 一次 batch launch 启动多个 Run |
| 3 | `RUN_FINISHED` | Run | | U A P | run 所属 WS | Run 正常结束 |
| 4 | `RUN_FAILED` | Run | | U A P | run 所属 WS | Run 失败 |
| 5 | `RUN_CANCELLED` | Run | | U A | run 所属 WS | Run 被取消 |
| 6 | `TASK_EXECUTION_CHANGED` | Task | ● | U | task 所属 WS | execution 状态迁移 |
| 7 | `TASK_VALIDATION_CHANGED` | Task | ● | U | task 所属 WS | validation 状态迁移 |
| 8 | `ACCEPTANCE_CRITERION_CHANGED` | Task | ● | U | task 所属 WS | AC 定义变化（语义快照） |
| 9 | `FACT_RECORDED` | 语义标签 | | U A | fact 所属 WS | 记录 Fact |
| 10 | `CLAIM_RECORDED` | 语义标签 | | U A | claim 所属 WS | 记录 Claim |
| 11 | `CLAIM_RETRACTED` | 语义标签 | | U A | claim 所属 WS | 撤回 Claim |
| 12 | `ARTIFACT_REGISTERED` | Artifact | | U A | artifact 所属 WS | 注册 Artifact |
| 13 | `ARTIFACT_MARKED_MISSING` | Artifact | | U A P | artifact 所属 WS | Artifact 缺失 |
| 14 | `RELATION_ADDED` | Relation | | U A | `source.ws ?? target.ws` | 添加直接边 |
| 15 | `RELATION_REMOVED` | Relation | | U A | 同上 | 移除边 |
| 16 | `GATE_EVALUATED` | Gate/Milestone | | U | gate 所属 WS | 一次 Gate 评估 |
| 17 | `MILESTONE_ACHIEVED` | Gate/Milestone | | U | milestone 所属 WS | 里程碑达成 |
| 18 | `INTERVENTION_CREATED` | 人类注意力 | | U A P | 第一个关联 WS（无关联则不发事件） | 创建 Intervention |
| 19 | `TOPOLOGY_FORK_REALIZED` | 拓扑实现 | | U | **inputs[0]**（source WS） | fork 边实现 |
| 20 | `TOPOLOGY_MERGE_REALIZED` | 拓扑实现 | | U | **outputs[0]**（resulting WS） | merge 边实现 |

**发射者保守性说明**（工程默认，扩展需用户确认冻结范围）：

- `TASK_EXECUTION_CHANGED` / `TASK_VALIDATION_CHANGED` / `ACCEPTANCE_CRITERION_CHANGED` / `GATE_EVALUATED` / `MILESTONE_ACHIEVED` 为 **USER only**：状态迁移与验收/评估是人类的判断动作，Agent 工具面（计划书 §25）不含这些操作；
- 拓扑 realize 是用户在 GUI 显式确认的管理+实际发生混合操作（actor=USER）。

## 5. 每事件详细规范

通用校验（全部事件）：`ownerWorkstreamId` 存在；若其为 PLANNED，则本事件的接受与其 PLANNED→REALIZED 迁移（workstream.yaml 更新 + derived_state 写入）为**同一原子操作**，校验按迁移后状态执行（DOMAIN_SCHEMA §13、TC-DOM-033）；payload 内引用的对象存在；`actor` 合法；对 AGENT 发射的事件校验 `actor.run_id` 对应 Run 存在。

### 5.1 Run 生命周期

#### RUN_STARTED

| payload 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `run_id` | R id | ✅ | 新建（不存在） |
| `task_id` | T id | ❌ | 存在且属同 WS |
| `dsh_session_id` | string | ❌ | |
| `intent` | string | ❌ | |
| `initiated_by` | ActorRef | ✅ | |

副作用（派生缓存）：`run` 行创建，status=RUNNING，started_at=occurredAt。

#### RUNS_STARTED（batch）

| payload 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `runs` | `{run_id, task_id?, dsh_session_id?, intent?}[]` | ✅ | ≥2 项（=1 时用 RUN_STARTED） |
| `batch_source` | SourceRef | ❌ | |

**信封特例**：一次 batch launch 的 `RUNS_STARTED` 在**每个相关 owner workstream** 各产生一条同 payload 事件（各自的 eventSeq 独立推进）——保持「每事件恰一个 owner」的同时不拆散原子性。Run 结束必须逐 Run 记录（无 RUNS_FINISHED）。

#### RUN_FINISHED

| `run_id` ✅（存在且 RUNNING） | `outcome_summary` ❌ |
|---|---|

副作用：run.status=FINISHED，ended_at=occurredAt。

#### RUN_FAILED

| `run_id` ✅（存在且 RUNNING） | `error_summary` ❌ | `failure_kind` ❌（自由标签，如 `OOM`/`DATA_MISSING`） |
|---|---|---|

副作用：run.status=FAILED，ended_at=occurredAt。

#### RUN_CANCELLED

| `run_id` ✅（存在且 RUNNING） | `reason` ❌ | `cancelled_by` ✅ ActorRef |
|---|---|---|

副作用：run.status=CANCELLED，ended_at=occurredAt。

### 5.2 Task 执行

#### TASK_EXECUTION_CHANGED（mutation）

| payload 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `task_id` | T id | ✅ | 存在且属 owner WS |
| `from` / `to` | `TaskExecution` | ✅ | 合法转换（DOMAIN_SCHEMA §13）；`from` = 当前派生值 |
| `reason` | string | ❌ | |

#### TASK_VALIDATION_CHANGED（mutation）

| `task_id` ✅ | `from` / `to`：`TaskValidation` ✅（合法转换 + from 校验） | `reviewer` ❌ ActorRef | `note` ❌ |
|---|---|---|---|

约束：`to=NOT_REQUIRED` 仅当 task 的 acceptance_criteria 为空（INV-TASK-3）。

#### ACCEPTANCE_CRITERION_CHANGED（mutation）

| payload 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | T id | ✅ | |
| `from` / `to` | string[] | ✅ | AC 文本快照（语义审计用；定义文件本身的版本由 Git 管理） |

### 5.3 语义标签

#### FACT_RECORDED

| `fact_id` ✅（新建） | `statement` ✅ 非空 | `created_by_run` ❌ R id（AGENT 发射时必填） | `references` ❌ string[] |
|---|---|---|---|

副作用：`fact` 行创建，status 恒 ACTIVE。

#### CLAIM_RECORDED

同 FACT_RECORDED（`claim_id`、`statement`、`created_by_run`、`references`）。副作用：claim 行创建，status=ACTIVE。

#### CLAIM_RETRACTED

| `claim_id` ✅（存在且 ACTIVE） | `reason` ❌ |
|---|---|

副作用：claim.status=RETRACTED（终态）。

### 5.4 Artifact

#### ARTIFACT_REGISTERED

| payload 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `artifact_id` | A id | ✅ | 新建 |
| `type` | `ArtifactType` | ✅ | |
| `title` | string | ✅ | |
| `uri` | string | ✅ | path/URI |
| `content_hash` | string | ❌ | |
| `created_by_run` | R id | ❌ | |
| `related_task` | T id | ❌ | 属同 WS |
| `supersedes` | A id | ❌ | 存在 |

副作用：artifact 行创建，status=REGISTERED。

#### ARTIFACT_MARKED_MISSING

| `artifact_id` ✅（存在且 REGISTERED） | `reason` ❌ | `detected_by` ❌ ActorRef（P 发射时填 audit 来源） |
|---|---|---|

副作用：artifact.status=MISSING。

### 5.5 Relation

#### RELATION_ADDED

| `relation_id` ✅（新建） | `source` ✅ TypedRef | `relation_type` ✅ | `target` ✅ TypedRef |
|---|---|---|---|

校验：满足 DOMAIN_SCHEMA §8 组合表与方向规范（INV-REL-1/2）；唯一性（无同边重复）。

#### RELATION_REMOVED

| `relation_id` ✅（存在且 ACTIVE） | `source` / `relation_type` / `target` ✅（冗余记录便于审计回放） | `reason` ❌ |
|---|---|---|

### 5.6 Gate / Milestone

#### GATE_EVALUATED

| payload 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `gate_id` | G id | ✅ | 存在且属 owner WS |
| `result` | `PASSED`/`FAILED`/`WAIVED` | ✅ | `WAIVED` 仅 actor.kind=USER 且 `note` 非空 |
| `evaluated_by` | ActorRef | ✅ | |
| `note` | string | ❌ | |
| `evidence_refs` | TypedRef[] | ❌ | 评估依据（Fact/Artifact 等） |

Gate 评估可多次执行；每次评估都是一条新事件；gate 当前状态 = 最近一次评估结果（无评估 = PLANNED）。

#### MILESTONE_ACHIEVED

| `milestone_id` ✅（存在且 PLANNED） | `evidence_refs` ❌ TypedRef[] | `note` ❌ |
|---|---|---|

副作用：milestone 派生状态 = ACHIEVED（终态）。

### 5.7 人类注意力

#### INTERVENTION_CREATED

| `intervention_id` ✅（新建） | `title` ✅ | `origin` ✅ `USER`/`AGENT_REPORT`/`AUTO_FLOODING`/`AUTO_AUDIT` | `source_refs` ❌ TypedRef[] |
|---|---|---|---|

信封 owner = intervention 第一个关联 WS（`workstream_ids[0]`，可由 source_refs 推导）；**完全无 WS 关联的 Intervention 不发事件**（只存在于 operational 队列）。`origin=AUTO_*` 时 actor.kind=PLUGIN。

### 5.8 拓扑实现

#### TOPOLOGY_FORK_REALIZED

| `topology_edge_id` ✅（存在、PLANNED、同 owner Topic） | `inputs` ✅ WS id[] | `outputs` ✅ WS id[] |
|---|---|---|

校验与副作用：edge.lifecycle -> REALIZED，`realized_event_id` 回填（拓扑 YAML 的 declarative 更新）；owner = `inputs[0]`；V1 要求 realized FORK 边 `inputs` 恰为 1 项、MERGE 边 `outputs` 恰为 1 项（消除 owner 歧义的工程默认）；outputs 中 PLANNED 的 WS 自动置 REALIZED。

#### TOPOLOGY_MERGE_REALIZED

同上；owner = `outputs[0]`（resulting WS）。

## 6. 事件 -> 派生状态（reducer 语义）

| 事件 | 更新的派生缓存 |
|---|---|
| RUN_STARTED / RUNS_STARTED | run 行创建 |
| RUN_FINISHED / RUN_FAILED / RUN_CANCELLED | run.status、ended_at |
| TASK_EXECUTION_CHANGED | task.execution 当前值 |
| TASK_VALIDATION_CHANGED | task.validation 当前值 |
| ACCEPTANCE_CRITERION_CHANGED | task AC 快照（validation 重置提示） |
| FACT_RECORDED / CLAIM_RECORDED | fact/claim 行 |
| CLAIM_RETRACTED | claim.status=RETRACTED |
| ARTIFACT_REGISTERED / ARTIFACT_MARKED_MISSING | artifact 行 / status |
| RELATION_ADDED / RELATION_REMOVED | relation 行 / status |
| GATE_EVALUATED | gate 当前评估结果 |
| MILESTONE_ACHIEVED | milestone 派生状态 |
| INTERVENTION_CREATED | intervention 行 |
| TOPOLOGY_FORK/MERGE_REALIZED | 拓扑 YAML lifecycle（declarative，经用户确认的管理性更新）+ WS lifecycle |

重放（rebuild）：从空 DB 按 audit 顺序重放全部事件可重建所有派生列（测试 TC-HIST-006）；重放不得产生新的 HistoryEvent。

## 7. 目录维护流程

1. 事件 schema 的唯一真源是 `schema/history/history-events.schema.json`（每事件一个 `$defs` 条目 + `oneOf` 判别）；
2. 本文档的 §4/§5 由 schema 生成或人工同步（冻结时人工核对一次）；
3. 测试 fixture 由 schema 自动生成（每事件至少一个正例 + mutation 负例，仿 DSH persistence catalog 思路）；
4. 新增事件 / payload 变更：bump `schemaVersion`（payload 级）或 `.research/schema-version`（目录级）；旧事件 replay 必须继续支持（向前兼容读取）。
