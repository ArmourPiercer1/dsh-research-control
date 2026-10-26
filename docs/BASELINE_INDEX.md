# BASELINE_INDEX — 权威文档索引（Stage-0）

> 状态：Active（Stage-0 基线产物）。本文件与 `BASELINE_PROGRESS.md`、`BASELINE_PLAN.md` 是
> 基线阶段新增的**非冻结**工程文档；不改动 8 份 Frozen V1 契约文档与 `schema/`。
> **2026-10-26 AD-EB-01/EB1 更新**：这批文件本身就是仓内唯一正源（随 Git 版本化，不再是
> 「工作区根正本的镜像」）；`scripts/snapshot-release.mjs` 只校验与生成发布清单，见 §1/§4。

## 1. 文档分层（谁是正源）

| 层 | 文件 | 权威性 |
|---|---|---|
| 冻结契约（仓内正源） | `ARCHITECTURE.md`、`DOMAIN_SCHEMA.md`、`DSH_ADAPTER.md`、`GIT_INTEGRATION.md`、`HISTORY_EVENT_CATALOG.md`、`PLAN_FORK_SPEC.md`、`SUBAGENT_ROUTING.md`、`TEST_MATRIX.md`、`schema/`（23 文件）、`SNAPSHOT.md` | **AD-EB-01（2026-10-26）起本仓根即唯一正源**（批准基准哈希 `docs/engineering-baseline/gates/G0-inventory.yaml`）；`SNAPSHOT.md` 是确定性发布清单（生成物），构建对其与文件树做双向逐文件 sha256。运行时面同路径解析（`#resolveSchemaRoot` 自 `<pkg>/schema`）。修订 = 冻结变更流程：改契约文件 + `pnpm run snapshot:update` + 同一提交评审（旧「勿在包根编辑、改动落仓外正本」纪律 superseded） |
| 包自有说明 | `README.md`、`docs/packaging.md` | 可直接编辑，不在快照清单（`snapshot-release.mjs` FROZEN_DOCS 不含 README） |
| 基线阶段产物 | `docs/BASELINE_INDEX.md`、`docs/BASELINE_PROGRESS.md`、`docs/BASELINE_PLAN.md`、`docs/BASELINE_TSC_BASELINE.md`（tsc known-failing 逐行证据） | 本 Stage-0 新增；非冻结，随后续 PR 演进 |

## 2. 11 工具范围的权威引用（Stage-1 起生效）

根目录 Frozen V1 文档 + 包内 `schema/` 对 11 工具范围**自足**：

- 工具面/权限矩阵（7 写 + 4 读，Investigator 4 只读闭集）：`ARCHITECTURE.md` §7.2
- 对象字段与状态机：`DOMAIN_SCHEMA.md`（Fact/Claim/Artifact §7、Attention §9、Run/DiscoveredSession §6、PlanFork §5）
- 事件信封与 20 payload：`HISTORY_EVENT_CATALOG.md`（agent 写路径的事件 actor 合规依据）
- PlanFork 语义：`PLAN_FORK_SPEC.md`
- 机器契约：`schema/operational/semantic-labels.schema.json`、`attention.schema.json`、`run.schema.json`、`plan-fork.schema.json`、`history/history-events.schema.json`
- 测试追溯：`TEST_MATRIX.md`（INV→TC→AC）+ `tests/tools/stubs.test.ts`（当前桩行为冻结）

## 3. 正源缺口（记录，不发明内容）

以下被树内文档引用但**不在版本树内**（位于作者的科研工作区根，仓库外层）：

| 被引用处 | 缺失文件 | 处置 |
|---|---|---|
| `README.md` L3 | 工作区根 `README.md`（V2 使用指南）、`docs/design/V2_RESEARCH_PLANE_DESIGN.md` | 缺口：V2 设计正源未入库。Stage-0 不虚构；V2-UI 后续证据以代码 + 提交信息为准 |
| `scripts/snapshot-release.mjs`（旧版）L5 | `docs/execution/spec-issues/SI-001.md`（裁决书） | 裁决书原件仍 UNKNOWN（未入库不可访问，不伪造）；其发布期复制机制已由 AD-EB-01 退役（`docs/engineering-baseline/`，EB1），现行脚本语义以脚本头注为准 |
| `schema/README.md`、`SUBAGENT_ROUTING.md` | 「计划书」（§37/§40 冻结记录表） | 同上；冻结范围以 SNAPSHOT.md 清单为准 |

仓库内**无 AGENTS.md、无 skills 文件**（全树检索确认）；如后续要引入，属新工程决策，不在 Stage-0 范围。

## 4. 环境正源（构建/测试的可复现前提）

- （历史，Stage-0 记载）测试曾以 `tests/<suite>/../../..` 解析 `WR_ROOT` 读父层 `schema/`，
  快照脚本 SOURCE_ROOT = 仓库父目录——G0（`docs/G0_REPRODUCIBLE_TEST_ROOT.md`）把测试根收敛到
  仓内 `schema/`，EB1（AD-EB-01）退役了快照的父目录读取与 `DSH_SNAPSHOT_SOURCE_ROOT`。
- **独立 clone 即独立可复现**（EB0 实测，`docs/engineering-baseline/gates/G0.md`）：无需任何
  仓外 fixture，按 README 顺序 install → tsc（known-failing 债务身份核对）→ lint → build →
  test → pack:verify；唯一环境前置是 git identity（CI 注入；EB3 测试世界项）。
