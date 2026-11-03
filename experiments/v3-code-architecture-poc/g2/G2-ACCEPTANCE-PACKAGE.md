# G2 统一人工验收包（候选交付，2026-11-04）

> 状态：**候选交付 / 未完成全部 PR**。本包只陈述**已实测的事实**与**未满足项**，
> 不声称 G2 完成、不声称可发布、不含任何代替人工签署的标记。

## 1. 候选分支与 SHA

| 分支 | tip | PR | 内容 |
|---|---|---|---|
| `g2/impl` | `04c773a` | 基底（非发布路径） | G2 开发起点（= `04c773a45a9b33f8d5b88ddc041dbd0446838c9d`）|
| `g2/pr-1` | `6013572` | **#50**（Draft） | 甲类：锚文件 + `events-recon.mjs` + 夹具；`src/**`、`tests/**` 为零 |
| `g2/bootstrap` | `a484322` | **#51**（Draft，stacked on #50） | Bootstrap Gate |
| `g2/pr-2` | `c6d932b` | **#52**（Draft，stacked on #51） | 乙类：EA-3 / EA-4 / EA-7.1·7.2 / R-8 / 记录域 Port |

合并顺序：50 → 51 → 52。**均未合并 `main`。**

## 2. 已实测的门禁（各分支最新 tip）

| 门禁 | 结果 |
|---|---|
| `check:types` | 19 条债务**身份**精确复现（不是计数匹配）|
| `lint` / `check-imports` | 0 |
| `build` + `check:freshness` | 0（31 个 canonical 文件 sha256 双向校验）|
| `docs:check` | OK |
| `pnpm test`（PR-2 tip `c6d932b`） | **5126 passed / 1 red** |
| 唯一红灯 | `tests/engineering/eb1-canonical.test.ts` = 既存 **R-1**（起点 `04c773a` 同红，非本次引入）|
| `tsc -p tsconfig.kernel.json` | 0 |
| `events-recon` 生产根 | exit 0（期望 13 / 事实 10 / planned 3）|
| `events-recon --self-test` | **29/29** |
| 逐提交门禁（PR-1 历史） | 4/4 PASS |
| 冻结夹具 | 52 PASS / 0 FAIL |
| `kernel-event-authority` | 25/25 |
| `kernel-bootstrap` | 7/7 |
| `contracts-raw-intake-port` | 12/12 |

## 3. 已落地的机制（PR-2）

- **EA-3**：`EventOwnershipEntry` 全形 + 装配期五字段判据（缺一即 `ACTIVATION_IMPOSSIBLE`）+ 机制名不可被清单认领
- **EA-4**：九字段 `AuthorizationContext` 信封、入参字段集封闭（8 个见证字段全拒）、`gateFullShape` 三分支（**闸内无事件名清单**）、`replayAuthorityEvidence` 三态
- **EA-7.1**：`recordMechanismAudit` 有生产调用方 `auditRequiredIntegrity(by, trigger)`——**每次运行必落一条**
  `integrity-audit-recorded`（§7.2 载荷：`runId/trigger/counts/violationsDigest/softGhostsDigest/drift/schemaVersion/ruleSetVersion`）；
  回声只回 `{seq}`（EA-7.4 非 oracle；`hiddenBy*` 键在回执与入参两处都不留）
- **EA-7.2**：**未落地**，只落了写入口。K=32 聚合缺读侧遮蔽计数基底，登记 **R-6**，随 PR-3（ReadContext / withhold）补
- **EA-4.5 / 4.6 生产接线**：`Kernel.gateSources()` + `Kernel.replayLedger(seq)`；存储触发器 `route_change_guarded`
  升到同一九字段判据（`SCHEMA_VERSION` 7→8）。剩余缺口（版本化归属）登记 **R-7**
- **EA-2.2 deny-by-default**：`appendLedger` 与 `NamespaceWriter.write()` 对 domain / mechanism / unregistered
  三类一律拒；机制名单 13 条与锚逐条相等（有断言钉住）
- **EA-1.2.3 / R-9**：`raw-record-declared` 由机制内部签发（`Kernel.declareRawIntake`，加入调用方事务、
  同事务写 records + ledger、重复 id 拒、`RPT-` 拒占、`unparseable` 不收口）；`RawIntakeCommandPort.declare()`
  为 Application 唯一具名入口；`RAW_INTAKE_PLUGIN` 删除（机制事件无可认领面）；锚翻 `planned:false`，`writeSites` 未扩
- **R-8**：生产代码零 `appendLedger` 调用方（有回归护栏测试）
- **R-9（部分）**：`CommandReceipt` / `DeclareRawIntakeCommand` / `RawIntakeCommandPort` 形状 + 实现 + 清单登记

## 4. 未满足项（**阻塞或待裁定，逐条**）

| # | 项 | 性质 |
|---|---|---|
| A | `Frozen-Face-Review: <日期> <批准人>` | **人工签署**，覆盖 PR-2 的 `src/kernel/**` 与计划并入的 CI 触发面 `.github/**` |
| B | ~~**R-3**：`raw-record-declared` 写点面~~ | **已关闭**（`5f2c12e`）：按人工裁定「方案 2 最小形态」落地——机制事件由 `Kernel.declareRawIntake` 内部签发，`RawIntakeCommandPort` 保留为应用唯一入口，`writeSites` 未扩、未造假写点；对账翻绿 |
| C | PR-1「有条件通过」条件 1 剩余项：改锚残余③④的**常驻架空间** | 未完成（规则层已封堵，无机验证据）|
| D | ~~PR-1 条件 2：自验升级为标题集合等值~~ | **已完成**（`6013572`）：冻结 29 条标题的集合等值；负例实测「删一条名 ⇒ exit 1、改名一条 ⇒ exit 1」；仍**不防有意弱化**（README 已注明）|
| E | **R-2**：`--commit` 在非默认工作树下的可疑静默放行 | 未闭合（附复现步骤）|
| E2 | **R-5**：PoC 实现根对账 2 红（范围性：锚 `writeSites` 指生产根）| 未闭合，待评审裁定 PoC 树是否需与生产根事件面同步 |
| E3 | **R-6**：EA-7.2 的 K=32 聚合无读侧计数基底 | 未闭合，随 PR-3 |
| E4 | **R-7**：复算的版本化归属未建（`ownerAt` 只答当前版本）| 未闭合，随 PR-6 |
| E5 | **R-8**：锚缺 name→axis 字段，机制轴表暂为机制自我陈述 | 未闭合，待锚补字段后降级为断言 |
| F | **R-1**：`SUBAGENT_ROUTING.md` G0 哈希不一致 | 既存红灯，需裁定（恢复 / 重锚 / 缓期）|
| G | PR-1 的 5 个已批准名保持 `planned:true` 至写点同批翻面 | 需确认是否接受 |
| H | **CI 从未在 `g2/*` 上真实运行过** | 触发面只投 `main`；与授权要求「每步真实 CI」冲突 |
| I | 独立审查席位模型路由 | 复核席自报 `deepseek-v4.1-flash`，偏离 `SUBAGENT_ROUTING` 的 glm-5.3 ⇒ 正式验收前需按路由重跑 |

## 5. PR-3 … PR-11

**未开工**。PR-8 按授权保持 **DEFERRED**。PR-2 已过两轮非作者独立复审（第一轮 6 条阻塞 →
第二轮 3 条已闭合、3 条部分；第三轮复审进行中），尚未取得「通过」裁决。

## 6. 边界声明

- 未合并 `main`、未发布、未进入 G3；
- 未实现 PR-8 / G3 域规则 / hostile Profile；
- 未决定 D-1 粒度与研究采纳政策；
- 未伪造任何 `Frozen-Face-Review` / `Event-Name-Review` 人工签署；
- 未整体并入 #48 / #49。

## 7. 下一步最小路径（建议）

1. 取得 PR-2 第三轮复审的「通过/有条件通过」裁决 → 转正式评审；
2. 由人给出 **A（Frozen-Face-Review）** → CI 才能在 `g2/*` 上真实运行（H）;
3. 裁定 **F（R-1）** 与 **G**；
4. 补完 C/D/E 后冻结 PR-1，进入 PR-3。

## 8. 当前状态（交接用）

- **目标未完成**：PR-3 … PR-11 未开工；PR-2 待第三轮复审裁决；三项人工签署/裁定未获得。
- 工作树干净；三条分支均已推送：`g2/pr-1` `6013572`、`g2/bootstrap` `a484322`、`g2/pr-2` `c6d932b`。
- 未创建任何发布 tag、未合并 `main`、未推送任何代表"完成"的标记。
- **下一会话建议起手顺序**：
  1. 读本文件 §4 的 A–I，先要来 **B（R-3 裁定）** 与 **A（`Frozen-Face-Review`）**；
  2. 按裁定落地 PR-2 最后一片（Port 已实现、清单已导出、锚未翻面 ⇒ 只差写成点与翻转同批）；
  3. 补 PR-1 条件 1 的③④常驻架空间与 R-2；
  4. 转 PR-2 正式评审 → 再开 PR-3。
- **不要**在未获 A 的情况下声称 PR-2 全门禁通过：CI 从未在 `g2/*` 上真实运行（§4-H）。

## 9. 本次会话的自我评估（供审查者参考，不作为交付声明）

- 交付了真实的机制改动（EA-3/EA-4/EA-7.1·7.2/R-8/R-9 部分），每步附生产测试与门禁实测。
- 也犯了可核查的错误：三次在重建/重构中丢失已修判据（已加集合等值断言防再犯）、两次误推分支、一次把「改锚判定」放宽到可洗白（由复核席抓出）。这些均已记录在案，未删除、未粉饰。
- 未做而声称要做的：PR-3+ 全部；PR-2 最后一片（因 R-3 需裁定）。
