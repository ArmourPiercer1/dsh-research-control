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

- 分支/PR：`g2/pr-2` → **#52**（Draft，base `g2/bootstrap`，stacked on #51 → #50），tip `d1cf014`；**已过三轮非作者独立复审**（见 §2.1）
- 已落（commit `e697d70` + `c6d932b`）：
  - `EventOwnershipEntry`（EA-3.1 全形）+ `AuthorizationContext`（EA-4.2 九字段）
  - 装配期五字段缺一即红（EA-3.2 ③/EA-3.1）；`approval` 三要素校验；`retired` 名拒写
  - `appendAuthoritativeEvent` 入参字段集封闭（EA-4.3，`as unknown as` 面同拦）+ 九字段信封（txSeq=行序）
  - `src/kernel/authority-gate.ts`：`gateFullShape`（EA-4.5 三分，闸内无事件名清单）+ `replayAuthorityEvidence`（EA-4.6 三态）
  - `tests/kernel-event-authority.test.ts` **16/16**（装配期判据、九字段、入参封闭 8 字段、退役、半形、同源、三支、三态、闸门源码无名单）
- 门禁实测（tip `c6d932b`+1，全仓面）：`tsc -p tsconfig.kernel.json` 0；**`check:types` 19 条债务身份精确复现**（期间自查抓到 1 条新债 `TS2532` 并修掉：`Refusal.detail` 可为空）；`lint` 0；`build` 0（31 文件契约校验）；`docs:check` OK；bootstrap 7/7；**`pnpm test` 5105 passed，1 red = 既存 `eb1-canonical`**（登记 R-1，非本 PR 引入）；生产根 `events-recon` exit 0
- 自查发现并修正的三处**测试自身**缺陷（已记入提交信息）：半形负例被合并逻辑覆盖而全绿；把 `capability-admin` 当「挂错轴」（那是 route-audit 支）；domain 支误测 `authorized`
- 已落（续，同一分支后续提交）：
  - `a97bc39` EA-7.4 非 oracle 判据 `findNonOracleViolations`（递归含数组、深度 32、容忍循环引用；判据是**前缀**非子串）+ 5 例测试
  - `226d31f` 通用台账通道对预留名的拒写**实测证据**（先前版断言前提有误：`facet-mounted`/EA-7 名字当时并未登记/预留；改正后只断言真正预留的名字）
  - `7bd0950` EA-7.1/7.2 名字**先入预留集**：批准已到位、写点未落地是最危险窗口（通用通道若能写，space-write 主体可 mint 审计行）
  - `dffafa1` EA-7.1/7.2 **落地**：`Kernel.recordMechanismAudit`（只受两名字、运行期复核、字面量写点、走廊 `capability-admin`）+ 回声只回 `{seq}` + 入参 `hiddenBy*` 丢弃 + 锚两条目翻 `planned:false`
- PR-2 门禁实测（`dffafa1`）：kernel-event-authority **19/19**；bootstrap 7/7；`tsc -p tsconfig.kernel.json` 0；`check:types` **19 条身份精确复现**；`lint` 0；全仓 **5108 passed / 1 red**（既存 eb1-canonical，R-1）；生产根 recon **exit 0**（期望 13 / 事实 9 / planned 4）
- 已落（R-3 闭合，`5f2c12e` / `5882c7d` / `1268c1f`）：`raw-record-declared` 收归**机制签发**
  （`MECHANISM_OWNED_EVENT_TYPES` + `Kernel.declareRawIntake`，加入调用方事务、字面量写点、
  同事务先 records 后 ledger、重复 id 拒、`RPT-` 拒占、`unparseable` 不拒收）；`RawIntakeCommandPort.declare()`
  保留为 Application 唯一具名入口并转调机制；回执改 `{recordId, witnessSeq}`（不伪造 oid）；
  `RAW_INTAKE_PLUGIN` 删除（机制事件无可认领面）；`writeSites` 未改，翻 `planned:false` 后对账自然转绿。
  PoC 树同步：用例改经端口、`D-19c-ALLOWED` 标记制退役（门禁反向：留标记即红）、`KERNEL_SURFACE` 显式重生成。
- 已落（R-8）：生产代码零 `appendLedger` 调用方 + 回归护栏测试（`0c6e2ca`）。
- 门禁实测（`1268c1f`）：contracts-raw-intake-port **11/11**；event-authority 20/20；bootstrap 7/7；
  tsc 0；check:types 19 条身份复现；lint 0；build 0；docs:check OK；**5120 passed / 1 red**（R-1）；
  生产根对账 exit 0（期望 13 / 事实 10 / planned 3）；自验 29/29。
  PoC 套件 33 failed / 325 passed —— 与起点 `origin/g2/impl` **失败集完全相同**（未引入新红）。
- **独立复审（三轮，非作者席位，逐轮裁决）**：

  | 轮 | 范围 | 裁决 | 未闭合项 |
  |---|---|---|---|
  | 1 | `a484322..1268c1f` | **不通过**（6 条阻塞）| B-4 旁路、记录身份第二入口、九字段/全形闸接线、EA-7 接线、approval 可选、deny-by-default 缺失 |
  | 2 | `..97a0056` | **不通过** | 1/2/5 闭合；3、6 未闭合；新增 P1：`write()` 可 mint 机制名 |
  | 3 | `..d1cf014` | **有条件通过** | 6 与 3a/3c 闭合；余 R-9（契约分歧）、R-10（`trigger:'open'` 无路径）与 P3 级清理 |

  处置落地：`8560bfa`（B-4 / deny-by-default / 九字段 / EA-7.1）、`c6d932b`（`write()` 收死、机制名单补全到
  13 条、`gateSources()`/`replayLedger()` 生产接线、迁移行信封、软幽灵指纹、巡检入事务）、`d1cf014`
  （facet 轴按 FM-7 修正 + `facet-mount` 入机制资源、巡检 join 分支同授权判据、迁移器用共享版本常量并补
  端到端回归、`write()` 恒拒回归钉、重复名单/泄漏面清理）。
- 门禁实测（`d1cf014`）：production **5129 passed / 1 red**（R-1）；`kernel-event-authority` 28/28；
  `contracts-raw-intake-port` 12/12；`kernel-bootstrap` 7/7；tsc 0；check:types 19 条身份复现；lint 0；
  build 0（31 canonical）；docs:check OK；生产根 recon exit 0（13/10/3）+ 自验 29/29。
- 未闭合（登记于 `G2-KNOWN-REDS.md`）：**R-5**（PoC 实现根对账 2 红，范围性）、**R-6**（EA-7.2 K=32 聚合无读侧基底 → PR-3）、
  **R-7**（版本化归属 + 历史冻结版本集未建 → PR-6）、**R-8**（轴值无锚来源，`facet-mount` 已按 FM-7 修正）、
  **R-9**（`write()` 恒拒使 D-24 合法 Facet 挂载面不可达 = 契约分歧，需 `Frozen-Face-Review` 覆盖或改 §16.1）、
  **R-10**（`auditRequiredIntegrity` 无生产调用方 → PR-5）、**R-11**（闸不防裸面改写，既定边界）；人工 `Frozen-Face-Review`
- **剩余项的真实性质（读契约后确认，非“改道”而是“新建”）**：`synth:raw-intake` 与
  `RawIntakeCommandPort` 在当前树中**完全不存在**（`grep -rn "raw-intake\|RawIntake" src tests` 零命中）。
  契约文本已给出形状（`G1-CONTRACT-DOMAIN-COMMAND.md` §DC-PORT）：
  `declare(tx, cmd: DeclareRawIntakeCommand): CommandReceipt`，命令判别式 `'test.records:declareRawIntake'`，
  内部 = 拥有者自己的 `appendAuthoritativeEvent`（不是 `appendLedger`）；`D-19c-ALLOWED` 标记制随之退役。
  因此这一片需要：①新领域包的清单（`ownsEventTypes` 登记 `raw-record-declared`，该名已在批准集内、仍 `planned:true`）；
  ②Port 实现 + 装配根注入；③与 deny-by-default 翻转**同一提交**；④用例迁移。
  缺任何一项都是半扇门（注册了没改道 / 改道了没注册 / 翻转了没写点），故必须整片一次落地。
- 新增登记项：`G2-KNOWN-REDS.md` **R-2**（`--commit` 在非默认工作树下可疑静默放行，附复现步骤，未闭合）
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
