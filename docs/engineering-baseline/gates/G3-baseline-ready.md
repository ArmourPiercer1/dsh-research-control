# BASELINE_READY view（生成物 — 重跑 `pnpm run baseline:ready` 即最新）

> Generated: git `main@049c37da198c` · worktree DIRTY (view describes committed HEAD; uncommitted paths excluded) · node v24.21.0 · pnpm 11.7.0
> 来源：Git + 机器检测 + `dev/engineering/registry.yaml`（人工事实）。本视图不新增真相，不做手工维护。

| 项 | 状态 | 依据 |
|---|---|---|
| 类型债务 | KNOWN-FAILING 精确复现（19 条）— 非全绿 | dev/engineering/tsc-debt.ids |
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
- 已知张力：2026-10 train 迁移（用户裁决：产品跟进上游）train/实例/CLI pin 三者重锚至 release(dsh): 0.2.0-rc.2；B-EB3-1 的 rc.8 起服缺陷随 pin 重定至 train CLI 解除；TC-DSH-008 世界复跑已完成（前置链 #27；迁移评审合入后 0.2 世界无头 t61 设置卡往返 + t63 干净画像全绿，见 docs/MAINT_0_2_0_RC2_PLAN.md 落地状态节）

## 已知欠账与缺口（registry 派生 + G3 登记口径）

- `e2e_spec_layer`（obsolete-reference）：scripts/e2e-run.sh 终段引用的 e2e/smoke.*.spec.ts 已在 9275eef（V2 全量验收、V1 specs archived）移入 e2e/v1-archived/，且两份 playwright 配置均显式 testIgnore 归档目录——脚本在 pin 世界起服后必然 No tests found。基线自带、非 2026-10 train 迁移引入（rc.2 世界实证：pin 校验/播种/research seed/起服全过，唯 spec 层死引用）。
- `typescript`（known-failing）：基线清单 `dev/engineering/tsc-debt.ids`
- SI-001 裁决书原件 / 外部 V2 设计 / 计划书 = UNKNOWN（仓外不可访问，不伪造）。
- V3（design_prs）：#9/#10（V2 设计与 PoC 计划）已合并——历史设计通道关闭，不再是执行依据
- V3（formal_contract）：docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md = PROPOSAL（人工批准前不生效；批准状态由人工在评审中给出，本登记不冒充批准）
- CI required status 配置与否见 G3 记录（观察先于强制）。

## 设计线（registry.design_lines 派生）

- `v3`：现行 = `docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md`（DRAFT-PROPOSAL——人工批准前不生效；生效/冻结由人裁定，机器只查路径与锚）· 切换锚 `80e546e` · 首代 `docs/poc/V3_POC_EXECUTION_PLAN.md` · 封存：V3 契约批准的同 PR 对首代原件哈希封存（scripts/seal-superseded.mjs --write，树 docs/architecture/superseded/，然后补登记 seal_manifest）

