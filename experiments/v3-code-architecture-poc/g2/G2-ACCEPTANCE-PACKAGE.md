# G2 统一人工验收包（候选交付，2026-11-04）

> 状态：**候选交付 / 未完成全部 PR**。本包只陈述**已实测的事实**与**未满足项**，
> 不声称 G2 完成、不声称可发布、不含任何代替人工签署的标记。

## 1. 候选分支与 SHA

| 分支 | tip | PR | 内容 |
|---|---|---|---|
| `g2/impl` | `ac6f3d6` | 基底（非发布路径） | G2 开发起点 |
| `g2/pr-1` | `6013572` | **#50**（Draft） | 甲类：锚文件 + `events-recon.mjs` + 夹具；`src/**`、`tests/**` 为零 |
| `g2/bootstrap` | `1ed9c60` | **#51**（Draft，stacked on #50） | Bootstrap Gate |
| `g2/pr-2` | `4f7572c` | **#52**（Draft，stacked on #51） | 乙类：EA-3 / EA-4 / EA-7.1·7.2 / R-8 / 记录域 Port |

合并顺序：50 → 51 → 52。**均未合并 `main`。**

## 2. 已实测的门禁（各分支最新 tip）

| 门禁 | 结果 |
|---|---|
| `check:types` | 19 条债务**身份**精确复现（不是计数匹配）|
| `lint` / `check-imports` | 0 |
| `build` + `check:freshness` | 0（31 个 canonical 文件 sha256 双向校验）|
| `docs:check` | OK |
| `pnpm test`（PR-2 tip） | **5108 passed / 1 red** |
| 唯一红灯 | `tests/engineering/eb1-canonical.test.ts` = 既存 **R-1**（起点 `04c773a` 同红，非本次引入）|
| `tsc -p tsconfig.kernel.json` | 0 |
| `events-recon` 生产根 | exit 0（期望 13 / 事实 9 / planned 4）|
| `events-recon --self-test` | **29/29** |
| 逐提交门禁（PR-1 历史） | 4/4 PASS |
| 冻结夹具 | 52 PASS / 0 FAIL |
| `kernel-event-authority` | 20/20 |
| `kernel-bootstrap` | 7/7 |
| `contracts-raw-intake-port` | 8/8 |

## 3. 已落地的机制（PR-2）

- **EA-3**：`EventOwnershipEntry` 全形 + 装配期五字段判据（缺一即 `ACTIVATION_IMPOSSIBLE`）+ 机制名不可被清单认领
- **EA-4**：九字段 `AuthorizationContext` 信封、入参字段集封闭（8 个见证字段全拒）、`gateFullShape` 三分支（**闸内无事件名清单**）、`replayAuthorityEvidence` 三态
- **EA-7.1 / 7.2**：`Kernel.recordMechanismAudit` 落地；回声只回 `{seq}`（EA-7.4 非 oracle）；入参 `hiddenBy*` 丢弃；两名字先进预留集、后翻 `planned:false`
- **R-8**：生产代码零 `appendLedger` 调用方（有回归护栏测试）
- **R-9（部分）**：`CommandReceipt` / `DeclareRawIntakeCommand` / `RawIntakeCommandPort` 形状 + 实现 + 清单登记

## 4. 未满足项（**阻塞或待裁定，逐条**）

| # | 项 | 性质 |
|---|---|---|
| A | `Frozen-Face-Review: <日期> <批准人>` | **人工签署**，覆盖 PR-2 的 `src/kernel/**` 与计划并入的 CI 触发面 `.github/**` |
| B | **R-3**：`raw-record-declared` 写点面（扩 `writeSites` / kernel 原语 / 装配期注入）| **需裁定**：G1 冻结文本内部张力，实施者不得私自选择 |
| C | PR-1「有条件通过」条件 1 剩余项：改锚残余③④的**常驻架空间** | 未完成（规则层已封堵，无机验证据）|
| D | ~~PR-1 条件 2：自验升级为标题集合等值~~ | **已完成**（`6013572`）：冻结 29 条标题的集合等值；负例实测「删一条名 ⇒ exit 1、改名一条 ⇒ exit 1」；仍**不防有意弱化**（README 已注明）|
| E | **R-2**：`--commit` 在非默认工作树下的可疑静默放行 | 未闭合（附复现步骤）|
| F | **R-1**：`SUBAGENT_ROUTING.md` G0 哈希不一致 | 既存红灯，需裁定（恢复 / 重锚 / 缓期）|
| G | PR-1 的 5 个已批准名保持 `planned:true` 至写点同批翻面 | 需确认是否接受 |
| H | **CI 从未在 `g2/*` 上真实运行过** | 触发面只投 `main`；与授权要求「每步真实 CI」冲突 |
| I | 独立审查席位模型路由 | 复核席自报 `deepseek-v4.1-flash`，偏离 `SUBAGENT_ROUTING` 的 glm-5.3 ⇒ 正式验收前需按路由重跑 |

## 5. PR-3 … PR-11

**未开工**。PR-8 按授权保持 **DEFERRED**。本会话的可用上下文不足以按「每 PR 真实测试 + 独立审查」的节奏推进到这些 PR；继续推进需要新的会话轮次。

## 6. 边界声明

- 未合并 `main`、未发布、未进入 G3；
- 未实现 PR-8 / G3 域规则 / hostile Profile；
- 未决定 D-1 粒度与研究采纳政策；
- 未伪造任何 `Frozen-Face-Review` / `Event-Name-Review` 人工签署；
- 未整体并入 #48 / #49。

## 7. 下一步最小路径（建议）

1. 裁定 **B（R-3）** → 落地 PR-2 最后一片 → 请独立席复核 → 转正式评审；
2. 由人给出 **A（Frozen-Face-Review）** → CI 才能在 `g2/*` 上真实运行（H）;
3. 裁定 **F（R-1）** 与 **G**；
4. 补完 C/D/E 后冻结 PR-1，进入 PR-3。

## 8. 会话结束时的状态（第 40/40 轮，交接用）

- **目标未完成**：PR-3 … PR-11 未开工；PR-2 最后一片被 **R-3** 阻塞；三项人工签署/裁定未获得。
- 工作树干净；三条分支均已推送：`g2/pr-1` `6013572`、`g2/bootstrap` `1ed9c60`、`g2/pr-2` `4f7572c`。
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
