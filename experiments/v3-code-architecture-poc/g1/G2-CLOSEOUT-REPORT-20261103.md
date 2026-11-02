# 结项报告 — §0bis 三项收口 + 非作者 G1 冻结复核（2026-11-03）

> 授权与判据：`g1/G2-DEV-PLAN.md §0bis`（外部审查 `ddbe50b`/`7d016cc` 引入，现行）＋其「固定收尾门禁」
> 分支：`g1/contracts-20261031`｜本报告对应提交：`4e30c18`（父 `71fa972`）｜PR #49 仍为 **Draft**
> 性质：甲类（实验 + 文书）。**本报告是「申请冻结」的证据包，不是冻结决定，也不是乙类开工许可。**

## 0. 一句话

三项全部收口：P-NS = **PASS_STABLE_NS**、P-EXT = **PASS_EXTENSION_SEAM**、T-SEC = 五处适用域对账完成；
非作者独立复核席复验 **无阻塞**；门禁 `--self-test` 31/31、`--require-clear` exit 0、`g0-gate` PASS。
**G1 冻结与 G2 乙类开工仍待用户授权**（门禁绿只是申请判据）。

## 1. 三项判定

### 1.1 P-NS（稳定物理命名空间 vs 通用重定位）

- **裁决：`PASS_STABLE_NS`**，`node experiments/v3-code-architecture-poc/preflight/ns/run.mjs` **exit 0**。
- 五项最小真实测试全过，每项配真负例（① 携 ns 移交 ⇒ `TRANSFER_NS_DRIFT`；② 按库误盖另一空间的行 ⇒
  该空间读面 `SCHEMA_INCOMPATIBLE`；③ 迁移漏盖行 ⇒ 逐行 `SCHEMA_INCOMPATIBLE`，不重解释；
  ④ 在线 DML ⇒ `DOMAIN_STATE_APPEND_ONLY`，事务内崩溃 exit 9 全回滚，非事务崩溃留混合态 ⇒ 打开面
  `SCHEMA_UPGRADE_REQUIRED`；⑤ 路径键引用拆包后漂移，oid+revision 键不漂移）。
- **机制发现**：`domain_state` 在存储层是追加式（触发器）。H0 的「重启式离线迁移」在本仓形态下 =
  **离线窗口内单事务重写版本戳 + 原子换库**；在线 DML 面仍被判据拒绝。这与 PR-8 卡里工程审查 P1-1
  的实测（`domain_state_no_update` 全禁 UPDATE 会让 RL-5.1 步 3 必炸）互相印证——PASS 分支下该触发器
  窄化不再需要。
- **分支后果（已落地于计划/卡）**：PR-8/W8 **DEFERRED**（不在 G2 必经图）；`ns-relocated` 保持
  `planned`、不要求批准；PR-5/PR-7 承接稳定 ns、启动版本/历史验证与可回滚重启式迁移；PR-10 不再验
  物理重定位（`g1/G2-DEV-PLAN.md:505-507`、`:190`、`:565-567`）。
- 报告：`preflight/ns/VERDICT.md`（含输入锚、逐字输出、证据锚、诚实边界）。

### 1.2 P-EXT（独立 Kernel 扩展缝）

- **裁决：`PASS_EXTENSION_SEAM`**，不建新实验、不记 `EXTENSION_SEAM_GAP`。
- 证据：新能力只需要清单声明 + 领域侧版本化 Port/校验贡献，Kernel 与装配根零改动；同 Space 跨插件
  原子提交（`tests/capability-scope.test.ts:53`，Q40）、版本化报告与逐行可分归因
  （`tests/contract-skew-echo.test.ts:46`）、拆包后精确引用不变（`tests/p2-identity-plugin.test.ts:100`）
  均有真测试；非法越权负例在位（`CAPABILITY_SCOPE_ESCAPE`、XC-28）。
- 报告：`preflight/ext/VERDICT.md`（含「无真实 DSH Adapter」等三条诚实边界）。

### 1.3 T-SEC（可信部署边界）

- 文档：`g1/G1-TRUSTED-PROFILE-DELTA.md`。**P-T（可信首版，默认）** 保留：正常授权、Space 隔离、
  数据不越界、WITHHELD/UNKNOWN 不得变科学断言、普通越权拒绝、检查报告完整性（字段级同形、零
  `hiddenBy*`、计数只进审计面）。**P-A（敌对 Profile，可选）**：响应恒时、恶意枚举逐字节等、隐含计数
  侧信道穷尽证明——不作首版单独放行门。
- 五处高位适用域加注（原条款与夹具**一字未删**，探针重挂 P-A）：
  `G1-CONTRACT-EVENT-AUTHORITY.md`（echo 面）、`G1-CONTRACT-RECONCILIATION.md`（EA-7.4）、
  `G2-DEV-PLAN.md`（PR-3 退出门禁行）、`G1-FREEZE-CRITERIA.md`（G1-READ-02 退出判据）、
  `G1-ACCEPTANCE-MATRIX.md`（EA-7.4/T-P7 判据）。
- 正式科研采纳授权：用户（G1 冻结 + G2 乙类开工）；P-A 加固由未来敌对部署立项的负责人 + `Frozen-Face-Review`
  提出，不自动生效；事件名审批不变。

## 2. 非作者 G1 冻结复核（独立席位）

- **席位**：独立子代理，独立 detached worktree（`.scratch/wt-g1freeze` → 后 `.scratch/wt-g1freeze2`），
  未参与实现/文书。**路由偏差**：`SUBAGENT_ROUTING.md` 指定权威审查席模型 `qiyuan-inter/glm-5.3`
  本期不可用（在册仅 `gpt-6-astra`），经 `qiyuan-inter/gpt-6-astra` 执行；复核意见首行已声明偏差。
- **第一轮：阻塞**。2 BLOCKER + 2 需修：① P-NS VERDICT 的 HEAD 锚与实跑不一致；② P-NS-2 的「负例」
  实为正例；③ T-SEC 未同步 `G1-FREEZE-CRITERIA.md`/`G1-ACCEPTANCE-MATRIX.md` 两处高位门禁；
  ④ P-NS-4 未断言崩溃子进程 exit 9。
- **处置**：提交 `4e30c18`——锚策略改为「src sha256 为锚、HEAD 只报运行时刻指向并带 dirty 标记」；
  新增 ② 的真负例；两处高位门禁补 P-T/P-A 适用范围注；崩溃子进程显式断言 `status === 9`。
  建议「在裁决账 SCR-54/D1-c 行加指针」不采纳，理由登记于 DELTA §5。
- **第二轮复验：无阻塞，可进入结项**（逐点 PASS，含亲自复跑 `run.mjs` exit 0、`--self-test` 31/31、
  `--require-clear` exit 0、diff 仅 `experiments/**`）。

## 3. 门禁与证据（提交 `4e30c18`）

| 门禁 | 命令 | 结果 |
|---|---|---|
| G1 清单自验 | `node …/g1-checklist-validate.mjs --self-test` | **exit 0**，`变异自验：31/31 全部捕获` |
| G1 清核 | `node …/g1-checklist-validate.mjs --require-clear` | **exit 0**，`items=27 open=7 done=20 违规=0`；A 层 20/20 done、B 层 7 open 全有 owner |
| P-NS 实验 | `node …/preflight/ns/run.mjs` | **exit 0**，五项 PASS，`PASS_STABLE_NS`（同源连跑 2 次 + 提交后 1 次 `HEAD=4e30c18` 干净工作树） |
| PoC 全量门 | `node …/g0-gate.mjs` | **PASS**：tsc 0；`tests/**` 225 例全绿（与身份锚四项逐等）；`attacks/**` 与基线完全一致（33 条已定性已知红） |
| P-EXT 引用测试 | `npx vitest run --config … vitest.config.ts <7 files>` | 7 files / 52 tests 全绿（复核席另抽 5 files / 31 tests 全绿） |

说明：`g0-gate` 于 `71fa972` 工作树运行；`4e30c18` 相对它只改 G1 文档与 `preflight/**`，不触及
tsc/tests/attacks 收集面，故结论沿用；复核席在 `4e30c18` 上另跑 `--self-test`/`--require-clear`/`run.mjs` 复核。

**未动面**：8 根冻结文档、`schema/**`、生产 `src/**`、`tests/**`、DDL、事件名封闭集——零改动；
`git diff --stat 7b3315a..4e30c18` 全部位于 `experiments/**`。

## 4. 20 条 A / 7 条 B 复核

- **A 层 20/20 done**：校验器以 `DONE-EVIDENCE` 规则强制「owner 非伪造 + evidence 非幽灵 + resolution 存在」，
  每条 evidence 指向可核契约/测试/提交；抽查（提交 `7b3315a` 的 G1-TIME-01/02、G1-LINK-01、G1-RECON-01）
  均带日期化「让位/收编」注与落点。
- **B 层 7/7 open、owner 齐全**：`G1-OWN-01`、`G1-BIND-03`、`G1-READ-02`、`G1-VER-03`、`G1-STORAGE-01`、
  `G1-STORAGE-02`、`G1-AUDIT-01`。**观察（非阻塞）**：`G1-VER-03` 与 `G1-STORAGE-02` 的 owner 仍列
  PR-8（现已 DEFERRED），但两者同时列 PR-5/PR-7，**不构成孤儿归属**；建议 G2 开工前把 PR-8 从载体列表划掉。
- 结论：B 层「免检完成、不免归属」成立；清零不是冻结前置（`--require-clear` 的 M31-B 正向条已钉住）。

## 5. 仍需用户决定的三件事（本报告不代作决定）

1. **G1 冻结放行**：技术判据已齐（本报告 + 复核意见 + 门禁），但是否冻结由用户签。
2. **G2 乙类开工授权**：P-NS 自动分流只决定 PR-8 去留，不构成开工许可。
3. **PR #49 合并**：仍 Draft；合并时机与范围由用户定（本分支只动 `experiments/**`）。

## 6. 残余风险与未覆盖（如实登记）

- P-NS 只证明 PoC 机制在 H0 形态下可行：未覆盖迁移期多进程并发写、跨 Space 迁移调度、生产迁移器的
  运维审计面（PR-5/PR-7 实现义务）。
- P-EXT 的「无真实 DSH Adapter」边界仍在：PR-9 的真实 Adapter 装配冒烟必须按原卡执行。
- P-A 套件（两世界逐字节/恒时/穷尽侧信道）目前只有条款与夹具，**未启用、未实现**，启用条件见 DELTA §4。
- T-SEC 只是适用范围对账；`G1-READ-02` 的呈现落码与检查报告完整性实现仍按 B 层交付归属推进。
- 复核席为单席、模型偏差为 `gpt-6-astra`；对抗式三角色面板未启用（本轮门禁档位为权威审查单席）。
