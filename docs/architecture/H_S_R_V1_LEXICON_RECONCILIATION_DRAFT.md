# 与 V1 冻结词汇的接入对照（设计层）

> **PR #42 · DRAFT-PROPOSAL · 2026-10-28。** 供软件工程设计接入时避免词汇与语义冲突。本文件**不修改**任何 V1 冻结契约，只说明新五类词汇与 V1 冻结词汇之间的**关系与禁止事项**。V1 运行面（根目录 `ARCHITECTURE.md`、`DOMAIN_SCHEMA.md`、`HISTORY_EVENT_CATALOG.md`、`schema/**`）仍是当前实现真源；本文件属 Proposed。

## 1. 使用前提

| 编号 | 规则 |
| --- | --- |
| V1-01 | 新五类术语不与 V1 冻结词汇同义替换。改名、加字段或在旧事件上赋予新含义都不构成迁移（[W3C Crosswalk](W3C_ALIGNMENT.md) 的迁移纪律同样适用）。 |
| V1-02 | V1 的科研语义标签（Claim/Fact）按 `INV-SCI-1/2` 是 Workstream-local 索引标签，插件不判其科学正确性；新架构的 Proposition/评价/接纳是**另一层**语义，两者并存不互相覆盖。 |
| V1-03 | 迁移只能**新增**可回放的投影与候选记录，不改变、不删除、不伪造既有事件；无法解析的字段显式记 `UNKNOWN`，不猜测补全。 |
| V1-04 | 旧标识（C-/F-/A-/REL-/Run）及其 statement、run、时间、工作线与直接关系必须仍可追溯。 |

## 2. V1 关系词汇 → 新落点

V1 `relation_type` 闭集（`ARCHITECTURE.md:257-258` 的方向制与 `DOMAIN_SCHEMA.md:382-391` 的组合表）不可无损映射到新语义层：

| V1 关系 | 新架构处理 | 关键禁止 |
| --- | --- | --- |
| `PRODUCED_BY`（ARTIFACT→RUN） | 有来源的来源记录（`prov:wasGeneratedBy` 语义）；视图上可作关联 | 只在真实产出成立时映射；Run 与其产出活动必须相符 |
| `CONSUMES`（TASK/RUN→ARTIFACT） | “实际使用”才映射 `prov:used` | **计划使用 ≠ 实际 usage**；计划留在 V1 控制面 |
| `DERIVED_FROM`（FACT→ARTIFACT/FACT） | **必须分流**：数据派生 → `prov:wasDerivedFrom`；科学推理 → Argumentation | 不得一对一无损强译；标记为“待人工或规则分流的有损关系” |
| `SUPPORTED_BY` / `CONTRADICTED_BY` | 候选证据关系或评价，需补齐 Scheme、角色与精确命题版本后才是论证 | V1 明示“只记录，不推理”（`INV-REL-4`）；不得因迁移自动生成论证或支持度 |
| `VALIDATED_BY`（GATE→FACT/ARTIFACT） | 验证/检查记录引用 | Gate 通过 ≠ 科学充分性；GATE 的 `WAIVED` 不转成任何科研结论 |
| `DEPENDS_ON` / `IMPLEMENTS` / `CONTRIBUTES_TO` | 留在 V1 计划与控制面语义 | 不映射为逻辑前提或推理依赖 |
| `RELATED_TO` | 弱关联 Association（须补类型与来源） | 不因“都是边”与来源、论证混为同一语义 |
| V1 统一 `RELY_ON` 方向制 | 废弃为科学语义；逆向查询由检索提供 | 不得据方向制推出“反向关系也成立” |

## 3. V1 事件与对象词汇

| V1 词汇 | 含义来源 | 与新层的关系 |
| --- | --- | --- |
| `FACT_RECORDED` / `CLAIM_RECORDED` / `CLAIM_RETRACTED` | `HISTORY_EVENT_CATALOG.md` | 表示“标签被登记”的事件；**不自动**成为 `FACT_DESIGNATION`、接纳状态或更高规范化层级 |
| `RUN_STARTED` / `RUNS_STARTED` / `RUN_FINISHED` / `RUN_FAILED` / `RUN_CANCELLED` | 同上 | Run 是 V1 运行治理对象；活动语义可对齐 `prov:Activity`，**运行绑定与状态不会无损变成**活动个体 |
| `GATE_EVALUATED`（PASSED/FAILED/WAIVED） | 同上 | 派生态与提示性启发不构成依赖解释；与新架构的检查报告是不同层 |
| `ARTIFACT_REGISTERED` / `ARTIFACT_MARKED_MISSING` | 同上 | 缺失登记对应 Entity 的可用性检查记录（状态轴 A8），不抹去历史 |
| PlanFork / Plan / Task / Milestone / Intervention | V1 控制面 | 保持 V1；仅当被科研记录指称时才作为 Entity 出现 |
| ResearchSpace 隔离 | 新层横切约定 | 与 V1 的 Workstream 事件归属是不同维度，不互相推导 |

## 4. 接入时必须显式报告的有损点

导入/映射产物必须逐条给出 `lossReport`（位置、字段、动作），至少覆盖：无法解析的 World/Scope/证明字段（记 `UNKNOWN`）、`DERIVED_FROM` 的分流候选与未分流项、只有标签而无含义的 Claim/Fact（保留为候选，不晋升）、V1 时间语义无法区分“所描述时间 / 登记时间”的记录（不得静默择一）、以及跨 Workstream 关系在新层的空间归属不确定性。**报告缺失或静默丢弃即视为迁移不合格。**

## 5. 未在本轮处理

V1 冻结面的实际读写迁移实现、双轨回放与一致性对账脚本、事件目录扩展与 schema-version bump 程序，均属后续实施设计与独立 Gate，不随本文件批准。
