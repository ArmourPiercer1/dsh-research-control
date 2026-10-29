# PoC Evidence — 命令、SHA、退出码与实测现象

> 本文件只登记**可复现证据**。任何未被本文件命令覆盖的说法，都不得当作已证明。
> 状态词汇见 `README.md`；结论解读见 `ASSESSMENT.md`。

## 1. 环境与被审提交

| 项 | 值 |
| --- | --- |
| PoC 分支 | `poc/v3-code-arch-20261030`（由 PR #44 head 直接切出，未设 upstream 防误推） |
| 基线 | PR #44 head `5ec38974`（`origin/design/v3-code-architecture-review-20261027`） |
| 领域契约基准 | PR #42 head `0369c3196cec0b217125afeba78b89933be5d4c9` |
| 工程基线 | `origin/main` = `80abe7d` |
| SQLite | `node:sqlite`（内置），SQLite 3.53.4，Node 24.21.0 |
| 新增依赖 | **无**（未装 better-sqlite3 等；用 Node 内置驱动） |

核验命令：

```bash
git rev-parse HEAD
git rev-parse origin/design/v3-code-architecture-review-20261027
gh pr view 42 --json headRefOid --jq .headRefOid
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');console.log(d.prepare('select sqlite_version() v').get().v)"
```

## 2. PoC 套件（本区独立 runner）

```bash
pnpm run test:poc:arch          # exit 0
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json   # 0 诊断
```

结果（阶段 D 修复后）：**Test Files 7 passed (7) / Tests 58 passed (58)** = 49 例作者测试
+ 9 例审查员攻击测试（其中 2 个文件按修复后契约改写为更强断言，见 `REVIEW.md` §2），全部断言跑在
`experiments/v3-code-architecture-poc/.poc-data/**` 下的真实 SQLite 文件上。

> 例数不手写：由 `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts
> --reporter=json` 按文件计数；下表为当前分支快照（增删测试须重生成）。

| 文件 | 例数 | 覆盖的架构检验 |
| --- | --- | --- |
| `tests/p1-storage-tx.test.ts` | 10 | §13.1/§13.4、§15.1 边界①：单空间跨插件 UoW 原子性、三类故障注入、事件权威唯一、Ledger 不可变、Journal 可压缩、暂存不可见、无写权拒绝 |
| `tests/p2-identity-plugin.test.ts` | 10 | §13.2/§13.3、§15.1 边界②：kind 固定、精确 vs 导航引用、同事务循环引用、硬/软引用、拆包后身份不变、移交持久与原子、ns 漂移 fail-loud、Facet 全周期、越权写拒绝 |
| `tests/p3-intake-validation.test.ts` | 14 | §13.5/§13.7/§13.8、§15.1 边界③：Raw Intake、接纳失败保源、可解析≠合格、版本化报告不可改写、UNKNOWN 合法、不可用降级、归约唯一、端点类别纪律、授权轴与派生视图截点 |
| `tests/p4-read-isolation.test.ts` | 9 | §13.6/§13.10/§13.11/§13.12、§15.1 边界④：ReadContext 必需性、双时间顺序、五出口空间隔离、缓存出口、呈现脱敏不可区分、Journal 缺口与"Journal 不能充当历史"、游标续跑与滞后标注、影响只给候选、截断必须标注 |
| `attacks/invariant/`（不变量攻击者） | 3 | 登记序、精确引用、记录标识（原始攻击 + 修复后更强断言） |
| `attacks/host/`（宿主与边界） | 5 | 修订级引用、报告登记序、路由权威、强转触达内部方法、SQL 守卫 |
| `tests/multiprocess-contention.test.ts` | 1 | 真起子进程抢写事务：写被拒可重试、读不受阻、未提交不可见、提交后无丢写 |
| `tests/sql-guard.test.ts` | 10 | **F-14′ 完整覆盖**：块注释/行注释/多注释/前导分号/多语句 六类负例 × `run`/`all`/`get`，每条负例配「拒绝后不可变性仍生效」的反差；三条正例防误伤；另有打开已建库不重跑 DDL 且 `schema_version` 可读 | 
| `attacks/review/`（P1 修复复审） | 5 | 第 1 轮修复完整性：报告三件套同滚、源端修订、守卫绕过（注释前缀/多语句）、目标 manifest |
| `tests/arch-independence.test.ts` | 7 | 任务硬约束「Kernel 不包含科研语义判定规则」+ 依赖方向 + 领域插件扩展不需改 Kernel（面哈希）+ 五类 kind 路由 + 必需依赖成环拒绝 |

## 2b. 第 3 轮红测试的逐条归属（不得笼统说"剩余问题"）

| 红文件 | 判定 | 依据 |
| --- | --- | --- |
| `evolution/old-schema-records` 5 红 | 夹具自身 `9 values for 10 columns`，且现在被打开期 `SCHEMA_UPGRADE_REQUIRED` 先拦住 ⇒ 断言写的是修复前形态，**结论不可从当前红测试读出** | `REVIEW.md` §9 F-28；作者独立复现见 `tests/schema-evolution.test.ts`（检出 + 显式迁移器，3 条全绿） |
| `evolution/old-schema-counters` 2 红 | **路劲已封**：缺 `schema_version` 即拒绝打开，另加 OID 计数器落后检查；断言仍写"打开成功然后撞号" | `REVIEW.md` §9 F-29，改写权在审查方 |
| `evolution/contract-version-skew` 2 红 | 攻击前置条件已被装配期拒绝，攻击构造不出来；断言编码修复前静默装配 | `REVIEW.md` §9 F-26/F-27、§10 |
| `evolution/lifecycle-sequence` 2 红（流动） | 1 条为语义分歧（ns 漂移：作者 fail-loud vs 审查方要求返回 0 行），1 条待复审判定 | `REVIEW.md` §9 F-24、`CONTRACTS.md` §12b |
| `evolution/projection-and-era` 1 红 | era 前置条件被打开期拒绝 | `REVIEW.md` §11.1 |
| `semantics/stopline-vocabulary` 1 红 | **成立**，确认缺陷 F-31（词汇门禁被 `WITHHELD_REFERENCE`／小写／JSON 键名绕过）；本轮不改，避免替换正在被审计的对象 | `REVIEW.md` §11.3 |

## 3. 关键实测现象（不是类型签名推断）

> **[实测] 的作用域**：指"断言跑在真实 `node:sqlite` 文件上且可复跑"。它**不**自动蕴含多进程
> 并发、崩溃恢复或宿主集成（那些在 §5 列为未证明）。纯逻辑类断言（kind 路由、证明力缺失等）在
> `CONTRACTS.md` 中标 **[实现断言]**，与存储边界实证区分。

| 编号 | 现象 | 复现 |
| --- | --- | --- |
| M-1 | 另一连接持写锁时，本事务在 `busy_timeout` 耗尽后失败；探针实测等待 502ms 后 `errcode=5`（SQLITE_BUSY），持锁方提交后只读到对方的行 ⇒ **无部分提交** | `p1` 提交冲突例 + 一次性探针 `node -e "...DatabaseSync..."` |
| M-2 | 提交前钩子抛出 ⇒ `object_directory` 计数 0、`ledger_head` 0；随后同世界可正常提交 ⇒ 零不是"写不进" | `p1` 提交阶段失败例 |
| M-3 | 中途抛错的事务不推进水位：其后第一次成功提交落在 `seq=1`、`ledger_head()===1`、`count(seq>1)===0` ⇒ 回滚不留 phantom 空洞（非事务自增做不到） | `p1` 中途失败例 :60-67 |
| M-4 | `update/delete from ledger` 与 `update object_directory` 被触发器拒绝；`delete from journal` 允许 ⇒ 不可变性是存储层属性，不是"整库只读" | `p1` 不可变探针 |
| M-5 | Journal 单独重放只得 1 条，而权威登记有 2 条 ⇒ Journal 不得充当历史真源 | `p4` 缺口例 |
| M-6 | 跨空间目标引用与"目标不存在"的呈现**深度相等**，且序列化后不含对方空间标识 | `p4` 隔离例 |
| M-7 | 脱敏后报告不含任何数字（无计数侧信道），而审计视图仍保留完整区分 | `p4` 脱敏例 |
| M-8 | 移交在事务内改路由 + 留登记；失败事务不回写内存视图；重启后所有者不变 | `p2` 移交例 |
| M-9 | 换实现但 ns 未迁移 ⇒ 读写双向 `SCHEMA_INCOMPATIBLE`，不静默返回空 | `p2` 漂移例 |
| M-10 | 加第二个领域插件（新 kind + 新 ns）时 Kernel+契约 sha256 面基线不变，两种 kind 正确路由 | `arch-independence` 面哈希例 |

## 4. 主仓门禁（PoC 分支上的实测）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 根单测全量 | `pnpm test` | 首跑 `2 failed / 5080 passed / 21 skipped (364 files)`；两个失败文件单独跑均全绿，归因见 §6 |
| 类型债门 | `pnpm run check:types` | `[tsc-gate] known-failing debt reproduced EXACTLY (19 diagnostics; identity match, not count match)` — **未新增债务** |
| 导入不变量 | `pnpm run lint` | `check-imports: OK — no INV-PERM-5 violations in src` |
| 文档静态一致性 | `pnpm run docs:check` | 本分支上**先红后绿**：新增侧车文档后报 `FAIL DOCS_INDEX_STALE @ docs/README.md: 派生索引过期`；按门禁给出的唯一处置执行 `pnpm run docs:sync --write`（只写派生索引）后复跑 → `OK — 1200 tracked files, static consistency clean`。**未**把问题文件从索引或门禁剔除 |
| 文档索引 | `pnpm run docs:sync --write` | 已重生成 `docs/README.md` 派生索引（唯一可自动写文件） |

## 5. 未证明的边界（禁止越级引用）

**已补证（本轮之后）**：多进程并发写同一空间文件 ⇒ `tests/multiprocess-contention.test.ts` 用
`node` 真起子进程抢写事务并忙等 3s（超过 `busy_timeout=2000`），父进程得到 `TX_CONTENTION` 且
`retryable=true`；同一时刻读不受阻、子进程未提交的 `journal` 行不可见；子进程提交后两侧内容都在
（无丢写、无半写）。同进程双连接的旧证据保留，两者不互替。

仍未测：DSH 宿主权限面与工具面；真实五类对象字段与状态机；性能/容量；备份与时间点恢复；
Schema **迁移器**（本轮只做了"打开时拒绝不匹配版本"，没有做迁移脚本）；热插件加载与沙箱。
领域判据全部是**合成占位规则**（`src/domains/**` 文件头声明），不得被引用为 PR #42 科研语义
政策的实现。

## 6. 根单测两个失败的归因（记录事实，不猜结论）

首跑 `pnpm test` 报 2 失败：`tests/engineering/eb2-docs.test.ts`（docs:sync 写边界）与
`tests/g5-real-registry/workflow.test.ts`（history_query 重放得到 4 条而非空）。

已核实的事实：
- 两个文件**单独跑均全绿**（`npx vitest run <file>`：25 tests passed / 15 tests passed）。
- `eb2-docs` 那条会**就地改写 `docs/README.md`** 再断言 `docs:sync --write` 能逐字节还原；
  首跑时有 4 个对抗审查子代理在并发运行同一仓的 `pnpm run test:poc:arch` 与 git 只读命令。
- `g5-real-registry/workflow.test.ts` 不使用 `tests/dsh-homes/`（grep 无命中），因此与
  DSH_HOME 残留无关。

处置：该两条与 `experiments/**` 无代码交集（本区被根 vitest 排除、被根 tsconfig 排除、
不参与 lint、不进 build）。

**最可能的归因（待一次独占串行重跑确认）**：两次全量运行都与其他进程**并发**跑在同一工作树：
- 第 1 次（2 失败）期间，作者正在提交并执行 `pnpm run docs:sync --write`——而
  `eb2-docs.test.ts` 那条正是**就地改写 `docs/README.md` 再断言 sync 能逐字节还原**，
  并发的 sync 会直接破坏它；
- 第 2 次（1 失败，另一条自愈）期间，多个审查子代理正在并发执行 `pnpm run test:poc:arch`
  与只读 git 命令。

**对照结果：归因成立。** 在所有其他进程停止、工作树无并发 `docs:sync` 之后独占重跑
（`HEAD c76da3a`，日志 `.scratch/root-serial.log`，gitignored 故不入仓，关键输出已抄录于此）：

```
Test Files  358 passed | 6 skipped (364)
     Tests  5082 passed | 21 skipped (5103)
exit=0
```

⇒ 根全量在本分支**全绿**，此前两次失败是并发干扰而非代码缺陷：`eb2-docs` 那条会就地改写
`docs/README.md` 并断言 sync 能逐字节还原，与作者并发执行的 `docs:sync --write` 直接冲突；
`g5-real-registry` 依赖 `history_query` 重放的计数，对并发负载下的时序敏感。
两条在独占重跑中均未复现，因此可以声称根门禁全绿——但**附带条件**：该结论只在"无并发测试流量"
的前提下成立，本仓这两个文件本身对并发敏感（属既有测试面的脆弱点，不在本轮修复范围，
登记为实施期观察项）。

## 7. 新门禁的红→绿证据（`docs:probe` 对 `package.json` 变更的要求）

本分支在 `package.json` 新增 `test:poc:arch`（侧车 runner），属门禁面变更，按 probe 的 T0 动作
须给出红→绿证据。观测序列（均在本会话内实际发生，非叙述）：

| 时点 | 状态 | 观测 |
| --- | --- | --- |
| P1/P2 落地后 | 绿 | `Test Files 2 passed / Tests 19 passed` |
| 契约重构后 | **红** | `[PARSE_ERROR] Unexpected token`（`src/contracts/index.ts:84` 类型联合被 `;` 提前终止）；`4 failed`（移交授权轴缺失，`Refusal: NO_SPACE_WRITE`） |
| 架构独立性门禁首跑 | **红** | `2 failed`：Kernel 面基线未重生成；可选依赖成环被误判为不可装配 |
| 阶段 D 攻击测试引入 | **红** | `45 failed`（`no such column: to_revision`）；随后 `4 failed`（审查员断言写的是修复前契约） |
| 第 2 轮复审/演化轴打穿后 | **红** | `1 failed`：守卫被前导注释绕过（`4ab5cf6` 之前）；另 `4 failed`：源端修订未验 + Kernel 面基线未重生成 |
| 两轮修复后 | 绿 | `Test Files 8 passed / Tests 63 passed`，`tsc` 0 诊断 |
| **第 3 轮（历史，`HEAD 14ea9b6`）** | **不通过** | `121 passed / 13 failed`（`--reporter=json` 逐文件生成）：**作者测试文件 8 个全绿（0 红）**；红全部在审查方攻击文件 — `old-schema-records` 1/6、`contract-version-skew` 2/4、`lifecycle-sequence` 3/5、`old-schema-counters` 1/3、`projection-and-era` 3/4、`stopline-vocabulary` 4/5。一条未删、未 `skip`、未放宽。**计数假象**：`stopline-vocabulary` B 条由红转绿不是 F-31 被修，而是语义席位把断言改写为"实测拦不住"（记录漏洞）——F-31 仍是开放 P1，引用本行必须同时引用 `REVIEW.md` §12.1 |
| **独立复审第 3 轮后（`HEAD bf3185f`）** | **不通过** | `125 passed / 15 failed`；作者 9 个测试文件 0 红。复审员三条攻击全部成立并全部封死（`NAMESPACE_ESCAPE`／`SCHEMA_INCOMPATIBLE`／`ACTIVATION_IMPOSSIBLE`，见 `REVIEW.md` §12 与 `tests/rereview-r3.test.ts`）；其攻击文件 0/3 转红正是"漏洞不再可构造"的证据 |
| **第 5–12 轮后（当前，`HEAD cd82793`）** | **不通过** | `139 passed / 15 failed`；作者 11 个测试文件 **0 红**。本轮区间的修复：读句柄只放 `SELECT/WITH` + 追加式三表存储层钉死（S-0①②）、`Coverage` 回 RPT-03 三值且归约不吃 coverage（S-1）、报告自身身份 + `records` 为正源（S-3）、空集可归因 `hiddenByInactiveCapability`/`timeFieldMissing`（S-2、F-24 残余）、`HARD_REF_NOT_PINNED`（S-4）、XC-28 可检测性（S-7/S-8）。**四口径同时成立，引用本行必须四句都带**：① `attacks/**` 不做类型检查（`tsc 0` 只覆盖 `src`+`tests`）；② F-34 **已关闭**（根因是并发写断言押在时序余量上，已改为同步驱动，`REVIEW.md` §17；全套并行跑绿）；③ `reduce-coverage` 剩的那 1 条绿是**过时断言**（手写四值清单），不是产品通过；④ evolution/semantics 席位有**未提交**改动，HEAD 与工作树在 `old-schema-records`、`lifecycle-sequence` 上计数不同 |
| **第 12 轮 F-EV-R2 修复（`cd82793`）** | **不通过（待独立复验）** | 演化席位报来 P1：同一行"戳 v1 / 路由 v2"在三个读面上给出两个答案。修复暴露出**更根本的一条**：`revise` 从未盖契约版本戳 ⇒ revision≥2 的行标记全为空串；读侧半门之所以"看起来没事"，正是它对空标记睁一只眼——**半门掩盖了一个更基本的缺陷**（这条比 F-EV-R2 本身更值得写进评估）。证据：演化席位 `attacks/evolution/contract-version-skew.test.ts` T4a/T4b 由红转绿（其文件未改一字）；`tests/p2-identity-plugin.test.ts` 10/10 绿（其被打断实为正确行为，见 `REVIEW.md` §19）。`KERNEL_SURFACE.sha256` 显式重生成并说明理由。"待独立复验"= 作者自述不构成证据，档位不变。 |

另有一次**作者自己写错的断言**被记入证据而非抹掉：`tests/p4-read-isolation.test.ts` 的缺口用例
最初把 Journal 缺口构造在重建 baseline 之下（那里缺口确实不影响索引），断言 `STALE` 是错的；
修正方式是调整测试构造，**不是**放宽机制语义（提交 `d0764bd`）。

## 8. 分支与远端边界（避免误读）

- 本分支 `poc/v3-code-arch-20261030` 已从 PR #44 head `5ec3897` 切出并**推送过一次**（远端同名新分支）。
  未合并任何 PR、未改动 PR #42/#44/#47 的 Draft 状态、未向设计分支或 `main` 推送。
  若按最严格口径解读"不推送远端"，该次推送应视为需要用户裁决的一处越界，用户可要求删除远端分支。
- 后续提交（含阶段 D 修复与全部文档）**仅在本地**，等待用户裁决是否推送。

## 计数口径更新（第 28 轮，工作树含审查方在飞文件）

上一行 `143 passed / 15 failed` 之后，工作树新增审查方文件 `attacks/review/r5r8-sql-guard-attack.test.ts`
与 `r5r8-semantics-attack.test.ts`（席位 `1faae161`，24 例：17 绿 / 7 红）。**这 7 条红不是产品缺陷**，
拆开看：

- **6 条**是 CTE-DML 探针，被驱动语法直接拒绝（`near "delete"`）。席位按"洞存在且触发器拦截"的形状写断言，
  洞在语法层就不存在 ⇒ 断言转红。**它们是"该通道封死"的实证，不是回退。**
- **1 条**是席位自己的 fixture 错误（把 `declareRecord()` 返回的 seq 当成 recordId），
  席位已在未做清单中自述。**我不会去改它——那是审查方的文件。**

因此再次强调本项目口径：**任何测试计数都必须连带说明红条的性质**，
否则"7 红"会被读成退步，而其中 6 条恰恰是封死的证据。

## 门禁自身的一条断言被证伪并修正（第 29 轮）

`tests/arch-independence.test.ts` 中检查插件逃逸成员的那条断言写作
`[raw,k,port].every(x => x === undefined || x !== undefined)`，**恒真**，等于没验。
改为真判据后立刻测得 `[false, false, true]`：`tx.raw` 与 `tx.k` 运行时可达（登记 **D-16，P1**）。
现按"断言漏洞现状"约定钉为 `[false,false,true]`，修复后会自动转红。

**口径**：本轮起，`arch-independence` 的"绿"不再覆盖插件逃逸这一项——它现在断言的是漏洞现状。
任何引用测试计数的地方都必须连带这一条。

## 门禁测量行（第 31 轮，`HEAD dd3e740`）

| 门 | 结果 |
| --- | --- |
| `vitest`（poc 配置，全量 35 文件） | **166 passed / 22 failed**；`Test Files 8 failed / 27 passed` |
| 作者侧 | **12 文件 84 例，0 红** |
| `tsc -p`（include 仅 `src`+`tests`） | 0 诊断 |
| `check-imports`（INV-PERM-5） | OK |
| `docs:check` | OK |

**22 条红全部位于审查方所有的 8 个攻击文件**，逐文件的性质：

| 文件 | 红数 | 性质 |
| --- | --- | --- |
| `attacks/semantics/dml-guard-attack.test.ts`、`attacks/review/r5-with-dml.test.ts` | 6 + 1 | S-0 修复后 DML 经读句柄不可执行 ⇒ 攻击无法构造 |
| `attacks/review/r5r8-sql-guard-attack.test.ts`、`r5r8-semantics-attack.test.ts` | 5 + 2 | 席位 `1faae161` 自述：其中 **6 条是 CTE-DML 探针被驱动语法拒绝**（该通道封死的实证，断言按"洞存在"形状写故转红），**1 条是席位自己的 fixture 错误** |
| `attacks/review/r3-independent-attacks.test.ts` | 3 | R3-A/B/C 封堵后越界读不可构造 |
| `attacks/semantics/report-record-identity-attack.test.ts` | 2 | S-3 报告身份入 `records` 后旁路消失 |
| `attacks/semantics/reduce-coverage-attack.test.ts` | 2 | S-1 coverage 不再驱动 verdict；同文件剩 1 条绿是**手写四值列表的过时断言**，非产品通过 |
| `attacks/semantics/required-floating-ref-attack.test.ts` | 1 | S-4 悬空钉死引用改判 `HARD_REF_NOT_PINNED` |

**引用本行时必须连带的五条口径**：① `attacks/**` 不在 `tsc` include 内，"类型门干净"不覆盖攻击文件；
② `reduce-coverage` 剩余的那条绿是过时断言；③ 审查方工作树有未提交编辑，HEAD 计数与工作树计数会不同；
④ **`arch-independence` 的绿不覆盖"插件逃逸"一项**——它现按"断言漏洞现状"钉为 `[false,false,true]`（D-16 开放）；
⑤ 任何计数都必须连带说明红条性质，否则"封死的实证"会被读成退步。

**可复现性说明（第 32 轮推送后）**：本行测量时审查方产物尚未入库，远端复现值必然偏低。
现这些产物已按原内容收编进 `attacks/**`（提交 `ade62b2`，归属与席位对照见 `attacks/README.md`），
**文件内容一字未改，只是纳入版本控制**，因此本行 `166 passed / 22 failed` 自远端
`poc/v3-code-arch-20261030` 分支 `HEAD 76b1ec2` 起可直接复现。
