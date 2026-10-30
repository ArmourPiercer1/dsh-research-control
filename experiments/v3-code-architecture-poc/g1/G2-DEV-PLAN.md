# G2 正式开发计划 —— 按契约依赖排出的可执行顺序（不是愿望清单）

> **性质**：G1 阶段 3 交付物 6。**本计划不是开工许可**：G2 的进入条件 = `g1-checklist-validate.mjs
> --require-clear` exit 0 **+ 用户授权**（`G1-ADJUDICATION-TABLE.md §4.2` 项 3）。第七轮裁定现行口径：
> **G0-R 限定范围 PASS；G1 立即冻结 = NO-GO；G2 = NO-GO；PR #48 不合并**（`G0-R-CLOSURE.md:14-18`，
> 实测清单计数 27/open 23 ⇒ `--require-clear` exit 1）。本计划的作用是：**让「解除 NO-GO」之后
> 的第一周就有可执行的命令与可判定的退出门禁**，而不是届时再排。
> **配套**：条款级验收与缺口见《G1-ACCEPTANCE-MATRIX.md》（下称矩阵），本文用「矩阵 §x 行」引用它。
> **禁改面**：本计划不改 `experiments/v3-code-architecture-poc/**` 的夹具与门禁脚本本体（见 §5 禁止项）。
> **锚点纪律 / 行号漂移限定（P2-3，2026-11-01 工程审查；形照矩阵头注同款免责段）**：本文引用他文时
> 以「**文件 + 小节名 + 判据文字**」为准，`:nnn` 行号只是辅助注且**默认已漂移**（实测两次：EA
> 「不留豁免窗」句曾标 `:577-578`、审查时实测 `:694`；「夹具世界迁移登记」曾标 `:613`、实测 `:728`）——
> 判据文字优先于行号；本文自身被改动后，他文引用本文的行号同样按此纪律处理。新写引用一律不带裸行号。

---

## 0. 排期的三条硬事实（先于任何顺序）

1. **契约已给出的顺序是物理依赖，不是偏好**：`RL-3.4` 的迁移联动接口**旧句已按 R-3 改写**（旧作
   「`RELOCATABLE_NS_KEYS` 把『Facet 挂载/扩展表并入同一重定位事务』定义为 A 节落地时的唯一迁移联动接口」，
   `G1-CONTRACT-RECONCILIATION.md` R-3 作废该句）——现行接口是**类别谓词**：按「该表**物理有无 `ns`
   位置列**」逐项归位；挂载登记表 `facet_mount` 无 ns 列（判据输入 = 逻辑 `(facetCapability, targetOid)`）
   ⇒ **不入清单、零搬迁**；扩展记录行（A2 现形，物理住属主 ns）随 `domain_state` 条目搬走。而 `FM-9`
   的两个挂载名与 `RL-2.2` 的 `ns-relocated` 都要走 `EA-2.4` 六步入账 ⇒ **事件权威层先行是结构要求**，
   先做 Facet 会造出一个「挂载 Port 装配红 forever」的中间态（`ACTIVATION_IMPOSSIBLE`，FM-7）。
2. **真实 DDL 只能出现在冻结之后**：`IMPLEMENTATION-PLAN-DRAFT.md §2-G1`「未完成时禁止启动」原文
   —— 禁止 G2 的真实 DDL、`capability_route` 演进、Schema 迁移器（会基于错误的时间/所有权模型固化）。
   因此本文把**所有动表形的 PR 排到 §3 的第 5 位之后**，前四位只动判据与装配。
3. **无 CI ⇒ 每个 PR 的退出门禁必须是本地可复跑命令**：`G0-R-CLOSURE.md §5` 明示「所有绿灯均无 CI 背书，
   不构成 CI 验收」。故 §4 的门禁全部写成「命令 + 期望退出码」，且**新/改门禁必须自带架空式变异**
   （`IMPLEMENTATION-PLAN-DRAFT.md §7` 流程规则：不贴红色输出不算完成）。

---

## 1. 依赖图（文本表；`←` = 被依赖，行内给依赖的具体理由与条款锚）

| # | 工作块 | 依赖前序 | 为什么不能换序（条款锚） | 冻结面变更？ |
| --- | --- | --- | --- | --- |
| W1 | **机制事件封闭名单 + 锚文件 + 异源对账 R1–R4** | — | 名单是所有写面判据的输入；`EA-6.1` 把锚文件物化登记为「实施批首项」，`EA-6.2 R3` 要求期望集**只**来自锚文件（禁从 `SCHEMA`/`REQUIRED_TRIGGERS`/写点模块取） | 否（新增侧车文件）；若名单文档进 8 根文档则触发（用户决策 4） |
| W2 | **Event Ownership 归属账（扩 `ownsEventTypes`）+ 唯一签发 Port + 全形信封 + 审计复算** | W1 | `EA-3.2` 判据②要拿归属账比机制名单；`EA-4.5 gateFullShape` 的 owner 复算要 `ownershipOwnerAt(...)`（`EA-4.5` 末项） | **是**（权限与持久化格式 + 事件不变量 ⇒ `Frozen-Face-Review`） |
| W3 | **身份文法 + SpaceContext 强制 + 存在性呈现（refuse vs withhold）+ 保留前缀全集** | W2（前缀与拒绝码封闭集纪律同源） | `D1-a` 已裁「标识不编码空间」，但 `RECORD_ID_RESERVED`/保留前缀全集归 `G1-LINK-01`；`E-01` 的 withhold 裁定（`G1-READ-02`）决定读面形状，晚做会把 oracle 形态编进工具面（`D6-b` ②） | 否（`src/**` 内部），但**权限面** ⇒ 投票面命中 ⇒ `Frozen-Face-Review` |
| W4 | **双时间三概念分离 + `recorded_as_of → CommitSequence` 两分支映射 + 分页游标自包含** | W2、W3（游标要冻结的可见性谓词） | `G1-TIME-01/02`（清单 open）+ `D2-a/b`；`#47 T-GAP-13`「同一毫秒可多次提交 ⇒ 时间戳不能充当事务快照边界」；`D-5` 现状把 `recordedAt` 与 `seq` 当同一数两个名字 | 否（内部），`records` 表加列 ⇒ 若动 `schema/**` 则**是** |
| W5 | **四层版本轴 + `storage_schema_version` 登记 + 打开判据序（含触发器体摘要外置）+ TransactionLease** | W1–W4 | `RL-9.1` 层界表 + `RL-8.1` 打开序（步 2 需触发器新体 ⇒ 与 W8 的触发器改造同批）；`G1-STORAGE-01/02`（open）；`D3-b` 并存三规则 | **是**（`schema/**` + DDL 形）⇒ `snapshot:update` + `Frozen-Face-Review` |
| W6 | **检查器降级三形 + 报告绑定四要素 + 对外 Check Request 形态** | W2（报告签发资格 = 归属账 + 机制取证）、W4（回显实际生效截点） | `D4-a/b/c`：视图恒空 ⇒ `ACHIEVED+COMPLETE`（N-1）与视图抛异常 ⇒ 不落报告（N-3）都是缺陷；「三态齐备 ≠ 校验生效」（`D4-d`）⇒ 降级标注与巡检计数是**两个独立面** | 否 |
| W7 | **Facet 双身份 + 挂载登记 + 两个 planned 名入账** | W1、W2、W5（表形与打开判据） | `FM-2.5` 的 `facet_mount` 表 + `facet_mount_insert_guarded` 触发器 + 「打开期判据…随 `SCHEMA_VERSION` 推进与 `G1-STORAGE-02` 期望摘要外置**同批**」；`FM-9` 未入账期间装配红 fail-closed | **是** ⇒ `snapshot:update` + `Frozen-Face-Review` |
| W8 | **物理重定位（账/门/切换/触发器改造）+ 恢复条件 + 打开期漂移检测与修复流** | W1、W2、W5、W7（挂载账落地先后可核**双向**清单判据；R-3：挂载表**不入** `RELOCATABLE_NS_KEYS`，扩展记录行随 `domain_state` 搬） | `RL-3.4`（R-3 改写形：联动接口 = 「物理有无 `ns` 位置列」类别谓词逐项归位，**非**表名点入）；`RL-6.4` 构建期**双向**扫描以清单为全量原子性前提；`RL-5.2` 触发器改造「随 `SCHEMA_VERSION` 推进 + `REQUIRED_TRIGGERS` 摘要重登 + 打开判据同批」 | **是** ⇒ `snapshot:update` + `Frozen-Face-Review` |
| W9 | **工具与宿主接口冒烟（真实 DSH Adapter 最小身份/权限/Capability）+ 只读工具四硬约束** | W2、W3、W6 | `IMPLEMENTATION-PLAN-DRAFT.md §2-G2 收窄②` 把真实 Adapter 最小冒烟**提前到 G2**，理由原文：「装配根注入 principal ≠ 宿主身份真实性」必须在机制层就撞一次；`D6-b` 四条硬约束依赖 W3 的呈现裁定 | 新工具名 ⇒ **是**（`ARCHITECTURE.md` §7.2 冻结清单 + `tests/tools/permissions.test.ts` 同步，`D6-a`；**同一提交并跑 `pnpm run snapshot:update`**——P2-1 补记，§7.2 在哈希冻结面内） |
| W10 | **纵向切片（G2 收尾，非并行加速）**：`Raw Intake → Entity 登记 → 有来源的 Association → PropositionRevision → S-L1 CheckReport → 历史读取` | W1–W6 | `§6.1′` 原文理由：D-19 正是「机制接口全绿但领域对象无法不绕过接口实现」的现实例子，串行到 G3 才发现就是把这个教训再买一次单 | 否 |

**图的一句话读法**：`W1 → W2 → W3 → W4 → W5 → {W6 ∥ W7} → W8 → W9 → W10`。
`W6 ∥ W7` 是**仅有的**一处可并行带，互斥点见 §3。旧句「`W3 ∥ W4`、`W6 ∥ W7` 是仅有的两处可并行带」
作废（P2-2 串行修正，2026-11-01 工程审查）：本表 W4 行的「依赖前序」栏自己写着 **W2、W3**
（游标要 PR-3 冻结的可见性谓词），「W3 ∥ W4」与本图的依赖边**直接冲突**——按旧句排期恰好会把
「把 oracle 形态编进工具面」（W4 行自陈的理由、`D6-b` ②/`E-01` 教训）变成现实。串行原因全文见 §3.2。

---

## 2. 首批 PR 拆分（11 个：PR-0 + PR-1..PR-10；每个都可独立评审、可判定退出）

> **对「建议 6–10 个」的偏离说明（一条）**：实际给 11 个，多出的是 **PR-0（门禁身份前置）**。不把它并进功能 PR 的理由：`G1-GATE-01` 的三条洗白链（GT-2/GT-3/GT-4）修的是**尺子**，与功能改动同 PR 会让「尺子变了」和「行为变了」两件事在同一次绿里混在一起说不清 —— 这正是 G0-R 第七轮点名的失效形态。功能 PR 本身是 10 个，落在建议区间内。

**通用退出门禁（每个 PR 都必须全绿，下文不再重复）**：

> **退出门禁铁律（写死，2026-11-01 工程审查 P1-3 / 台账 R-9）**：任一 PR 的退出 = **该 PR 落地后**
> `g0-gate.mjs` **仍 exit 0**，**且作者套件（`tests/**`）无新红**——当前锚定计数 **225 例全绿 +
> 身份锚四项逐等 + skip=0**（`AUTHOR_ANCHOR.json`，225/225；2026-11-01 实测，测试增删后随
> §4.2 流程重锚，**不变式是「0 红是硬条件」+ passed_sha256/files_sha256 名集逐等**——g0-gate
> 原文「作者测试门（tests/**，0 红是硬条件）」）。「中间态红」的
> 正确修法是**把该红所要求的合规落点提前进本 PR**（PR-2 的 `synth:raw-intake` 即此形，见 R-9），
> **禁止用「改测试让它接受拒写」消缝**——`tests/p3-intake-validation.test.ts` 钉住的 Raw Intake
> 容错（解析失败也留来源、登记必落账，Q37/B-1/`EA-1.3a`）不允许任何 PR 把「落账失败」改成预期
> 行为；那只会把违例从代码面搬进测试面，比不修更糟。

```sh
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs            # 结构+语义：本席位实测 exit 0；R-9 轮复跑仍 0（锚点真值段在位，见校验器头注 P1-2）
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs  # 51 PASS / 0 FAIL，exit 0（领域复审轮复跑值；沿革 35→48→51）
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET.fixtures.mjs           # 35 PASS / 0 FAIL，exit 0（复跑值；旧基线 29）
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs      # 60 PASS / 0 FAIL，exit 0（R-8 轮复跑值：+T-N22/S16/MUT-11；沿革 42→57→60）
node experiments/v3-code-architecture-poc/g0-gate.mjs                          # 三条流逐等：本席位实测 exit 0
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json                   # 本席位实测 exit 0（零诊断）
pnpm run check:types                                                            # 本席位实测 exit 0，但输出自带限定：
                                                                                #   「known-failing debt reproduced EXACTLY
                                                                                #    (19 diagnostics; identity match, not count
                                                                                #    match) — this is NOT a clean typecheck」
                                                                                #   ⇒ 绿 ≠ 类型干净，只等于「已知债逐条同一」
pnpm run lint                                                                   # check-imports：本席位实测 exit 0
pnpm run docs:check                                                             # 期望 exit 0（只在提交态可信，§4.3）
```

### PR-0 `gate: 基线身份与重锚纪律机械防线`（**解除 NO-GO 后第一个 PR**）

- **范围**：把 `G0-R-CLOSURE.md §7` 三条洗白链的机械防线落进门禁 —— ① `attacks/**` 基线逐条记
  `failureMessages[0]` 摘要（GT-2）；② 基线由门禁在**干净 worktree** 重算并锚定「被收集文件清单哈希」
  （GT-3 / G-3′）；③ `reanchored_by` + `delta_sha` 双标记与名集增删 diff 高亮（GT-4 洗白链）；
  ④ 根 `vitest.config.ts` 加 `exclude: '.scratch/**'` **并配收集面负例**（`IMPLEMENTATION-PLAN-DRAFT.md §7`
  登记的同一失效模式）。
- **不做什么**：不改任何产品判据；不动 `src/**`；不接 GitHub CI（CI 归属见 §6 余项）；不把「审查方红条」洗成绿。
- **进入门禁**：`node …/g0-gate.mjs` ⇒ exit 0（当前实测 0）；`node …/g1-checklist-validate.mjs --self-test` ⇒ exit 0（R-9 轮复跑实测 0，21/21——P1-2 修复新增锚点真值族 M18–M21；旧注「17/17」为修复前实测，作废改此句）。
- **退出门禁**：`g0-gate.mjs` exit 0；**新增三条各自的架空式变异实测退出码非 0**（形态见 §4.1，逐条贴红）；
  `pnpm test` exit 0 且收集结果不含 `.scratch/` 路径（负例断言）。
- **验收测试要求**：GT-2/GT-3/GT-4 各一条「改断言体/删测试/改一字节注释 ⇒ 门禁必红」的常驻测试；
  收集面负例一条。**基线与身份锚必须在新干净 worktree 内重生成，并记录外部身份**（§4.2）。
- **依赖前序**：无。
- **冻结面**：否。
- **为什么第一位**：GT-2/GT-3/GT-4 与「覆盖面进基线流程位」的去向**全是 `G1-GATE-01`**（实测 status: open）。
  不先修尺子，后面每个 PR 的「基线逐等」都是未锚定主张 —— 而 Q45 护栏（FM 契约的生命线）正是靠基线逐等来
  持续否证的（矩阵 §2 FM-3.2 行的缺口）。

### PR-1 `events: 机制事件封闭名单锚文件 + 异源对账构建判据（R1–R4）`

- **范围**：物化 `g1/EVENT-CONTRACT-LEDGER.json`（形状按 `EA-6.1`：`schemaVersion/approved[]/entries[]`，
  含 `writeSites` glob、`planned`、`gated_by`、`interpretationRuleSetVersion`）；**名单内容按 R-5 后的新形状写
  （2026-11-01 回填；旧句「首批 10 个 mechanism 名 + ns-relocated/facet-mounted/facet-unlinked 三名 planned
  占位」作废——它把三个提案未入账名算进了已批准面）**：已入账 **7 名** = 锚文件 `class:'mechanism' ∧
  planned:false` 全集（capability-enabled/-disabled/-transferred、object-registered、check-report-recorded、
  object-revised、record-backfilled；前五名批准面 = `CONTRACTS.md` §16.3/D-27 既有评审事实 C-19，后两名 =
  存量升格 EA-5.2，批准条目引用该既有事实而非新造）；`planned:true` 带逐名 `gated_by` = **提案未入账 4 名**
  （`raw-record-declared`→`EA-1.2.3`、`integrity-audit-recorded`→`EA-7.1`、`read-shadow-recorded`→`EA-7.2`、
  `ns-relocated`→`G1-NS-01`）+ **A 侧 planned 2 名**（`facet-mounted`/`facet-unlinked`→`G1-FACET-01`）；
  **该锚文件截至目前尚未物化**（矩阵 §4 首行复测）——物化前名单「三方逐等」只是 契约↔夹具 **两方**，
  本 PR 物化后第三方位才就位；物化即按上述新形状写，勿沿用「首批 10」旧叙事（EA §9.4 / R-5 开放项②）；
  写对账脚本（TS Compiler API 扫 `src/kernel/**` 的 ledger insert 调用点与 `eventType` 字面量 = 事实集；
  期望集**只**读锚文件）实现 R1 `EVENT_RECON_ORPHAN` / R2 `…_STALE` / R3 `…_SAMESOURCE` / R4 `…_COUPLING`。
- **不做什么**：不改运行时写面判据（那是 PR-2）；不给任何领域名入账；不把锚文件放进 8 根文档或
  `schema/**`（承载面 = 用户决策 4，未决前**留侧车**，`EA-9.4` 原文「G2 前以本侧车为工作正源」）。
- **进入门禁**：PR-0 exit 0 全套；`EA` 夹具 exit 0（实测）。
- **退出门禁**：`node <对账脚本>` ⇒ exit 0；**四条 R 判据各配一条架空形，实测各自非 0**（§4.1）；
  R3 脚本 import 图静态检查（不得 import `src/kernel/**`）exit 0；R4 用一次性双文件提交样本验证 ⇒ 构建红。
- **验收测试要求**：删定义形态（名单与写点同时抹）⇒ 异源点名、同源失明（`MUT-3` 同族，不许只跑异源那条）；
  `planned` 名不得进运行时名单（夹具 S2 已在，真库侧另配）。
- **依赖前序**：PR-0。
- **冻结面**：否（新增侧车）。**若**用户决策 4 选择「进冻结面 / 进 `schema/**`」⇒ 本 PR 拆出子提交走
  `snapshot:update` + `Frozen-Face-Review`。

### PR-2 `events: 归属账扩形 + 唯一签发 Port + 全形信封 + 审计复算（deny-by-default 落地）`

- **范围**：`EventOwnershipEntry` 扩形与装配期五序判据（`EA-3.2`）+ OA-1..OA-4（`EA-3.3`）；
  `appendAuthoritativeEvent` 入参字段集封闭（类型面 + 运行时白名单守卫双向，`EA-4.3`）；
  `AuthorizationContext` 九字段落 `ledger.authority_basis`（**增 `actor`，不动 DDL 不推 `SCHEMA_VERSION`**，`EA-4.4`）；
  `gateFullShape` 全形闸（`EA-4.5`）+ `replayAuthorityEvidence` 三态（`EA-4.6`）；
  通用 `appendLedger` 收敛为机制内部原语 + 协调台账行改走 `writerOwningKind` 委派（`EA-2.2`，**Q40 不破**）；
  `integrity-audit-recorded` / `read-shadow-recorded` 落账（`EA-7.1/7.2`，**K = 32 常量不变**——R-1 只改
  出口不改算法；两名为 EA §2.4 **提案未入账**名，进入门禁见下）+ 非 oracle 三条（`EA-7.4`，R-1 形：
  调用方 echo 面**零 `hiddenBy*` 键**，计数只进内部审计）；
  **`synth:raw-intake` 登记 + 命令 Port 改道（R-9 从 PR-10 提前，2026-11-01 工程审查 P1-3）**——
  本 PR 把通用 `appendLedger` 收敛为机制内部原语（deny-by-default），而 `IntakeUseCase.intake()`
  今天就走通用通道（`src/app/intake-use-case.ts`，带 `D-19c-ALLOWED` 标记）、作者套件
  `tests/p3-intake-validation.test.ts` 钉着「未注册类型的声明也被接受 + **ledger 写入成功**」；
  姊妹先例 = `synth:fact-designation`（D-20 收口：登记进 `test-records` 的 `ownsEventTypes` +
  用例改走命令 Port，`src/app/standing-use-case.ts` 头注与 `src/domains/test-records.ts` 实测在案）——
  同名义务对 `synth:raw-intake` **不许**再押给 PR-10：**登记与 Port 改道与本 PR 的拒写翻转同批**，
  否则「作者套件全绿」与「deny-by-default 落地」互斥（工程审查实测：翻转后 `intake()` 落账被拒
  ⇒ p3 套件 2 例当场红）。不放进 PR-1 的理由：PR-1 明文「任何域名不得进账」且无翻转动作，
  登记先于消费只会造出「账上有名、无人拒写」的空转窗口——**消费（拒写翻转）与登记同批**才是
  该先例的完整形态。
- **不做什么**：不动 Raw Intake 的容错语义（B-1：`declaredType` 畸变仍收，`EA-1.3a`）；
  不回填存量历史行、不做别名映射（`EA-5`）；不为「拒绝历史可回看」新立名单项（`FM-3.1(b)` 明写「本契约不顺手加」）。
- **进入门禁**：PR-1 exit 0；**`G1-EVT-01` / `G1-AUDIT-01` 已在清单进入 `assigned` 且 owner 为三源之一**
  （人工核对，机验只判非空/非 UNASSIGNED）；**`integrity-audit-recorded` / `read-shadow-recorded` 两名的
  人工 `Approved-By` 标记 + `Event-Name-Review:` trailer 已落地（R-5：4 个提案名人工批准是依赖写面 PR 的
  进入门禁——未入账期间机制内部直写装配红 `ACTIVATION_IMPOSSIBLE`，本 PR 的落账功能不可能绿，
  故不许写成「先落码后补批准」的退出门禁）**。
- **退出门禁**：`g0-gate.mjs` exit 0 且**基线红/绿名集无漂移**（Q45 护栏仍在 passes）；
  `EA` 夹具 exit 0；**`tests/p3-intake-validation.test.ts` 的 intake 落账成功例无新红**——必须经
  「`synth:raw-intake` 登记 + 命令 Port 改道」转绿，**不许改写成接受拒写**（R-9；改测试接受
  `UNREGISTERED_EVENT` 违 Q37/B-1 的 Raw Intake 容错，见通用退出门禁铁律）；异源对账 R1/R2
  确认 `synth:raw-intake` 为**已登记**名（归属账比机制名单零违规，夹具世界的该名字不再是豁免窗）；（`tests/g5a-d27-audit-reserve.test.ts` 同族扩到全部
  **已入账 7 名**；4 个提案名在通用通道 mint 同判红，未入账期间其直写通道装配红——R-5/T-N13 的真库对应物；
  旧句「扩到全部 10 名」为 R-5 前名单基数，作废）；
  `arch-independence.test.ts` 运行时面对拍「插件可见成员名集零增删」exit 0。
- **验收测试要求**：T-N2（自带见证）/T-N3/T-N4（分类）/T-N6/T-N7（双认领装配红零副作用）/T-P4（有写权无业务轴
  ⇒ 收存不投影）/T-P7（**R-1 反转形**：普通响应零 `hiddenBy*` 键 + 计数在审计行可回看 + 隐藏 0/1/≥2 件
  三世界逐字节同形）在**真库**上重做一遍（夹具是模型，矩阵缺口列已登记）；
  `gateFullShape` 的「半形必红」变异常驻（对应夹具 `MUT-1`）。
- **依赖前序**：PR-1。
- **冻结面**：**是**（事件不变量 + 权限/持久化格式）⇒ PR body 写 `Frozen-Face-Review: <日期> <批准人>`；
  如动 `schema/**` 则同提交 `pnpm run snapshot:update`。

### PR-3 `identity: ObjectID 文法去空间 + SpaceContext 强制 + 存在性呈现 + 保留前缀全集`

- **范围**：正式面标识字符串不编码空间名/路由事实（`D1-a`）；`SpaceContext`/`ReadContext` 必填（`D1-b`，#44 L147）；
  `refuse` vs `withhold` 正面裁定落码（`G1-READ-02` / E-01），含既有四码 + PR-2 新 detail 形状**逐码复核**
  （`D1-d`）；`echo` 键集拆调用方/审计两套谓词；保留前缀全集 + 域保留申请流程 + 发号区间是否 namespace 化
  （`G1-LINK-01` 四问之④）；跨 Capability 引用四问的①②③（同条）。
- **不做什么**：**禁止**「禁跨领域边」式整包修法（`§15 G1-c` 点名：会打死 Q45/Q40）；不借机收紧人群；
  不把 `NAMESPACE_ESCAPE` 与 `CAPABILITY_SCOPE_ESCAPE` 互替（`RECONCILIATION.md §3 8b` 实测）。
- **进入门禁**：PR-2 exit 0；`G1-READ-02`、`G1-LINK-01` 进入 `assigned`（owner = 三源之一）。
- **退出门禁**：两世界逐字节同形探针（`SCR-54` 先例形态）exit 0；`pnpm test` exit 0；
  计数面负例（**R-1 反转形**：调用方 echo 面**零 `hiddenBy*` 键**，计数只在内部审计面可回看；旧句
  「`hiddenByInactiveCapability` 等 echo 键不增字段」为 R-1 前形态，作废——撤键是收紧方向，但
  `arch-independence.test.ts` 的面锚是逐字比对，须按 EA-7.4 历史形态句**逐条点名重锚**，不走静默）exit 0。
- **验收测试要求**：「目标不存在 vs 无可见权」逐字节等；「未挂载 vs 越权」逐字节等（`FM-3.1(a)`，两源共用唯一塑形函数）；
  `RECORD_ID_RESERVED` 覆盖扩后的前缀全集；**每条新拒绝形态配「架空同形判据必放过」的变异**。
- **依赖前序**：PR-2。
- **冻结面**：**是**（权限面）⇒ `Frozen-Face-Review`。

### PR-4 `time: 三概念分离 + recorded_as_of → CommitSequence 两分支 + 游标自包含`

- **范围**：`described_at` / `recorded_at` / `CommitSequence` 三槽分离（`G1-TIME-01`，禁互相转换）；
  映射定义**两个分支的确定取值**：同毫秒多次提交 ⇒ 前缀界 + `nextCursor`；该时刻无提交 ⇒ 同形态（`G1-TIME-02`）；
  请求与响应**回显实际生效截点**（`D2-b`，#47 SI-13/SI-14）；时钟回拨语料 + 晚到记录补录标注（`D2-d`）；
  分页游标自包含 + 分页级物化水位（`D2-e/D2-f`）；`recordReport` 返回的 `recordedAt`/`seq` 同值歧义收口（`D-5`，
  **改名前先跑调用方清点**——本仓实测一次静默改名打断 4 个在用调用方）。
- **不做什么**：不做读面加速/物化的性能优化（`READINESS.md:45`：迁移与备份/恢复正确性先行）；
  不引入领域时间语义推断（禁止「按当前配置回算历史」，`EA-4.6`）。
- **进入门禁**：PR-3 exit 0；`G1-TIME-01/02` 进入 `assigned`。
- **退出门禁**：同毫秒两次提交 + 空时刻两组黄金样例 exit 0；`readAsOf` 同一请求两次结果逐字节等（确定性断言）；
  **判据次序变异必红**（先 `recorded_seq` 后 `storage_schema_version` 的顺序交换 ⇒ 红，`RL-8.1` 同型纪律）。
- **验收测试要求**：`attacks/evolution/` 双时间族不新增红；游标跨截点漂移负例；
  「`described_at` 被当排序键用」的回归钉（PoC 现状错法，`§2-G1 ③` 点名）。
- **依赖前序**：PR-2、PR-3（游标消费已冻结的可见性谓词）。
- **冻结面**：若 `records` 加列动到 `schema/**` ⇒ **是**；纯 `src/**` 内部 ⇒ 否，但仍是持久化格式面 ⇒ `Frozen-Face-Review`。

### PR-5 `schema: 四层版本轴 + storage_schema_version 登记 + 打开判据序 + TransactionLease`

- **范围**：五层版本轴表落文档与代码（`D3-a`，**禁互相冒充**）；`storage_schema_version` 按
  `(space_id × capability_id)` 复合键登记（`D3-c`）；打开判据序实现（`RL-8.1` 步 1/2/3/5 先落，步 4 随 PR-8）；
  触发器体摘要期望值**外置锚文件**（`G1-STORAGE-02`）；`StoragePort` 层受限 `TransactionLease`
  （`G1-STORAGE-01`：PoC 保证范围仅「Kernel 管理的 UoW 路径」，`SqlitePort.tx()` 交出的 `RawTx` 回调返回后
  仍可 autocommit 写入是**已登记界外事实**）；墙的可解释性边界三规则（`D3-b`：墙只拒「不可安全读」且不得销毁原字节 /
  版本钉 + 旧解释器 / 冲突时墙让位为「可旧读 + 标注」，**永不以改写历史记录实现**）；Schema 迁移器 +
  **SQLite 备份/恢复正确性**（先于任何读面加速）。
- **不做什么**：**完整 PITR 不作为所有读面开发前置**（`§2-G2 收窄①` 原文）；不做 backfill 补造（`RL-8.4` 默认禁止，
  迁移器**无权**补造「当时合法迁移」）；不在本 PR 落 `ns` 链判据（属 PR-8）。
- **进入门禁**：PR-4 exit 0；**G1 冻结已获用户授权**（否则本 PR 起即违 `§2-G1`「未完成时禁止启动」）；
  `node scripts/snapshot-release.mjs` ⇒ exit 0（本席位实测 0：31 canonical files match）。
- **退出门禁**：`pnpm run build` exit 0 且 `pnpm run check:freshness` exit 0（`CONTRACT_DRIFT` 即红）；
  `pnpm run snapshot:update` 后**契约与清单同一提交**（评审要求，非命令）；`pnpm run pack:verify` exit 0；
  旧库（`tests/fixtures/g6a-p5-drift.db` 家族）打开 ⇒ `SCHEMA_UPGRADE_REQUIRED` fail-loud，**原字节零改写**断言。
- **验收测试要求**：`storage_schema_version` 与 `contract_version` 互相冒充的负例（同载体混填必红）；
  TransactionLease 的「租约未撤销即复用」「撤销后仍可写」两条负例；**触发器名↔体成对替换**的绕过形态（N6/N7 教训）。
- **依赖前序**：PR-1..PR-4。
- **冻结面**：**是**（`schema/**` + DDL）⇒ `snapshot:update` + `Frozen-Face-Review`。

### PR-6 `checker: 不可用三形 → INDETERMINATE 落账 + 报告绑定四要素 + 对外 Check Request`

- **范围**：`CHECKER_UNAVAILABLE` ⇒ 落一条标注不可判定的 `CheckReport`、**响应仍成功**、旧 PASS 不动
  （`D4-a`：不静默续用 PASS、不整链失败、不把「机制健康」冒充「科研 PASS」）；视图恒空与视图抛异常两形
  （`G1-BIND-02/03`）；报告绑定四要素 = 被检对象+修订、检查器身份、规则集版本、解释器版本，**缺件直接拒**
  （`D4-b`，#47 SCR-21）；对外 Check Request 与对内 `ValidationReportSubmissionPort` 两立同构（`D4-c`）。
- **不做什么**：不在机制层判「三态齐备 ⇒ 校验生效」（`D4-d`：降级标注与巡检计数**两个独立面**，不互证）；
  机制不判科研真值（`FM-5.3` 三面执行、领域出判据）；不开独立报告特权通道（`D6-b` ③）。
- **进入门禁**：PR-2、PR-4 exit 0。
- **退出门禁**：`tests/edges-view-unavailable.test.ts` / `tests/xc28-detectability.test.ts` 族无新增红；
  「经提交 Port 取得写面对象」的面锚负例 exit 0（`D4-c` 验收要求）；
  「外部检查请求产生新报告且对象 revision 不变」正例 exit 0。
- **验收测试要求**：三形各一（恒空 / 抛异常 / 真实不可用）+ 旧 PASS 不变 + 报告可回看；
  「用 `CHECKER_UNAVAILABLE` 当整链失败」的反例必红。
- **依赖前序**：PR-2（签发资格）、PR-4（截点回显）。
- **冻结面**：否。

### PR-7 `facet: 双身份 + 挂载登记 + 两个 planned 名入账（D-24 完整修法）`

- **范围**：`FacetMountPort` 五成员（`FM-6`）；`facet_mount` 表 + 两触发器（`MOUNT_ROW_FROZEN` /
  `MOUNT_AUDIT_REQUIRED`）+ 打开期判据四项；`hasActiveMount` 唯一判据点（`FM-3.1`）；入参白名单守卫三类
  `detail.reason`；双身份与保留前缀；三操作分立（`FM-4`）；第二真源三面执行（`FM-5.3`）；
  **同批**走 `EA-2.4` 六步给 `facet-mounted`/`facet-unlinked` 入账（锚文件独立提交 + `Event-Name-Review:` trailer +
  用户 `Approved-By`）；**重定位联动按 R-3 改写**（旧句「并把该两名加入 `RELOCATABLE_NS_KEYS`（这是
  `RL-3.4` 指定的唯一联动接口）」与本裁决直接冲突，作废——`G1-CONTRACT-RECONCILIATION.md` §7-3 点名的
  回填项）：归位**按「物理有无 `ns` 位置列」的类别谓词逐项**判定，挂载登记表 `facet_mount` 的判据输入是
  逻辑 `targetOid`（无 ns 位置键）⇒ **不入清单、零搬迁**（不改行、不补见证、不落事件，RL T-P10 逐字节等
  钉住；反向判据：清单混入它会构建红，T-N18/MUT-9）；扩展记录行 = A2 现形（物理住属主 ns、带 ns 位置键）
  随 `domain_state` 清单条目搬走；G2 若为扩展记录另立表，按同一谓词逐项归位，不点名堆名单。
- **不做什么**：**不打死 Q45 护栏**——`attacks/review/g1a-regression.test.ts` 该条只允许**加一步 `declareMount`**，
  三条断言（成功码 / 扩展按自身修订可读 / 核心 payload 逐字段不变）**一字不改**（`FM-3.2`）；
  不提供「目标的挂载方列表」读面（`FM-2.4`）；不新增核心改写通道（`FM-5.1` 类型面无写点）。
- **进入门禁**：PR-1/PR-2/PR-5 exit 0；**两个机制名已入账（锚文件 `planned:false` + 批准标记齐形）**——
  未入账即提交挂载 Port = 装配红，PR 自身不可能绿，故把入账写进进入门禁而非退出门禁。
- **退出门禁**：`FM` 夹具 exit 0；`attacks` 基线 passes **不含** Q45 护栏条目的移除（名集逐等，`g0-gate` exit 0）；
  插件可见成员名集零增删对拍 exit 0；`MUT-1/2/3` 三条常驻判别的**真库对应物**各一条（矩阵 §2 缺口列）。
- **验收测试要求**：T-N1..N8 真库化；`MUT-1`（行形态判据 = D-24 现状）必须在真实判据下拦住同一负例；
  核心 head/payload 逐字段不变断言；「FR 进正式端点槽位必拒」。
- **依赖前序**：PR-1、PR-2、PR-5。
- **冻结面**：**是** ⇒ `snapshot:update` + `Frozen-Face-Review`。

### PR-8 `ns: 物理重定位 + 恢复条件 + 打开期漂移检测与修复流（D-31 历史面）`

- **范围**：`namespace_relocation` 账（append-only + `RELOCATION_LEDGER_FROZEN`）；`ns-relocated` 名入账
  （`planned:false`，`gated_by` 撤销；R-5：RL-2.2 只是**提案文书**，入账 = 人工 `Approved-By` + trailer 三要素，
  见进入门禁）；`RelocationPorts` 七成员（运维面，插件面零增删）；`RL-4` **12 门**（R-4 正式入集：precheck
  阶段 1–10 + 流程门 11 `APPROVAL` / 12 `REPAIR_PROVENANCE`，旧句「十条门」作废）+
  事务内复核；`RL-5.1` 单事务写序；`RL-5.2` 触发器**四处**改造（子句②四元集合 / 子句③拆三条 /
  混合语句拒 / **R-8 `domain_state_no_update` 体窄化**——RL-5.1 步 3 在现体（全禁 UPDATE）下必炸
  （工程审查 P1-1 实测），三件套「名保留 + 体摘要重登 + `SCHEMA_VERSION` 推进 + 打开判据同批」
  是本 PR 进入门禁；负例面 T-N22：非位置列改写仍拒 + `no_delete` 一字不动）；
  `RL-6` 列语义 + 零写面清单 + `RELOCATABLE_NS_KEYS` 构建期**双向**扫描（R-3：入选 = 「物理有无 `ns`
  位置列」类别谓词；漏登记红 ∧ 清单混入无 ns 列表也红；`facet_mount` **不入清单、零搬迁**）；`RL-6.5` 前缀完备链；`RL-7` 恢复条件；
  `RL-8.1` 打开判据步 4（全表链比对）+ `RL-INFO` 单一信息面 + `QUARANTINE` + 修复流。
- **不做什么**：**不撤销 `TRANSFER_NS_DRIFT`**、不把移交改回携 ns（`RL-5.3`）；不解冻 `dir.ns`（`RL-1.4` B2 弃案维持）；
  **不承诺检出裸面伪造链**（`RL-6.5a` 界外 = 登记边界；文档/实现把「检测」写成「防御」即违例，`RL-13 T-N16` 钉两侧）；
  不做跨进程主动失效（既有 G1 余项，不新立项）。
- **进入门禁**：PR-5、PR-7 exit 0；**`ns-relocated` 已入账 = 人工 `Approved-By` + `Event-Name-Review:`
  trailer 两处同现、锚 `planned:false`（R-5：提案文书≠批准；标记未落地时 execute 在落账那一步拒签、
  整笔回滚（T-N20），本 PR 不可能绿——进入门禁，不是退出门禁）**；`G1-NS-01` 清单条目 `assigned`。
- **退出门禁**：`RL` 夹具 exit 0；**故障矩阵 18 条中 F-04 由「G2 故障注入验收」补上**（夹具列现为「—」，
  本 PR 必须把它变成有夹具的一行）；`g6a-d31-history-drift.test.ts` 常驻 + **`ns_epoch` 下界钉**：把 `ns_epoch`
  设为该库 `max(H.seq)` 并清空 H ⇒ 门禁必红（`G1-DONE-01` resolution 里登记的「不得随库复制」提醒的机验化）；
  `pnpm run build` exit 0（表形变更）。
- **验收测试要求**：`RL-13` T-P1..P10 / T-N1..N22 **真库化**（2026-11-01 R-8 轮复跑实测的表范围；旧句
  P9/N16 为 R 轮前基线——新增 T-P10 挂载零搬迁、T-N17 门封闭集、T-N18 双向扫描、T-N19 呈现面、
  T-N20 批准门、T-N21 补戳、**T-N22 触发体窄化两侧判据**各配真库对应物——T-N22 的真库对应物正是本 PR
  的触发器改造本体：现体拒纯 ns / 窄化体放行纯 ns / 五非位置列十形全拒 / 摘要重登三件套 / REPLACE 照拒）；
  `MUT-1..11` 十一条架空形各配真判据对照（R-8 轮 +`domainStateUpdateMUT11`）；
  `RL-8.1` **交换步 1/4 的变异必须红**（原文：「顺序即判据」）；`RL-INFO` 三条共用同一 `callerBodyFor(caller)`
  的构造面单一性静态门；单 Space 失败不阻断其他 Space（`R-08`，`G1-DONE-03` 验收要求原文）。
- **依赖前序**：PR-1、PR-2、PR-5、PR-7。
- **冻结面**：**是** ⇒ `snapshot:update` + `Frozen-Face-Review`。

### PR-9 `host: 真实 DSH Adapter 最小装配冒烟 + 只读工具四硬约束`

- **范围**：最小身份 / 权限 / Capability 装配冒烟（**从 G4 提前到 G2**，`§2-G2 收窄②`）；工具读实现
  **复用空间内同一判据函数**（`D6-b`，禁复制逻辑）；新只读工具四条硬约束（必携 SpaceContext / echo 键集不含
  隐藏计数与被屏蔽 detail / 报告可见性从被检对象派生 / 跨空间只读面不返回 per-space 计数）；
  幂等层前置（`X-1` 乐观并发码 + `X-2` 不透明幂等 token 三要件 + `X-3` 码表定名）。
- **不做什么**：**不实施在线热切换与不可信插件沙箱**（G4 边界已按 #44 :331/:33/:180/:351 收窄，登记为
  未来扩展项 X-1，不得当首版门禁）；不做完整工具面/RPC/GUI（属 G4）；**不自行注册工具名** ——
  唯一通道是 V1 冻结面流程（`D6-a`：`ARCHITECTURE.md` §7.2 清单 + `Frozen-Face-Review` +
  `tests/tools/permissions.test.ts` 同步）。
- **进入门禁**：PR-3、PR-6 exit 0；工具名若新增 ⇒ **先**走冻结面流程并获批（否则本 PR 不进）。
- **退出门禁**：`DSH_HOME="$PWD/tests/dsh-homes/<用途>"` 下的冒烟 exit 0（`AGENTS.md §3`：越界即流程违规）；
  「未走冻结面流程出现新工具名 ⇒ `permissions.test.ts` 红」负例 exit 非 0（变异向）；
  工具旁路读核心表被扫描门禁红。
- **验收测试要求**：装配根注入 principal **不等于**宿主身份真实性的**如实标注**（`CONTRACTS.md §10` 未证明面
  在冒烟报告里逐条列出，不许借冒烟绿宣称已证明）；两世界同形探针挂到工具面（`SCR-54` 先例）。
- **依赖前序**：PR-3、PR-6。
- **冻结面**：**是**（新工具名 + 宿主权限面）⇒ `Frozen-Face-Review`（且工具名清单与本 PR 同一提交；
  **且同交 `pnpm run snapshot:update`**——P2-1 补记，2026-11-01 工程审查：工具名正源 `ARCHITECTURE.md`
  §7.2 在哈希冻结面内（`SNAPSHOT.md` 实测在列、`snapshot-release.mjs` 校验 31 文件），漏跑 = 构建红
  CONTRACT_DRIFT；PR-2/5/7/8 都写了这条、旧行漏写，照 §4.4「每次」模板补齐。兜底 `check:freshness`
  自 PR-5 起在阶段门，漏跑当场红，但**排期面不许依赖兜底**）。

### PR-10 `slice: 纵向功能切片 + 迁移工务（G2 收尾判据）`

- **范围**：`Raw Intake → Entity 登记 → 有来源的 Association → PropositionRevision → S-L1 CheckReport →
  历史读取` 一条端到端窄路径（真实五类对象，**不得**新增第六类对象或第四套认识系统）；
  **PoC 夹具世界迁移**（域内自用事件名全部登记或改走 Raw 信封，不留豁免窗，`EA-9.2-②`；
  **基数收缩注记（R-9）**：`synth:raw-intake` 已随 PR-2 的拒写翻转同批登记+改道，本 PR 迁移的是
  **其余**域内自用名——不许拿「PR-10 再统一迁」把 PR-2 的登记义务押回去）；
  `D-19c-ALLOWED` 签字清单重排（`EA-2.2`，登记为实施批义务）；三条架构门与 `attacks/**` 迁入正式测试面。
- **不做什么**：**不是提前做完 G3** —— 切片只跑一条窄路径（`§6.1′` 原话）；不引入领域校验规则的科研正当性
  （G3）；不把 `experiments/**` 当测试面（切片测试**进正式测试面**）。
- **进入门禁**：PR-0..PR-9 全绿；**`raw-record-declared` 人工 `Approved-By` 已落地**（切片首环 Raw Intake
  的台账行用该提案名——R-5 fail-closed：未入账期间直写装配红，进入门禁，见 `G1-CONTRACT-RECONCILIATION.md` §7-4）。
- **退出门禁（切片出口判据，原文可执行形态）**：该路径上**每个跨领域写都是一个拥有者命令端口调用**
  （`D-19c′` 静态集合相等核对通过）∧ 切片全程在**一条**事务内提交（Q40）∧ 切片测试在 `tests/**` 而非 `experiments/**`；
  夹具世界迁移后 `EA` 夹具与真库名单对账 exit 0（R1/R2 双向零违规）。
- **验收测试要求**：「绕开拥有者端口直接写」的新形态必红（词法网 + 作用域墙双钉，墙失效才算洞）。
- **依赖前序**：PR-0..PR-9。
- **冻结面**：迁移本身不动冻结面；`attacks/**` 迁移后基线重生成须走 §4.2 的外部身份流程。

---

## 3. 并行范围与互斥点

### 3.1 可并行（且为什么可以）

| 并行带 | 内容 | 前提 |
| --- | --- | --- |
| **G1 取证 ∥ G0-R 修复** | 契约对账取证不依赖机制修复结果（`§6.1′` 第 1 行） | 已在执行（本轮即此形态） |
| **PR-6 ∥ PR-7** | 检查器降级与挂载互不消费对方新面 | PR-5 已合并 |
| **`attacks/**` 扩充 ∥ 功能实现** | 不同文件所有权（`§6.1` 可并行条） | 审查方文件作者不改写；基线重生成只能一人做 |
| **G1 清单条目关闭 ∥ PR 实施** | 条目关闭是对账面，不锁代码 | 关闭三件套（owner/evidence/resolution）由条目责任者执行 |

> **旧表曾有「PR-3 ∥ PR-4（前提：PR-2 已合并；不得同时改 `ReadContext`）」一行，本轮删除**
> （P2-2 串行修正，2026-11-01 工程审查）：它与 §1 图的 W4 依赖列（W2、W3）、PR-4 自身进入门禁
> （PR-3 exit 0）互相矛盾——「正交谓词面」≠「非消费关系」，分页游标正是 PR-3 存在性裁定的下游。
> 串行原因全文见 §3.2 新增行。

### 3.2 必须串行（附原因）

| 串行对 | 为什么必须串行 |
| --- | --- |
| **PR-3 → PR-4** | **旧 §3.1 表曾声明「PR-3 ∥ PR-4（前提：PR-2 已合并）」，该行作废（P2-2 串行修正，2026-11-01 工程审查）**。三条硬证据：① §1 图 W4 行「依赖前序」栏自写 **W2、W3**（「游标要冻结的可见性谓词」）；② PR-4 自己的进入门禁写着「PR-3 exit 0」、依赖前序「PR-2、PR-3」——旧并行行与同文档两处直接矛盾；③ 「两个正交谓词面」论证不成立：**正交 ≠ 非消费**，分页游标（PR-4 产物）消费的正是 PR-3 要裁的 refuse/withhold 呈现形态（`E-01`/`D6-b` ②「晚做会把 oracle 形态编进工具面」——并行 = 让该教训按排期发生）。可并行的仅剩 `PR-6 ∥ PR-7`（§3.1） |
| **PR-1 → PR-2 → PR-5 → PR-7 → PR-8** | 名单/归属账是所有写面判据的输入；表形（PR-5）先于挂表（PR-7）；联动接口**旧句「挂载表进 `RELOCATABLE_NS_KEYS` 是唯一联动接口」已按 R-3 作废**——现为「物理有无 `ns` 位置列」类别谓词逐项归位（挂载账不入清单、零搬迁；扩展记录行随 `domain_state` 搬），倒序仍造出「ns-keyed 表漏登记 ⇒ 只搬一半」的漂移，且正向半边无对象可核 |
| **4 个提案名的 `Approved-By` 落地（人工，用户/指名代表）→ 消费该名的写面 PR**（PR-2：`integrity-audit-recorded`/`read-shadow-recorded`；PR-8：`ns-relocated`；PR-10：`raw-record-declared`） | R-5 fail-closed：批准标记未落地期间，相应写面（含机制内部直写）装配红 `ACTIVATION_IMPOSSIBLE`、重定位在落账那一步整笔回滚——**这是设计后果不是缺陷**；因此 4 个 `Approved-By` 是各消费 PR 的**进入门禁**（`G1-CONTRACT-RECONCILIATION.md` §5/§7-4），不许按「先落码后补批准」排期 |
| **G1 正式冻结 → PR-5 起的所有真实 DDL** | `§2-G1`「未完成时禁止启动」原文：会基于错误的时间/所有权模型固化 |
| **入账（锚文件独立提交）→ 消费该名的 Port 落地** | `EA-2.4` 步骤 3「独立提交、与实现代码不同提交」+ `R4` 同提交耦合拒 ⇒ **同 PR 允许、同 commit 禁止**，且顺序固定 |
| **触发器体改造 → `SCHEMA_VERSION` 推进 → 打开判据同批** | `RL-5.2` 头注三件套；漏一步 = 旧库静默过闸 |
| **`G1-GATE-01` 机械防线（PR-0）→ 一切依赖「基线逐等」的护栏主张** | GT-2/GT-3/GT-4 未闭合前，「Q45 护栏在 passes 里」不构成持续否证（矩阵 §4 末行） |
| **同一文件的门禁脚本与基线产物** | **不得并行**（`§6.1` 末行 + `§6.2` 纪律：并发工作树上生成的基线会把别人的中间态固化成权威） |

### 3.3 文件互斥清单（同文件即互斥，登记给排期人）

`src/kernel/kernel.ts`（`routeNs` 单点：PR-3/PR-4/PR-8 都碰）· `src/storage-sqlite/sqlite-port.ts`
（SCHEMA + 触发器：PR-2/PR-5/PR-7/PR-8 都碰）· `g1/EVENT-CONTRACT-LEDGER.json`（PR-1/2/7/8 都碰，
**必须按名分独立提交**）· `attacks/BASELINE.json` + `AUTHOR_ANCHOR.json`（只由门禁在干净树写，见 §4.2）·
根 `vitest.config.ts` / `tsconfig.json`（PR-0 独占；**必须保留** `references/**`、`tests/deepseek-harness/**`、
`tests/dsh-homes/**` 三条排除，`AGENTS.md §2`）。

---

## 4. 本仓 PoC 期已建立的纪律，G2 逐条沿用（命令级）

### 4.1 新/改判据必带**架空式变异**验收

规则原文（`IMPLEMENTATION-PLAN-DRAFT.md §7` 流程规则）：**「新增或修改门禁脚本，必须同时交付至少一条
变异验证——人为制造它应当拦住的情形，贴出红色输出，否则不算完成。」** G2 的强化：判据类变更必须
「真实判据拦住负例 ∧ 架空判据放过同一负例」两条都在（三份夹具的 `MUT-*` 先例：2026-11-01 R-8 轮复跑实测
常驻且 exit 0 为 EA **7** 条 / FM **4** 条 / RL **11** 条；旧计数 EA 3 / FM 3 / RL 5 与「RL 10」是 R-1…R-6
与 R-8 前基线——R 轮每修一项各配一条同族影，**旧条零删除**）。

```sh
# 变异向（期望：**非 0**，且红因是目标判据本身）
node <被改的对账/校验脚本>            # 期望 exit ≠ 0，贴出红输出
# 还原后（期望：0）
node <同一命令>                        # 期望 exit 0
```

常驻形态要求：MUT 函数**从不替换真实函数**，只在自验分支旁路调用、结果只进断言不进世界状态
（`RL-5.2`「还原方式如实写明」的写法，G2 沿用——否则「变异通过」会变成「真实判据被换掉」）。

### 4.2 基线 / 身份锚需要**外部身份**

- `--write-baseline` **脏树拒写**（本席位读源码 + 现行为准）：`g0-gate.mjs:74-79,250-252` 写死三条拒写条件
  —— `git status --porcelain` 非空 / 流不可解析 / 出现 skip ⇒ 一律拒写（临时路径同判据）。
  **G2 不得放宽为「记一下就好」**：基线只能记可复现的树。
- 基线与身份锚**必须在干净 worktree 内生成**（`§6.2` 纪律 3；本轮实例：`.scratch/wt-g0base`、`.scratch/wt-bl`）。
- **外部身份登记**（GT-4 最低机械防线三条，登记在 `G1-GATE-01` 裁定面）：重锚必须有
  `reanchored_by: <非作者>` + `delta_sha`，且名集增删在评审中高亮；`Anchor-Review` CI probe 在 CI 落地前
  以「第二人本地签字」代替并留痕——**签字是人的事实，机器只核形态与非本人**。
- 作者侧身份锚现状（本席位实读 `AUTHOR_ANCHOR.json`）：`generated_from_commit=df20c0b1…`、
  `passed=total=225`、`passed_sha256` 钉通过项身份、`files_sha256` 钉 `tests/**` 路径+内容
  （**断言体乃至一个注释字节**不符即红）。收不住的形态 = 「改断言体**并且**重锚」，
  文件内 note 自陈：「防线是变异抽检纪律（纪律非机制）」——**G2 不得把这行读成机制已闭合**。

### 4.3 `docs:check` 只在**提交态**可信

```sh
git add <显式路径> && git commit …          # 先跟踪
pnpm run docs:check                          # 期望 exit 0（提交态第 2 次）
```
采集面是 `git ls-files`（`G0-R-CLOSURE.md §4` 三跑实测）：未跟踪文件不在扫描面、脏修改偏离提交态
⇒ **提交前一次 + 提交后对 HEAD 一次，两次都入账**才算绿；`docs:sync --write` 同理（未提交的新文档进不了索引）。

### 4.4 冻结面变更（G2 期间每一次）

```sh
# 改契约文件（8 根文档 / schema/**）后：
pnpm run snapshot:update                     # 期望 exit 0
node scripts/snapshot-release.mjs            # 期望 exit 0（本席位实测：31 canonical files match SNAPSHOT.md）
pnpm run docs:probe --paths /tmp/changed.txt --fail-on-blocking   # 不带标记 ⇒ 期望 exit ≠ 0（正确投票）
# 同一次提交里：契约 + SNAPSHOT.md，PR body 写：
#   Frozen-Face-Review: <YYYY-MM-DD> <批准人>
pnpm run docs:probe --paths /tmp/changed.txt --fail-on-blocking   # 带标记后本地复现 ⇒ 期望 exit 0
```
「快照哈希与清单同步**绝不代替审查**」（`docs/development.md`「冻结变更的机器门」）。本表 §1/§2 标
「冻结面 = 是」的 PR：**PR-2、PR-3、PR-4（若动 schema）、PR-5、PR-7、PR-8、PR-9**。

### 4.5 DSH 相关运行（PR-9 起）

```sh
DSH_HOME="$PWD/tests/dsh-homes/<用途>" dsh …        # AGENTS.md §3：越界即流程违规
pnpm run test:e2e:v2:bootstrap && pnpm run test:e2e:v2   # 现行 V2 验收入口（旧 test:e2e 不得作唯一门禁）
```
起服 / 探测 / 关停**必须写在同一个 bash 调用里**；train 切换后先 `pnpm run clean` 再 `pnpm run build`
（`AGENTS.md §2` 实测教训：残留产物同时毒化构建与运行面）。

---

## 5. 禁止事项（对作者与所有实施席位，写进文档而非记在脑子里）

1. **禁止把 `experiments/v3-code-architecture-poc/**` 整体移作生产基线，禁止用一次 merge 收编。**
   原文警告（`IMPLEMENTATION-PLAN-DRAFT.md §8`）：**「实验分支整体合并会顺带改变 V1 基线」**——本分支已含
   一次冻结面变更（`467414f`）与一次回退（`de82ed3`），整体合并会把两者连同实验侧车一起写进主线，
   **冻结面哈希与清单会被一并移动**。收编必须按 `§8` 的 U-1（冻结面变更）/ U-2（实验产物）/
   U-3（门禁脚本）三个独立评审单元拆分，PR-0/PR-10 各认领其中一段。
2. **PoC 夹具世界迁移是实施批义务，不得当作「豁免窗」或「以后再说」。**
   登记原文（`g1/G1-CONTRACT-EVENT-AUTHORITY.md` §9.2「DESIGN C.5 开放问题裁定」条 2
   「**所有权账范围**」判据句——P2-3 重锚，2026-11-01：行号引用已漂移两次〔曾标 `:577-578`、
   审查时实测 `:694`〕，一律改「文件 + 小节名 + 判据文字」形）：「域内自用名（夹具/测试世界）要么登记、
   要么改走 Raw 信封——**不留豁免窗**（豁免 = 名单外默认可写的残体）；存量夹具迁移登记为实施批义务」，
   同句再见于该契约 §9.4「未决与保留项（诚实清单）」条目「夹具世界迁移登记（实施批）」
   （旧标 `:613`，审查时实测 `:728`，同样作废改小节锚）。去向纪律 = `G0-R-CLOSURE.md §7`「无悬空项」的同一口径：
   **每个残余必须有去向**，本计划把该去向固定为 **PR-10 的退出门禁**（迁移后 R1/R2 双向零违规）。
3. **禁止弱化门禁或伪造 PASS**：不得跳过、降标准、从索引剔除、不得为对齐基线改审查方文件；
   `READINESS.md §5` 原句——「任何一项被放宽（跳过、降标准、从索引剔除）都视为**未通过**，而不是『通过』」。
4. **禁止把仓内记录的 PASS 当作自己的独立测试结果**（`§9` 条 6）；所有引用数字须并列 `EVIDENCE.md`
   的五条口径限定，且**并列 `CONTRACTS.md §14.1` 三条限制**（词汇扫描是命名门 / `attacks/**` 不类型检查 /
   **任何绿灯不证明 Kernel 业务无知**）。
5. **禁止新增第六类科研对象或第四套认识系统**（`M-8`；`READINESS.md:42-43`）；禁止在 Kernel 出现科研
   标识符或对 `kind`/`role` 做值判定（`M-1`，新结构门 `M-2` 属 G2 交付）。
6. **禁止修改 PR #42 已裁定语义**；发现冲突**提出并指向 Q 编号**，不自行重开（`§9` 条 3）。
   `G1-ADJUDICATION-TABLE.md §5` 已核：全表未重开任何 Q1–Q45。
7. **禁止用「门禁绿」冒充「CI 验收」或「安全保证」**：`G0-R-CLOSURE.md §5` 「所有绿灯均无 CI 背书，
   不构成 CI 验收」；33 条审查方红条是**已定性的已知项**，不是「产品通过」。

---

## 6. 阶段门禁汇总与 G3 边界

| 阶段界 | 命令 | 期望退出码 |
| --- | --- | --- |
| **G1 申请冻结（唯一的放行命令）** | `node …/g1-checklist-validate.mjs --self-test` 然后 `… --require-clear` | **0 然后 0**（当前实测 0 与 **1** ⇒ NO-GO） |
| G1 冻结批准 | 人工：非作者审查者具名结论 + 用户授权（`--require-clear` 的 `supersession_review` 字符串**不代替**证据） | — |
| **G2 进入** | 上一行完成 + 用户批准工程基线（分支 / PR / train pin） | — |
| 每个 PR（含 PR-0） | §2 的「通用退出门禁」五条命令 | 各 0 |
| PR-5 起 | `pnpm run build` / `pnpm run check:freshness` / `pnpm run pack:verify` | 各 0 |
| **G2 出口** | `pnpm run check:types` / `pnpm run lint` / `pnpm run build` / `pnpm test`（**根门禁，非侧车**）+ 三条架构门**各有变异验证记录** + Kernel 科研词表扫描为空 + `M-2` 结构门通过 + PR-10 切片三条出口判据 | 各 0 |
| G3 进入 | G2 出口全绿 + **Q12 写权限模型已由 D-19 修复落地** + 对象契约（字段/状态机）已冻结 | — |

**G2 明确不做（防范围蔓延）**：科研五类对象的字段/状态机/接纳判据（G3）；完整 PITR 作为所有读面前置
（已收窄，`§2-G2 ①`）；在线热插件与不可信插件沙箱（G4 之外的未来扩展项 X-1）；完整工具面 / RPC / GUI /
真实科研工作流验收（G4）；跨进程主动失效（G1 余项，本计划**不新立项**）。

**G2 的诚实残余（每份 PR 描述都要带，不得省略）**：宿主主体真实性未证明（`CONTRACTS.md §10`）；
N5 两处界外（worker 回收后定时器异常不可检出、「登记红在场 + banner 失配」窗口）；N3 残余形态
（两层以上包装 + Proxy `ownKeys` 欺骗 + 装配层参数属性）；裸面伪造链 = 登记边界不承诺检出（`RL-6.5a`）；
「批准者/审查者是否真读了 diff」是人认边界（`EA-6.1`、`RL-8.4`、`--require-clear` 三处同一边界）。
