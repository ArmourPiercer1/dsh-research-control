# Adversarial Review（阶段 D）— 独立对抗审查与处置

> 规则：审查员与作者**不同模型、独立上下文**；每条 finding 必须带可复现证据；
> P0/P1 修复后必须**独立复审**，作者自称修好不算证据；不得把 P0 降级成 P2 来掩盖核心正确性问题。

## 1. 审查配置与模型路由偏离（如实记录）

| 席位 | 策略要求（`SUBAGENT_ROUTING.md`） | 实际使用 | 偏离原因 |
| --- | --- | --- | --- |
| 规范符合性猎手 | `qiyuan-inter/glm-5.3` | `qiyuan-self/qwen3.8-27b` | `qiyuan-inter/glm-5.3` 返回 `child LLM route ... is not allowed for this Session`；退到路由表默认档 |
| 不变量攻击者 | `qwen3.8-max` | `qiyuan-inter/gpt-6-astra` | 前者未在目录中通告，且本 Session 不允许 |
| 语义组合与停线 | `qwen3.8-max` | `qiyuan-self/qwen3.8-27b` | 同上 |
| 集成与宿主边界 | `qiyuan-inter/glm-5.3` | `qiyuan-inter/gpt-6-astra` | 同第一行 |

作者模型 = `qwen3.8-flash-next`；四个席位实际使用的两个模型均与作者不同，独立性成立；
但**未按策略指定的模型执行**，这是一次记录在案的偏离，不是满足策略。

## 2. Finding 与处置

| 编号 | 级别 | 被违反的契约 | 位置 | 复现 | 根因 | 最小修法 | 回归测试 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-10 | **P1** | 历史真源唯一（ID-08、C11、T-01/T-02 的 `recorded_as_of` 截点） | `src/kernel/kernel.ts` `recordReport` | `attacks/host/host-boundary-attack.test.ts` 第 2 例：`select seq from ledger where seq=?` 得 `undefined` | 报告只写 `check_report` 并消耗 `meta.ledger_seq`，从不写 `ledger` ⇒ 报告的 `recorded_seq` 指向一条不存在的历史事实 | 同一事务内写 `ledger` 行 + `journal` epoch | host 第 2 例转绿；`tests/p1-storage-tx.test.ts` 跨能力单事务（`ledger` 2→3） | 已修，待复审 |
| F-11 | **P1** | SP-09（业务/运维授权与写权分轴）、能力权威唯一 | `UnitOfWork.reassignCapabilityRoute` + `Kernel.uow` 默认 `space-write` | `attacks/host`：仅 `space-write` 的主体把 `cap.test.object-model` 路由改到 `attacker.plugin/dom_attacker` | 运维权威操作被放进插件事务面；授权只查 `space-write` | 路由改写移出插件面；`transferRoute`/`setRouteEnabled` 要求 `capability-admin` 并校验目标 manifest 提供该能力 | host 路由例 + `tests/p2-identity-plugin.test.ts` 移交例（含"缺权限失败 ⇒ 零登记"与"授权成功"反差锚点） | 已修，待复审 |
| F-12 | **P1** | RF-02/RD-05（精确引用）、SP-02（保守侧） | `checkRequiredRefs` 只查 `object_directory.oid` | `attacks/invariant` 第 2 例 + `attacks/host` 第 1 例：required 引用 `revision: 999` 提交成功 | 硬引用只验到对象级，未验到修订级 | 对 `revision-ref` 校验 `domain_state(oid, revision)` 存在 | 两个审查员的攻击用例原样转绿 | 已修，待复审 |
| F-13 | **P1** | ID-08（记录有自身标识）、精确引用不得歧义 | `appendLedger` 的 `record_id` 无唯一性 | `attacks/invariant` 第 3 例：同一 `REC-DUP` 得 2 行 | "声明记录"和"引用记录"在 API 上是同一件事；`readRecord` 用 `order by seq` 的任意仲裁掩盖了歧义 | 新增 `records(record_id primary key, declared_seq, payload_json)`；`declareRecord` / `declaresRecord:false` 分离声明与引用；拒绝码 `RECORD_ALREADY_DECLARED`、`RECORD_UNDECLARED`；`readRecord` 改读 `records` | 攻击第 3 例按更强形态改写：第二次声明必须被拒 + 整体回滚 + "声明一次后按引用追加"作为反差锚点合法 | 已修，待复审 |
| F-14 | **P1**（原始报告为 P0 候选，见 §4） | 存储层不可变性是边界而非约定（C11、RV-03、DF-06、IC-S2） | `UnitOfWork.raw: RawTx` | 审查员实测 `drop trigger ledger_no_update` 后 `update ledger set event_type='forged'` 成功 | 机制把手柄连同 DDL 一起交给领域；触发器是可以被 DDL 删除的对象 | 两层：① `UnitOfWork` 契约不再暴露 `raw`；② 交出的 `RawTx` 是守卫视图，DDL/`PRAGMA`/`ATTACH` 一律 `RAW_SQL_REFUSED`；③ 路由改写贴写点二次核对权威 | `attacks/host` 新增守卫例（强转拿到句柄后 DDL 被拒，且触发器仍拒绝 DML 篡改） | 已修，待复审 |

### 修复是否放宽了门禁（自查）

- 未删除任何攻击；未修改 `arch-independence.test.ts`、`KERNEL_SURFACE.sha256` 的**判据**
  （基线值因 Kernel 真实变更而重生成一次，理由写在提交信息里）。
- 攻击文件里两处描述"修复前契约"的断言由作者改写为**更强**形态（从"结果应当只有一行"
  改为"第二次声明必须被拒绝且整体回滚"；从"属性应为 undefined"改为"强转拿到句柄后
  DDL 被机制拒绝，且触发器仍拒绝 DML"）。改写理由与原文差异即本表 F-13/F-14 两行。
- 结果：`pnpm run test:poc:arch` **58 passed (58)**（49 作者例 + 9 攻击例），
  `npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json` 0 诊断。

### 2.1 第 2 轮：独立复审与长期演化轴的再打穿

| 编号 | 级别 | 被违反的契约 | 位置 | 复现 | 根因 | 最小修法 | 回归 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-14′ | **P0**（F-14 的定级纠正） | 存储层不可变性是边界（C11/RV-03/DF-06/IC-S2） | `sqlite-port.ts` SQL 守卫 | `attacks/review/reviewer-boundary.test.ts`：`/* disguise */ DROP TRIGGER IF EXISTS ledger_no_update` 未被拒 | 守卫用 `^\s*(drop|…)` 锚定关键字，**前导注释即可绕过**，删触发器后 DML 篡改成功；且未拒绝多语句 | 判定前归一化（剥空白/块注释/行注释/多余分号，循环到不动点）+ 拒绝 `;` 后仍有内容 | 复审攻击例转绿（`run`/`all`/`get` × 注释前缀 + 多语句） | 已修（`4ab5cf6`） |
| F-14″ | **P0**（同上，作者自查补口） | 守卫的**多语句分支**没有测试即等于未被证明 | `attacks/review/` 只覆盖注释前缀 | 作者自查：`select 1; drop trigger …` 这条分支无回归覆盖 | 新增 `tests/sql-guard.test.ts` 10 例（六类负例 × 三方法 + 三正例） | 全绿 | 已补 |
| F-17 | P1 | RF-02/RD-05 精确引用 | `checkRequiredRefs` 只验目标端 | `attacks/review/`：`from(oid, revision=999)` 的必需边提交成功 | 第 1 轮 F-12 修得不完整：源端修订未验 | 必需边**两端**都验到 `domain_state(oid, revision)` | 复审攻击例转绿 | 已修（`4ab5cf6`） |
| F-15 | P1 | 模式演进不得在打开时静默迁移 | `sqlite-port.ts` 构造期 `exec(SCHEMA)` | `attacks/evolution/`：手造缺 `records` 的旧库 ⇒ 打开后被静默补表，旧 `record-ref` 判成缺失 | DDL 挂在每次打开路径 ⇒ 读操作携带写语义；且无版本标记可判定"是否迁过" | 空库才建表；已有库先过 `meta.schema_version` + 表集 + 触发器集校验，通过后**不再执行 DDL**；分歧 `SCHEMA_UPGRADE_REQUIRED`，detail 给迁移输入 | 演化攻击例 + 新库可正常打开的反差锚点 | 已修（`4ab5cf6`） |
| F-18 | P1 | 派生面滞后 ≠ 缺口；Journal 与 Ledger 的 epoch 对应 | `reassignRouteInternal` / `setRouteEnabled` | 移交一次 ⇒ `Projection.status().gap === true` ⇒ 永久 `FULL_REBUILD_REQUIRED` | 路由变更写了 `ledger` 却没写 `journal` epoch；缺口检测按"每个登记 epoch 都该有 journal 行"判定 | 机制级事件统一写 journal epoch（`Kernel.journalEpoch`） | 移交后 `gap === false` 且可增量续跑 | 已修（`4ab5cf6`） |

**"上一轮说已修、本轮被打穿"的事实**：F-12 与 F-14 在第 1 轮被记为"已修，待复审"，复审结论是
**修得不完整**。这条往返保留在台账里，作为"作者自称修好不算证据"的实例。

## 3. 攻击未得手项（同样有信息量）

审查员明确报告未能攻破：提交前异常、`failBeforeCommit`、真实第二连接 SQLITE_BUSY 锁竞争、
嵌套/重启/未提交跨连接可见性、未删触发器时的 ledger/`check_report`/`object_directory` 不可变性、
跨空间引用泄漏出口、重复事件权威装配、业务无知门禁（注释剥离 + 词汇扫描 + sha256 面基线）。
存在性侧信道（OPAQUE 与"不存在"同形、脱敏无计数）本轮也未被分开。

## 4. 一处级别判断的说明（不做降级掩盖）

F-14 的"领域可自行拆除不可变性触发器"按纯安全口径可判 **P0**（它使一条被反复引用的核心不变量
只在"没人越界"时成立）。第 1 轮我判 **P1**，理由是 PoC 威胁模型假定插件是**已授权但会犯错**的
参与者而非主动攻击者；当时已声明该级别判断须由独立复审判定。

**复审改判为 P0**（`qiyuan-inter/gpt-6-astra`，见 §7），依据是可运行攻击：主动路径不仅"理论成立"，
而且**当时就已经能走通**——守卫正则被前导注释绕过，删掉 `ledger_no_update` 后 DML 篡改成功。
判 P1 的前提（"主动攻击路径同样被切断"）是错的。故 F-14 记为 **P0**，并衍生 F-14′（守卫绕过）。
这不是新增缺陷，是同一缺陷的定级纠正；本表不回改成 P1。

## 5. 纪律事件（审查过程本身）

1. 审查员被要求只在 `attacks/<轴>/` 新建文件。不变量攻击者一度把新攻击追加进了
   自己先前新建的文件，发现后自行撤回；根因是我此前一次 `git add -A` 把它的工作中的
   攻击文件扫进了我的提交（`023948d`、`fbfd67b`），使该文件从"未跟踪"变成"已跟踪且被修改"。
   **这是我的失误**，不是审查员违规；后续提交改为显式 `git add` 指定路径。
2. 宿主席位报告"工作树含 `.scratch-patch1.py` 与多处 M"，那是作者在并行修复，非审查员改动；
   已在其后续消息中澄清。
3. **冻结面核查的结论（已核实，不是推测）**：宿主席位报告 `git diff --name-only origin/main...HEAD`
   含 `docs/README.md` 与 `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md`。逐条查证：
   - `docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` 来自**基线分支**（PR #44），
     `git log origin/design/v3-code-architecture-review-20261027..HEAD` 对它零提交；
   - `docs/README.md` 是**派生导航索引**：不在 `scripts/snapshot-release.mjs` 的 `FROZEN_DOCS`
     八份根文档之内，也不在 `docs/engineering-baseline/gates/G0-inventory.yaml`（grep 命中 0 次），
     它是 `docs:sync --write` 唯一允许自动写的文件；本轮改动 4 行全部是新增文档的索引条目。
   ⇒ 本轮**未触碰冻结面**（`schema/**` 与 8 份根文档零改动），无需 `Frozen-Face-Review` 标记。
4. 三个审查席位与作者**并发**运行同一工作树，`.poc-data/**` 为共享目录但每个测试用独立临时
   子目录，未见相互污染；根 `pnpm test` 在并发负载下两次运行给出 2 失败 / 1 失败（同一文件
   集合波动），已在 `EVIDENCE.md` §6 记录为"待对照归因"，未声称主门禁全绿。

## 6. 复审指派（P0/P1 修复的独立确认）

- 复审员：`qiyuan-inter/gpt-6-astra`（与作者模型不同、独立上下文）。
- 任务：对 F-10…F-14 逐条验证修复是否真的封死原路径、是否引入新破口、级别判断是否成立；
  允许在 `attacks/review/` 新建攻击。
- 结论与本轮处置记录在本文件 §7（复审完成后填写）。

## 7. 复审结论（独立复审判定，非作者自评）

复审员：`qiyuan-inter/gpt-6-astra`，独立上下文，允许且实际在 `attacks/review/` 新建攻击测试。
**必须区分两个提交**（复审员明确要求，本报告照此区分，不合并成"已修"一句话）：

| 对象 | 复审结论 | 证据 |
| --- | --- | --- |
| `f9a6c86`（第 1 轮修复） | **两条修复不完整**：F-12 只验目标修订，`from` 修订不存在仍可提交；F-14 守卫正则被 `/* disguise */ DROP TRIGGER …` 绕过，删触发器后 DML 篡改成功 | 复审新建攻击测试当时为红 |
| `4ab5cf6` 及当前 HEAD | **F-10/F-11/F-12/F-13/F-14 均封死**（就上述具体绕过路径而言） | `kernel.checkRequiredRefs` 加 `from_oid/from_rev` 校验；守卫归一化注释/空白/分号并拒多语句；复审复跑其 5 条攻击全绿 |

复审同时给出**独立确认的正向结果**：F-11 已测"目标 manifest 不提供该能力 ⇒ `ACTIVATION_IMPOSSIBLE`
且零登记"；`space-write` 单独不足以改路由、强转触达内部方法被写点二次授权拦下、重启后路由持久。
当前 `pnpm run test:poc:arch` **63 passed**、`tsc` 0 诊断（复审员独立跑出的数字与作者一致）。

**对"作者自称修好不算证据"的落实**：第 1 轮我把 F-12/F-14 记作"已修，待复审"，复审结论是修得
不完整——这正是该纪律要防的情形，已原样保留在 §2 与 §2.1，不作回改。F-14 的级别由复审改判，
我不自评。复审员的攻击文件保留在 `attacks/review/`，其一条描述漏洞行为的断言由作者改写为
**修复后契约**（拒绝 + 触发器存活 + 对象仍可读），改写理由就地注释，未删除任何攻击。

## 8. 其余席位的处理（含两处驳回）

规范符合性席位（`qwen3.8-27b`）提出 6 条 P0 级"事实性错误"。**逐条核验后 2 条驳回、4 条采纳**：

| 断言 | 核验方式 | 处置 |
| --- | --- | --- |
| 本仓引用了不存在的编号 `ID-09/ID-10/RF-07/RF-08/T-06..08/PR-A5/A6/SD-*` | 对本仓 `src/`、`tests/`、`*.md` 做引用位 grep | **驳回**：这些编号只出现在 `RECONCILIATION.md` 的**"该 ref 下不存在"反例清单**里，没有任何文件把它们当条文引用。为避免再次误读，该表标题已改为不可误读形态并注明是反例清单 |
| M-3 的登记序断言与实际不符 | 读 `p1` 中途失败例 :60-67 的断言 | **部分采纳**：数字与断言一致（`seq=1`/`head===1`/`count(seq>1)===0`），但原表述"回到 0"含糊易误读 ⇒ 已改写为可核对形式并附行号 |
| `EVIDENCE.md` §2 例数与攻击文件行数已过期（9→13 等） | `vitest --reporter=json` 逐文件计数 | **采纳**：§2 计数改为由命令生成 + 快照化，行按席位拆开 |
| `docs:check` 记录成"直接 OK"掩盖了先红后绿 | 本会话命令记录 | **采纳**：`EVIDENCE.md` §4 改为记录 `FAIL DOCS_INDEX_STALE` → `docs:sync --write`（只写派生索引）→ `OK`，并写明未剔除问题文件 |
| `[实测]` 标记把纯逻辑断言也包了进去 | 逐条比对 `CONTRACTS.md` §4 | **采纳**：§3 加"[实测] 的作用域"定义；kind 路由、循环引用无证明力等改为 **[实现断言]** |
| `test-validation.ts` 中 `UNKNOWN → 合规：PASS` 措辞与契约不一致 | 读该处 | **采纳**：改为"状态合法：不产生 finding，但记入 `declaredGaps` 且 `coverage=INCOMPLETE_DUE_TO_VISIBILITY`"，与 P3 用例断言一致 |

驳回一条、部分采纳一条、采纳四条——记录分歧与核验方式本身是审查的一部分；
"审查员说的都算"与"作者说的都算"是同一种错误。

