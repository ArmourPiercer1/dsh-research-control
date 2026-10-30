# R3 独立复审裁决

## 结论摘要

本轮独立复验：F-21 真修好；F-24 禁用期真修好，但 ns 漂移采用 fail-loud 抛 `SCHEMA_INCOMPATIBLE`，而原攻击文件要求 0 行，测试形态过时，契约依据支持抛错；F-25 真修好。F-26 真修好（requires 版本不符拒绝），F-27 主要路径真修好（同 owner 换版本拒绝、读版本不符拒绝），但空串被读侧放行是后门，且写侧 `capabilityOfNs` 在共享 ns 时存在归属歧义。F-22/F-23 的源码门禁不能证明真实边界：自建攻击证明 `PluginFace.revisionOf` 可跨能力读核心对象；领域不能持有 Kernel 的门禁仍会通过 `world.kernel` 经装配传入的绕过形态。该面为 P1。

## 任务一：五项修复

### F-21 — 成立：真修好

- 契约：ReadContext 完整性优先于空间归属；`CONTEXT_INCOMPLETE` 不得被 `CROSS_SPACE_REFUSED` 抢先。
- 证据：`src/kernel/read-context.ts:28-36` 先检查对象和 required fields，再比较 `spec.space`；`p4-read-isolation.test.ts` 的缺 space 例通过。
- 判定：真修好。注意同文件 `:36` 与 `:38` 存在重复空间判断，属于冗余，不改变顺序结果。

### F-22/F-23 — 成立：修得不完全，P1

- 契约：领域不得获得 Kernel/port/raw/驱动；PluginFace 只给领域最小能力面；不得伪造已验证身份。
- 证据（实际攻击）：新建 `attacks/review/r3-independent-attacks.test.ts`。`PluginFace.revisionOf` 从 `cap.r3.facet` face 读取 `cap.test.object-model` 对象 payload，测试通过；说明窄面仍是全空间精确读原语，没有 capability/ns 约束。该测试命令：
  `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/attacks/review/r3-independent-attacks.test.ts`
  实际：`1 failed, 2 passed`，其中跨能力读取例 `✓`。
- 另外，现有门禁只扫 `src/domains/**` 的源码形态；领域若由装配根把 `w.kernel` 或任意 Kernel 派生对象传进服务，门禁看不到。`src/harness/world.ts:47-54` 暴露 `raw/kernel` 与装配便利方法，门禁没有对装配调用图做验证。
- `PluginFace` 当前字段为 `writerFor/readOwn/eventsOf/revisionOf`（`src/kernel/kernel.ts:463-473`）。`revisionOf` 没有“仅 owner capability”语义，导致跨域数据侧读通道。
- 判定：窄面不足，修得不完全，P1。不是 P0：攻击者仍需获得装配传入的 face/服务调用能力，未直接获得运维路由改写权限。
- 最小修法：移除通用 `revisionOf`，改为 `revisionOfOwn` 并在 Kernel 内以 face capability 对 `object_directory.owner_capability` 做严格相等校验；跨域引用由显式中性 Kernel 解析原语处理，不返回他域 payload。装配测试须禁止 `new DomainService(w.kernel, ...)` 等传递 Kernel 的形态，或至少将 World 的 Kernel/raw 仅保留测试内部、不能作为领域构造参数。
- 回退测试：不同 capability 创建对象后，A face 读取 B oid 必须得到 `undefined` 或 `CAPABILITY_INACTIVE/NOT_FOUND_IN_SPACE`，而 A 自己对象仍可读；静态变异测试覆盖 `as any`、动态属性、`Reflect.get` 和 `world.kernel` 传入。

### F-24 — 成立：禁用期真修好；ns 漂移攻击断言应驳回（契约选择为 fail-loud）

- 契约：读写共用 `routeNs`；能力禁用不得从双时间面泄漏；ns 漂移不得把旧 payload 交给新读者（CP-6/F-03）。
- 证据：`read-context.ts:46-69` 每行执行 `routeNs`；`CAPABILITY_INACTIVE` 被剔除，禁用期测试通过；ns 漂移时 `routeNs` 抛 `SCHEMA_INCOMPATIBLE`，目标文件实际失败输出为：`Refusal: SCHEMA_INCOMPATIBLE`，栈指向 `read-context.ts:59`。
- 判定：F-24 禁用分支真修好。ns 漂移原攻击要求“返回 0 行”，但这和“不把不兼容 payload 伪装为空”不一致；REVIEW §9 已注明分歧，按 CP-6/F-03 的 fail-loud 依据，采用抛错，原测试驳回/过时。
- 回退测试：漂移双时间读必须抛 `SCHEMA_INCOMPATIBLE`；禁用双时间读必须返回 0 行且不抛。

### F-25 — 成立：真修好

- 契约：持久路由行是所有者权威；再启用与 `activate()` 同源，清单不应重建所有者。
- 证据：`kernel.ts:321-332` 再启用读取 `capability_route` 的 plugin/ns/version；生命周期 owner 例通过。全套输出：`re-enable must restore the PERSISTED owner ... ✓`。
- 新问题：持久行指向未加载实现时仍 `registry.setRoute`，后续写/读可能以无代码 owner 生效；当前没有对该 plugin manifest 存在性或能力实现可用性做再启用拒绝。另禁用事务确实登记 `ledger`/`journal`，这一点是正确的，但 `setRouteEnabled` 更新不存在 capability 时没有检查受影响行数，可能登记“成功禁用”而实际无路由。
- 判定：修复核心成立；新边界问题 P2。
- 最小修法：再启用前验证持久 plugin 在装配清单中且声明该 capability；更新路由必须检查 affected row=1，否则 `CAPABILITY_INACTIVE`/`ACTIVATION_IMPOSSIBLE` 且整事务回滚。
- 回退测试：持久路由指向未装配插件时启用拒绝且无 ledger/journal；不存在 capability 的 enable/disable 不产生登记。

### F-26/F-27 — F-26 成立；F-27 修得不完全，P1

- 契约：`requires[].contractVersion` 不匹配生效 provider ⇒ `ACTIVATION_IMPOSSIBLE`；同 owner 声明版本与持久版本不一致 ⇒ `ACTIVATION_IMPOSSIBLE`；读写必须按版本判定。
- 证据：`kernel.ts:248-269` 明确实现两项拒绝。原 `contract-version-skew` 两条红的实际原因是攻击夹具没有捕获 `openWorld` 期间抛出的 `ACTIVATION_IMPOSSIBLE`，不是修复缺失。首条重开测试通过，requires 版本不符栈明确为 `Refusal: ACTIVATION_IMPOSSIBLE`。
- 旧库：打开 v2/旧 schema 直接 `SCHEMA_UPGRADE_REQUIRED`（`sqlite-port.ts:218-223`），这是 fail-closed 设计，不是把库静默当新库；但迁移器只处理 records，未提供完整 v2→v3 迁移，故产品若声称可升级则不充分；若契约仅要求拒绝打开，则成立。
- 真实攻击：新建测试第二例把 `domain_state.contract_version=''` 的行插入后，`readRevision` 成功读出；`assertContractVersion`（`kernel.ts:157-163`）明确 `recorded !== ''` 才比较。命令同上，实际 `empty contract_version ... ✓`。这违反“版本不一致/缺失应不可判定即拒绝”的 fail-closed 方向，P1。
- 共享 ns：新建第三例证明写侧 `capabilityOfNs` 反查顺序决定归属。两个 capability 共用 `dom_test_om`，第二 capability v9 写入后落库版本实际为 `v1`，测试失败：`expected 'v9' to be 'v1'`。这不是测试误报，而是直接证明写侧无法从 ns 唯一确定 capability；P1。
- 最小修法：`contract_version=''` 直接 `SCHEMA_INCOMPATIBLE`；NamespaceWriter 持有 capability 的 contract version，写入时直接使用该 capability，不得 ns 反查；注册时拒绝多个能力共享同一持久 ns，或建立明确 ns→capability 唯一表。
- 回退测试：空版本行读拒绝；两个共享 ns 的 manifest 装配拒绝，或各自 writer 写入版本分别为 v1/v9；迁移后旧记录必须有明确版本来源而非空串。

## 任务二：三份作者未看攻击

### stopline-vocabulary-attack — 部分成立，P2（攻击文件自身反差断言错误）

实际单文件运行红 1 条、其余 4 条绿。红为：`expect(scanSemantics('p.WITHHELD_REFERENCE...')).toContain('WITHHELD')`，实际 `expected [] to include 'WITHHELD'`。原因是扫描器左边界明确排除 `.`，所以该对照断言不成立；不能用该红证明实现修复。其余绿例实证：契约中的 `INDETERMINATE/declaredGaps`、Kernel 的 `describedAt`、中性/小写 JSON 形态均可绕过当前门禁。命名门欠包含是 P2（业务语义门本就非 Kernel 的完整语义验证；但门禁文案不得 over-claim）。最小修法是修正测试锚点（用空格/对象字面量）并在文档声明命名扫描非语义证明；是否扩词表需契约所有者裁定。

### xc28-dual-source-attack — 成立，P1（领域语义层）

实际 4 tests 全绿。它证明同一事务可把 `operating_context` 既写入 payload 又建立 `USED_IN` 边，之后字段可独立 revise 而边不变；也证明 adopted/superseded 内联字段可静默写入。契约是 XC-28/RD-12 单一正源、XC-01/C01 与 XC-22。机制业务无知是设计意图，因此这是领域合成校验缺口而非 Kernel P0；应把 RECONCILIATION 中 NAMESPACE_ESCAPE 与 XC-28 的实证拆开。最小修法是合成领域校验器拒绝关系族 payload 与反向 adopted/superseded 字段，并添加反例回退测试。

### reduce-coverage-attack — 成立，P1

实际 3 tests 全绿。`synthReduce([], 'CHECK_UNAVAILABLE')` 为 `INDETERMINATE`，同一 findings + `COMPLETE` 为 `ACHIEVED`；`Coverage` 含第四值 `CHECK_UNAVAILABLE`；离线校验器返回空 findings。违反 RPT-02/RPT-03：coverage 不应参与 verdict，校验器不可用应是 `INDETERMINATE` finding（reason `CHECKER_UNAVAILABLE`）。这是可运行缺陷，不是测试形态问题。最小修法：离线生成 finding；归约只消费 findings；Coverage 回到封闭三值。

## 任务三：旧 schema 攻击辩解

原 `old-schema-counters` 和 `old-schema-records` 夹具确实无法进入业务路径：实际输出全部在 `SqlitePort.assertOpenableThenPrepare` 以 `Refusal: SCHEMA_UPGRADE_REQUIRED` 拒绝，行号 218-223，且 records 原夹具存在“9 values for 10 columns”问题的风险。重写为正确列数并保留旧库缺 `schema_version` 后，结论仍是打开期拒绝；因此“攻击无法构造”在当前机制下成立，不是逃避，但原测试需改为断言 `SCHEMA_UPGRADE_REQUIRED`，而不是继续期待静默补表/撞号。旧库迁移可用性另计：当前 `migrateLegacyRecords` 不能替代完整 schema migration，也没有 id_counter/domain_state.contract_version 的统一回填方案。

## 任务四：已知面抽查

- Kernel 业务无知/门禁词汇：stopline 测试已证明词表欠包含与位置盲点，但其一个对照断言错误；P2，不升级为机制 P0。
- 多进程并发：全套已运行；`multiprocess-contention.test.ts` 通过，实际父写被 `TX_CONTENTION` 拒绝、读不阻塞、未提交不可见。
- 报告不可改写：既有 `sql-guard`/host 攻击中的触发器约束通过；未发现本轮新破口。
- 投影缺口：全套输出中 projection gap 攻击主体通过（除旧 schema era 夹具在打开期拒绝），未新增 P0/P1。
- 空间隔离五出口：本轮未发现新泄漏；F-22/F-23 的 PluginFace 跨 capability 读是域间隔离缺口，不是跨 SQLite space 泄漏。

## 第三轮修复后的独立复验（作者补修后）

我重新运行了新建攻击文件与相关攻击。三条原攻击现在都被机制拒绝：

- `face.revisionOf` 抛 `NAMESPACE_ESCAPE`（`kernel.ts:414-422`）；
- 空 `contract_version` 抛 `SCHEMA_INCOMPATIBLE`（`kernel.ts:162-169`）；
- 共享 namespace 在装配期抛 `ACTIVATION_IMPOSSIBLE`（`kernel.ts:265-269`）。

命令：`npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts attacks/review/r3-independent-attacks.test.ts`。实际为 `3 failed`，且三条失败均在攻击断言处，栈分别命中上述拒绝；这表示攻击不可再构造，不是测试删掉/skip。F-22/F-23 与 F-27 的这三条具体漏洞判定改为**真修好**。

`hostSnapshot` 是否只是把洞挪到宿主侧：当前边界画法是可接受的。领域拿到的是单个已解析快照函数，不是 Kernel/port/raw，也不能选择任意 SQL；宿主作为装配根负责执行跨能力解析，符合“机制执行解析、领域解释 payload”的停线原则。残余风险是装配根若把任意 `(ref)=>snapshot` 交给恶意领域，仍可按任意 OID 读取；但这是装配配置错误，不是 PluginFace 默认越界面。最小回退测试应验证宿主仅向特定服务绑定受限 resolver，并禁止把 `Kernel`/`RawTx` 作为构造参数。

## 六个仍红攻击文件的独立处置

1. `contract-version-skew.test.ts` 两红：**作者辩解成立**。实际红栈均为 `openWorld` 装配期 `ACTIVATION_IMPOSSIBLE`，攻击没有进入旧 payload 读取；测试未捕获装配拒绝，断言写的是修复前可打开形态。
2. `old-schema-counters.test.ts` 两红：**辩解成立**。实际均在 `SqlitePort.assertOpenableThenPrepare` 以 `SCHEMA_UPGRADE_REQUIRED` 拒绝；旧夹具无 schema_version，不能继续断言静默补 0/撞号。
3. `old-schema-records.test.ts` 五红：**辩解成立**。实际均同样在打开期 `SCHEMA_UPGRADE_REQUIRED`；原夹具的旧列定义/值数量问题使其不能证明当前业务路径。应重写为打开拒绝或先走显式迁移器。
4. `stopline-vocabulary-attack.test.ts`：修复后 5/5 通过，但其结论仍只支持词表/扫描器欠包含，不等于 Kernel 业务语义泄漏；定级 P2。
5. `reduce-coverage-attack.test.ts`：修复后两条旧断言红，实际输出为 `ACHIEVED`（coverage 不再改变归约）及一条 `CHECKER_UNAVAILABLE/INDETERMINATE` finding；**攻击成立性被修复，辩解成立**。但 `Coverage` 类型仍保留 `CHECK_UNAVAILABLE`，应作为契约清理项而非当前可运行漏洞。
6. `lifecycle-sequence.test.ts`：ns 漂移例已绿且抛 `SCHEMA_INCOMPATIBLE`，证明作者选择符合 CP-6/F-03；新增“禁用剔除需可区分从未存在”的测试仍红，实际 echo 完全相同，确认一个**未修 P1**：空结果没有标注能力剔除/不可用原因，违反 C12/T-05 的“空结果≠¬P”。同文件 sequence guard 在当前装配清单重复 provider 时因 `AMBIGUOUS_AUTHORITY` 红，属于夹具/清单过时，不据此判实现缺陷。

## P0/P1 清单

### P0

空。本轮未发现新的可运行 P0；既有 F-14′ P0 结论不撤销，但不属于本轮新增。

### P1

1. **F-24 残余 / C12 空结果语义缺口**：能力禁用后 `readAsOf` 返回与“对象从未存在”完全相同的 rows+echo，缺少 excluded/inactive 标记；实际 `lifecycle-sequence` 新增例失败，错误信息为“禁用剔除的结果与从未存在的结果深度相等”。最小修法：echo 增加 `excludedByCapability`/不可用原因，或返回机制级 `CAPABILITY_INACTIVE`（但需保持与禁用期出口契约一致）。
2. **F-31 门禁假绿（开放）**：独立复验 `arch-independence` 原有扫描器对 `WITHHELD_REFERENCE`、小写/JSON 键名，以及点属性/动态属性/`Reflect.get` 等中性编码不提供语义保证；经 `world.ts` 传递 Kernel 的装配绕过也不在领域源码正则范围内。当前作者已登记为开放 P1；本轮不撤销。

实际运行（修复后复验）：完整门禁前一轮 `pnpm run test:poc:arch` 为 115 passed/18 failed；定向复跑上述 9 文件为 27 passed/16 failed，其中三条新攻击均在机制拒绝处失败、xc28 4/4 通过、stopline 5/5 通过、reduce 的缺陷断言反转、ns 漂移 1/1 通过。新建文件仍为 `attacks/review/r3-independent-attacks.test.ts`，未修改 `src/**`、`tests/**` 或既有攻击文件；类型门本轮未执行。