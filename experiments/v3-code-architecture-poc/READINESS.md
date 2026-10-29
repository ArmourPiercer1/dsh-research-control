# Implementation Readiness — 进入正式实施前必须为真的条件

> 本文件不是实施计划，而是**开工前置条件的可核验清单**。状态上限见 `ASSESSMENT.md`：
> 当前 **POC VERIFIED**，不是 IMPLEMENTATION READY。

## 1. 可以直接沿用的（PoC 已证明，含证据位置）

| 资产 | 沿用方式 | 证据 |
| --- | --- | --- |
| `contracts/index.ts` 的引用/空间/StoragePort/拒绝码封闭集 | 作为实施契约的起点（补真实 kind 与领域扩展码命名空间） | 73 例断言全绿（含 14 例审查员攻击） |
| `storage-sqlite` 的表结构与触发器 | 作为 DDL 草案（**须**补 `records` 与索引，按 `CONTRACTS.md` §3） | P1 不可变性探针 |
| `kernel.ts` 的注册表 + UoW + 命名空间写入器骨架 | 作为机制层参考实现，不作最终代码 | P1/P2/arch 三组 |
| `arch-independence.test.ts` 三类门禁 | **直接搬进正式 CI**（词汇扫描 + 依赖方向 + 面哈希） | 本轮抓出 3 处作者越界 |
| `attacks/**` 攻击测试 | 作为回归资产随契约演进扩充 | `REVIEW.md` §2 |

## 2. 必须重做或补足的（PoC 故意没做）

1. **真实对象模型**：五类对象的字段、状态机与领域接纳判据（PoC 用 `test.*` 占位 kind 与
   合成策略，`src/domains/**` 文件头已声明不得当作政策）。
2. ~~多进程并发写同一空间文件~~ **本轮已补证**：真起子进程抢写事务（`tests/multiprocess-contention.test.ts`，`EVIDENCE.md` §5）。
3. **DSH 宿主权限面**：`CONTRACTS.md` §10 明确未证明；装配根注入 principal ≠ 宿主身份真实性。
4. **Schema 迁移与时间点恢复**：`capability_route`/`records` 的演进、备份与 PITR 全未实现。
5. **热插件加载与沙箱**：PoC 的"插件"是同进程静态清单，不涉及加载与隔离。
6. **性能与容量**：PoC 数据量在个位数行级；`ref_edge` 反向查询目前全表扫。

## 3. 需要用户裁决的设计未决项（编码量能解决不了）

| 编号 | 决策 | 影响 |
| --- | --- | --- |
| D-1 | 空间粒度：一空间一文件（PoC 选）还是单库多空间 | 选后者 ⇒ P4 隔离证明整体作废，需重新证明 |
| D-2 | 派生面缺口策略：拒绝增量续跑（PoC 选）还是四态不可判定标注 | 决定 `Projection` 状态机与读面契约 |
| D-3 | 记录标识：`records` 表 + 声明/引用分离（PoC 选）还是 `ledger.record_id` UNIQUE | UNIQUE 会误伤"同一记录被多条后续事件引用" |
| D-4 | ~~F-14 级别~~ **已裁决**：独立复审实证守卫可被绕过 ⇒ 改判 **P0**，已修（`4ab5cf6`） | 无需再裁决；实施期须把 SQL 守卫列入红队常驻攻击面 |
| D-5 | `recordReport` 返回 `{reportId, recordedAt, seq}`：`recordedAt` 与 `seq` 是同一个值的两个名字（历史名 + 记录字段名）。实施期必须二选一，并在改名前跑一遍调用方——PoC 里一次静默改名当场打断了 4 个在用调用方 |
| D-6 | `domain_state.contract_version` 只有**写入侧**与**读侧判定**，没有 v2→v3 的回填迁移器。实施期第一个工作项就是它：无版本标记的既有库现在会被打开期拒绝，这是设计意图，但拒绝不等于迁移路径存在 |


## 4. 实施首批工作项（若用户批准开工，按此顺序）

1. 把 `arch-independence.test.ts` 与 `attacks/**` 迁入正式测试面并接进 CI 门禁。
2. 冻结 `CONTRACTS.md` §2–§9 为实施契约（含 D-1…D-4 裁决结果），走文档评审。
3. 用真实五类对象替换 `test.*` 占位，逐步把合成策略换成 PR #42 已定语义（**不得**新增第六类
   对象或第四套认识系统）。
4. 补 C-3 两组真实运行证据（多进程并发、宿主权限面），每项一个可复跑的证据目录。
5. Schema 迁移器 + PITR 的最小闭环，先于任何读面加速。

## 5. 开工门禁清单（每次实施提交都要全绿）

```bash
pnpm run test:poc:arch                                        # 侧车机制与攻击回归
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json # 侧车类型门（当前 0 诊断）
pnpm run check:types                                          # 根类型债门（19 条已知债，逐条身份匹配）
pnpm run lint                                                 # check-imports（INV-PERM-5）
pnpm run docs:check                                           # 文档静态一致性
pnpm run docs:probe --fail-on-blocking                        # 变更影响面
pnpm test                                                     # 根全量（当前见 EVIDENCE.md §6 的归因边界）
```

任何一项被放宽（跳过、降标准、从索引剔除）都视为**未通过**，而不是"通过"。
| D-7 | **`Kernel.port` 仍公开**（S-0③，与 S-5 同根，本 PoC 唯一剩余 P1）。实施期第一个安全动作：`port` 转 private + 具名读 API（`eventsFor` 已是雏形），`check_report` 读取必须带 principal 且只绑定回显不解码 findings。PoC 里读句柄已收紧到 `SELECT/WITH`，但**原始 SELECT 仍可取到 `check_report` 全文**，破 RPT-09 的 REF_UNRESOLVED/WITHHELD_REFERENCE 合并 |
| D-8 | 扫描面遇禁用能力现在**回显** `hiddenByInactiveCapability`，不是抛 `CAPABILITY_INACTIVE`。理由：扫描面没有"这个对象"可报。是否应与快照面同形改抛错，属契约裁量，PoC 未定；两派各有一条代价（抛错会让一次禁用打断整页读取） |
| D-9 | 装配边界：跨命名空间事实（快照、边角色）由装配根经 `hostSnapshot` / `registeredEdges` 交入。实施期必须约束 resolver 的**绑定**——否则"宿主替它取"会退化成"把任意读取器交给领域"。PoC 只有形状，没有绑定约束的机制 |
| D-10 | 门禁可证明的范围已收窄并写死在 `CONTRACTS.md` §14.1：词汇扫描是命名门、`attacks/**` 不类型检查、**任何绿灯不证明 Kernel 业务无知**。实施期若要拿门禁当证据，必须同时给出这三条的补偿措施，否则门禁数字会被读成安全保证 |

## 附录 A：D-7 的落地配方（`Kernel.port` 收口），含"为什么 TS private 不够"

第 11–14 轮三次推迟这一项，每次都因为"上下文不够做跨文件改动"。把它写成配方，使这件事
不再依赖任何单个会话的记忆。

**实测影响面（第 11 轮量过，别凭印象）**：`Kernel.port` 的**外部**消费者只有一个——
`src/kernel/read-context.ts:57` 的 `k.port.read(...)`；其余 `.port` 引用都在 `Kernel` 类内部
或走 `World` 自持的端口。**先量再改**，是这一项看起来比实际危险的原因。

**为什么不能用 TS `private` 交差**：`private` 只存在于类型层，编译后仍是实例属性，
`kernel['port']` 在 JS 里照拿。本 PoC 的 S-0/S-5 攻击就是"拿着端口做越权读"，
用 TS private 收口等于换了个写法继续漏——**必须让属性在运行时不存在**。

配方（按序，每步都可独立验证）：

1. `Kernel` 内部字段改 JS 私有字段 `#port: StoragePort`；构造器参数属性 `readonly port` 必须改写
   （参数属性不能带 `#`），改后把类内 `this.port` 全部替换为 `this.#port`（实测 8 处）。
   Node 24 支持 `#` 字段；`Object.getOwnPropertyNames(kernel)` 不再列出它，
   `kernel['#port']` 是语法错误——这才是"运行时不可达"。
   （`auth` 同理仍是 TS private，属**残留**，别顺手一起改：见步 5。）
2. 给 `read-context` 一个**具名只读扫描**方法替代 SQL 句柄：`Kernel.scanForRead(cutoff)`，
   内部单次 `this.#port.read(...)` 同时返回 `object_directory` 与 `domain_state` 两批事实。
   **必须是同一次 read**：分两次取会让可见性与对象时间看到不同状态，
   而"可见性截点与时间谓词同源"正是 `tests/empty-vs-absent.test.ts` 在守的性质。
3. 测试断言从"类型不通"升级为"运行时拿不到"：
   `expect(Object.getOwnPropertyNames(kernel)).not.toContain('port')`，
   并断言面集合（沿用 `tests/arch-independence.test.ts` 已有的运行时权威面判据）。
4. `KERNEL_SURFACE.sha256` 显式重生成，理由=面收窄（S-0③ 闭合），属收紧非放宽。
5. **不要顺手改 `auth`**，也**不要顺手关 `World.raw`**：后者是测试装配的显式后门，
   它的存在本身就是"绿灯不能证明 Kernel 业务无知"（`CONTRACTS.md` §14.1）的物证。
   两者各自单列（`auth` 残留、装配后门），混进同一次改动会让"面变窄了多少"重新变得不可核。

**验证清单**：`npx tsc -p …/tsconfig.json` = 0；`tests/` 全绿；
`attacks/semantics/dml-guard-attack.test.ts` 与 `checkreport-raw-read-attack.test.ts` 保持红
（它们红=越权读不再可构造）；`check-imports`、`docs:check` OK。

## 附录 B：两条独立复验带来的新开放项（第 27 轮，作者未自评）

| 编号 | 级别 | 内容 | 为什么不能省 |
| --- | --- | --- | --- |
| D-11 | **P2** | `ledger` 无 `contract_version` 列，`eventsOf` 把 `payload_json` 原样交进插件面 ⇒ v2 实现读 v1 事件载荷可能被静默误读。席位判它**不是** F-EV-R2 的漏网出口（事件面是"当时记下了什么"，套当前版本判据＝升级即失忆，违反 ID-08/T-01/T-02 回放契约），但**不接受静默**：建议加 `ledger.contract_version` 写入时盖戳（别塞进 payload），代价是存量行未盖章 ⇒ **D-6 同款回填器债务再现** | 席位原话：若 PoC 决定不做，必须写成显式裁定，"不能让它以'不算漏网'的名义消失"，否则下轮审查会当漏网出口重提 |
| D-12 | **P2** | `hiddenByInactiveCapability` / `hiddenByContractSkew` 的"只给数量不给 oid"**不抗探测**：席位实测用截点前缀差分 `C(X)-C(X-1)` 可枚举被剔除行的精确 `recorded_seq`，且**无 revise 时 oid 可直接命名**（`OBJ-<space>-<n>` 的 n 按创建序单调），另 `usedRecordedAsOf` 在默认截点下泄露 head。启停能力只重新分桶，不给行级身份 | 这条**推翻了我此前写过的说法**。作者侧曾把"只给数量"表述为防身份泄露的设计；真实语义只是"不在单次批量应答里交出全集合"。泄露的是存在与位置，不是内容 |
| D-13 | **P3** | `timeFieldMissing` 在剔除**前**的 `visible` 上计算（应基于 `keep`）⇒ 行全被剔除时该位口径误导 | 仍可判定，不违反 C12/T-05，但属我自己第 12 轮改动留下的口径缺陷，作者侧应修 |

**建议的 echo 加强（不改形态）**：补首个被剔除行的 `{capability, recordedContractVersion, effectiveContractVersion}`
版本对——给操作者一次读即可行动的线索，仍不给 oid。

| D-16 | **P1** | 交给插件的 `UnitOfWork` 对象在运行时携带 `raw`（裸 SQL 句柄）与 `k`（全量 Kernel 引用），实测 `[raw,k,port] = [false,false,true]`（false=可达）。类型面靠 `@ts-expect-error` 藏住，运行时没藏住 ⇒ JS 插件或一次 `as unknown as` 即得全库读写 | **我原来的门禁断言是恒真式（`x===undefined \| x!==undefined`），恰好把这个洞盖住了**——是复验席指出后改成真判据才现形。修法与附录 A 同族：`#raw`/`#k` 私有字段，让属性在运行时不存在；同类名测试"领域插件不得持有 Kernel"是源码扫描，扫不到运行时面 |
