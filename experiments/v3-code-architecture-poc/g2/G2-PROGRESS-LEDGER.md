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
- 关键提交：`b24954b`（锚文件物化，带 `Event-Name-Review:` trailer）、`c8482dc`（既存红灯登记）、`b8b5749`（审查修复）、`2565e5b`（自查反攻口封堵，stacked 于 #51 暂存）
- 交付：`contracts/event-registry/EVENT-CONTRACT-LEDGER.json`（13 条目 / 12 批准）、`README.md`、`scripts/events-recon.mjs`（R1–R4 + 批准三要素 + 转发写点）、夹具 S 组翻三方（S1b 分组 / 新增 S1d / S1c 四方对齐）
- 门禁实测：`--self-test` 21/21 exit 0；`--impl-root experiments/...` exit 0；夹具 52 PASS/0 FAIL；`check:types` 19 条债务身份精确复现；`lint`/`build`/`docs:check` 0/0/OK；`pnpm test` 1 red（既存，见 `G2-KNOWN-REDS.md` R-1）
- 独立审查：第 1 轮 **不通过**（4 P1 + 6 P2，附实测绕过形）→ 全部修复并做成常驻架空形 → 第 2 轮待回

### Bootstrap 正式 Kernel 骨架（乙类第一步）

- 分支/PR：`g2/bootstrap` → #51（Draft，base `g2/impl`，**stacked on #50**）
- 关键提交：`7374059`（骨架 + 最小提交环测试）、`9d9bf61`（docs:sync）
- 交付：`src/kernel/**`、`src/contracts/index.ts`、`src/storage-sqlite/sqlite-port.ts`（逐文件迁移，差异仅 import 去扩展名 + 删 PoC 沙箱守卫）、`tsconfig.kernel.json`、`tests/helpers/kernel-harness.ts`（自足）、`tests/kernel-bootstrap.test.ts`（7 条）
- 门禁实测：`tsc -p tsconfig.kernel.json` 0；`check:types` 债务身份精确复现；`lint` 0；`build` 0；bootstrap 测试 7/7；`node scripts/events-recon.mjs`（**生产根**）exit 0（事实 7、转发写点 13 条均带核对）；`pnpm test` 1 red（同一既存红）
- 一处门禁作用域修正：`tests/store/tc-db-004.test.ts` 的 V1 表白名单排除 V3 目录 + **新增** `KERNEL_TABLES` 十一张表的独立精确钉（净覆盖不降）
- **未满足（待人工）**：CI 触发面（`.github/**` 是仓级 blocking 面）需 `Frozen-Face-Review: <日期> <批准人>`；按实施基线走「并入 PR-2 同批」

## 2. 未开工（按授权序列）

PR-2（进入门禁已核：`G1-EVT-01` = done、`G1-AUDIT-01` = open 但 owner 非 UNASSIGNED；两名新名的批准已在锚文件 + trailer 在位）→ PR-3 → PR-4 → PR-5 → PR-6 → PR-6b → PR-7 → PR-9 → PR-10 → PR-11。**PR-8 保持 DEFERRED。**

## 3. 待用户裁定的批（攒成一批问，不逐步打扰）

1. **`Frozen-Face-Review` 人工标记**：PR-2 起每个命中冻结面的 PR 都需要；首个是 PR-2（含 CI 触发面）。
2. **既存红灯 R-1 的处置**（`SUBAGENT_ROUTING.md` G0 哈希不符）：恢复文件 / 重锚台账 / 暂不处理——三条路都要用户裁决，实现者不自选。
3. 是否接受 PR-1 与批准文书 §4.1 的偏离（5 名保持 `planned:true` 直到代码落地，见 `contracts/event-registry/README.md` §5）。

## 4. 剩余风险（当前）

- 迁移是把 PoC 的 Kernel 面整体搬进 `src/`，**并发/崩溃恢复/同键竞态/跨域具名命令事务**尚未在正式面重做（归 PR-4/PR-5/PR-6b）。
- `src/contracts/index.ts` 的 `RefusalCode` 与 V1 既有拒绝码尚无交集说明（PR-2 处理）。
- 对账脚本的事实集是**静态**判定：运行期兜底仍靠 EA 的 deny-by-default 写面（PR-2），二者不可互相替代。
