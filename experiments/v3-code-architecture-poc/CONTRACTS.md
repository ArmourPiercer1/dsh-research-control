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
