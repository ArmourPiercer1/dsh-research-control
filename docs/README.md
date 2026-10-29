# docs/ — 文档分层入口（唯一导航页）

> 本页是**导航**，不是第二真相：状态在 Gate 记录与 `dev/engineering/registry.yaml`，
> 契约内容在冻结正源，历史在 Historical 层。层级 = `Current`（现行有效）/
> `Proposed`（未生效提案）/ `Historical`（历史证据，只追加不改写）。
> 本页的文件清单块是**派生索引**，由 `pnpm run docs:sync --write` 生成，勿手改。

## 各层放什么、谁说了算

| 层 | 位置 | 权威关系 |
|---|---|---|
| 冻结契约（Current） | 仓库根 8 文档 + `schema/**` + `SNAPSHOT.md` | 唯一正源（AD-EB-01）；修订=冻结变更流程 |
| 工程纪律（Current） | `AGENTS.md`、`docs/development.md`、`docs/testing.md` | 执行纪律，用户指令驱动；不改契约 |
| 决策记录（Current） | `docs/decisions/ADR-*.md` | 决策的正式落点；`supersedes` 只指向被替代记录的标识 |
| 工程基线（Current） | `docs/engineering-baseline/` + `gates/` | PR #11 计划与各 Gate 裁决记录 |
| 提案（Proposed） | Draft PR #9 / #10 分支 | **未生效**——不得按已生效契约引用；合流前不入库为 Current |
| 历史（Historical） | `docs/BASELINE_*`、`docs/G1_TRUSTED_BOUNDARY.md`…`docs/G4_*`、`docs/TOOLS_TRACEABILITY.md`、`docs/evidence/**` | Stage-0/WP 时代记录；只追加更正，不改写原文 |

> **命名撞车说明**：旧 WP 阶段的 `G0–G5` 文档（上表 Historical 行）与工程基线的
> Gate `G0–G3`（`docs/engineering-baseline/gates/`）不是同一序列；引用时写全路径。
> V3 类型化研究面（#9）与 PoC 计划（#10）保持 Draft，本仓任何 Current 文档都不得
> 替它们宣布生效。

## 派生索引（docs:sync 生成，勿编辑）

<!-- docs:sync:begin -->
| 文件 | 层级 |
|---|---|
| `AGENTS.md` | Unranked |
| `ARCHITECTURE.md` | Unranked |
| `DOMAIN_SCHEMA.md` | Unranked |
| `DSH_ADAPTER.md` | Unranked |
| `GIT_INTEGRATION.md` | Unranked |
| `HISTORY_EVENT_CATALOG.md` | Unranked |
| `PLAN_FORK_SPEC.md` | Unranked |
| `README.md` | Unranked |
| `SNAPSHOT.md` | Unranked |
| `SUBAGENT_ROUTING.md` | Unranked |
| `TEST_MATRIX.md` | Unranked |
| `docs/BASELINE_INDEX.md` | Historical |
| `docs/BASELINE_PLAN.md` | Historical |
| `docs/BASELINE_PROGRESS.md` | Historical |
| `docs/BASELINE_TSC_BASELINE.md` | Historical |
| `docs/G0_REPRODUCIBLE_TEST_ROOT.md` | Current |
| `docs/G1_TRUSTED_BOUNDARY.md` | Unranked |
| `docs/G2_READONLY_TOOLS.md` | Unranked |
| `docs/G3_SEMANTIC_WRITE_TOOLS.md` | Unranked |
| `docs/G4_ATTENTION_WRITE_TOOLS.md` | Unranked |
| `docs/MAINT_0_2_0_RC2_PLAN.md` | Unranked |
| `docs/README.md` | Current |
| `docs/TOOLS_TRACEABILITY.md` | Historical |
| `docs/architecture/ARCHITECTURE_BASELINE.md` | Proposed |
| `docs/architecture/CORE_SEMANTICS.md` | Proposed |
| `docs/architecture/OPEN_DESIGN_QUESTIONS.md` | Proposed |
| `docs/architecture/POC_IMPLEMENTATION_PLAN.md` | Proposed |
| `docs/architecture/README.md` | Proposed |
| `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` | Proposed |
| `docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md` | Proposed |
| `docs/architecture/W3C_ALIGNMENT.md` | Proposed |
| `docs/architecture/adr/D13_OPEN_WORLD_REGISTRY.md` | Proposed |
| `docs/architecture/adr/D14_CONCEPT_REGISTRY.md` | Proposed |
| `docs/architecture/adr/D15_NONBLOCKING_OBLIGATIONS.md` | Proposed |
| `docs/architecture/adr/D16_ANOMALY_DISCOVERY.md` | Proposed |
| `docs/architecture/adr/D17_PROGRESSIVE_SEMANTICS.md` | Proposed |
| `docs/architecture/adr/D18_RELIABILITY_DIMENSIONS.md` | Proposed |
| `docs/architecture/adr/D19_DUAL_GRAPHS.md` | Proposed |
| `docs/architecture/adr/D20_W3C_ALIGNMENT.md` | Proposed |
| `docs/architecture/adr/README.md` | Proposed |
| `docs/decisions/ADR-0001-in-repo-canonical-source.md` | Current |
| `docs/decisions/ADR-0002-lightweight-governance.md` | Current |
| `docs/decisions/ADR-0003-design-lineage-supersession-seal.md` | Current |
| `docs/design/V3_TYPED_RESEARCH_EPISTEMICS_ARCHITECTURE_DRAFT.md` | Historical |
| `docs/development.md` | Current |
| `docs/engineering-baseline/EXECUTION_PLAN.md` | Current |
| `docs/engineering-baseline/STRUCTURE_DESIGN.md` | Current |
| `docs/engineering-baseline/gates/G0.md` | Current |
| `docs/engineering-baseline/gates/G1.md` | Current |
| `docs/engineering-baseline/gates/G2.md` | Current |
| `docs/engineering-baseline/gates/G3-baseline-ready.md` | Current |
| `docs/engineering-baseline/gates/G3.md` | Current |
| `docs/packaging.md` | Current |
| `docs/poc/V3_POC_EXECUTION_PLAN.md` | Proposed |
| `docs/poc/gates/P0.md` | Proposed |
| `docs/poc/gates/P1.md` | Proposed |
| `docs/poc/gates/P2.md` | Proposed |
| `docs/poc/gates/P3.md` | Proposed |
| `docs/poc/gates/P4.md` | Proposed |
| `docs/poc/gates/POC-COMPLETION-REVIEW.md` | Proposed |
| `docs/testing.md` | Current |
| `experiments/v3-semantic-poc/NOTES.md` | Unranked |
| `experiments/v3-semantic-poc/README.md` | Unranked |
| `experiments/v3-semantic-poc/REPORT-P4.md` | Unranked |
| `experiments/v3-semantic-poc/SPEC.md` | Unranked |
| `experiments/v3-semantic-poc/fixtures/ab/corpus/README.md` | Unranked |
| `experiments/v3-semantic-poc/samples/gpt-streak/README.md` | Unranked |
| `experiments/v3-semantic-poc/samples/gpt-streak/observation-spec.md` | Unranked |
| `schema/README.md` | Unranked |
| `src/host/persistence/hardening/README.md` | Unranked |
<!-- docs:sync:end -->
