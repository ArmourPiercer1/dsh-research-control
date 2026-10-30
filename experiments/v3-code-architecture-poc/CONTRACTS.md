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

**新增契约字段 `PluginManifest.ownsEventTypes`（清单面加宽）**：能力可把自己拥有的事件类型登记为
**正式事件类型**——即「领域据以执行接纳/授权类判定、派生业务投影直接相信它」的事件。
形状与 `ownsKinds` 同族：`readonly { eventType: string; capability: CapabilityId }[]`。
登记判据也与 `ownsKinds` 同族：同一事件类型被两个能力登记 ⇒ `AMBIGUOUS_AUTHORITY`；
指向未激活能力 ⇒ `CAPABILITY_INACTIVE`。Kernel 把 eventType 当**不透明字符串**，不解释任何业务语义
（业务无知扫描继续覆盖本面）。归属账本按能力 id 记，**不随路由停用而消失**：拥有者被停用时，
正式事件在两个通道上都写不动——那正是语义，不是可用性缺陷。

**新增拒绝码 `EVENT_AUTHORITY_REQUIRED`**：语义 =「**本通道没有资格写这个事件类型**」，与
「缺授权轴」的 `AUTHORITY_REQUIRED` 是两回事，与「改了他人的对象」的 `CAPABILITY_SCOPE_ESCAPE`
也是两回事。适用面：① 通用 `appendLedger`（含 `declareRecord`）或 `NamespaceWriter.write()`
携带的登记式台账行写了**已登记的正式事件类型**；② `appendAuthoritativeEvent` 收到**未登记**的
eventType（没有权威签发者，机制拒当它的传声筒）。不可重试：调用方必须换通道或先登记。

**新增端口成员 `NamespaceWriter.appendAuthoritativeEvent(a: { eventType; objectId; revision; payload;
describedAt? }): CommitSequence`（窄面加宽一项）**——正式事件类型的**唯一写入入口**，属于该事件
类型的**归属能力**。落笔前的判据全部先于写入、零残留：
① eventType 已登记为正式事件类型，且登记在**本端口能力**名下 ⇒ 否则 `EVENT_AUTHORITY_REQUIRED`；
② `objectId` 必须存在于 `object_directory` ⇒ 否则 `NOT_FOUND_IN_SPACE`；
③ `revision` 必须在该对象的**归属命名空间**里真实存在（与 §16.1 的 D-24② 修订判据同源）⇒
否则 `NOT_FOUND_IN_SPACE`。
ledger 行的 `actor` 列由**机制**从本事务已验证主体写下——**签发主体是机制事实，不是载荷字段**。
正式事件关于的可以是**他人拥有的对象**（记录域对对象模型的对象声明采纳，这正是它的既定用途），
因此本入口核对的是**事件类型归属**，不是对象归属——与 §16 表格的 `write()` 语义分属两根轴。

**唯一入口的机制执行（不是约定）**：

- `appendLedger`（以及经它的 `declareRecord`）在**一切事务作用域——包括 `assembly`**——拒绝写已登记的
  正式事件类型。装配根与 Application Use-case 也不例外：正式事件只能经**所属领域的授权命令 Port**
  写入（PoC 里 = `FactDesignationCommandPort.declare`，判据仍住 `FactStandingPolicy`，端口只落笔）。
  Q40 不破：命令 Port 在**调用方交来的同一条事务**内写入。
- `appendLedger` 的 `objectId` 归属从此受检：scoped 事务里走与 `revise` **同一条** `#assertScope(owner)`
  ⇒ 在 scoped 事务里给他人对象记事件 = `CAPABILITY_SCOPE_ESCAPE`。这是读侧 E-01（`eventsOf` 默认拒绝
  跨命名空间）的**写侧对称门**；assembly 作用域保留跨领域台账（协调权，Q40 依据不变）。
- `NamespaceWriter.write()` 顺手登记的台账行同样过正式事件名单 ⇒ 不能借扩展状态行冒充正式事件。

**投影信任模型（领域侧，与机制配套；D-20 复审要求 3、4）**：派生业务状态**不得**凭载荷里任何
随手字符串判定（修前 `note:'AUTHORIZED'` 就是被实测利用的伪造面——无关能力一条 `appendLedger`
即翻转他人对象的采纳投影）。判定只认：

1. **结构化字段**：事件必须带 `designationSchema` 标记与齐全的 `stance/issuer/authorization/policyVersion`
   字段，任一缺失即不参与投影；
2. **签发方 = 机制 ledger actor**：`eventsOf`/`eventsFor` 的行新增 `actor` 列（读面加宽，见下），
   投影要求 `payload.issuer === row.actor`——载荷自称不算身份，机制记的才算；
3. **授权是结构化字段**，按领域**写入当时**的判定落成数据；投影**从不查询当前权限**；
4. **`policyVersion` 按事件记录的版本判定**：投影按事件记录的版本号查**冻结的判据表**
   （`FACT_STANDING_RULES`；新版本 = 加一行，旧版本的判据**永不再改**）；未知版本 ⇒ fail-closed
   不计入。**禁止**按当前配置对历史事件做静默重解释——事后权限/规则变化不得改写当时所写事件的效力。

旧形状事件（无 `designationSchema`，含历史伪造行）在新信任模型下自动退出投影 = 不再生效，但 H 是
append-only，它们**仍在库里**；对这类存量伪造的处置是运维/审计问题（ledger 侧审计目前无机制承接，
登记在回报与 G1 余项，勿当作已解决）。

**读面加宽（同时加宽 E-01 的泄露面一项，如实登记）**：`eventsOf`/`eventsFor` 返回行新增 `actor`
（机制 ledger 主体）。E-01 的已知耦合因此从「存在性 + 归属者身份」加宽为「+ 事件行的登记者」——
对正式声明类事件，签发者本来就是业务可见数据；若将来把跨命名空间读开放给其它事件类型，须连同
E-01 的 G1 裁定一并复核。

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

