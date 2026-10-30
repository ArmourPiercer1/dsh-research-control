# Implementation Contracts（阶段 C）— 由实测反推的机制契约修订

> 状态：**PoC 反推产物**。每条契约都标注它是**类型签名推断**得来，还是**真实运行结果**支撑
> （任务红线：SQLite、并发事务、事件登记顺序等关键问题不得只靠签名推断）。
> 本文不修改 PR #42 的已定语义，不新增第六类对象或第四套认识系统，不构成实施批准。
> 证据位置一律指 `experiments/v3-code-architecture-poc/tests/**`，运行环境
> `node:sqlite`（SQLite 3.53.4，Node 24.21.0）。

## 1. 依赖方向（实测：源码扫描强制，见 `arch-independence.test.ts`）

```
contracts  ←  kernel  ←  domains  ←  product/harness(装配根)
                ↑
        storage-sqlite（实现 contracts 的 StoragePort；kernel 不 import 它）
```

- Kernel 与契约代码**禁止** import `domains/`、`harness/`、`storage-sqlite/`、`node:sqlite`
  （扫描强制，并配变异锚点）。**[实测]**
- 领域**禁止** import 装配层，也禁止绕过机制直接对核心表写 SQL。**[实测]**
- 换存储驱动 = 只新增一个 `StoragePort` 实现；Kernel 零改动。**[实测：驱动只在 harness 装配]**

## 2. 存储与事务契约

| 条款 | 内容 | 依据 |
| --- | --- | --- |
| ST-1 | 一个 ResearchSpace = 一个 SQLite 文件；不存在跨空间共享连接池 | 装配根 `world.ts`；P4 隔离 5 条出口 **[实测]** |
| ST-2 | 写事务用 `begin immediate`；`begin` 本身必须在事务 try 内，否则锁竞争错误绕过翻译路径 | P1 提交冲突例（首轮实现正因 `begin` 在 try 外而泄漏驱动异常）**[实测]** |
| ST-3 | 提交期失败（含 COMMIT 前钩子抛出、SQLITE_BUSY）必须**整体回滚**，四张表零残留 | P1 三类故障注入 **[实测]** |
| ST-4 | 登记序 `seq` 必须是**事务内计数器**（`meta.ledger_seq`），不得使用非事务自增序列 | 回滚后 `ledger_head` 仍为 0 且下一次成功提交从 1 起 **[实测]**（非事务序列会留下永久空洞，令 `recorded_as_of` 截点指向从未提交的区间） |
| ST-5 | `ledger` 与 `check_report` 的 UPDATE/DELETE 由**存储层触发器**拒绝；`object_directory` 的 UPDATE 拒绝；`journal` 允许删除 | P1 不可变性探针（含"journal 可删"反差锚点）**[实测]** |
| ST-6 | 未提交身份对其它真实连接不可见，且**与不存在同形**（无 `STAGE_INVISIBLE` 这类专用码） | P1 第二连接可见性例 **[实测]** |
| ST-7 | 驱动错误码不得越过 Storage Port：SQLITE_BUSY/LOCKED → `TX_CONTENTION{retryable:true}`，原码留在 `detail.driverErrcode` 作证据 | P1 提交冲突断言改为机制码 **[实测]** |

**锁与并发语义（实测）**：WAL + `begin immediate` 下，第二连接持写锁时第一连接的写事务
在 `busy_timeout`（PoC 取 2000ms）耗尽后失败；探针实测 500ms 设置下等待 502ms 后
`errcode=5`，且持锁方提交后读到的只有对方的行 ⇒ **无部分提交**。跨能力写不存在额外锁竞争，
因为一次 UoW 只用一条连接。空间之间是不同文件，天然不互相争锁。

## 3. 表与索引建议（按 PoC 查询形态给出，未做性能调优）

| 表 | 建议索引 | 服务的实测查询 | 隔离/锁含义 |
| --- | --- | --- | --- |
| `object_directory(oid PK, space, kind, owner_capability, ns, created_seq)` | `(kind)` | 快照重建全扫；kind 分桶 | 单写者；UPDATE 被触发器封死 |
| `domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version)` | `PK(ns,oid,revision)` + `(recorded_seq)` | 双时间读取 `recorded_seq<=cutoff`；读侧按 `contract_version` 判形状可解性 | 追加式；旧 revision 行永不覆盖 **[实测]**。`contract_version` 是 F-27 逼出来的：只比 ns 不比契约版本 ⇒ 旧实现写的形状被原样交给新读者（静默错答）。写入时落**生效**版本，读侧不一致 ⇒ `SCHEMA_INCOMPATIBLE` **[实测]** |
| `ledger(seq PK, …, object_id, record_id)` | `(object_id, seq)`、`(record_id, seq)` | 派生业务视图按截点回源（`standingAt`）| 触发器禁改删；是**唯一历史真源** |
| `journal(tx_epoch, ns, oid, op)` | `(tx_epoch)` | 缺口检测逐 epoch 探测 | 可压缩可删除；不得充当历史 |
| `ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required)` | `(to_oid, to_rev)` | 反向影响候选查询（当前全表扫） | `required` 决定提交期完整性校验 |
| `capability_route(capability PK, plugin_id, ns, contract_version, enabled, changed_seq)` | — | 激活期覆盖内存视图 | **允许** UPDATE（路由是可运维状态，身份不是） |
| `projection_state(name PK, seq, baseline, rebuilt_at)` | — | 水位/基线/缺口 | 派生面状态，可弃可重建 |

`space` 列在单文件模型下恒等，保留是纵深防御（防止误把别的空间的行导入本库），不参与索引设计。

## 4. 身份、引用与修订

- 身份三元组 `(oid, kind, ns)` 在 Directory 创建时固定；kind 语义由注册表路由，Kernel 无 kind 常量。
  第二个领域插件带全新 kind 注册，Kernel 面 sha256 不变且两种 kind 正确路由。**[实现断言]**（进程内逻辑，不涉存储边界）
- `RevisionRef` 永不漂移（旧 revision 行仍在，非"记住旧值"）；`ObjectRef` 语义为跟随当前。
  两者在同一测试中对照成立。**[实测]**
- 硬引用（`required:true`）在**提交时**校验，缺失整体回滚；软引用允许悬空保存。**[实测]**
- 同事务内循环引用可写入，Kernel 不因此产生任何"证明力"产物。**[实现断言]**（证明力本就不在机制面）
- 暂存身份对外不可见且与不存在同形（ST-6）。**[实测]**

## 5. 能力注册、生命周期与装配

| 条款 | 内容 | 依据 |
| --- | --- | --- |
| CP-1 | 能力权威唯一：重复 capability、重复 kind 拥有者、第二个事件权威 ⇒ `AMBIGUOUS_AUTHORITY`（拒绝**装配**，不是运行期竞抢） | P1 双事件权威例（含 `eventAuthority:'none'` 可共存的反差锚点）**[实测]** |
| CP-2 | **必需**依赖缺失或成环 ⇒ `ACTIVATION_IMPOSSIBLE`；**可选**依赖缺失只是降级装配（`registry.degraded`） | P2/独立性测试，含"改为可选即可装配"的反差锚点 **[实测]** |
| CP-3 | Capability→实现映射必须**持久**（`capability_route`），激活时以持久路由覆盖内存视图 | P2 重启后所有者不变 **[实测]**；纯内存方案无法兑现 #44 §11 的原子切换 |
| CP-4 | 移交/装卸在事务内改路由并留 `capability-transferred` / `capability-enabled|disabled` 登记；**提交成功后**才更新内存视图 ⇒ 失败事务不回写 | P2 原子性例 **[实测]** |
| CP-5 | 移交只需 `capability-admin`，**不得**复用 `space-write`（SP-09 业务授权与写权分轴） | 初版复用写权被自己的授权门拒绝 **[实测]** |
| CP-6 | 换实现但命名空间漂移 ⇒ 读写双向 `SCHEMA_INCOMPATIBLE` fail-loud；读写共用同一条 `routeNs` 判据 | P2 漂移例 **[实测]** |
| CP-7 | 授权资源：Kernel 只声明自己执行的 `space-write`/`capability-admin`；业务授权轴由领域以字符串声明，经 `uow(principal, fn, requires)` 进入 | 契约修正 **[实测：接纳授权独立判定]** |

## 6. Raw Intake 与 Domain Admission

- 无法解析的原始材料仍可登记，保留来源；**不产生对象**（记录有标识但无对象身份，ID-08）。**[实测]**
- 接纳失败只拒绝，**绝不删除**原始输入；接纳中途失败不留半对象，原始记录不受影响。**[实测]**
- "能解析"与"结构合格"是两条独立判据：能解析但不合格的对象必须可保存，报告为 NOT_ACHIEVED
  且不得被读成 PASS。**[实测]**
- 对象化路径（RF-06）：记录不能直接充当端点，承载记录的个体可以；**该判据住在领域**，
  Kernel 只提供 `record-ref` 存储能力。**[实测]**
- 无写权 ⇒ 连 Raw Intake 也完全拒绝，四表零变化。**[实测]**

## 7. 校验与检查报告

- 机制层的 `CheckReportRecord` 载荷对 Kernel **不透明**；逐项判定枚举（含
  `NOT_APPLICABLE`）、Coverage 词汇属领域校验契约。**[契约修正，见 §11 F-06]**
- 报告一经写入不可改写：UPDATE/DELETE 被存储层触发器拒绝；校验器版本改变产生**新报告**，
  旧报告逐字段可核验。**[实测]**
- 允许 UNKNOWN 的字段如实声明未知 ⇒ PASS 并进 `declared_gaps`；连状态都未声明才是
  VIOLATION。**[实测]**
- 校验器不可用 ⇒ `INDETERMINATE` 报告、`findings` 为空、旧 PASS 原样保留；绝不产出 FAIL。**[实测]**
- 归约 `FAIL > INDETERMINATE > ACHIEVED` 在**领域**实现（RPT-02/RD-38），机制层不归约。**[实测]**
- FAIL 与 INDETERMINATE 共存 ⇒ NOT_ACHIEVED，且 coverage 独立呈现。**[实测]**

## 8. 读取与呈现

- `ReadContext` 缺任一必需字段 ⇒ `CONTEXT_INCOMPLETE`（未声明截点的查询视为未定义，T-01）。**[实测]**
- 双时间**顺序固定**：先 `recorded_as_of` 可见性过滤，再 `described_*` 对象时间过滤；
  晚到登记不得进入更早知识截点的视图；缺省截点必须回显。**[实测]**
- 跨空间读取没有代码路径：快照、搜索、错误形态、跨空间引用、Facet/DB 五条出口全部不泄漏，
  且呈现形态不携带对方空间标识。**[实测]**
- Kernel 解析失败一律返回中性 `OPAQUE`，**从不**区分不存在/他空间/未提交；
  `UNVERIFIABLE_REFERENCE`、`UNVERIFIABLE_TO_YOU`、`NOT_DISCLOSED` 由**呈现层**映射（SP-10）。
  **[实测：脱敏产物对无权者与"目标不存在"完全等值，且不含任何数字]**
- 审计视图与呈现视图共享同一份不可改记录；脱敏只在呈现层。**[实测：审计调用者仍拿到完整区分]**

## 9. 派生投影（读面）

- 投影状态三元语义：**滞后**（可用但必须标注 `STALE`）、**缺口**（拒绝增量续跑，
  `FULL_REBUILD_REQUIRED`）、**不可判定**（不得当作空结果）。**[实测]**
- 缺口检测以 `ledger` 为对照基准 ⇒ Journal 不能充当历史真源；实测 Journal 单独重放只得 1 条
  而权威记录有 2 条。**[实测]**
- 冷启动用权威快照重建 + 游标增量续跑；游标与基线持久，重启不重复消费。**[实测]**
- 业务视图直读权威记录，**不经过**投影；投影滞后不影响业务读数。**[实测]**

## 10. DSH Adapter 与 CLI 装配边界（**未在本 PoC 证明**）

PoC 未接 DSH。可迁移的是"装配根注入 principal + 授权表"这一形态（`world.ts` 的
`Authorizer` 闭包）；不可迁移的是宿主侧身份真实性、工具面权限与 `LIVE_*` 门。
**结论状态只能到 POC VERIFIED，不得据此声称宿主集成可用。**

## 11. 本轮由实测逼出的契约修订清单

| 编号 | 级别 | 症状（若不修会怎样） | 修订 |
| --- | --- | --- | --- |
| F-01 | P1 | 移交只在内存里，提交后崩溃 ⇒ 无人知道谁是所有者，"原子切换"是空话 | 持久 `capability_route` + 激活期覆盖内存视图 |
| F-02 | P1 | 移交蹭写权 ⇒ 与 SP-09 冲突，且实测被授权门拒绝 | `uow(...,requires)` 授权轴分离，新增 `AUTHORITY_REQUIRED` |
| F-03 | P1 | 换包未迁移 ns ⇒ 旧对象**静默消失**（比报错更糟） | Directory 固定 ns；读写共用 `routeNs`，漂移即 fail-loud |
| F-04 | P2 | 非事务序列 ⇒ 回滚留下永久空洞，`recorded_as_of` 可指向从未提交的区间 | 事务内 `meta.ledger_seq` 计数器 |
| F-05 | P2 | 单列"暂存不可见"拒绝码 ⇒ 本身就是存在性侧信道 | 删除该码；未提交身份与不存在同形 |
| F-06 | P1 | 报告语义枚举写在机制契约里 ⇒ "Kernel 业务无知"从契约层就被破坏 | 校验词汇移入领域契约；机制层报告载荷不透明 |
| F-07 | P2 | 驱动异常直接冒泡 ⇒ 调用方必须读懂 SQLITE 码才知道能否重试 | Port 边界翻译为 `TX_CONTENTION{retryable}` |
| F-08 | P2 | `ValidationOutcome` 用"整份报告形态" ⇒ 无法表达同报告内 FAIL 与 INDETERMINATE 共存（RPT-02/XC-27） | 改为逐项 `CheckOutcome` + `Coverage`，归约归领域 |
| F-09 | P2 | `PluginManifest.requires` 从未声明 `required` ⇒ 必需/可选依赖无法区分，环检测会把可选互依误判为不可装配 | 契约补 `required?`，缺省必需；可选缺失走 `degraded` |

| F-10 | **P1** | 报告消耗登记序却不写登记 ⇒ 历史真源分裂，`recorded_as_of` 看不见报告，该 seq 在 ledger 中凭空消失 | `recordReport` 同事务写 `ledger` + `journal`（阶段 D 审查实测） |
| F-11 | **P1** | 路由改写在插件事务面上、只查 `space-write` ⇒ 只有写权即可劫持能力权威 | 移出插件面；入口要 `capability-admin` + 校验目标 manifest；写点二次核对 |
| F-12 | **P1** | 硬引用只验 `oid` 不验修订 ⇒ 指向不存在修订的必需引用静默提交 | `checkRequiredRefs` 对 `revision-ref` 验到 `domain_state(oid, revision)` |
| F-13 | **P1** | 记录标识可重复声明 ⇒ 精确记录引用歧义，且被 `order by seq` 的任意仲裁掩盖 | `records` 表唯一化首次声明；`declareRecord` 与引用分离；`readRecord` 改读正源 |
| F-14 | **P0**（第 1 轮记 P1，复审改判，见 `REVIEW.md` §4/§7，见 `REVIEW.md` §4） | 领域拿到任意 SQL ⇒ 可自行拆除不可变触发器，"存储层保证不可变"退化为"没人越界时保证不可变" | `UnitOfWork` 契约不再交出 `raw`；`RawTx` 经守卫视图，DDL/`PRAGMA`/`ATTACH` 拒绝 |
| F-14′ | **P0**（定级纠正，复审实证） | SQL 守卫被前导注释绕过 ⇒ 不可变性仍可被领域拆除 | 判定前归一化 + 拒绝多语句（`REVIEW.md` §2.1） |
| F-15 | P1 | DDL 挂在每次打开路径 ⇒ 读操作携带写语义，旧库被静默"半迁移" | `meta.schema_version` + 表集 + 触发器集校验；已有库不再执行 DDL；`SCHEMA_UPGRADE_REQUIRED` |
| F-17 | P1 | 必需引用只验目标端修订 ⇒ 不存在的源修订在主张约束力 | 必需边两端都验到 `domain_state(oid, revision)` |
| F-19 | P2 | 契约承诺与实现面漂移无探测器（`UnitOfWork` 承诺 8 个方法，靠人眼对齐） | 运行时面沿原型链比对 + `@ts-expect-error` 机验 `raw/k/port` 不在插件可见类型面上 **[实测]** |
| F-21 | P1 | 跨空间读取先判归属 ⇒ 缺字段的请求泄漏"该空间存在与否" | `read-context` 先 `CONTEXT_INCOMPLETE` 后 `CROSS_SPACE_REFUSED`；**顺序本身是契约** **[实测]** |
| F-22/F-23 | **P1** | 领域插件持有 `Kernel`／经 `kernel.port` 全库扫描／自造 `verified:true` 主体 ⇒ 命名空间隔离与身份核验对该领域形同虚设 | 领域只接 `PluginFace`；事务执行器与主体由装配根交入；门禁禁 `: Kernel` / `.port` / `.raw` / `node:sqlite` / `verified: true` **[实测]** |
| F-24 | P1 | 禁用期快照读面拒绝、双时间读面照样端出同一对象 ⇒ 同一对象两个矛盾答案 | `readAsOf` 每条状态行过**与快照面同一条** `routeNs`（不是新判据，是把 F-03 早已声明"读写共用"的那条真的接到第二个读面）**[实测]** |
| F-25 | P1 | 再启用从**已加载清单**重建路由 ⇒ 内存所有者与 DB 所有者背离，ledger 无移交登记而重启后悄悄换人 | 再启用改读持久路由行，与 `activate()` 完全同源（持久行指向的实现即便不在本次清单也照样生效）**[实测]** |
| F-26 | P1 | `requires[].contractVersion` 是装饰品：v2 需求可静默装配到 v1 provider | `activate()` 覆盖生效路由后判版本满足性，不符 ⇒ `ACTIVATION_IMPOSSIBLE` **[实测]** |
| F-27 | P1 | 旧登记 payload 形状被原样交给新读者；v2 清单打开 v1 持久空间不可判定 | `contract_version` 落库（表结构 v3）+ 读侧 `assertContractVersion`；同一所有者改版本 ⇒ `ACTIVATION_IMPOSSIBLE` **[实测]** |
| F-31 | P1（门禁强度，非机制） | 业务无知词汇扫描被 `WITHHELD_REFERENCE`／小写／JSON 键名三种形态完全绕过 | 待改：token 切分 + camelCase + 大小写与 `-_` 归一（修法见 `REVIEW.md` §11.3）。**词汇门禁本质上不可能完备**，止损线是架构性的，绿门禁不得被引用为"业务无知已证明" |
| F-18 | P1 | 机制级事件缺 journal epoch ⇒ 缺口检测误判，派生面永久拒绝续跑 | `Kernel.journalEpoch` 统一登记（报告、路由变更、装卸） |
## 12. 已选 vs 已拒（含替换代价）

| 决策 | 已选 | 已拒 | 拒的原因 | 若日后改主意的代价 |
| --- | --- | --- | --- | --- |
| 空间隔离粒度 | 每空间一个 SQLite 文件 | 单库多空间 + 行级 space 过滤 | 后者让"忘记过滤"成为可能的失败模式，且缓存/搜索越界需逐处防护 | **高**：需迁移数据与重写隔离测试（P4 五条出口全部重做） |
| 历史真源 | Ledger 唯一，Journal 可压缩 | Journal 兼作历史（CDC 即历史） | 实测 Journal 单独重放只得 1 条 | **高**：事件模型与恢复路径全改 |
| 登记序 | 事务内计数器 | `AUTOINCREMENT` 序列 | 见 F-04 | 中：需为截点查询引入"空洞即不可判定"语义 |
| 模式演进 | 版本标记 + 打开只校验不写 + 显式迁移器 | 每次打开跑 `create table if not exists` | 见 F-15：读操作携带写语义，旧库被静默半迁移 | 高：需为每个历史版本写迁移脚本与版本链 |
| 机制句柄 SQL | 归一化后关键字判定 + 拒多语句（纵深一层） | 锚定式前缀正则；或完全不给句柄 | 前缀正则可被注释绕过（F-14′）；完全不给则机制自身也无从读写核心表 | 低：守卫不是唯一一层，触发器仍在 |
| 不可变性 | 存储层触发器 **+ 机制边界 SQL 守卫 + 插件面不交出 raw** | 仅应用层约定；**以及"只有触发器"这一层** | 应用层可被绕过；而单靠触发器也拦不住拿到 DDL 句柄的领域（F-14 实测） | 低：去掉触发器即可，但守卫测试必须换手段 |
| 记录标识 | `records` 表唯一化首次声明 + 声明/引用分 API | `ledger.record_id` 上加 UNIQUE | UNIQUE 会误伤"同一记录被多条后续事件引用"这一合法形态 | 中：需同时改 `readRecord` 与 record-ref 解析 |
| 权威唯一性 | 装配期拒绝 | 运行期"最后注册者胜出" | 后者静默改变事件语义 | 低 |
| 报告语义位置 | 领域契约 | 机制契约 | 见 F-06 | 低：类型搬移，无数据变更 |
| 移交语义 | 路由表 UPDATE | 新对象命名空间迁移脚本作为唯一路径 | 迁移脚本无法回答"谁是当前所有者" | 中：需引入外部注册中心 |

## 12b. 第 3 轮新增的取舍（含替换代价）

| 议题 | 选定 | 拒绝 | 替换代价 |
| --- | --- | --- | --- |
| ns 漂移时第二个读面的形态 | **fail-loud 抛 `SCHEMA_INCOMPATIBLE`**（与快照面同形；读者能区分"没有数据"与"数据读不了"） | 返回 0 行（审查方断言的形态） | 低：一行改 `filter` 而非 `throw`；但会让"扫描结果少一行"变成不可解释的静默缩减。分歧**未收口**，见 `REVIEW.md` §9 |
| 再启用时持久路由指向未加载的实现 | **信任持久行**（与启动语义一致） | 拒绝启用（作者第一版） | 拒绝启用会让"同 ns 换实现"的正常运维在重启后卡死；改回信任后 `lifecycle-sequence` 两条转绿 |
| `recordReport` 返回名 | **一个值两个名字** `{reportId, recordedAt: seq, seq}` + 恒等断言 | 静默改名 `seq→recordedAt` | 改名实测打断 4 个在用调用方；别名是已知瑕疵，实施期应二选一（`READINESS.md` D 项） |
| 旧库（无版本标记 / 历史早于 `records` 表） | **打开即拒绝** + 显式迁移器 `migrateLegacyRecords` | 打开时静默补表/补键/回填 | 打开路径零写入；代价：`domain_state.contract_version` 尚无回填器，v2 库需实施期补迁移（`READINESS.md`） |

## 13. 本 PoC **没有**证明的（不得越级引用）

- 未测：多进程并发写同一空间文件（只测了同进程双连接）；DSH 宿主权限面；真实五类对象字段与
  状态机；性能与容量；备份/时间点恢复；Schema 迁移工具；热插件加载与沙箱。
- 领域判据全部是**合成占位规则**（文件头已标注），不得被引用为 PR #42 科研语义政策的实现。
- 因此本实验区最高只能声称 **POC VERIFIED**；`IMPLEMENTATION READY` 需 §12 的未决项收口，
  `PRODUCT READY` 另论，且**不得由前三者推出**。

## 14. 第 5–6 轮实测回写的契约条目（先前版本落后于实现，此处补齐）

> 标签含义同前：**[实测]** = 有可运行的红/绿断言支撑，括号内是证据文件；**[实现断言]** = 代码如此但未独立复验。
> 本节的存在本身就是一条事实：**契约曾经落后于实现**，且落差是在三席审查压力下才暴露的。

| # | 契约条目 | 判据（可判定形态） | 证据 |
| --- | --- | --- | --- |
| 1 | 机制交出的**读句柄只能是查询**；追加式表在存储层被钉住 | 非 `SELECT/WITH` ⇒ `RAW_SQL_REFUSED`；`UPDATE/DELETE domain_state/ref_edge/records` ⇒ 触发器 abort；必备触发器集是**开库判据**，缺任一 ⇒ `SCHEMA_UPGRADE_REQUIRED`（`SCHEMA_VERSION=4`） | **[实测]** `attacks/semantics/dml-guard-attack.test.ts`（6 例修复后全红）、`tests/schema-evolution.test.ts` |
| 2 | 检查报告**有自身身份**，与其余记录同构 | `recordReport` 同事务写 `records(RPT-<seq>)`；`record-ref` 存在性以 `records` 为正源；无身份者仍 `OPAQUE` | **[实测]** `tests/p3-intake-validation.test.ts`、`attacks/semantics/report-record-identity-attack.test.ts` |
| 3 | `Coverage` 是 **RPT-03 封闭三值**；"校验器不可用"是 INDETERMINATE 的**理由**，不是 coverage 值，也不参与归约 | 离线 ⇒ 恰一条 `{code:CHECKER_UNAVAILABLE, outcome:INDETERMINATE}`；`synthReduce` 第二参数不参与判定 | **[实测]** `tests/p3-intake-validation.test.ts`；`attacks/semantics/reduce-coverage-attack.test.ts` |
| 4 | **空结果必须可归因**（禁用态遮蔽 / 时间字段形状缺失 / 截点无值三者可区分） | `echo.hiddenByInactiveCapability > 0`（只给数量不给 oid）；`echo.timeFieldMissing` 四档反差 | **[实测]** `tests/empty-vs-absent.test.ts` |
| 5 | 存储命名空间是**数据所有权键**，必须被单一能力独占；契约版本无标记 = 不可判定 = 拒绝 | 抢同一 ns ⇒ `ACTIVATION_IMPOSSIBLE`；`contract_version=''` 被读 ⇒ `SCHEMA_INCOMPATIBLE` | **[实测]** `tests/rereview-r3.test.ts` |
| 6 | 窄面 `PluginFace` **不携带跨命名空间读，也不携带运维权威** | `revisionOf` 恒 `NAMESPACE_ESCAPE`；面对象成员集不含 `transferRoute/setRouteEnabled/activate/port/raw/registry/uow/nextLedgerSeq`（**运行时**判据，源码扫描挡不住"宿主把 Kernel 传进来"） | **[实测]** `tests/arch-independence.test.ts`、`tests/rereview-r3.test.ts` |
| 7 | 跨命名空间要读的对象由**装配根**取好交入，不下发任意读取句柄 | 领域服务构造参数 `hostSnapshot` 由装配根提供 | **[实现断言]**（边界是否只是把洞挪到宿主侧，待复审裁定） |

### 14.1 门禁能保证什么、不能保证什么（必须与任何绿灯并列引用）

- `src/domains/**` 的词汇扫描是**命名门**，对"中性词承载的领域判定""无名词的规则"在构造上不可见；
  三种已证实绕过：小写/JSON 键名、下划线后缀+点前缀、`as any` 类透传（后一类本轮已禁）。**F-31 开放**。
- 侧车 `tsc` 只覆盖 `src` 与 `tests`：**`attacks/**` 不做类型检查**，攻击文件的类型漂移不会被门禁捕获
  （实测：`Coverage` 收回三值后，攻击文件手写的四值字面量仍运行时通过）。
- 因此：**任何绿灯都不构成"Kernel 业务无知"的证明**；架构性止损线是"校验词表只存在于
  `src/domains/validation-contract.ts`"，不是扫描器的通过。

### 14.2 拒绝码封闭集的扩张（S-4）——一次显式记录，不是悄悄加码

新增 `HARD_REF_NOT_PINNED`：**硬（required）引用不得指向浮动目标**。`object-ref` 不带修订 ⇒
`to_rev` 落 NULL ⇒ 目标一被修订，这条边就静默改指新修订，无重校验、无事件；而"事务内确实存在"
这一提交期判据本身会随时间改变，等于把硬完整性押在一个会漂移的解析上。

与既有 `REQUIRED_REF_MISSING` **分开**的理由：二者对调用方是不同修法（补修订 vs 补存在性），
合并成一个码就等于让调用方猜。

**位置是判据的一部分**：新检查放在提交期"目标 oid 是否存在"**之后**，因此
"幽灵 object-ref ⇒ `REQUIRED_REF_MISSING`"这条既有判据与其错误码一字不变，
新码只覆盖此前无人拦截的那一种形状。证据：`tests/p2-identity-plugin.test.ts` 全部原断言不变仍绿，
`attacks/semantics/required-floating-ref-attack.test.ts` 的漂移复现转红、其"幽灵仍被拒"反差锚点仍绿。

### 14.3 一次作者自伤事故（防止"改代码顺手删了测试覆盖"被掩盖）

S-4 首次落地时我用脚本拼接代码，误把 `recordReport` 的整段实现（30 行）连同闭合括号一起删掉，
只留下一个孤立的 `);`。当时**除一处类型错误外测试仍大面积绿**——因为该函数的行为断言集中在
`tests/p3` 与报告身份那条新增回归上，而它们当时因截点问题未被执行到。

- 发现方式：`tsc` 报 `UnitOfWork → UnitOfWorkImpl` 转换不合法（类不再 `implements` 接口可见形状）。
- 处置：`git checkout -- src/kernel/kernel.ts` 回到已提交态，再只重贴 12 行判据；未试图手工"补回来"。
- 教训（与前两次自伤同族，见 §11.2）：**用脚本改代码必须先看 diff 的删除侧**，
  `git diff --stat` 里 `12 insertions(+), 42 deletions(-)` 这种不对称就是警报。
  类型门禁在这里比测试更早抓到问题——这与"类型门禁只是弱证据"的直觉相反，值得记一笔。

### 14.4 F-EV-R2 的契约结论（读面判据必须**逐面齐全**）

行级契约版本判据的适用范围是**所有**读面：精确引用、快照、双时间、以及 `PluginFace` 的
`readLatest`。装在其中一个面上不构成"读面据此判断形状"——它只构成"某些调用点会拒"，
而调用方无从知道自己走的是哪一个。据此，`RECONCILIATION`/本文件凡描述行级打戳的用途，
都必须同时说明**判据装配点清单**；清单不完整时，声称止于"部分读面"。

**已实现并实测**（第 12 轮，`REVIEW.md` §19）：写侧 `revise` 补盖戳（此前 revision≥2 的行全是空标记），单对象读面拒读、扫描面剔除 + 回显 `hiddenByContractSkew`。扫描面的失败形态选择属**设计裁量**，沿用已被独立复验接受的 F-24 先例，仍需独立裁决；同时暴露一条更早的事实：**判据依赖的标记本身，我的写侧并没有保证生产**。

### 14.5 扫描面失败形态的**分界原则**（两份独立裁决一致，且比作者的理由更准）

作者给出的理由是"扫描面抛错会毒化整页"（F-24 先例）。两个独立席位都选了 **B（逐行剔除 + 每次读必回显计数）**，
但给出了更准的分界线——**不是严重度，也不是读面形状，而是"该行对契约家族的归属是否可判定"**：

| 失败 | 归属可判定？ | 形态 | 为什么 |
| --- | --- | --- | --- |
| 命名空间漂移 | **否**：没有任何生效能力认领这行的形状，原属谁判不出 | 整读拒绝 | 判据本身无定义 ⇒ 只能拒（RPT） |
| 能力禁用 | 是：原因、责任方都已知 | 剔除 + 计数 | 忠实呈现机制事实 |
| 契约版本偏差 | 是：ns 仍由生效属主声明，两个版本都有名字 | 剔除 + 计数 | 同上 |

**`truncated + 计数` 第三形态被明确否决**：会把"页截断"这条归因轴混进来，拆掉 S-2 刚钉死的
"空集三成因分离"。

对 A 派最强论点（"版本偏差是数据损坏信号，静默剔除让损坏隐身"）的处置：B **不是静默**——
读级每次命中的读必回显计数，行级由单对象面逐行抛 `SCHEMA_INCOMPATIBLE` 且带版本对；
A 多给的只是**即时性**，不是**可检测性**。而 A 的代价正好踩在 C12/T-05 上：
一行偏差使整窗口无结果，且异常路径上没有 echo 可挂，调用方吞掉异常后记下的
"本窗口没有数据"恰是被禁止的那种误读。

### 14.6 契约规则：**递到插件手上的对象，必须按运行时面验收**（D-7 / D-15 / D-16 的共同根）

三条开放 P1 是同一族，不是三个孤立缺陷：

| 项 | 声称 | 实际 | 为什么此前没暴露 |
| --- | --- | --- | --- |
| D-7 | `Kernel.port` 只读不可绕 | 属性公开，`kernel.port.raw` 即裸句柄 | 靠类型声明与源码扫描验收 |
| D-16 | 插件不得触碰 `raw` / Kernel | 递进回调的 `UnitOfWork` 运行时带 `raw` 与 `k` | **验收断言本身是恒真式** |
| D-15 | 双正源违规可检测（**限定见下**，不是无条件可检测） | 装配未接线时静默通过且 coverage 报 COMPLETE | 只测了"接了线会触发"，没测"没接线会怎样" |


**"可检测"的准确边界（席位 B 的 N-2：此前主张强于实现，此处按实现收窄）**

检测面只有两件事的交集，超出即静默不检，不是"检了没问题"：

1. **角色名**：`ref_edge.role` **精确匹配字面量 `USED_IN`**（入库无规范化，`kernel.ts` 原样存）。
   实测漏检形态：`used_in`、`USED_IN_`、`Used_In`、`" USED_IN"`（带前导空格）。
2. **字段名**：只认 payload 上已声明的 `operating_context`。payload 是自由
   `Record<string, unknown>`，写成 `operatingContext` 或嵌套 `context.operating` **连 INDETERMINATE 都不触发**。

因此实施期若要保留"可检测"这个词，必须同时交付：**角色名入库规范化 + 别名字面量表 +
payload 形状校验（未知字段至少产出 INDETERMINATE）**。三者缺一，条文只能写成
"在规范化角色名与已声明字段名范围内可检测"。**装配根交来的边视图内容本身不受机制校验**
（受信任输入边界，与 `hostSnapshot` 同类）：交一份恒空视图即可复现"ACHIEVED + COMPLETE + 零信号"。

**规则（实施期硬门，不可用类型面或源码扫描满足）：**

1. 凡**递到插件代码手里**的对象（`UnitOfWork`、`PluginFace`、投影输入、校验输入），
   其**运行时自有+原型链成员集**必须由测试断言为"契约声明的封闭集"的子集。
   判据形态是 `Object.getOwnPropertyNames` 沿原型链收集后比对，**不是** `@ts-expect-error`，
   也**不是** grep 源码——前者被一次 `as unknown as` 绕过，后者被"宿主把对象传进来"绕过。
2. 任何形如 `x === undefined \| x !== undefined`、`expect(arr).toContain` 于空数组、
   或"断言集合是自身子集"的**恒真式**，一经发现必须**当场替换为真判据并允许它变红**。
   本 PoC 实测：改掉恒真式的同一轮就测出 D-16。
3. **可选参数与缺省值不得让"未提供"看起来像"提供了空"**。缺省即"未提供"时必须传
   `undefined` 并由消费方产出 `INDETERMINATE` 类负信号，禁止静默跳过（⇒ D-15）。
4. 验收必须包含**"没接线"这一列**：正例（接对了会成功）与**反例（没接时会显式不可判定）**
   成对出现，只测正例的门禁等于给静默通过发通行证。

## 16. D-19 领域写权威边界（2026-10-30 外部复审提出，作者采纳）

**两层写面，权限不同，且这一差别是契约的一部分**：

| 写面 | 谁持有 | 能改什么 | 依据 |
| --- | --- | --- | --- |
| `UnitOfWork.createObject/revise/linkRef`（通用事务面） | 装配根 / Application Use-case | **可跨领域**——跨插件原子提交需要它 | Q40 |
| `NamespaceWriter.createOwned/reviseOwned/linkOwned`（能力作用域端口） | 领域插件（经 `face.writerFor(tx)`） | **仅本能力拥有的对象**；归属不符 ⇒ `CAPABILITY_SCOPE_ESCAPE` | Q12 |

要点：

- 判据只用机制事实（`object_directory.owner_capability`、`registry.ownerOfKind`），Kernel 内**不含科研语义判定**。
- **插件面上不得出现通用事务句柄**：`PluginFace` 曾一度加入 `uow(...)`，被本 PoC 自己的门禁
  （插件面成员不得出现在 `AUTHORITY` 禁用名单上）当场拦下并撤回——**给领域递通用事务句柄
  正是本条要堵的入口**，门禁的判断优于作者的初版设计。
- `writer → 宿主事务` 的映射放模块级 `WeakMap`，不放实例字段：后者等于把句柄重新交回插件
  （`.constructor` 逃逸的同族教训）。
- 拒绝必须发生在写入之前；测试须验证"目标修订未被改动"，不接受"写了再报错"。
- **Application Use-case 层的写权限形态（D-19c 收口）**：用例层**不得**直接持有或使用通用对象写面
  （`createObject/revise/linkRef`）；它只能经 `UseCaseDelegation.writerOwningKind(kind, tx)` 取得
  **对象拥有者的作用域端口**，在调用方交来的**同一条事务**内完成跨归属写（因此 Q40 不破，且
  委派交出的仍是 `NamespaceWriter`——能力上界与领域自有端口相同，**不存在第二个权威**）。
  机制级台账写入（`appendLedger`）在本层按 `D-19c-ALLOWED` 行标记 + **出现次数 == 签字次数**
  双判据逐条签字：行标记会被下标写法（`tx['appendLedger']`）绕过，计数判据补这个洞。
- 判据强度次序（写进契约，防止日后被倒置）：**运行时作用域上界是墙，源码扫描是防遗忘的网**。
  墙失效才算洞；网失效只是退化。**墙的适用边界（席位 G1-A 实测后收窄，三处声明一律以本条为准：本文件、
`src/app/delegation.ts` 头、`tests/domain-write-face.test.ts` 头）**：`#assertScope` 只对**经
`Kernel.uowFor(cap, …)` 取得的事务**生效。凡装配根把 `Kernel.uow()`（`scope='assembly'`）交进
领域对象（修前现状：`ValidationService.runIn` 一路已由 §16.2 收口；「任何以 `UnitOfWork`
为形参的领域服务」作为**一般形态**仍是常态约束——`src/domains/**` 目前不再有任何对象持有
全权事务执行器），该路径
**没有归属检查执行点，只有那张已知可绕的词法网**。故**"D-19c 已收口"仅在"经 `uowFor` 的领域
事务路径"内成立**（D-22）。另：席位实测墙在该路径上确实守得住拼接成员名、`getPrototypeOf`
取方法、`Reflect.get/apply`、端口-kind 错配、移交后复用旧端口。网明确不拦拼接成员名与反射取成员——该边界由
  `tests/domain-write-face.test.ts` 的"断言扫不到"负空间测试钉住，并同处证明同一形态运行时被墙拦下。
- 负例/正例见 `tests/capability-scope.test.ts`（装配根可跨 ⇒ Q40 不破；领域不可跨 ⇒ Q12 成立）。

### 16.1 事务生命周期、提交期判据与 `write()` 的无歧义面（D-23 / D-24，外部复审第四轮，2026-10-30）

**新增拒绝码 `TX_CLOSED`（插件可见面变化，先于代码声明）**：`src/contracts/index.ts` 的
`RefusalCode` 封闭集新增 `TX_CLOSED`。语义：**该句柄所属的底层事务已终结（提交、回滚，或
提交期抛错——三者同形）**，凡由该事务句柄派生的读写一律拒绝。适用面：`UnitOfWork` 的
`createObject/revise/linkRef/appendLedger/declareRecord/recordReport` 与 `NamespaceWriter` 的
`write/createOwned/reviseOwned/linkOwned`（含只读面 `readLatest`），以及**在已终结句柄上事后
调用 `PluginFace.writerFor(旧句柄)` / `Kernel.namespacedWriter(cap, 旧句柄)`**——后者直接以
`TX_CLOSED` 拒绝建端口。它是可重试的吗：不是——调用方必须另起事务重做，不得复用旧句柄。

- **生命周期下沉到事务本体，而不是实例**：终结记账的键是 `StoragePort.tx` 交出的 `RawTx`
  （模块级 `WeakSet`，见 `kernel.ts` 的 `CLOSED_TX`）。`Kernel.uow/uowFor` 回调一离开即记账。
  为何不能只给 `UnitOfWork` 加 `closed` 实例位：`NamespaceWriter` 保留**同一个**底层句柄
  （`writerFor`/`#scoped` 都经模块级 `WeakMap` 取它），实例级失效只封得住半个入口（D-23 原文）。
  记账同样不用实例上的 TS `private`/参数属性（D-17/P2-2：运行时可枚举）。
- **提交期判据改为增量**：`checkRequiredRefs` 只验证**本事务**新增的 required 边（按底层句柄
  归账，`writer.linkOwned` 经瞬时实例写入的边同样入账）。**禁止**改回提交前全表重扫：一条存量
  损坏边会永久拒绝此后任何主体的任何提交，而 `ref_edge` 是 append-only（触发器删不掉）、重开库
  仍阻塞 = 空间级不可自愈写阻塞（席位 G1-A A-12/B-⑦）。
- **存量完整性走独立的审计路径**：`Kernel.auditRequiredIntegrity()`——打开期/迁移/审计用的显式
  方法，全表巡检 required 边、**返回违规清单而非抛首错**。它是**装配根/运维面**：`PluginFace`
  不引用它，Kernel 也不交给插件；插件可见面（§16 的窄面）不包含任何存量巡检能力。后果锁见
  `attacks/review/g1a-regression.test.ts`（存量脏边不得阻塞无关主体的合法提交）。
- **`NamespaceWriter.write()` 的两个无歧义面（D-24）**：① 目标 `oid` 必须存在于
  `object_directory`——幽灵 oid 的状态行以 `NOT_FOUND_IN_SPACE` 拒绝，先于任何写、零残留；
  合法 Facet 挂载（oid 在目录、行落自己 ns）**不受影响**（Q45/#44 §6.2）。② 修订级存在判据
  （required 边的源端与目标端）必须 **join `object_directory` 按归属 ns 归因**——"该对象在其
  归属命名空间里确有该修订"才算成立（RD-05）；在他能力 ns 里伪造的行不再冒充修订存在。
- **已知缺口（登记为 G1 存储契约，本 PoC 不修）**：机制层没有"扩展挂载登记"，合法挂载与
  伪造他人对象的状态行在 `write()` 入口是**同一行形态**，无歧义面无法区分二者——因此明确
  **不采用**"oid 主能力 == 写入能力"的一刀切（那会打断 Q45 正例，护栏测试持续阻止该回头路）。
  完整修法需要一个显式的挂载声明/登记机制；在它出现前，`write()` 对"他人核心对象"的合法
  挂载仍按行形态放行，这是被记录的边界，不是被忽略的洞。

### 16.2 正式事件的唯一权威写入入口与领域服务的受限提交 Port（D-20 / D-22，外部复审第四轮，2026-10-30，包 2）

**本节先于代码**：以下每一条都是插件可见面变化，全部在此声明后才允许动 `src/`。
**（包 3 修订标注，2026-10-30，外部复审席位 G2-A 的 N1/D-25 收口）** 本节中标注「包 3」的条目为
本轮新增/改写的插件可见面：清单条目新增 `requiresAuthority`、权威入口新增激活核对与授权取证、
`eventsOf`/`eventsFor` 行新增 `authority`、投影信任模型第 3/4 条改写、`ledger` 新列 `authority_basis`。
其余为包 2 原文。

**新增契约字段 `PluginManifest.ownsEventTypes`（清单面加宽）**：能力可把自己拥有的事件类型登记为
**正式事件类型**——即「领域据以执行接纳/授权类判定、派生业务投影直接相信它」的事件。
形状与 `ownsKinds` 同族，包 3 起为
`readonly { eventType: string; capability: CapabilityId; requiresAuthority: AuthorityResource }[]`。
**`requiresAuthority`（包 3，N1 收口）**＝该正式事件类型的签发所须经核对的**业务授权轴**（对 Kernel
为不透明字符串）：它是机制侧授权结论的**唯一取证来源**（见入口判据 ⑤）。登记判据与 `ownsKinds`
同族且**按序判定**：同一事件类型被两个能力登记 ⇒ `AMBIGUOUS_AUTHORITY`；指向未激活能力 ⇒
`CAPABILITY_INACTIVE`；**缺授权轴 ⇒ `ACTIVATION_IMPOSSIBLE`**（正式事件没有授权轴就永远无法产生
授权证据，装配不可成立，fail-closed；此码此前只出现在 `activate()` 的依赖环判据，现登记到注册期）。
Kernel 把 eventType 与 axis 都当**不透明字符串**，不解释任何业务语义（业务无知扫描继续覆盖本面）。
归属账本按能力 id 记，**不随路由停用而消失**。
**`requiresAuthority` 的轴值判据（包 4，D-26，席位 G3-A A1-1/A1-3 实测）**：注册判据在「缺轴 ⇒
`ACTIVATION_IMPOSSIBLE`」之外补一条**轴值**判据——登记的轴名**不得是机制自身权限轴**（至少
`space-write`、`capability-admin`）。恶意清单把 `requiresAuthority` 声明成 `space-write` 时，只有写权、
无任何业务轴的主体经正当通道即得 `authorized:true` 见证（把「写权」当成「业务授权」，正是 SP-09 明令
禁止的混同）；修后此类登记在**装配期**即被 `ACTIVATION_IMPOSSIBLE` 拒绝、零签发面。
**Kernel 业务无知如何守住（这条约束判据本身不得引入业务知识）**：Kernel **不**硬编码任何业务轴名
（`domain-admission` 一类不得出现在 `src/kernel/**`）；判据用「机制资源联合」做**排除**——Kernel 只认得
自己拥有的机制权限轴字面量集合（`space-write`/`capability-admin`，即 `MechanismResource` 的运行时投影），
要求登记轴名**不等于**其中任何一根 ⇒ 业务授权轴必须是**机制联合之外**的字面量。Kernel 对业务轴的具体
取值仍只当不透明字符串，取证时照旧 `principalCan(axis)`，不解释其语义。故新增的是一条**声明式排除谓词**
（「轴 ∉ 机制自身权限轴」），**不构成业务知识回流**：Kernel 知道的仍是「我自己的写权/管理权」，不知道
任何「科研接纳资格叫什么」。**边界如实**：空白轴（`' '`）等非机制、非业务字面量仍能过登记（Kernel 无从
判定一根业务轴之外字符串的语义），但取证据恒 `authorized:false` ⇒ fail-closed 方向可接受，登记在案。
**（2026-10-30 席位 G2-A 实测纠正 → 包 3 已兑现，D-25 已修）** 此前本处把期望写成了事实（权威通道
对停用状态零核对，停用能力仍能签发正式事件）。机制现状：`appendAuthoritativeEvent` 在写入前核对
本端口能力的**激活状态**（查生效路由表，缺失 ⇒ `CAPABILITY_INACTIVE`、零残留），「拥有者被停用 ⇒
正式事件在两个通道上都写不动」自包 3 起是**现状而非目标语义**。
**（包 4 纠正，2026-10-30，席位 G3-A「D25-MP」实测；旧句保留于上、以此段为准）** 上一段与下文入口
判据 ② 原写「查 `capability_route` 生效路由」，**超前于机制真实行为**：写路径判据查的是**本进程内存
registry**（`CapabilityRegistry.caps`），持久列 `capability_route.enabled` 只在「执行停用/启用的
进程」+「其后新启动的进程」生效。实测（`RE-REVIEW-G3-A.md` §③-D-25）：同文件双世界，B 停用后先启动
的 A 仍能签发（`NO_REFUSAL`），A `restart()` 后才 `CAPABILITY_INACTIVE`。据此把契约改写为机制真话：
**停用判据是进程内即时、跨进程最终一致**，一致性窗口 = 停用前启动的全部常驻进程；运维要求即时全局
停用时必须重启（或实施期补跨进程失效机制，G1 余项）。同处一并登记：停用窗口内 `eventsOf` 的**读面
不关**（C-1 实测：既有 face 经停用窗口仍可 `eventsOf`；D-25 判据只承诺写面，读面语义见 E-01 行，
属记录在案的设计边界，不是疏漏）。实测依据（勿信文档，跑这条）：
`tests/n1-authorization-evidence.test.ts` 的「D-25 直测面」用例——`unloadCapability(CAP_RECORDS, ADM)`
之后通道 B `appendAuthoritativeEvent` 得 `CAPABILITY_INACTIVE` 且 ledger 计数不动，同场对照同能力
`write()` 同码拒绝、通道 A 仍 `EVENT_AUTHORITY_REQUIRED`，`loadCapability` 后恢复可签发。

**新增拒绝码 `EVENT_AUTHORITY_REQUIRED`**：语义 =「**本通道没有资格写这个事件类型**」，与
「缺授权轴」的 `AUTHORITY_REQUIRED` 是两回事，与「改了他人的对象」的 `CAPABILITY_SCOPE_ESCAPE`
也是两回事。适用面：① 通用 `appendLedger`（含 `declareRecord`）或 `NamespaceWriter.write()`
携带的登记式台账行写了**已登记的正式事件类型**；② `appendAuthoritativeEvent` 收到**未登记**的
eventType（没有权威签发者，机制拒当它的传声筒）。不可重试：调用方必须换通道或先登记。

**新增端口成员 `NamespaceWriter.appendAuthoritativeEvent(a: { eventType; objectId; revision; payload;
describedAt? }): CommitSequence`（窄面加宽一项）**——正式事件类型的**唯一写入入口**，属于该事件
类型的**归属能力**。落笔前的判据全部先于写入、零残留（编号即执行顺序）：
① eventType 已登记为正式事件类型，且登记在**本端口能力**名下 ⇒ 否则 `EVENT_AUTHORITY_REQUIRED`；
② 本端口能力处于**激活**状态（包 3，D-25；停用即写不动，两个通道同判。判据源 = **本进程内存 registry**
的生效路由——包 4 纠正，原文曾写「查 `capability_route` 生效路由」，纠正说明见上文「包 4 纠正」段）
⇒ 否则 `CAPABILITY_INACTIVE`；
③ **授权取证，先于对象解析（包 3，N1——D-20 第三层的机制落点；#44 §5.1「权限校验先于对象解析」
的同类排布）**：机制向**机制可信的授权来源**取证——取该事件类型登记的 `requiresAuthority` 轴
（判据 ① 的同一本归属账本），对**本事务的已验证主体**用与 `assertAuthority` **同一条** authority
账本核对（`Kernel.principalCan`；不建第二套权限账本、不调用任何领域回调），并把证据
`{ axis, capability, authorized }` 写入 ledger 新列 `authority_basis`——**机制独占写入**：
`appendAuthoritativeEvent` 的入参里没有能填这一列的字段，调用者改不动它。
取证失败的两形 fail-closed 拒写（先于任何写、零残留）：事件类型没有登记授权轴（装配判据被运行时
变更绕开时的兜底）⇒ `AUTHORITY_REQUIRED`；取证通道本身抛错 ⇒ 原样拒绝，事务回滚。
**「取证结论为未授权」不是拒写**：PR-A1 要求无业务授权轴的主体其声明**完整保存**（行落库、见证
`authorized:false`、载荷意图字段为 `AUTHORITY_UNVERIFIED`），但该行自此**永不计入投影**（见下文见证优先闸）。
④ `objectId` 必须存在于 `object_directory` ⇒ 否则 `NOT_FOUND_IN_SPACE`；
⑤ `revision` 必须在该对象的**归属命名空间**里真实存在（与 §16.1 的 D-24② 修订判据同源）⇒
否则 `NOT_FOUND_IN_SPACE`。
ledger 行的 `actor` 列由**机制**从本事务已验证主体写下——**签发主体是机制事实，不是载荷字段**；
包 3 起 `authority_basis` 同理——**授权结论是机制事实，不是载荷字段**。
正式事件关于的可以是**他人拥有的对象**（记录域对对象模型的对象声明采纳，这正是它的既定用途），
因此本入口核对的是**事件类型归属**，不是对象归属——与 §16 表格的 `write()` 语义分属两根轴。

**存储面（登记；非冻结面）**：`ledger` 新增可空列 `authority_basis text`——机制见证的 JSON 封套，仅
`appendAuthoritativeEvent` 写，其余通道（`appendLedger`/`write()`/`recordReport`/迁移器）一律留 NULL。
PoC 侧 `SCHEMA_VERSION` 4→5（DDL 在 `src/storage-sqlite/sqlite-port.ts`，**不在**冻结的根 `schema/**`，
后者与本 PoC 零引用关系）；既有 v4 库按既有纪律在打开路径 `SCHEMA_UPGRADE_REQUIRED` fail-loud，
PoC 测试世界全部新建库、无迁移债；实施期若要读旧库，迁移器须显式补写。
**包 4 存储纪律（N9，席位 G3-A A2-5 实测）**：「`UPDATE`/`DELETE` 被触发器 abort ⇒ H 不可变」这条
存储层支点**不完备**——SQLite 的 `INSERT OR REPLACE` 冲突消解走「隐式删除 + 插入」，而**隐式删除只在
`recursive_triggers=ON` 时才触发 DELETE 触发器**（默认 OFF）。修前连接未开该 PRAGMA ⇒ 装配裸面
（`port.raw`，运维/测试后门，插件句柄拿不到）一条普通 `insert or replace` 即静默整行替换历史、投影翻
`ADOPTED`，非越权但击穿 append-only 核心不变量。修后契约：① 连接建立处必须 `PRAGMA recursive_triggers
= ON`（实测 REPLACE 触发 `ledger_no_delete` abort `HISTORY_IMMUTABLE`、原行不变）；② 机制句柄守卫
（`guard()`）把 `insert or replace` / `replace into` 形态一并登记为被禁写法（纵深：守卫此前只禁
DDL/PRAGMA/ATTACH 头，不禁这类 DML 形态）。回归锚：`tests/n9-replace-append-only.test.ts`。

**包 5 存储纪律（D-27 / D-28 / D-29 / D-30，席位 G4-A G4A-N9c/d/e 实测，2026-10-30）**：
包 4 的 `recursive_triggers=ON` 只保护**已带 DELETE 触发器的表**——保护面恰为触发器表集，
`object_directory` / `capability_route` / `meta` 不在其内（D-27/D-28/D-29 三条新洞都由裸面
REPLACE 在这三表上整行改写合法达成）；守卫归一化只剥**前导**注释 ⇒ 中置注释与 upsert
`DO UPDATE` 四式穿过锚定正则（D-30）。本包修法分两层：

*层一：存储层触发器（fail-loud。abort 消息词 `ROUTE_FROZEN` / `ROUTE_SHAPE_FROZEN` /
`ROUTE_AUDIT_REQUIRED` / `ROUTE_CHANGED_SEQ_MONOTONICITY` / `META_COUNTER_MONOTONICITY` 与既有
`HISTORY_IMMUTABLE` / `DIRECTORY_IDENTITY_FROZEN` 同构，是**存储层信号文本，不是 `RefusalCode`
封闭集成员**——封闭集不因此扩张，登记于此以免误读）：

- `capability_route`（D-27/P1：绕开的是 `capability-admin` 轴的持久化，被绕的是「停用」这一安全
  决策）⇒ 启停**只能**经 `setRouteEnabled`、移交**只能**经 `transferRoute`，且任何路由变更必须
  随审计落账：`route_no_delete`（DELETE 含 REPLACE 隐式删除 ⇒ `ROUTE_FROZEN`）；
  `route_change_guarded`（UPDATE：`changed_seq` 严格单调递增，`ROUTE_CHANGED_SEQ_MONOTONICITY`——
  机制判据钉死的是「戳只能前进」，不是「戳有意义」；且 `ledger` 必须已存在 `seq = new.changed_seq`、
  事件类型合 `{capability-enabled, capability-disabled, capability-transferred}`、payload.capability
  字面相符的行 ⇒ `ROUTE_AUDIT_REQUIRED`）；`route_insert_guarded`（INSERT 只接受初始登记形
  `enabled=1 且 changed_seq 为 NULL` ⇒ `ROUTE_SHAPE_FROZEN`——INSERT 伪造不出「已审计」）。
  三个正当写方的写序随之改为**先写 ledger 审计、后改路由**（BEFORE 触发器逐语句判，账必须在先）。
  **审计先行必须与变更同事务原子（外部复审点名：否则「先审计」反而制造幽灵审计——假凭据比零审计更糟）**：
  同事务的保证是**唯一一条边界**——`Kernel.uow` 的 `return this.#port.tx((raw) => { … fn(tx) … })`
  把回调体整个装进 `SqlitePort.tx` 的 `begin immediate → fn → commit / catch → rollback`；审计 insert
  与路由 update 拿的是同一条句柄（`RAW_OF_UOW.get(tx)` 即 `port.tx` 交进来的 `raw`）。**机制内不存在
  第二个事务边界**：不经 `tx()` 回调的写只有 `port.raw`（同一连接的 autocommit），那条面本来就是
  已登记的运维后门——是明示的界外，不是隐蔽的第二边界。界外的幽灵形状被钉成显式断言（拆两条
  autocommit「审计先落、变更被拒」⇒ H 留下从未生效的审计行，且 `ledger_no_delete` 连幽灵一起钉死、
  抹不掉）：机制内三形态（提交期注入失败 / 事务中途触发器 abort / scope-escape 先于任何写）实测
  **零残留、序号也不留 ghost**（`tests/d27-route-audit-gate.test.ts` D27-5），并把该原子性**架空**
  一次（审计挪到事务外）证明测试确实抓得住幽灵（红后还原，kernel.ts sha256 核验等值）。
  **诚实边界**：裸面持有者可先向 H 写一条形态齐全的审计行再过闸——伪造从「零审计」变成
  「先落账进 append-only H 才可改写」，痕删不掉、处置归运维/审计（与 v2 存量伪造行同处置面，
  G1 余项）；触发器钉死的是**无痕变更**，不是裸面持有者的一切变更。
- `object_directory`（D-28/P2：RD-01 注释宣称「创建即固定」，修前只固定了 UPDATE 一形）⇒
  **身份行不可改、不可删**：`directory_no_delete`（DELETE 含 REPLACE 隐式删除 ⇒ 复用
  `DIRECTORY_IDENTITY_FROZEN`）；`directory_birth_audited`（INSERT：**账本非空**的空间里新身份行
  必须带 `seq = created_seq`、`event_type='object-registered'`、`object_id` 相符的 ledger 行 ⇒
  同码；`createObject` 写序改为 ledger 先行）。账本为空的空间不参判据 = 迁移器/存量库夹具形状
  （old-schema 攻击资产所赖），如实登记。**裁定：owner 一经登记不可变更**——PoC 内无任何正当的
  owner 变更路径，`object_directory.owner_capability` 无合法写者，留可变列而无正当写者正是本洞
  根因，故列语义钉死为常量。`transferRoute` 语义据此对齐：移交改的是「能力 → 实现插件/ns/契约版」
  的**路由行**（`capability_route`），**不触碰也不得触碰**目录行——对象归属没有机制移交通道，
  旧契约「路由表可变」一句仅指路由三元组。
- `meta`（D-29/P3：H 序号单调是全套打开判据的地基）⇒ `meta_counter_monotonic`（UPDATE：任何键
  `new.value < old.value` 一律 `META_COUNTER_MONOTONICITY`——`ledger_seq`/`id_counter`/
  `schema_version` 同受护，版本号下调也是「打开路径地基被动过」）；`meta_ledger_seq_no_delete`
  （DELETE `ledger_seq` 键同码——堵住 REPLACE 的隐式删除形，REPLACE=归零两式之二连 UPDATE 形
  `ON CONFLICT DO UPDATE SET value=0` 一并拒）。**边界如实**：`id_counter` 键的 DELETE 仍可行
  （该形态打开期即 `SCHEMA_UPGRADE_REQUIRED` fail-loud，old-schema 轴既有绿条钉着——已治理的
  打开期形态，不在运行时拒是刻意的）；**前跳（ghost seq）与合法发号在触发器层不可分辨**，与
  journal 幽灵行同族，属裸句柄运维界残余。
- **触发器保护面声明（必须与任何绿灯并列引用）**：以上触发器对**经 `SqlitePort` 建立的连接**
  生效（含未守卫的 `port.raw`——连接层带 `recursive_triggers=ON`）；手工 `new DatabaseSync`
  不带该 PRAGMA 时 REPLACE 的隐式删除**不触发** DELETE 触发器 = 裸文件全权界，登记不入承诺；
  `journal` / `projection_state` / `projection_cursor` **仍无不可变性触发器**（派生/压实面，
  设计允许），其被禁形态由层二守卫兜。`PRAGMA writable_schema` / `ATTACH` 只在守卫层被禁
  （头位词表），未守卫面可直接执行——同属裸面残余。
*层二：守卫归一化（D-30/P3，纵深）*：`normalizeSql` 剥**全部**注释（块/行、任意位置）后做
**子串**匹配——被禁 REPLACE 形态**放弃 `^` 锚**（中置注释四式证明锚本来就是错的），名单补
`on conflict … do update`（upsert 整行改写与被禁 REPLACE 同族）；`on conflict … do nothing`
保持合法（投影登记的唯一合法 upsert 形，机制自己在用）。**误杀方向**：字符串字面量内的
`--` / 块注释符 / 被禁词会被误剥误杀——误杀方向安全（拒而不放行），如实登记；`normalizeSql`
是**词法**手段，更深的形态（字面量内伪关键词的绕行、未来新语法形）仍可能绕，主修始终是层一。
**SCHEMA_VERSION 5→6（登记；非冻结面）**：DDL 增上述 7 触发器并全部纳入 `REQUIRED_TRIGGERS`
打开校验；存量 v5 库按既有纪律打开期 `SCHEMA_UPGRADE_REQUIRED` fail-loud（detail 同时给版本
不符与 `missingTriggers` 归因），PoC 测试世界每次新建库、不承担 v5→v6 迁移债（同包 3
`authority_basis` 先例）。回归锚：`tests/d27-route-audit-gate.test.ts`、
`tests/d28-directory-identity.test.ts`、`tests/d29-meta-counters.test.ts`、
`tests/d30-guard-forms.test.ts`（各例均含「修前成功形态」的反向对照钉）。

**唯一入口的机制执行（不是约定）**：

- `appendLedger`（以及经它的 `declareRecord`）在**一切事务作用域——包括 `assembly`**——拒绝写已登记的
  正式事件类型。装配根与 Application Use-case 也不例外：正式事件只能经**所属领域的授权命令 Port**
  写入（PoC 里 = `FactDesignationCommandPort.declare`，判据仍住 `FactStandingPolicy`，端口只落笔）。
  Q40 不破：命令 Port 在**调用方交来的同一条事务**内写入。
- `appendLedger` 的 `objectId` 归属从此受检：scoped 事务里走与 `revise` **同一条** `#assertScope(owner)`
  ⇒ 在 scoped 事务里给他人对象记事件 = `CAPABILITY_SCOPE_ESCAPE`。这是读侧 E-01（`eventsOf` 默认拒绝
  跨命名空间）的**写侧对称门**；assembly 作用域保留跨领域台账（协调权，Q40 依据不变）。
- `NamespaceWriter.write()` 顺手登记的台账行同样过正式事件名单 ⇒ 不能借扩展状态行冒充正式事件。

**投影信任模型（领域侧，与机制配套；D-20 复审要求 3、4；包 3 修订第 3、4 条）**：派生业务状态
**不得**凭载荷里任何随手字符串判定（修前 `note:'AUTHORIZED'` 就是被实测利用的伪造面——无关能力
一条 `appendLedger` 即翻转他人对象的采纳投影）。判定只认：

1. **结构化字段**：事件必须带 `designationSchema` 标记与齐全的 `stance/issuer/policyVersion`
   字段，任一缺失即不参与投影；
2. **签发方 = 机制 ledger actor**：`eventsOf`/`eventsFor` 的行新增 `actor` 列（读面加宽，见下），
   投影要求 `payload.issuer === row.actor`——载荷自称不算身份，机制记的才算；
3. **授权结论只认机制见证（包 3，N1，替换原第 3 条「授权是结构化字段」）**：ledger 新列
   `authority_basis` 是 `appendAuthoritativeEvent` 落笔前按归属账本的 `requiresAuthority` 轴向
   可信授权来源取证后写下的**机制见证**（入口判据 ③）。载荷的 `authorization` 字段**降级为
   意图声明**——领域写入方仍会填它（观测用途），**投影不采信它**。
   **见证优先闸**：凡带机制见证的行，授权结论一律以 `authority_basis.authorized` 为准，
   **与载荷自称的版本号无关**——`authorized:false` 的行无论自称 v2、v3 还是任何版本，一律不计。
   这条闸把「今天的新写入挑一个旧版本号走自称判据」的逃逸道封死：能走到「载荷自称」判据的
   只剩**无见证的历史行**（见第 4 条）。投影**从不查询当前权限**；
4. **`policyVersion` 按事件记录的版本判定**：投影按事件记录的版本号查**冻结的判据表**
   （`FACT_STANDING_RULES`；新版本 = 加一行，旧版本的判据**永不再改**）；未知版本 ⇒ fail-closed
   不计入。**包 4 查表纪律（N6/N7，席位 G3-A 实测两个 P1 后裁定）**：`policyVersion` 在插件自写的
   payload 里，而判据表是普通冻结对象字面量——`Object.freeze` **不封原型链**，裸下标 / `in` 查表会让
   `'constructor'` 查到 `Object`（真值可调用 ⇒ v3 全部形状判据整体旁路，N6/P1 完整性）、`'toString'`
   同族、`'__proto__'` 查到 `Object.prototype`（非函数 ⇒ 调用即 `TypeError` **永久崩读者**，账本不可
   删改、再写正当 `WITHDRAWN` 也救不回，N7/P1 可用性）。因此查表**必须**：
   ① 先 `Object.prototype.hasOwnProperty.call(TABLE, policyVersion)`（**禁用 `in` 与裸下标真值判断**）；
   ② 命中值过**形状校验**（必须是登记过的判据函数，且载荷的 `designationSchema` 匹配、
   `policyVersion` 与所查键**字面相等**）；③ 任一不满足 ⇒ **fail-closed 不计入且绝不抛异常**——
   读者面（`standingAt`）对任何畸形行都必须正常返回「不计入」，可用性崩面与完整性旁路同一条修法一起封。
   验收锚 = `tests/n6-n7-frozen-table-prototype.test.ts`（席位 FIXPROBE-1/2/3 原样移植：修法前 3 红、
   修法后 4 绿，FIXPROBE-4 对照组恒绿）。**包 3 新增 `fact-standing/v3` 行**：结构化字段 + `issuer === actor` + 见证
   `authorized === true`，判据体内**不读**载荷 `authorization`。**v2 自此为只读历史语义**：
   领域写入方只产 v3；v2 判据（含其授权子句「载荷自称 AUTHORIZED」）只对**无见证行**可达 =
   包 3 机制生效前写入的存量行，新写入不可达（权威通道的每一行必带见证）。
   **禁止**按当前配置对历史事件做静默重解释——两个方向都不许偏：已落库的 v2 行在包 3 之后、
   在业务授权被撤销之后，仍按 v2 冻结判据继续生效（`tests/n1-authorization-evidence.test.ts`
   「撤销 × 历史双钉」方向①钉住）；撤销后的新写入不计入（方向②：见证 `authorized:false`）。

旧形状事件（无 `designationSchema`，含历史伪造行）在新信任模型下自动退出投影 = 不再生效，但 H 是
append-only，它们**仍在库里**；对这类存量伪造的处置是运维/审计问题（ledger 侧审计目前无机制承接，
登记在回报与 G1 余项，勿当作已解决）。**包 3 如实登记的同类残余**：包 3 之前经权威通道写入的
「v2 外形伪造行」（诚实 issuer + 自称 AUTHORIZED，席位 G2-A 组合 C4 形态）**无见证** ⇒ 仍按
冻结的 v2 判据计入——历史不可重解释与存量伪造处置在 append-only 上互相拉扯，处置归运维/审计
（G1 余项），PoC 测试世界全部新建库、不携带这类存量行；集成期读旧库必须先过审计。

**读面加宽（同时加宽 E-01 的泄露面，如实登记）**：`eventsOf`/`eventsFor` 返回行新增 `actor`
（机制 ledger 主体）。E-01 的已知耦合因此从「存在性 + 归属者身份」加宽为「+ 事件行的登记者」——
对正式声明类事件，签发者本来就是业务可见数据；若将来把跨命名空间读开放给其它事件类型，须连同
E-01 的 G1 裁定一并复核。
**包 3 再加宽一项（E-01 泄露面第三次加宽，登记于 READINESS 的 E-01 行）**：返回行新增
`authority: { axis; capability; authorized } | null` = ledger `authority_basis` 的机制见证
（无见证行为 null）。跨命名空间读由此多看到「该事件签发时经核对的授权轴名 + 机制授权结论」；
投影判定必需这一列（不把它交给读者，领域就只能回去读载荷自称——正是 N1 消灭的形态），
故按必要性加宽并如实登记，E-01 的 G1 裁定复核范围随之扩大。

**D-22：领域验证服务只接收有具体用途的受限提交接口**。`ValidationService` 的**类型面**只收
`ValidationReportSubmission`——一个只有 `submitReport(...)`（「登记一份校验报告」这一个动作）的
Port，**不再收任意回调形态的全权事务执行器**；Application 层的跨插件协调事务不受影响（提交 Port
由装配根实现，内部用授权主体自开事务）。构造参数一律 `#` 私有字段——D-17/P2-2（TS `private`
参数属性 = 运行时自有可枚举字段）这条教训在本仓第三次点名，不得再犯。**运行时兼容（诚实登记，
过渡形态，显式具名）**：既有攻击夹具（含本条的审查者冻结裁判 `attacks/review/g1a-regression.test.ts`
——它以回调形态构造并预设构造成功，只要求句柄运行时不可达）仍以旧形态接线，审查文件不可改。
兼容路径是**模块级导出的具名适配器** `adaptLegacyValidationWiring(wiring)`（入参类型 `LegacyRunIn`
标记 `@deprecated`）：构造器只有 `this.#submit = adaptLegacyValidationWiring(submission)` 一行；
适配器把 callable **降级包装**成单动作 Port 后原执行器即脱离一切可达位置——不在实例、不在原型、
不在包装对象的自有属性上，**兼容入口对第三方持有者同样取不回事务句柄**（可达性=零，判据由
`tests/formal-event-authority.test.ts` 以直接攻击适配器的形式钉死，而不是只钉"从服务实例拿不到"）。
删除条件：三个旧夹具（`re-review-g0b` / `r5r8` / `reduce-coverage`）与裁判改接线后，删除适配器、
`LegacyRunIn` 与构造器内那一行。

**墙适用边界的更新**：上面「装配根交入全权事务」的收窄声明里，`ValidationService.runIn` 一路已收口
（运行时面与结果面双重实测：`attacks/review/g1a-regression.test.ts` D-22 条）；一般形态的约束继续
有效——任何新的领域对象都不得持有通用事务执行器，接线一律用**有具体用途的 Port**。

### 16.3 包 6：机制审计名预留、移交不携 ns、读面归属、保留前缀、巡检覆盖与打开判据补漏（席位 G5-A @03d74a0 反审，2026-10-31）

本节按「先契约后机制」撰写：下列每一条先落在本文，机制实现随后；`KERNEL_SURFACE.sha256` 于实现完成后统一重生成。

**D-27 真修（P1 完整性）：五个机制审计名进预留 + 路由守闸核机制落账见证。**
G5-A 纠正了前席与作者的共同误判：D-27 的可达面不是「装配裸面/运维」——`appendLedger` 与
`write()` 对五个机制审计事件名（`capability-enabled` / `capability-disabled` /
`capability-transferred` / `object-registered` / `check-report-recorded`）**零预留**，任何只有
`space-write` 的主体都能落与 `setRouteEnabled` 真账逐列同形的行（含自定 `actor`、同为 NULL 的
`authority_basis`），全链到「新进程签发恢复」。两段修法：
① **预留五名**：复用正式事件名已有的预留通道与同一拒绝码，不新发明、不引入新中心耦合——
`CapabilityRegistry` 增设机制审计名集合（机制的自我陈述，与 `MECHANISM_RESOURCES` 同族），
`appendLedger` / `write()` 命中等同 formal-event 预留 ⇒ `EVENT_AUTHORITY_REQUIRED`（通道判据）；
`register()` 拒绝清单 `ownsEventTypes` 认领五名 ⇒ `AMBIGUOUS_AUTHORITY`（与双认领同码同族，
否则「窄面正式通道」成为预留的第二 breach）。机制自身的五个写点
（`setRouteEnabled` / `reassignRouteInternal` / `createObject` / `recordReport`）走实现内部直写、
不经通用通道 ⇒ 预留不误伤机制。
② **路由守闸核见证**：`route_change_guarded` 的审计存在性判据补 `l.actor is not null` +
`json_valid(l.authority_basis)` + `json_extract($.axis)='capability-admin'` +
`json_extract($.authorized)=1`——只查形状 = 把谎言写进删不掉的表。机制路由审计行
（enabled/disabled/transferred 三事件）从此写 `authority_basis` 见证
`{axis:'capability-admin', capability:<被路由能力>, authorized:<入口权威核对结论>}`，
与 N1 正式事件见证同信封。判据半形已被席位点名：**只做 ① 不做 ②，攻击者持真实 actor mint 仍过闸**
⇒ 专用用例钉住（半形变异下必红，见 EVIDENCE 变异实验）。
**诚实边界（登记）**：裸面（`port.raw` DML / 裸文件）仍可连见证列一起伪造过闸——预留使插件可达
mint 归零，裸面伪造从「随便一行即过」升级为「必须在见证列撒谎」，痕迹不可删、处置归运维/审计。
触发器体变更 ⇒ `SCHEMA_VERSION` 6→7，旧库重开 `SCHEMA_UPGRADE_REQUIRED`（不携迁移债，包 3/5 先例）。

**D-31（P1 可用性）：移交通道不携 ns；ns 漂移入口即拒。**
包 5 裁定「owner 一经登记不可变更」与 `transferRoute` 携 ns 互斥，其并存产物是一次完全合法的
`capability-admin` 操作永久毒化全库双时间读面。签名判定采纳席位：**ns 参数根本不该存在**——
移交的原语义只是改 Capability→Plugin 映射。机制面：`reassignRouteInternal` **删除 ns 参数**，
路由 ns 恒取当前持久行 ⇒ 机制面不存在任何改 ns 的通道；`transferRoute(cap, to, by)` 的 `to`
仍是 `PluginManifest`（清单类型无 ns 参数可删），其 `storageNamespace` 从**写入输入**降为
**校验输入**：声明与当前生效路由 ns 不同 ⇒ 入口即以新码 `TRANSFER_NS_DRIFT` 拒——判据在开事务、
落账、改路由**之前**，零半成品。ns 迁移另立显式迁移通道（机制没有，也不拿移交面凑数）。
正向对照：同 ns 换包（pluginId/contractVersion 变）行为不变。读侧的 `SCHEMA_INCOMPATIBLE`
兜底保留（界外篡改后的库形状仍须 fail-loud），但可用性责任在入口，不在读侧。
`TRANSFER_NS_DRIFT` detail 只回显调用方自己的输入（capability/currentNs/declaredNs）；
空空间同形负例钉「不得泄漏跨空间存在性」。

**D-24 读侧（P1）：扫描面与快照面共用同一条 `dir.ns` 归属判据。**
`readAsOf` 扫描查询带上行 `ns`，每行过**与 `readSnapshot`/`readLatest` 同一条**
`routeNs(registry, dir)` 判据（不是复制逻辑，是同一个函数）：有效归属 ns ≠ 行 `ns` ⇒ 该行不是
此对象的属主状态，剔除并计数；`serveable()` 捕获 `SCHEMA_INCOMPATIBLE`（路由 ns 漂移）计入遮蔽
而非上抛——一行归属不符不得炸整页（扫描面失败形态分界原则 §14.5）。**echo 形状不加字段**：
三种隐藏成因归入 `hiddenByContractSkew`，其语义从「契约版本偏差」加宽为
**「写入方不被当前读者保证」**（版本偏差 / 路由 ns 漂移 / 归属不符他人行）——同一信息面
（知数量、不给身份）、同一处置面，且冻结裁决附件钉着 echo 键集，加字段=动已冻结面。
**后果登记**：合法 Facet 挂载行（oid∈dir、行落扩展者自己的 ns）在快照面本就不可见，扫描面现在
对齐——双时间扫描的可见面收窄为对象属主状态；「同一对象同一时刻两个答案」由此终结。

**D-21 最小止血（P1 可用性）：保留前缀 id 收归机制计数器。**
`RPT-` 前缀是机制报告身份 namespace（`recordReport` 按 ledger 计数器发 `RPT-<seq>`）。
显式声明携带保留前缀（`declareRecord` / `appendLedger` 的 declaring 形态）⇒ 新码
`RECORD_ID_RESERVED` 拒，判据在落 `records` 行与 ledger 行之前。引用形态不受影响：
`linkRef` 的 record-ref 指向已存在 `RPT-*` 仍合法（S-3 报告引用语义不变）。**保留前缀的完整
语义（前缀全集、域保留申请、发号区间 namespace 化）归 G1**；本止血只承诺：声明通道不能预占
保留前缀 ⇒ 合法报告提交不再被滚动撞号。

**C2（P2）：巡检覆盖 `required:false` 的目标存在性（`softGhosts` 只报不阻）。**
`auditRequiredIntegrity()` 返回新增 `softChecked` / `softGhosts`：`required=0` 的边逐条查目标
**存在性**（object-ref 查目录、record-ref 查 records 表；**不做 revision 级判定**——
`required:false` 语义内含允许悬空修订，计入幽灵的只有身份级悬空）。计数只进回执：不改
`violations`、不阻塞任何提交。「0 违规」与「无幽灵」从此脱钩——清白回执说出它看见了什么。

**存储不变量补漏（P2/P3：新洞2 / F5b / F5c / N9 残余）：**
- 打开路径判据补 `max(ledger.seq) ≤ meta.ledger_seq`：水位归零/倒退重开即
  `SCHEMA_UPGRADE_REQUIRED`（detail 给两数）；ghost-seq 前占形的重开可检性一并覆盖。
- **裸驱动错误包装**：`UNIQUE constraint failed: ledger.seq`（会话内水位落后、下一次发号撞
  历史）由 `translate()` 包装为新码 `LEDGER_SEQ_CONFLICT`——需修复、不可重试，驱动文本仅存
  `detail.driverMessage` 作证据。**如实登记**：包装前该文本越过了「驱动词汇不得越过 Storage
  Port 边界」的既有纪律，违例入 READINESS N9 残余行。
- **触发器体摘要进打开判据**：`REQUIRED_TRIGGERS` 从名字比对升级为名字 + SQL 体摘要；期望摘要
  在模块加载时于**内存基准库**上执行 `SCHEMA` 后从 `sqlite_master` 读回、归一（折叠空白、
  `if not exists` 头部差异）计算，**不手工维护摘要表**（改了 SCHEMA 忘改摘要 = 判据自己腐烂）。
  同名空壳/改体 ⇒ `SCHEMA_UPGRADE_REQUIRED`（detail `alteredTriggers` 列名）；缺名仍走
  `missingTriggers`（缺失优先于改体判定）。**一字自证**：`when new.value < old.value` 改成
  `>`（名字/排版全同、保护当场失效）重开必红点名；同体异形（仅换行缩进）不误伤
  （ST-E 把这两条都钉成测试）。
 - **`port.raw` 二选一：取守卫**。机制三面（tx / read / raw）一律拒多语句与注释伪装（剥注释归一同前）。
   `raw` 的拦截面按**可测三分法**钉死（逐形对应 `tests/g5a-n9-storage.test.ts` ST-D，不得含糊成「已守卫」）：
   ① **拦得住 ⇒ `RAW_SQL_REFUSED`**：DDL 全类（`drop/alter/create/attach/detach/vacuum/reindex/analyze`
   头部词表，与机制写句柄同源）、**PRAGMA 赋值形**（`pragma x = off`；`pragma x(v)` 调用形一并拒——
   赋值与读在词法上不可分辨，宁可误杀，纯读可改写 `select * from pragma_table_info(...)` 走 SELECT
   放行）、**多语句**（`;` 后有实体即拒；尾分号放行）。由此承诺成立：**经 SqlitePort 交出的任何句柄
   都无法关闭 `recursive_triggers` 连接态，也无法经 raw 执行 DDL**。
   ② **放行（有意为之，各有锚）**：SELECT/WITH；DML 全类——REPLACE/upsert 放行**到触发器**受拒，
   不拆「触发器不豁免写形」的既有锚；**PRAGMA 裸读形**（`pragma <name>` 无赋值无参数，n9 绿锚核对
   连接态所赖）；**事务控制 `begin/commit/rollback`**（`tests/p1-storage-tx.test.ts` 第二连接写锁锚
   所赖：界外面在自己的连接上开合事务不新增绕触发器通道——事务内触发器照火，且 DML 本就放行）。
   ③ **拦不住（残余，登记不承诺）**：手工 `new DatabaseSync` / 裸文件域外（默认 `recursive_triggers=OFF`，
   关闸写入重开不可检出）；`raw` 的 DML 伪造数据行含伪造审计行与 `authority_basis` 见证列（G27-C 钉死，
   与 D-27 裸面边界同条）；**raw 是唯一不做驱动词汇翻译的面**——无事务时 `rollback` 之类以
   `ERR_SQLITE_ERROR` 原样越界（ST-D 钉为既成事实）；界外面 `begin` 不开对导致连接半开属运维纪律，
   机制不管。**撤销与实现不符的旧口径**：「经 SqlitePort 建立的连接（含 `port.raw`）全部受护」不再
   成立为文——守卫管住的是**经 Port 交出的句柄上的状态类与结构类语句**，不是持有裸文件者。

**拒绝码封闭集新增（3 枚，按 §14.2 同规）：`TRANSFER_NS_DRIFT`、`RECORD_ID_RESERVED`、
`LEDGER_SEQ_CONFLICT`。** 三码 detail 均只回显调用方自己的输入或机制本地可判计数，不含任何
他空间存在性判定；每码在 `tests/**` 钉「不得泄漏跨空间存在性」负例（空空间与有对象空间同形）。

**插件可见面变化（对拍口径，重锚前登记）**：① `transferRoute` 输入面**收紧**——携带不同 ns 的
移交从「写成功」变为 `TRANSFER_NS_DRIFT` 拒（这是收紧不是放宽，如实标注：依赖旧语义的装配方
会看到新拒绝）；② `readAsOf` 结果集可收窄（归属不符行被遮蔽、计入既有计数器），echo 键集不变；
③ 三枚新拒绝码到达调用方分支面；`appendLedger`/`write()` 对五审计名的拒绝复用既有码
`EVENT_AUTHORITY_REQUIRED`（不新增码）。插件可见成员名集（face/tx/writer 运行时面）零增删，
由 `arch-independence.test.ts` 运行时面锚对拍；`reassignRouteInternal` 仍在 `UnitOfWorkImpl`
原型上（N4 登记面），仅参数表收缩。

