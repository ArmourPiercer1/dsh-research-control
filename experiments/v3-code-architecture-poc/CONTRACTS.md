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
| `domain_state(ns, oid, revision, payload_json, recorded_seq)` | `PK(ns,oid,revision)` + `(recorded_seq)` | 双时间读取 `recorded_seq<=cutoff` | 追加式；旧 revision 行永不覆盖 **[实测]** |
| `ledger(seq PK, …, object_id, record_id)` | `(object_id, seq)`、`(record_id, seq)` | 派生业务视图按截点回源（`standingAt`）| 触发器禁改删；是**唯一历史真源** |
| `journal(tx_epoch, ns, oid, op)` | `(tx_epoch)` | 缺口检测逐 epoch 探测 | 可压缩可删除；不得充当历史 |
| `ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required)` | `(to_oid, to_rev)` | 反向影响候选查询（当前全表扫） | `required` 决定提交期完整性校验 |
| `capability_route(capability PK, plugin_id, ns, contract_version, enabled, changed_seq)` | — | 激活期覆盖内存视图 | **允许** UPDATE（路由是可运维状态，身份不是） |
| `projection_state(name PK, seq, baseline, rebuilt_at)` | — | 水位/基线/缺口 | 派生面状态，可弃可重建 |

`space` 列在单文件模型下恒等，保留是纵深防御（防止误把别的空间的行导入本库），不参与索引设计。

## 4. 身份、引用与修订

- 身份三元组 `(oid, kind, ns)` 在 Directory 创建时固定；kind 语义由注册表路由，Kernel 无 kind 常量。
  第二个领域插件带全新 kind 注册，Kernel 面 sha256 不变且两种 kind 正确路由。**[实测]**
- `RevisionRef` 永不漂移（旧 revision 行仍在，非"记住旧值"）；`ObjectRef` 语义为跟随当前。
  两者在同一测试中对照成立。**[实测]**
- 硬引用（`required:true`）在**提交时**校验，缺失整体回滚；软引用允许悬空保存。**[实测]**
- 同事务内循环引用可写入，Kernel 不因此产生任何"证明力"产物。**[实测]**
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

## 12. 已选 vs 已拒（含替换代价）

| 决策 | 已选 | 已拒 | 拒的原因 | 若日后改主意的代价 |
| --- | --- | --- | --- | --- |
| 空间隔离粒度 | 每空间一个 SQLite 文件 | 单库多空间 + 行级 space 过滤 | 后者让"忘记过滤"成为可能的失败模式，且缓存/搜索越界需逐处防护 | **高**：需迁移数据与重写隔离测试（P4 五条出口全部重做） |
| 历史真源 | Ledger 唯一，Journal 可压缩 | Journal 兼作历史（CDC 即历史） | 实测 Journal 单独重放只得 1 条 | **高**：事件模型与恢复路径全改 |
| 登记序 | 事务内计数器 | `AUTOINCREMENT` 序列 | 见 F-04 | 中：需为截点查询引入"空洞即不可判定"语义 |
| 不可变性 | 存储层触发器 | 仅应用层约定 | 应用层可被绕过；触发器成本近零 | 低：去掉触发器即可，但守卫测试必须换手段 |
| 权威唯一性 | 装配期拒绝 | 运行期"最后注册者胜出" | 后者静默改变事件语义 | 低 |
| 报告语义位置 | 领域契约 | 机制契约 | 见 F-06 | 低：类型搬移，无数据变更 |
| 移交语义 | 路由表 UPDATE | 新对象命名空间迁移脚本作为唯一路径 | 迁移脚本无法回答"谁是当前所有者" | 中：需引入外部注册中心 |

## 13. 本 PoC **没有**证明的（不得越级引用）

- 未测：多进程并发写同一空间文件（只测了同进程双连接）；DSH 宿主权限面；真实五类对象字段与
  状态机；性能与容量；备份/时间点恢复；Schema 迁移工具；热插件加载与沙箱。
- 领域判据全部是**合成占位规则**（文件头已标注），不得被引用为 PR #42 科研语义政策的实现。
- 因此本实验区最高只能声称 **POC VERIFIED**；`IMPLEMENTATION READY` 需 §12 的未决项收口，
  `PRODUCT READY` 另论，且**不得由前三者推出**。
