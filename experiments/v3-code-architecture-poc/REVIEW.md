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

## 3. 攻击未得手项（同样有信息量）

审查员明确报告未能攻破：提交前异常、`failBeforeCommit`、真实第二连接 SQLITE_BUSY 锁竞争、
嵌套/重启/未提交跨连接可见性、未删触发器时的 ledger/`check_report`/`object_directory` 不可变性、
跨空间引用泄漏出口、重复事件权威装配、业务无知门禁（注释剥离 + 词汇扫描 + sha256 面基线）。
存在性侧信道（OPAQUE 与"不存在"同形、脱敏无计数）本轮也未被分开。

## 4. 一处级别判断的说明（不做降级掩盖）

F-14 的"领域可自行拆除不可变性触发器"按纯安全口径可判 **P0**（它使一条被反复引用的核心不变量
只在"没人越界"时成立）。本表判 **P1** 的理由是：PoC 的威胁模型假定插件是**已授权但会犯错**的
参与者，不是主动攻击者；且修复采用类型面 + 运行时守卫两层，主动攻击路径同样被切断。
**该判断是作者的级别判断，须由独立复审确认或改判**；若复审认为应判 P0，本表随之改判。

## 5. 纪律事件（审查过程本身）

1. 审查员被要求只在 `attacks/<轴>/` 新建文件。不变量攻击者一度把新攻击追加进了
   自己先前新建的文件，发现后自行撤回；根因是我此前一次 `git add -A` 把它的工作中的
   攻击文件扫进了我的提交（`023948d`、`fbfd67b`），使该文件从"未跟踪"变成"已跟踪且被修改"。
   **这是我的失误**，不是审查员违规；后续提交改为显式 `git add` 指定路径。
2. 宿主席位报告"工作树含 `.scratch-patch1.py` 与多处 M"，那是作者在并行修复，非审查员改动；
   已在其后续消息中澄清。
3. 三个审查席位与作者**并发**运行同一工作树，`.poc-data/**` 为共享目录但每个测试用独立临时
   子目录，未见相互污染；根 `pnpm test` 在并发负载下两次运行给出 2 失败 / 1 失败（同一文件
   集合波动），已在 `EVIDENCE.md` §6 记录为"待对照归因"，未声称主门禁全绿。

## 6. 复审指派（P0/P1 修复的独立确认）

- 复审员：`qiyuan-inter/gpt-6-astra`（与作者模型不同、独立上下文）。
- 任务：对 F-10…F-14 逐条验证修复是否真的封死原路径、是否引入新破口、级别判断是否成立；
  允许在 `attacks/review/` 新建攻击。
- 结论与本轮处置记录在本文件 §7（复审完成后填写）。

## 7. 复审结论

（待复审返回。）
