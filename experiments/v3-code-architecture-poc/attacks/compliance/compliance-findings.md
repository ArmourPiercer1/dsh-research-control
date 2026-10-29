# 规范符合性（合规轴）独立审查 — Findings

> 审查席位：规范符合性猎手（`qwen3.8-27b`，独立上下文；路由偏离见 `REVIEW.md` §1）。
> 对象：`experiments/v3-code-architecture-poc/` 全部文档与代码，对照 PR #42 契约基准
> `0369c3196cec0b217125afeba78b89933be5d4c9`（只读提取，未切分支、未写正源）。
> 本文件仅登记可复现结论；每条含 file:line + 复现命令。

## 0. 审查锚点（如实记录：工作树在审查期间持续演进）

- 已审提交链（审查期间 HEAD 从 `ec07538` 推进到 `6ec6852`）：
  `f9a6c86`（第 1 轮 5 处 P1 修复）→ `4ab5cf6`（复审/演化 4 处，F-14 改判 P0）→
  `0af67e2` / `afdba51` / `c76da3a` / `b914125` / `30dc739` / `6ec6852`（入档与守卫回归）。
- 最终核验时点：**2026-10-30 00:09:03，HEAD = `6ec6852`，工作树含 14 个 M + 5 个未跟踪**
  （第 3 轮修复进行中：`attacks/evolution/`、`attacks/semantics/`、`tests/schema-evolution.test.ts`
  等正在被创建/改写）。本文 findings 以"HEAD `6ec6852` + 该时点工作树"为锚；
  进行中修复以【在途】标注，不作为定论。
- 时点快照（sha256）见 `SNAPSHOT-235458.txt` 与本文件末附；关键文件：
  `kernel.ts=55401efe…`、`read-context.ts=c70218c4…`、`sqlite-port.ts=72ed2619…`、
  `CONTRACTS.md=b614e6ae…`、`RECONCILIATION.md=bd48ea86…`、`EVIDENCE.md=8b8698a0…`（00:09:03 时点值）。

## 1. 前 6 条主张的复核结论（对应 `REVIEW.md` §8 / `ASSESSMENT.md` §3 的逐条核验）

| # | 主张 | 处置记录 | 本人独立复核（00:09 时点） |
| --- | --- | --- | --- |
| 1 | "本仓引用了不存在的规则号 ID-09/10、RF-07/08、T-06..08、PR-A5/A6、SD-*" | 驳回 | **复核同意驳回**：对 `src/`、`tests/`、`*.md` 做引用位 grep，命中仅 `RECONCILIATION.md:34-42` 的"反例清单"表（标题与消歧说明均明示不是引用表）；无任何文件把它们当条文引用 |
| 2 | M-3 登记序断言表述含糊 | 部分采纳 | **已落实**：`EVIDENCE.md` M-3 现读为"其后第一次成功提交落在 `seq=1`、`ledger_head()===1`、`count(seq>1)===0` … `p1` 中途失败例 :60-67"；行号核对准确（`tests/p1-storage-tx.test.ts:60-67` 断言一致） |
| 3 | `EVIDENCE.md` §2 例数过期 | 采纳 | **部分落实，已再次过期**：按席位拆开的表已加入（8 行合计 63），但表内缺 `tests/sql-guard.test.ts`（10 例）与 `tests/multiprocess-contention.test.ts`（1 例）两行；同节首行仍是 "Test Files 7 / Tests 58"。见 P2-C4 |
| 4 | `docs:check` "直接 OK" 掩盖先红后绿 | 采纳 | **已落实**：`EVIDENCE.md` §4 现记录 `FAIL DOCS_INDEX_STALE @ docs/README.md` → `docs:sync --write`（只写派生索引）→ `OK — 1200 tracked files`，并注明未剔除问题文件 |
| 5 | `[实测]` 把纯逻辑断言包了进去 | 采纳 | **部分落实**：`EVIDENCE.md` §3 已加"[实测] 的作用域"定义；`CONTRACTS.md:56` kind 路由已改 **[实现断言]**；但 `CONTRACTS.md:60` 循环引用行仍标 **[实测]**（处置记录称"循环引用无证明力"也改 [实现断言]，未落地）。见 P2-C10 |
| 6 | `test-validation.ts` "UNKNOWN → 合规：PASS" 措辞 | 采纳 | **未落实**：该文件与 HEAD 一致（`git diff HEAD -- …/test-validation.ts` 为空，最后提交 `ec07538`），`:46` 仍为"⇒ PASS 并记入 declared_gaps（RPT-05、RD-25）"；全树 grep "状态合法" 仅命中 `REVIEW.md:126` 的处置记录本身。且处置记录里的替代措辞（UNKNOWN 情形下 `coverage=INCOMPLETE_DUE_TO_VISIBILITY`）与 P3 断言语义不符（该 coverage 值只属于被屏蔽引用情形，`test-validation.ts:52-56`）。见 P2-C11 |

## 2. 本轮新 findings

### P1-C3 — F-15 的回归测试在 HEAD 上缺失（台账引用了不存在的回归）

- 违反条款：本仓自定纪律——`tests/sql-guard.test.ts:7` "缺一条测试就等于该分支未被证明"；
  `README.md` 布局表 "`attacks/<审查轴>/` … 其失败本身就是 finding"；`READINESS.md` §1
  "attacks/** 攻击测试 | 作为回归资产随契约演进扩充"。
- 位置：`REVIEW.md:44`（§2.1 F-15 行）；`src/storage-sqlite/sqlite-port.ts:167/173/180`
  （三处 `SCHEMA_UPGRADE_REQUIRED` 抛出点，无任何测试触达）。
- 复现：
  ```bash
  grep -rn "SCHEMA_UPGRADE_REQUIRED" tests/ attacks/   # 在 HEAD 6ec6852 上：零命中
  git log --all --oneline -- 'experiments/v3-code-architecture-poc/attacks/evolution/*'  # 空
  grep -n "演化攻击例" REVIEW.md                        # :44 F-15 行
  ```
- 根因：F-15 的演化攻击文件（手造缺 `records` 旧库 ⇒ `SCHEMA_UPGRADE_REQUIRED`）从未被提交；
  `REVIEW.md` 台账把"演化攻击例 + 新库可正常打开的反差锚点"整体记为回归，但树内只存留下
  反差锚点（`tests/sql-guard.test.ts` "F-15 反差" 一例）。版本/表集/触发器集不匹配的
  三个 throw 分支因此无测试保护，属于"作者自称修好不算证据"的同类情形。
- 最小修法：把手造旧库的负例提交进 `tests/` 或 `attacks/evolution/`（一个负例 + 现有反差锚点即可）。
- 回归测试：即该负例本身（建议断言三要素：无版本标记 / 版本不符 / 版本对但缺表，各抛
  `SCHEMA_UPGRADE_REQUIRED` 且 detail 含 `missingTables`/`expectedVersion`）。
- 【在途】00:09 时点观察到 `attacks/evolution/old-schema-{counters,records}.test.ts`、
  `tests/schema-evolution.test.ts` 正在创建（且 `schema-evolution.test.ts` 已 grep 命中
  `SCHEMA_UPGRADE_REQUIRED`），并引出更深一层缺口（"模式新、历史旧"：`records` 出现前经
  `ledger.record_id` 声明的记录 ⇒ `readRecord` 静默 undefined ⇒ 必需 record-ref 永判缺失）。
  若该轮按台账纪律提交并复审，本条可关闭；**在提交与独立复审之前，本条成立**。

### P2-C1 — "46 个规则号"计数不可复现

- 位置：`RECONCILIATION.md:29`。
- 复现：对钉死基线 `5ec38974:docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` 的 §15 表
  （:400-413）逐格展开区间：
  ```bash
  git show 5ec38974:docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md | sed -n '400,413p'
  ```
  展开后**去重**规则号 = **58**（T-02/05、C01..C12、CC-06/07/09/10、IC-H3/S1/H6、
  RD-01/03/04/07/15/20/25/32/34/37/38、ID-01..08、PR-A1..A4、RF-02/04/05/06、
  RPT-00..11、XC-28）；若按字面记号（区间记 1 次）= **39**。"46"与两种算法都对不上。
  存在性结论本身**成立**：58 个 ID 逐一 `git grep -E "(^|[^A-Za-z0-9])<ID>" 0369c319 -- docs/`
  全部命中（含 `RPT-00`，定义在 `H_S_R_NORMALIZATION_CONTRACT_DRAFT.md:23`）。
- 根因：计数口径未写入文档，且与基线 §15 的现行文本不一致（可能按旧稿或第三种口径数得）。
- 最小修法：把口径写进该句（例如"区间展开后 58 个去重规则号，逐一命中"）或直接删掉数字。
- 回归：不适用（文档修正）；建议 `RECONCILIATION.md` 加一条"计数口径"脚注。

### P2-C2 — "缺任一必填字段 ⇒ CONTEXT_INCOMPLETE" 只测了一种组合，且顺序回归已实际发生

- 位置：`CONTRACTS.md:99`（**[实测]** 标记）；`tests/p4-read-isolation.test.ts:28-35`；
  `src/kernel/read-context.ts:26-40`。
- 复现：
  ```bash
  grep -n "REQUIRED_FIELDS" src/kernel/read-context.ts        # ['space','principal','mode','consistency']
  sed -n '28,35p' tests/p4-read-isolation.test.ts             # 唯一负例：缺 space+principal+consistency，mode 在场
  ```
  `mode` 单独缺失的分支无测试。00:08:14 的实跑已给出反例证据：一次在途编辑把
  "space 比较"提到"缺字段检查"之前后，该负例 spec 得到的是 `CROSS_SPACE_REFUSED` 而非
  `CONTEXT_INCOMPLETE`（实跑输出见 §4），测试红了才被抓回——"缺任一字段"的普遍性主张
  与检查顺序强耦合，逐分支覆盖不是可有可无。
- 最小修法：p4 该例改为 `test.each` 四个单字段缺失变体（各断言 `CONTEXT_INCOMPLETE` 且
  `detail.missing` 精确等于该字段）。
- 回归：即上述四变体。
- 附注：00:09 时点工作树的 `read-context.ts` 已把缺字段检查置于跨空间检查之前（注释
  "完整性先判…顺序本身就是契约"），但**同一检查重复了两行**（`if (spec.space !== k.space)
  throw …` 连写两次）——【在途】文件，提交前应删重。

### P2-C4 — `EVIDENCE.md` 计数在采纳修复后再次过期（同 #3 一类）

- 位置：`EVIDENCE.md` §2 首行（"Test Files 7 passed (7) / Tests 58 passed (58)"）vs 同节表
  （8 行合计 63）vs 实际（00:09 时点 10 个测试文件；`b914125` 后至少 74 例）。
- 复现：
  ```bash
  grep -cE "^\s*(test\(|test\.each\()" tests/*.test.ts attacks/*/*.test.ts   # 静态行数
  # test.each 需展开：sql-guard = 6 负例 + 3 正例 + 1 F-15 反差 = 10 例
  ```
- 根因：按席位拆表在 `f9a6c86` 后生成一次，`b914125`（+sql-guard 10 例）与
  多进程例（+1）之后未重生成；首行数字是更早一次（`f9a6c86`）的。
- 最小修法：按 EVIDENCE §2 自己的约定"增删测试须重生成"，用
  `npx vitest run --config …/vitest.config.ts --reporter=json` 重跑一次全表。
- 【在途】00:09 时点 `EVIDENCE.md` 正在被修改（M），可能已重生成；以提交态复核为准。

### P2-C5 — `READINESS.md` §1 首行计数与树内攻击例数对不上

- 位置：`READINESS.md` §1 第一行"73 例断言全绿（含 14 例审查员攻击）"。
- 复现：
  ```bash
  grep -c "expect(" tests/*.test.ts attacks/*/*.test.ts | awk -F: '{s+=$2} END{print s}'  # = 239
  grep -cE "^\s*(test\(|test\.each\()" attacks/*/*.test.ts    # 树内攻击文件：host 5 + invariant 3 + review 5 = 13
  ```
  无论按"测试例数"（00:09 时点 74）还是"断言数"（239），"73"都不成立；"14 例攻击"中第 14 例
  （演化攻击）在 HEAD 上不存在（见 P1-C3），树内实存 13 例。
- 最小修法：数字改为命令生成或加时点限定；攻击例数随 P1-C3 的回归落位一并更正。

### P2-C6 — `RECONCILIATION.md` §0 "本分支 HEAD = 该值" 已失实

- 位置：`RECONCILIATION.md:13`（"5ec38974（本分支 HEAD = 该值）"）。
- 复现：`git rev-parse HEAD`（00:09 时点 = `6ec6852`，其后于 `5ec38974` 12 个提交）。
- 根因：§0 是分支创建时的核验快照，分支自身演进后括号注释未更新。
- 最小修法：括号改为"（本分支由该 head 切出；后续提交见 `git log`）"。

### P2-C7 — 代码注释引用了台账里不存在的 F-16

- 位置：`src/storage-sqlite/sqlite-port.ts:107`（"见 `REVIEW.md` F-16/F-17"）。
- 复现：`grep -rn "F-16" *.md src/ tests/ attacks/` → 仅该注释自身命中；`REVIEW.md` 编号为
  F-10..F-15、F-17、F-18、F-14′、F-14″，无 F-16（演化轴发现记为 F-15）。
- 最小修法：注释改为 "F-15/F-17"。

### P2-C8 — `ASSESSMENT.md` "P1 组 9 例" 过期（与 #3 同类）

- 位置：`ASSESSMENT.md` §2 第 1 条"（P1 组 9 例）"。
- 复现：`grep -cE "^\s*test\(" tests/p1-storage-tx.test.ts` = **10**（`f9a6c86` 增补跨能力单事务例）。
- 最小修法：改为 10 例（或"以 `EVIDENCE.md` §2 表为准"）。

### P2-C9 — p2 移交例的注释与授权表不符（"只有 space-write" 的主体其实无任何授权）

- 位置：`tests/p2-identity-plugin.test.ts:124`（注释"只有 space-write"）vs `:21`
  （`GRANTS = { alice: ['space-write', 'capability-admin'] }`，carol 不在表内）。
- 复现：`sed -n '21p;124,125p' tests/p2-identity-plugin.test.ts`。
  该断言仍可区分新旧实现（旧实现 carol 得 `NO_SPACE_WRITE` ≠ `AUTHORITY_REQUIRED`），
  但"只有 space-write"的 SP-09 精确场景在 p* 主套里没有——它在
  `attacks/host/host-boundary-attack.test.ts:47-50`（alice 仅 space-write + rooter 反差锚点）。
- 最小修法：把 carol 显式授 `space-write`（`world('p2-transfer', { carol: ['space-write'] })`
  或等价 grants 参数），使主套自身覆盖"有写权、无运维权"场景；或把注释改为"无任何授权"。

### P2-C10 — 采纳处置 #5 未完全落地：`CONTRACTS.md:60` 循环引用行仍标 [实测]

- 位置：`CONTRACTS.md:60`（"同事务内循环引用可写入，Kernel 不因此产生任何'证明力'产物。**[实测]**"）。
- 复现：`sed -n '56,61p' CONTRACTS.md`（对比 :56 已改 [实现断言]）。
- 说明：该行是复合主张——"可写入"属存储行为（p2 同事务循环引用例在真实 SQLite 上成立，
  [实测] 可辩护），"不产生证明力产物"属纯逻辑。按 §8 处置记录的字面（"循环引用无证明力等
  改为 [实现断言]"）未落地。
- 最小修法：拆成两行分别标注，或整行改 [实现断言] 并让"可写入"并入 ST 组条款。

### P2-C11 — 采纳处置 #6 记录在案但未改文件（且替代措辞本身与 P3 断言冲突）

- 位置：`REVIEW.md:126`（处置记录）vs `src/domains/test-validation.ts:46`（未改，与 HEAD 一致）。
- 复现：
  ```bash
  git diff HEAD -- src/domains/test-validation.ts   # 空
  grep -rn "状态合法" src/ tests/                   # 无命中（仅 REVIEW.md:126 自引）
  sed -n '44,56p' src/domains/test-validation.ts    # UNKNOWN/ABSENT ⇒ PASS + declaredGaps；
                                                     # INCOMPLETE_DUE_TO_VISIBILITY 只出现在 withheld 分支
  ```
- 说明：现行注释"⇒ PASS 并记入 declared_gaps（RPT-05、RD-25）"与 RPT-05/RD-25 的三线分离
  及 P3 断言一致，措辞问题轻微；但台账记了"已采纳并改写"而文件未动，属记录-执行脱节。
  另处置记录里的替代措辞把 UNKNOWN 情形的 coverage 写成 `INCOMPLETE_DUE_TO_VISIBILITY`，
  与实现和 P3 断言（该值只属于被屏蔽引用）不符——若按记录照改反而会引入错误。
- 最小修法：二选一并在台账闭环——(a) 按正确口径改注释（UNKNOWN 情形：状态合法、不产生
  finding、记入 declaredGaps、coverage 保持 COMPLETE）；(b) 复核后认定原注释无误，在
  `REVIEW.md:126` 追加"复核后维持原文"的闭环注记。

## 3. 四条攻击轴总判定

| 轴 | 判定 | 依据（命令摘要） |
| --- | --- | --- |
| 1 引用真实性 | **未发现 P0/P1**（1 条 P2：C1 计数口径） | 58 个 §15 去重规则号逐一 `git grep -E "(^|[^A-Za-z0-9])<ID>" 0369c319 -- docs/` 全命中；行号锚点（ID-08@DOMAIN_FOUNDATIONS:47、RF-06@:124、T-05@:85、PR-A4@PROPOSITION:124、SP-09@:155、SP-10@:156、RV-03@:138、DF-06@:167、RPT-01@NORMALIZATION:42、C11@COMPOSITION:103、IC-S2@INTERACTION:87）逐一核对一致；缺失编号主张（ID-09/10、RF-07/08、T-06..08、PR-A5/A6、SD-）用带左词边界 grep 独立复证为真（0 命中）；"66 文件"= docs/ 下 66 个 .md（全树 75 个文件），准确 |
| 2 [实测] 标记真实性 | **未发现 P0/P1**（1 条 P2：C2 覆盖缺口） | `CONTRACTS.md` 全部 **[实测]** 行逐条映射到 p1-p4 真实断言（ST-1..ST-7、CP-1..CP-7、§4-§9 各条，映射见 §5）；涉及事务/历史真源/空间隔离/权限边界的 实测 主张全部有真实 SQLite 断言支撑（含 00:08 实跑前）；CP-5 权限分轴在 HEAD `f9a6c86` 起有调用点 + 写点双重强制与攻击回归（`kernel.ts:254/271`、`reassignRouteInternal` 二次核对、`attacks/host:46-69`） |
| 3 状态词汇升级 | **未发现** | `grep -rn "PRODUCT READY\|IMPLEMENTATION READY\|ARCHITECTURALLY SOUND\|POC VERIFIED" src/ tests/ *.md`：所有出现均带限定（"最高只能声称 POC VERIFIED"、"不得由前三者推出"、"不是 IMPLEMENTATION READY"）；`ASSESSMENT.md` 明确"不建议现在就宣布架构健全"；`READINESS.md` 首行"当前 POC VERIFIED，不是 IMPLEMENTATION READY" |
| 4 合成策略标注 | **未发现** | `src/domains/*` 六个文件头逐一读取：test-records/test-validation/test-object-model/test-facet 均含"测试专用/合成占位/不构成 PR #42 科研语义政策的实现/不得被引用为其证据"强表述；`report-presentation.ts` 的 `SYNTHETIC_AUDIT_VISIBILITY` 注释"此处是合成占位"；措辞在审查期间未被削弱（00:09 时点 test-records 头仍为强表述） |

## 4. 过程观察（不定级，供台账参考）

1. **审查期间套件曾红（00:08:14 实跑）**：`pnpm run test:poc:arch` →
   `Test Files 2 failed | 9 passed (11) / Tests 2 failed | 73 passed (75)`，exit 1：
   - `arch-independence.test.ts:95`：`KERNEL_SURFACE.sha256` 期望
     `53f1f52f…`（提交态基线）≠ 实算 `2900bf10…`——第 3 轮 Kernel 变更进行中，基线重生成
     尚未落盘（00:09 时点工作树基线文件又变为 `656e325f…`，仍在变化）。
   - `p4-read-isolation.test.ts:32`：缺 space 的 spec 得到 `CROSS_SPACE_REFUSED` 而非
     `CONTEXT_INCOMPLETE`（检查顺序回归，即 P2-C2 的实证；00:09 时点工作树已修正顺序，
     但残留重复行）。
   两条均为**在途编辑的瞬态**，非 HEAD 缺陷（HEAD 上此前入档记录为绿）。**结论：第 3 轮
   提交后必须复跑本门并刷新 EVIDENCE §2/§7 数字，否则"已绿"主张无证据。**
2. `EVIDENCE.md` §6 声称根门禁独占重跑全绿（5082 passed，`HEAD c76da3a`，日志
   `.scratch/root-serial.log` gitignored）。本席位未复跑根门禁（任务面只允许
   `pnpm run test:poc:arch`）；该主张按其自带条件（无并发测试流量）采信，登记为
   "依赖其独占重跑前提"。
3. `RECONCILIATION.md:14`"未 upstream 跟踪（防误推）"与 `EVIDENCE.md` §8"已推送过一次
   （远端同名新分支）"并存：两者可同时为真（推送未设 upstream），但并置易误读，
   建议 RECONCILIATION §0 补一句指向 EVIDENCE §8。
4. `REVIEW.md:116` 标题"2 条驳回、4 条采纳"与同节尾行"驳回一条、部分采纳一条、采纳四条"
   口径不一（一处把部分采纳计入驳回）。数字口径问题与 P2-C1 同类，台账内应统一。

## 5. [实测] → 断言映射表（00:09 时点核验，全部命中）

| 条款（`CONTRACTS.md`） | 断言位置 |
| --- | --- |
| ST-1 一空间一文件 / 5 出口不泄漏 | `p4:64-92`（①-⑤ 出口）、`world.ts` 单文件装配 |
| ST-2 `begin immediate` 在 try 内 / 真实 BUSY | `p1:144-163`（TX_CONTENTION + `driverErrcode=5` + retryable + 零残留）；`sqlite-port.ts tx()` |
| ST-3 提交期失败整体回滚 | `p1:132-142`（failBeforeCommit）、`p1:89-127`（跨能力中途失败四表零变化） |
| ST-4 登记序事务计数器 | `p1:43-69`（回滚后 head=0、下次从 1、`count(seq>1)=0`） |
| ST-5 ledger/check_report 触发器拒改删、directory 冻结、journal 可删 | `p1:182-190`、`p2:44-52`（kind/space 冻结）、`p3` 报告不可改写例 |
| ST-6 暂存不可见且与不存在同形 | `p1:165-180`（第二真实连接读不到 staged oid） |
| ST-7 驱动码不越 Port | `p1:157-159`（机制码 + detail 留驱动码） |
| §2 锁语义 502ms 探针 | `EVIDENCE.md` M-1（一次性探针，明示非套件）+ `p1:144-163` 套件锚点 |
| CP-1 事件权威唯一（装配期拒绝） | `p1:192-208`（AMBIGUOUS_AUTHORITY + `none` 可共存反差） |
| CP-2 必需依赖缺失/成环、可选降级 | `arch-independence:143`（成环 ACTIVATION_IMPOSSIBLE）；可选降级路径无独立断言（见下注） |
| CP-3 持久路由、重启所有者不变 | `p2:119-137`（重启后 registry 与 readObject 均保持 split） |
| CP-4 移交原子、失败不回写内存 | `p2:119-137`（失败 ⇒ 路由不变 + `capability-transferred` 登记 0 条；授权后 1 条） |
| CP-5 移交/装卸只认 capability-admin | `kernel.ts:251-254/261-271`（调用点 requires）、写点二次核对（`reassignRouteInternal`）、`p2:124-125`、`attacks/host:46-69`（space-write-only 拒绝 + 强转旁路拒绝 + 反差锚点） |
| CP-6 ns 漂移双向 fail-loud | `p2:139-147`（读/写双向 SCHEMA_INCOMPATIBLE） |
| CP-7 授权轴经 `uow(…,requires)` 进入 | 机制存在且 Kernel 自用（CP-5 各行）；**领域侧经注入 Authorizer 直查**（`test-records.ts declare()`），不经 uow requires——条款"业务授权轴由领域…经 uow 进入"的领域半句与实现不符，见注 |
| §4 精确/导航引用对照、硬引用提交期校验、同事务循环引用、暂存同形 | `p2:60-98`、`attacks/invariant:35-47`（修订级，F-12/F-17 后更强）、`p1:165-180` |
| §6 Raw/Admission 全组 | `p3`（14 例：不可解析可登记、接纳失败保源、可解析≠合格、端点类别、无写权全拒） |
| §7 校验与报告全组 | `p3`（版本化不可改写、UNKNOWN、不可用降级、归约、FAIL+INDETERMINATE 共存） |
| §8 ReadContext/双时间/隔离/脱敏 | `p4:28-35、37-62、64-92、94-108` |
| §9 投影三态、Journal 非真源、游标持久、业务视图直读 | `p4:110-204`（gap、journal-only 重放 1 vs 2、重启续跑、STALE/FRESH、截断回显） |

注 1（CP-2）：可选依赖缺失 ⇒ `registry.degraded` 的路径**无独立断言**（仅 arch-independence
的成环例与"改可选即可装配"叙事）。`degraded` 在 `kernel.ts` 装配路径存在，但没有任何
测试断言 `degraded` 为真。若 CP-2 的 [实测] 解释为"成环拒绝"则成立，解释为"可选降级"
则未实测——建议把 [实测] 限缩为"成环 ⇒ ACTIVATION_IMPOSSIBLE"，可选降级单列 [实现断言]
或补一例。按"宁可少报"，本项未定级，仅作解释边界提示。
注 2（CP-7）：见 §5 行内说明；实测半句（接纳授权独立判定）成立（`p3` 授权轴两例）。

## 6. 结论

- 四轴：**未发现 P0**；P1 一条（C3：F-15 回归在 HEAD 缺失，【在途】修复中）；
  P2 十一条（C1/C2/C4/C5/C6/C7/C8/C9/C10/C11 + 注 1 未定级观察）。
- 前 6 条主张：2 条被驳/部分采纳的复核与台账一致；4 条采纳中 2 条完全落实、2 条部分落实
  （#3 再次过期、#5 剩 L60）、1 条未落实（#6）。
- 状态词汇总判：**未越级**；当前树可声称上限维持 POC VERIFIED（且第 3 轮提交前应复跑
  `pnpm run test:poc:arch` 刷新证据，见 §4.1）。
- 本席最终立场见随附给委派代理的消息（含逐条 file:line 与复现命令）。
