# schema/ - V1 冻结契约（JSON Schema）

> 状态：**Frozen V1**（2026-08-22 冻结；含审计修订 A-4/A-5/A-8/A-9/A-12 及根级 oneOf 判别修复）。本目录是计划书 §37 第 4 项工程产物（`.research/schema/*.json` 或 zod source 的文档阶段形态）。

## 约定

- JSON Schema **draft 2020-12**；YAML 文件校验时先解析为 JSON 结构再校验；
- `operational/*.schema.json` 根级为 `oneOf` 判别：文件可直接校验「本文件定义的任意一种行实例」；按具体类型校验时 `$ref` 到对应 `$defs` 条目；
- 语义真源是各 `.md` 文档（DOMAIN_SCHEMA.md / HISTORY_EVENT_CATALOG.md / PLAN_FORK_SPEC.md），机器真源是本目录；冲突 = 冻结 blocker；
- 实现期：运行时校验代码（zod 或直接 JSON Schema validator）由本目录生成/对齐；任何契约变更须 bump `.research/schema-version` 并同步更新测试 fixture。

## 目录

| 文件 | 校验对象 | 对应文档 |
|---|---|---|
| `common.schema.json` | 公共结构（ActorRef/SourceRef/TypedRef/ID pattern/时间） | DOMAIN_SCHEMA §1 |
| `declarative/project.schema.json` | `.research/project.yaml` | DOMAIN_SCHEMA §2.1 |
| `declarative/topic.schema.json` | `.research/topics/<t>/topic.yaml` | §2.2 |
| `declarative/workstream.schema.json` | `.../workstreams/<w>/workstream.yaml` | §2.3 |
| `declarative/topology.schema.json` | `.research/topics/<t>/topology.yaml` | §3.1 |
| `declarative/plan.schema.json` | `.../workstreams/<w>/plan.yaml` | §4.4 |
| `declarative/task.schema.json` | `.../items/tasks/<id>.yaml` | §4.1 |
| `declarative/gate.schema.json` | `.../items/gates/<id>.yaml` | §4.2 |
| `declarative/milestone.schema.json` | `.../items/milestones/<id>.yaml` | §4.3 |
| `declarative/objectives.schema.json` | `.research/objectives.yaml` | §9.1 |
| `declarative/workspace.schema.json` | `.research/workspace.yaml` | §14.1 |
| `declarative/agent-plan-fork-policy.schema.json` | `.research/policies/agent-plan-fork.yaml` | PLAN_FORK_SPEC §9 |
| `history/history-event-envelope.schema.json` | 事件信封（不含 payload 判别） | HISTORY_EVENT_CATALOG §1 |
| `history/history-events.schema.json` | 20 个事件的完整信封+payload（oneOf 判别） | §4/§5 |
| `operational/run.schema.json` | Run / DiscoveredSession 行投影 | DOMAIN_SCHEMA §6 |
| `operational/semantic-labels.schema.json` | Claim / Fact / Artifact | §7 |
| `operational/relation.schema.json` | Relation（含组合表约束） | §8 |
| `operational/attention.schema.json` | Intervention / NextAction / Blocker / Awareness | §9 |
| `operational/reporting.schema.json` | Interaction / ReportingItem / ScheduledEvent | §10 |
| `operational/inbox.schema.json` | InboxItem | §11 |
| `operational/plan-fork.schema.json` | PlanFork | §5 / PLAN_FORK_SPEC |
| `operational/provenance.schema.json` | ManagementAction / AnalysisRecord | §12 |

## 无 schema 的声明式对象

`schema/declarative/` 不含 MergeContract（`.research/merges/<TE-id>/contract.md`）：它是自由 Markdown（可选 YAML front-matter 不参与核心校验），按设计（DOMAIN_SCHEMA §3.2）不设 schema；其版本历史由 Git 管理。

## 引用完整性说明

Schema 校验单文件结构；跨文件引用完整性（plan 引用 item 存在、拓扑边同 Topic 等）在加载期由 service 层执行（DOMAIN_SCHEMA §16），不在 JSON Schema 表达范围内。
