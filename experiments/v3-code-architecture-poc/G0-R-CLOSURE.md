# G0-R 收口记录（第七轮裁定驱动，2026-10-31）

> **性质**：G0-R（G0 复审轮）的**现行收口记录**——只写「现在保证了什么、没保证什么、
> 没修的去了哪」。**过程流水不在本文**：历史留在 `REVIEW.md`、`EVIDENCE.md` 与六份独立
> 对抗席位报告及两轮 G0 复验报告（`attacks/review/RE-REVIEW-*.md`，G0-A/G0-B/G1-A…G6-A）。
> **锚定**：裁定基准 = 提交态 `e3be0ce`；门禁实测落点 = `c06e22d` + 本席未提交改动
> （`e3be0ce..c06e22d` 之间只有并行席位两笔**纯文档提交**：`a738136` 入账
> `G1-RECON-PR47.md`、`c06e22d` 更正 `G1-CONTRACT-DESIGNS.md` 附三，均不触机制/门禁/本席
> 四文件——`git diff` 核过，见 §4 第 3 次）。复审者第七轮裁定：**G0-R 限定范围 PASS**。

## 1. 结论边界（先于一切数字）

- **G0-R = 限定范围 PASS**（复审者第七轮裁定）：指的是 G0 复审轮登记的收口义务——
  N5 运行级假绿修复登记、D-23 保证范围改判、门禁数字如实入账、残余逐条有去向——
  按各条声明的范围完成。
- 它**不等于**生产级安全、**不等于**实施基线批准。**G1 立即冻结 = NO-GO**
  （清单 27 条 / open 23，`--require-clear` 预期红）；**G2（正式 CI）= NO-GO**；
  **PR #48 不合并**。
- 状态词汇不互推（README 文件头纪律）：本文所有「已验证/已闭合」均限定到明示的范围，
  任何绿灯数字不构成就绪证据。

## 2. N5 的真实保证范围

裁定口径原话，逐字为界：

> 「**在固定并验证过的 Vitest reporter 契约下，既有的 N5 文件级与运行级吸收反例已得到
> 防护；超出该输出契约的异常不属于已验证保证。**」

**不得写成「任意运行级异常均可检测」。**

- **被防护的反例清单**（A–F 六形态，常驻回归 `tests/n5-failure-cause-signature.test.ts`
  + 探针 `tests/helpers/n5-causes-probe.mjs`；判据内核 `gate-causes.mjs` 唯一实现）：
  - **A 吸收形** ⇒ 必红：同文件内一条已登记断言红 + `afterAll` 抛错共存，旧门禁把清理期
    崩溃吸收成「已知失败」打印 PASS（G-1/G-2/GT-1 同族第四次）；修后未登记成因逐条点名。
  - **B 钩子形** ⇒ 必红：全绿文件 + `afterAll` 抛错（GT-1 的纯形态），判「文件 failed 且
    0 条失败断言 ⇒ 收集/清理期失败」。
  - **C 对照形** ⇒ 成因必须为 0：纯断言红不产出成因 = 基线零误报前提的常驻钉。
  - **D 收集形** ⇒ 必产出 `collection-error` 成因：import 崩溃（JSON 0 断言 + 文件级
    message）不许被当成无失败。
  - **E 运行级吸收形** ⇒ 必红：「已登记红 + 未归属运行级异常（未处理拒绝/微任务抛）」
    ——vitest 4.1.11 的 JSON reporter 在该场景**零信息**（顶层无 errors/failureMessage
    键，红场 exit 恒 1 零信号），唯一旁证是 default reporter 的 stderr `Unhandled Errors`
    banner（json reporter 丢弃）⇒ 双 reporter 双通道 + 运行级**独立判定，断言红不再是豁免**。
  - **F 兜底形** ⇒ 反转默认的常驻钉：`exit≠0 或 success≠true` 且文件级/运行级成因 0 且
    红 0 且 skip 0 的**一切无法归因形态一律红**（父席裁定：「banner 只是归因通道之一，
    匹配不到绝不落回『与基线一致』」）。
- **被钉的 reporter 版本**：**vitest 4.1.11**（package.json pin `^4.1.11`，安装实测
  `4.1.11`）。banner 正则与该版本实测输出形态绑定为**被钉契约**；升级 vitest 必须复跑
  A/B/D/E + F 五形态，E 形断言保证**改文案先红**（禁止放宽断言迁就新版）。
- **两处已登记界外**（如实登记，不编造检测手段）：
  1. **worker 回收后的定时器异常**：vitest 自身零痕迹、exit=0 ⇒ 任何基于其输出的判据都
     检不出——接受为界外。
  2. **「登记红在场 + banner 失配」窗口**：该组合下运行级异常不可检出；唯一防线即
     **E 形先红**（reporter 文案漂移会先打掉 E 形断言，逼守卫同步更新）。

## 3. D-23 的真实保证范围

裁定口径原话：「**Kernel 管理的 UoW 路径已验证闭合**」。

- `SqlitePort.tx()` **自身无独立失效机制**：它把 `RawTx` 交给回调，回调返回后句柄照样可
  autocommit 写入；终结记账发生在 **`Kernel.uow()` 的 `finally`**（`kernel.ts` CLOSED_TX）。
  界外事实已实测钉住：`tests/d23-tx-lifecycle.test.ts` 两条「界外事实钉」（直取
  `port.tx` 句柄回调返回后写入照常落库 ↔ 同形经 `Kernel.uow` 得 `TX_CLOSED` 的不对称）。
- 因此 D-23 **不是「StoragePort 全部消费者的同等保证」**：任何绕过 `Kernel.uow()` 直接消费
  `port.tx()` 的新机制消费者不受该账约束，D-23 原洞会重现。
- 把保证下沉为 StoragePort 层受限 `TransactionLease` 属正式实现工作，已登记
  **G1-STORAGE-01**（锚：`READINESS.md:120`、`CONTRACTS.md` §16.1/§16.2、清单条目原文）。

## 4. 提交态 `docs:check` 实测记录（提交态基线 + 工作树跑 + 并发提交后追记；本席裁定口径「双跑」= 前两次）

`docs:check` 的采集面是 `git ls-files`（`scripts/docs/check.mjs:8`）：**未跟踪的新文档
完全不在扫描面内；已跟踪文件读的是工作树内容**。由此产生上一条席位暴露过的盲点——
含未跟踪文件的脏树可以给出一枚对「提交态」不成立的 OK。

| 跑次 | 时点 | 工作树状态 | 结论 |
| --- | --- | --- | --- |
| 第 1 次 | 本席任何改动**之前** | 与 `e3be0ce` 逐字节一致（`git status` 干净） | `[docs:check] OK — 1293 tracked files, static consistency clean (no claim of empirical/host-verified status)` ——**提交态可信** |
| 第 2 次 | 本席全部改动落盘后、**未提交**（READINESS/PLAN 追加后复跑） | 脏：4 个已跟踪文件被修改 + `G0-R-CLOSURE.md` 未跟踪 | `[docs:check] OK — 1293 tracked files, static consistency clean` ——tracked 计数与第 1 次相同即证明**未跟踪的本文未被扫描**；该跑只证明「工作树里已跟踪文件的静态一致性」，**不构成提交态结论** |
| 第 3 次 | 本席收尾时（并发提交落地后） | 脏，同上；HEAD 已因并行席位两次提交移到 `c06e22d`（`a738136` 入账 `G1-RECON-PR47.md`、`c06e22d` 更正 `G1-CONTRACT-DESIGNS.md`——**均不在本席范围**，`git diff` 证明与本席 4 文件零交集） | `[docs:check] OK — 1294 tracked files, static consistency clean`——tracked +1 即 `G1-RECON-PR47.md` 转为已跟踪；本文（未跟踪）仍不在扫描面。**对新提交态 `c06e22d` 的提交态 docs:check 本席无法给出**（主树含本席未提交改动，纪律禁 worktree/stash 另开检出）——按下方纪律条款，本席文件入库后由提交席复跑并记录 |

**纪律条款（本记录确立，后续席位沿用）**：`docs:check` **只在提交态可信**——采集面是
`git ls-files`，未跟踪的新文件会让**索引 staleness 检不出来**（上一轮就是这么漏的），
脏修改又让已跟踪文件的扫描对象偏离提交态；含未跟踪文件或脏修改的运行一律按
「工作树参考值」读。**本轮及此后每一轮新增的文档，在入库后必须复跑一次 `docs:check`
并把结论记入当轮登记**——提交前跑一次、提交后对 HEAD 再跑一次，两次都入账才算
「提交态 docs:check 绿」。同理，`docs:sync --write` 的导航索引由 tracked 清单生成，
**未提交的新文档进不了索引**，索引完整性也只在提交态成立（本轮 `G0-R-CLOSURE.md`
与本文的索引条目即因此缺位，提交后需重跑 `docs:sync --write` 补齐）。

## 5. 门禁与数字（逐项标来源；本仓 PoC 侧车无任何 GitHub CI 记录）

「来源」列没有「CI」这一类——**所有绿灯均无 CI 背书，不构成 CI 验收**（G2 NO-GO 的
另一面）。运行主体：第七轮席位本地实测（2026-10-31；首轮落点 = `e3be0ce` + 本席改动，
终轮 = `c06e22d` + 本席改动——两笔并发提交不触机制/门禁，两次三条流结论逐字相同）。

| 门禁 | 数字/结论 | 来源 |
| --- | --- | --- |
| `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` | **0 诊断** | 本地运行（g0-gate [1/3] 流 + 单独复核） |
| 作者测试 `tests/**` | **225 例全绿、0 skip、与 `AUTHOR_ANCHOR.json` 身份锚四项逐等** | 本地运行（g0-gate [2/3] 流） |
| 审查方 `attacks/**` 名集 | 与 `attacks/BASELINE.json` 逐等：**total 133 / failures 33 / passes 100**（生成提交 `7d61ec3`）；无新增红、无红消失、成因全登记 | 本地运行（g0-gate [3/3] 流）+ `attacks/BASELINE.json`（文件内记录） |
| `g0-gate.mjs` 三条流 | **PASS**（原文全文存第七轮收尾回报；「审查方红条是已定性的已知项，不代表产品通过」为该脚本自带措辞） | 本地运行 |
| `--write-baseline` 脏树护栏 | 脏工作树下**拒写**（临时路径同判据） | 本地运行（本轮复测，见收尾回报） |
| `g1-checklist-validate.mjs` 三态 | 默认 **绿**（计数 27/open 23/done 4/`superseded_unreviewed=0`/违规 0）；`--require-clear` **预期红**（open=23、assigned=0、unassigned=22）；`--self-test` **17/17 全部捕获**（第七轮 +M14/M15/M16/M17；M17=旧名 `supersedes` 切断继任链必双红：UNKNOWN-FIELD+SUPERSEDED-TARGET） | 本地运行（第七轮改动后复跑） |
| `docs:check` | 提交态 OK（§4 第 1 次）；工作树跑为参考值（§4 第 2/3 次，第 3 次记录 HEAD 已移 `c06e22d`） | 本地运行 ×3 |
| 33 条红的定性 | 全部为已定性的审查方发现（REVIEW/席位报告逐条在账），非「待调查失败」 | 席位报告（G0-A…G6-A）+ `attacks/review/` |
| GT 系列/修复的独立复验 | 各席位的「已修」多为**作者流实测 + 席位复验**，凡「待独立复验」字样仍保留 | 席位报告，非本席复测 |

## 6. 第七轮增量（本席，随本记录入账）

`g1-checklist-validate.mjs` 的 superseded 终局洗白修复（反例在 `e3be0ce` 上**实测复现**：
23 条 open 全改 `superseded` + 非空 owner + 统一指向 `G1-DONE-01` ⇒ `--require-clear`
exit=0 假绿）：字段改名 `supersedes`→`superseded_by`（方向与 ADR-0003 相反，旧名列为
禁止字段）、superseded 必须带锚定的 `supersession_reason`/`supersession_evidence`、
`--require-clear` 要求 `supersession_review`（`REVIEW: <日期> <非作者审查者>`，
审查者==owner 或缺失即红；日常不拦）。设计依据（第七轮裁定原话）：**「机器无法自动证明
两个复杂契约语义等价 ⇒ 用『结构校验 + 人工确认替代关系』的门禁，不要继续堆自动推理
规则」**。判据细节、17 形态自验与「齐形可绿」三夹具实测见校验器头注与 READINESS 第七轮节。

## 7. G0 未修残余 → 去向表（无悬空项）

| 残余 | 事实与锚（现 READINESS.md 行号） | 去向 |
| --- | --- | --- |
| **GT-2** | 基线按名字比对，`attacks/**` 内容零校验：已登记红条掏空成恒真/恒假断言仍 PASS（READINESS.md:123；G6-A 复现「内容零校验」比登记更宽 :234） | **G1-GATE-01**——清单中唯一能闭合「attacks 基线身份 + 重锚纪律」的条目；席位修法「基线逐条记 `failureMessages[0]` 摘要」属该条裁定时的实现选型面 |
| **GT-3** | 基线自洽即通过：删审查方测试后按新现实重算 ⇒ 两次「与基线完全一致」PASS（READINESS.md:124） | **G1-GATE-01**（topic 原文即「干净 worktree 重算 + 被收集文件清单哈希作被锚定量 + 重锚二人标记/CI probe」）；PoC 侧 `--write-baseline` 脏树拒写只堵了一条重算换口，非闭合 |
| **GT-4 唯一洗白链** | 改断言体 + 重锚 ⇒ 身份锚四项照常「逐等 OK」（READINESS.md:216-218） | **G1-GATE-01**（G5-A 最低机械防线三条——名集增删 diff 高亮、`reanchored_by`+`delta_sha`、`Anchor-Review` CI probe——登记于该条裁定面；CI probe 本身在 G2 前有纪律归属问题，同条处理） |
| **N5 界外①** | worker 回收后的定时器异常：vitest 零痕迹 exit=0，任何基于其输出的判据检不出（READINESS.md:143 界外登记） | **明确接受为界外**（不编造检测手段；若要检出需引入 vitest 输出之外的观察面 = 新机制，超出 G0-R 裁定） |
| **N5 界外②** | 「登记红在场 + banner 失配」窗口运行级异常不可检出（同上锚） | **明确接受为界外 + 常驻先红防线**：E 形断言 = 被钉 reporter 契约，reporter 文案漂移必先把 E 形打红，逼守卫同步；窗口只在「漂移未察觉」期间存在 |
| **E-01** | `NAMESPACE_ESCAPE` 拒绝声明「oid 存在且属他人」+ D-12 可预测 oid ⇒ 存在性 oracle；包 2/3 两次加宽（actor/authority 列）（READINESS.md:137） | **G1-READ-02**（refuse vs withhold 正面裁定；E-01 行自记「待 G1 裁定，复核范围 = 存在性 + 归属者身份 + 登记者 + 授权见证」） |
| **N3** | 双门重写后残余：两层以上包装 + Proxy ownKeys 欺骗 + storage/kernel 装配层参数属性（G4-A 四形双盲实测，READINESS.md:144 及 §G4-A 行） | **接受为已登记残余**（无待裁决定：两门现行形态有红→绿血统 + 变异锚点常驻；残余形态已按「扩面须先登记」入账；作者门进正式 CI 的归属 = G2，纪律位 G1-GATE-01 已记） |
| **N4** | `tx` 运行时原型比声明接口宽（`reassignRouteInternal` 裸通道挂插件经手实例原型，实测被 `AUTHORITY_REQUIRED` 兜住无越权）（READINESS.md:145） | **G1-OWN-02** 同题归口——写面权威形状裁定（Application 只持协调权、写经拥有者命令端口）天然覆盖「裸通道保留/收敛/补机制授权」三选一；归口为本收口记录指定（该洞此前无 G1 映射，事实仍以 READINESS.md:145 原文为准） |
| **D-21 语义** | 保留前缀全集、域保留申请流程、发号区间是否 namespace 化——包 6 止血只封 `RPT-` 声明形（READINESS.md:210） | **G1-LINK-01**（四问之④「保留标识的分配政策」；止血形态由 `tests/g5a-d21-reserved-prefix.test.ts` 钉住） |
| **D-24 写侧** | 合法 Facet 挂载与伪造他人核心对象状态行在 `write()` 入口同一行形态；读侧已修（:209），写侧挂载登记未修（READINESS.md:121） | **G1-FACET-01**（扩展记录独立身份 + 显式挂载登记；契约草案 `G1-CONTRACT-DESIGNS.md` 节 A；Q45 正例护栏在 BASELINE passes，修法不得打死） |
| **D-31 历史面** | 入口已修（:208），历史面敞开：v6 漂移库被版本墙顺住非检出、v7 同形漂移重开零声纳、`dir.ns` 冻结与迁移通道互斥（F-G6A-4 行 READINESS.md:247） | **G1-NS-01**（物理 ns 可迁移性契约 + 打开期漂移检测 + 与 `dir.ns` 冻结的互斥正面处理；夹具 `tests/fixtures/g6a-p5-drift.db` + 探针已钉） |
| **审查方覆盖面进基线流程位** | 重算/重锚全部无二人标记、无清单哈希锚定（G5-A 最低机械防线三条，READINESS.md:216-218；GT-3 实测） | **G1-GATE-01**（该条即此流程位本身：CI 前纪律归属与责任人须指定） |

表外无残余：G0 复审轮各席位报告中标「未修」且未进上表的条目，均已在契约轮登记去向
（READINESS.md:265-270：F-G6A-2/6→`G1-EVT-01`、F-G6A-3→`G1-ROUTE-01`、
F-G6A-5→`G1-AUDIT-01`、§15 G1-a→`G1-OWN-02`、§15 G1-c→`G1-LINK-01`）或为
「已修，待独立复验」类（保持原字样，不在本表重复记账）。

## 8. 本文档的更新义务

- 提交本文后：重跑 `docs:sync --write`（补索引）+ 对 HEAD 跑 `docs:check`（§4 纪律）。
- G1 冻结评审启动时：§7 表中 `G1-*` 条目逐项关闭或改道，本表随行修正——**修正只许改
  「去向」列并留痕迹，事实列以 READINESS/席位报告为准**。
