# G2 实施进度账（逐步留痕）

> 依据用户 G2 授权：**每一步都要能回答**「改了什么 / 谁审的 / 门禁实测是什么 / 还有什么没满足 / 剩余风险」。
> 本文件是那本账；细节在 PR body 与提交信息里，这里只做**可追溯的索引与判定**。

## 0. 基线（不可混淆的两个 SHA）

| 项 | 值 | 判定 |
| --- | --- | --- |
| 冻结契约版本 | `fa3b892` | 内容不可变；后续提交只加授权/配置记录 |
| G2 开发起点 | `04c773a45a9b33f8d5b88ddc041dbd0446838c9d` | 由第一个 `g2/impl` 提交钉死；`git rev-parse g2/impl~1` 判定 |
| 开发分支 | `g2/impl`（集成分支）→ `g2/pr-N`（切片）| 不入 `main`，不发布 |

## 1. 已完成切片

### PR-1 机制事件名单锚文件 + 异源对账（甲类）

- 分支/PR：`g2/pr-1` → #50（Draft，base `g2/impl`）
- 关键提交：`b24954b`（锚文件物化，带 `Event-Name-Review:` trailer）、`c8482dc`（既存红灯登记）、`b8b5749`（审查修复）、`5757c05`（同内容在 `g2/bootstrap` 上为 `2565e5b`）（自查反攻口封堵，stacked 于 #51 暂存）
- 交付：`contracts/event-registry/EVENT-CONTRACT-LEDGER.json`（13 条目 / 12 批准）、`README.md`、`scripts/events-recon.mjs`（R1–R4 + 批准三要素 + 转发写点）、夹具 S 组翻三方（S1b 分组 / 新增 S1d / S1c 四方对齐）
- 门禁实测：`--self-test` 21/21 exit 0；`--impl-root experiments/...` exit 0；夹具 52 PASS/0 FAIL；`check:types` 19 条债务身份精确复现；`lint`/`build`/`docs:check` 0/0/OK；`pnpm test` 1 red（既存，见 `G2-KNOWN-REDS.md` R-1）
- 独立审查：第 1 轮 **不通过**（4 P1 + 6 P2）→ 全部修复并做成常驻架空形（现 22 条）→ 第 2 轮 **仍不通过**（3 P1 + 6 P2）→ 本轮修掉 3 个 P1 与 4 个 P2（见下），**余 2 个 P2 未修，已登记在案**
  - 已修验证：`--anchor` 接线（缺文件 exit 2，不再静默忽略）；批准只认**签名块内逐名出现**（修掉「文书里别处提到即算批准」）；R4 写点面扩到 `experiments/*/src/{kernel,storage-sqlite}`；R4 比顶层键与非 entries/approved 值；批准用 multiset 判增删（删1加1不再为 0）；批准追加与写点同提交 ⇒ 耦合红
  - 未修（下一轮）：①转发写点仍是文件级（一次哑元 `registry.lookup('占位')` 即覆盖全文件）；②`planned:true` 名未绑定契约块内逐名 gate（`gated_by` 仍是标签）
  - 审查席位路由偏差（如实登记）：本轮席位实际模型 `deepseek-v4.1-flash-1017`，与 `SUBAGENT_ROUTING.md`「权威审查 = glm-5.3」不符；**该结论不据此作废，但正式验收前需按路由重跑一次权威审查**

### Bootstrap 正式 Kernel 骨架（乙类第一步）

- 分支/PR：`g2/bootstrap` → #51（Draft，base `g2/impl`，**stacked on #50**）
- 关键提交：`7374059`（骨架 + 最小提交环测试）、`9d9bf61`（docs:sync）
- 交付：`src/kernel/**`、`src/contracts/index.ts`、`src/storage-sqlite/sqlite-port.ts`（逐文件迁移，差异仅 import 去扩展名 + 删 PoC 沙箱守卫）、`tsconfig.kernel.json`、`tests/helpers/kernel-harness.ts`（自足）、`tests/kernel-bootstrap.test.ts`（7 条）
- 门禁实测：`tsc -p tsconfig.kernel.json` 0；`check:types` 债务身份精确复现；`lint` 0；`build` 0；bootstrap 测试 7/7；`node scripts/events-recon.mjs`（**生产根**）exit 0（事实 7、转发写点 13 条均带核对）；`pnpm test` 1 red（同一既存红）
- 一处门禁作用域修正：`tests/store/tc-db-004.test.ts` 的 V1 表白名单排除 V3 目录 + **新增** `KERNEL_TABLES` 十一张表的独立精确钉（净覆盖不降）
- **未满足（待人工）**：CI 触发面（`.github/**` 是仓级 blocking 面）需 `Frozen-Face-Review: <日期> <批准人>`；按实施基线走「并入 PR-2 同批」

### PR-2 事件归属账全形 + 九字段授权上下文 + 全形闸（乙类）

- 分支/PR：`g2/pr-2` → **#52**（Draft，base `g2/bootstrap`，stacked on #51 → #50），tip `752088d`；**未请独立审查**（本 PR 明确未完成）
- 已落（commit `e697d70` + `752088d`）：
  - `EventOwnershipEntry`（EA-3.1 全形）+ `AuthorizationContext`（EA-4.2 九字段）
  - 装配期五字段缺一即红（EA-3.2 ③/EA-3.1）；`approval` 三要素校验；`retired` 名拒写
  - `appendAuthoritativeEvent` 入参字段集封闭（EA-4.3，`as unknown as` 面同拦）+ 九字段信封（txSeq=行序）
  - `src/kernel/authority-gate.ts`：`gateFullShape`（EA-4.5 三分，闸内无事件名清单）+ `replayAuthorityEvidence`（EA-4.6 三态）
  - `tests/kernel-event-authority.test.ts` **16/16**（装配期判据、九字段、入参封闭 8 字段、退役、半形、同源、三支、三态、闸门源码无名单）
- 门禁实测（tip `752088d`+1，全仓面）：`tsc -p tsconfig.kernel.json` 0；**`check:types` 19 条债务身份精确复现**（期间自查抓到 1 条新债 `TS2532` 并修掉：`Refusal.detail` 可为空）；`lint` 0；`build` 0（31 文件契约校验）；`docs:check` OK；bootstrap 7/7；**`pnpm test` 5105 passed，1 red = 既存 `eb1-canonical`**（登记 R-1，非本 PR 引入）；生产根 `events-recon` exit 0
- 自查发现并修正的三处**测试自身**缺陷（已记入提交信息）：半形负例被合并逻辑覆盖而全绿；把 `capability-admin` 当「挂错轴」（那是 route-audit 支）；domain 支误测 `authorized`
- 未落（PR-2 剩余）：`appendLedger` 收敛为机制内部原语 + `synth:raw-intake` 注册与端口改道（**必须同一提交**）；`integrity-audit-recorded` / `read-shadow-recorded` 落地 + 非 oracle 断言；`app/intake-use-case.ts` / `domains/test-records.ts` 迁移
- 未满足：`Frozen-Face-Review`（人工）；CI 触发面仍只投 `main`

## 3. 未开工（按授权序列）

PR-2（进入门禁已核：`G1-EVT-01` = done、`G1-AUDIT-01` = open 但 owner 非 UNASSIGNED；两名新名的批准已在锚文件 + trailer 在位）→ PR-3 → PR-4 → PR-5 → PR-6 → PR-6b → PR-7 → PR-9 → PR-10 → PR-11。**PR-8 保持 DEFERRED。**

## 4. 待用户裁定的批（攒成一批问，不逐步打扰）

1. **`Frozen-Face-Review` 人工标记**：PR-2 起每个命中冻结面的 PR 都需要；首个是 PR-2（含 CI 触发面）。
2. **既存红灯 R-1 的处置**（`SUBAGENT_ROUTING.md` G0 哈希不符）：恢复文件 / 重锚台账 / 暂不处理——三条路都要用户裁决，实现者不自选。
3. 是否接受 PR-1 与批准文书 §4.1 的偏离（5 名保持 `planned:true` 直到代码落地，见 `contracts/event-registry/README.md` §5）。

## 5. 剩余风险（当前）

- 迁移是把 PoC 的 Kernel 面整体搬进 `src/`，**并发/崩溃恢复/同键竞态/跨域具名命令事务**尚未在正式面重做（归 PR-4/PR-5/PR-6b）。
- `src/contracts/index.ts` 的 `RefusalCode` 与 V1 既有拒绝码尚无交集说明（PR-2 处理）。
- 对账脚本的事实集是**静态**判定：运行期兜底仍靠 EA 的 deny-by-default 写面（PR-2），二者不可互相替代。
