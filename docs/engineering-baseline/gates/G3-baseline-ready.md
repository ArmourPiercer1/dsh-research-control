# BASELINE_READY view（生成物 — 重跑 `pnpm run baseline:ready` 即最新）

> Generated: git `main@d4efd20d4866` · worktree clean · node v24.21.0 · pnpm 11.7.0
> 来源：Git + 机器检测 + `dev/engineering/registry.yaml`（人工事实）。本视图不新增真相，不做手工维护。

| 项 | 状态 | 依据 |
|---|---|---|
| 类型债务 | NEW DEBT — 基线不 READY | dev/engineering/tsc-debt.ids |
| 契约正源 | 正源↔清单一致（AD-EB-01 批准哈希） | SNAPSHOT.md ↔ schema/** + 8 docs |
| 预构建产物 | committed == fresh build（仅 rcm-css 噪声归一化） | scripts/check-build-freshness.mjs |

## 阶段 Gate（registry 事实，非推导）

| EB0_G0 | **PASS** | docs/engineering-baseline/gates/G0.md |
| EB1_G1 | **PASS** | docs/engineering-baseline/gates/G1.md · merge 49fab818f847 |
| EB2_G2 | **PASS** | docs/engineering-baseline/gates/G2.md · merge a6966617355a |
| EB3_G3 | **PASS** | docs/engineering-baseline/gates/G3.md · merge 2235e822bef2 |

## 宿主与 pin（registry 事实）

- `dependency_train` = `0.2.0-rc.2`
- `instance_checkout` = `tests/deepseek-harness`
- `instance_sha` = `c1b47e41fc`
- `e2e_cli_pin` = `0.2.0-rc.2`
- 已知张力：2026-10 train 迁移（用户裁决：产品跟进上游）train/实例/CLI pin 三者重锚至 release(dsh): 0.2.0-rc.2；B-EB3-1 的 rc.8 起服缺陷随 pin 重定至 train CLI 解除，TC-DSH-008 世界复跑在本迁移评审合入后执行

## 已知缺口（G3 登记口径）

- e2e CLI pin（TC-DSH-008 registry-floor）与 §实例 train 的版本对齐 = 待用户版本决策（AGENTS §4）。
- SI-001 裁决书原件 / 外部 V2 设计 / 计划书 = UNKNOWN（仓外不可访问，不伪造）。
- V3（#9/#10）= Draft，未生效；本视图不为其状态背书。
- CI required status 配置与否见 G3 记录（观察先于强制）。

