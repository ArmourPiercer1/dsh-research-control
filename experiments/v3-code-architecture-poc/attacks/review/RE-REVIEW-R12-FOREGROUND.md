# RE-REVIEW R12 · Foreground 独立复验（R12-FOREGROUND）

- 性质：独立复验人直接实测 + 直接裁决（非确认式复看）
- 状态：**已完成**
- 仓库：/home/user/dsh-plugins/dsh-research-control
- 目标：experiments/v3-code-architecture-poc/（要求 HEAD ≥ 4255722，已验证 ✓）
- 工具预算：≤ 14 次；**实际用量 8 次**（见第六节）
- 硬纪律遵守：只跑指定测试文件（未跑全量）；只读 src/kernel/read-context.ts（130 行全文）与 src/kernel/kernel.ts（807 行，分三段读完）；仅在 attacks/review/ 下新建本文件，未触碰 src/**、tests/** 及任何交付文档

## 待裁决事项

1. **裁决（必做，最影响下一步）**：读面 `readAsOf` 遇"行契约版本 ≠ 生效路由版本"时：
   - A：抛 `SCHEMA_INCOMPATIBLE` 拒绝整次读取
   - B：剔除该行 + 回显计数 `hiddenByContractSkew`（现状）
   - 判据（项目已裁定，不另自创）：RF-02（失效必须可判定、不得静默）；C12/T-05（空结果不得被读成"没有"）；RPT（不可判定不得伪装成答案）；先例 F-24（能力禁用时：扫描面=剔除+回显 `hiddenByInactiveCapability`，已被独立复审判为真修好；单对象面抛错）。
   - 作者自述倾向 B，并声明该倾向可能自我偏袒；本报告独立裁决，如不同意将直接反驳。
2. **出口核查**：`Kernel.eventsFor`（kernel.ts 约 L407）返回 `ledger.payload_json` 解析结果，而 `ledger` 表无 `contract_version` 列——是否构成 F-EV-R2 的漏网出口（P1）？

## 进度日志

- [骨架] 创建。即将执行唯一必做实测（仓库根）。
- [实测] 已执行，全绿。HEAD 验证：`4255722f8264dad04bcdc023a840eab4565412ba`，`git merge-base --is-ancestor 4255722 HEAD` 通过（≥ 基线 OK）。
- [读码] read-context.ts 全文（130 行）；kernel.ts L1–280 / L330–549 / L550–807 三段读完。
- [结论] 裁决与出口核查完成，见下。

## 一、实测结果（原样记录）

- 命令（仓库根执行）：`npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts tests/contract-skew-echo.test.ts attacks/evolution/contract-version-skew.test.ts`
- 结果：**全部通过**。`Test Files 2 passed (2)`；`Tests 9 passed (9)`；Duration 385ms。
  - `experiments/v3-code-architecture-poc/tests/contract-skew-echo.test.ts` — 4 tests, 199ms ✓
  - `experiments/v3-code-architecture-poc/attacks/evolution/contract-version-skew.test.ts` — 5 tests, 221ms ✓
- 小结：混合版本库的主要断言（skew 剔除 + `hiddenByContractSkew` 回显）在 HEAD 上现有测试全绿；未复现任何失败。

## 二、裁决：readAsOf 契约版本 skew → 选 B（剔除 + 回显 `hiddenByContractSkew`）

**我的选择：B。** 这不是对作者倾向的确认——我按判据独立推演后落在 B，且我认为现状代码的正确形态比"A vs B 二选一"更精确（见依据 1）。

### 依据（只使用项目已裁定判据 + 代码事实）

1. **现状代码在同一读面内已按"可判定性"分了两档，而版本 skew 恰在"可判定"这一档。**
   readAsOf 的扫描面内实际有三条失败路径（read-context.ts L71–103）：
   - 能力未启用/未装配（`CAPABILITY_INACTIVE`）⇒ 剔除 + `hiddenByInactiveCapability`（L76）；
   - **命名空间漂移**（`routeNs` 抛 `SCHEMA_INCOMPATIBLE`）⇒ **整次读取被拒**（L74–78 只捕获 CAPABILITY_INACTIVE，SCHEMA_INCOMPATIBLE 向外传播）；
   - **契约版本 skew**（`assertContractVersion` 抛 `SCHEMA_INCOMPATIBLE`）⇒ 剔除 + `hiddenByContractSkew`（L96–102）。
   为什么 ns 漂移拒整读、版本 skew 只剔除？代码给出了机制级理由：**ns 是数据所有权键**（kernel.ts L260–262、L147–151），ns 与生效路由不一致时 `capabilityOfNs` 反查失效 ⇒ **这行是谁写的都不可判定 ⇒ "生效版本"本身不存在 ⇒ 判据无定义**。按 RPT（不可判定不得伪装成答案），判据无定义只能拒读。而版本 skew 时：ns 匹配 ⇒ 属主已知 ⇒ 生效版本已知，行上戳已知（L619–622 写侧每次盖戳），**"两版本不同"是一个可判定事实**——此时拒整读反而把一个可判定的局部失效升级成整页不可用。分界线画在"**判定本身是否可判定**"上，这正是 RF-02/RPT 的边界，不是随意选的。
2. **F-24 先例的可迁移规则是"失败形态按读面性质分"，且代码显式声明沿用**（read-context.ts L87：「沿用已被独立复验接受的 F-24 先例」）。readAsOf 是扫描面（返回一页行），不是单对象面。先例已被独立复审判为真修好；把同一读面里"可判定不一致"的情形换成整读拒绝，会使该读面的失败形态自相矛盾（ns 漂移拒、版本 skew 也拒？那 `hiddenByInactiveCapability` 档又是什么性质？），**裁决族的不一致本身就是 RF-02 意义上的"不可判定"**。
3. **C12/T-05**：「整页为空」正是本项目最禁止被误读成"没有"的形态（read-context.ts L89–90）。一行 skew 若拒整读，调用方得到一个错误而**不知道页内哪些行本来可读**；剔除 + 计数则"可读部分仍可读，隐藏部分有归因"（L90：「剔除必须可归因，不得静默」）。
4. **RF-02 的可判定性**：B 形态下调用方拿到的是一个可机验的三元组——`rows`、`hiddenByContractSkew`、`echo.usedRecordedAsOf`，"失效"对调用方是可见且可断言的（现有 9 条测试正是断言这个形态，本次全绿）。
5. **对 F-27 纪律的一致性**：未盖章行（`recorded === ''`）同样被剔除并计数（kernel.ts L157–169 + L100），即"不可判定形状"绝不被放过端给读者——B 形态对"不可判定"的处理是**剔除+计数**而非端出，RPT 在扫描面由回显计数兜底，与单对象面"拒读"兜底同义不同形。

### 被我否掉那派（A：整读拒绝）的最强论点

**A 派最强论点：同一读面内 ns 漂移已经整读拒绝，而 ns 漂移与版本 skew 同为"行的记录路由 ≠ 生效路由"（前者是 ns 级、后者是版本级）。若接受"ns 漂移该拒"，逻辑一致性要求"版本 skew 也该拒"——现状的 B 是同一读面内的不一致，是 A 漏装的半门。**

**为何不足以翻盘：** 两个案例的失败性质不同，且差异恰好落在项目判据的定义域内：ns 漂移使**属主不可判定**（判据的自变量不存在，RPT ⇒ 拒）；版本 skew 时属主与两侧版本**全部已知**（判据可执行，结果"不匹配"是一个诚实答案，RPT 允许以"剔除+计数"呈现）。A 派论点把"路由不一致"当作同一类，但项目判据区分的是**可判定/不可判定**，不是**一致/不一致**。此外 A 的代价是整页可用性：在 D-6（PoC 尚无 domain_state 回填器）与混合版本库的现实下，"一行未迁移 ⇒ 该对象整段历史读不出"，而 F-EV-R2 根因注释（kernel.ts L615–618）已把"修订过的对象根本不可读"判为不可容忍的失败形态。一致性可以由"分界线 = 可判定性"达成，不需要把 B 也换成 A。

### 我选这派留下的风险（一句话）

`hiddenByContractSkew` 只给行数、不给 oid（F-24 的防泄露设计，read-context.ts L24–27），做**字段级聚合**的调用方无法从接口上知道"我聚合的字段是否恰好落在被剔除行里"——唯一缓解是把该计数保持非空、并用消费侧断言/攻击测试钉死"计数 > 0 ⇒ 结果是部分集"。

### 附带观察（P3，不属本次裁决项，仅记录）

`timeFieldMissing` 的形状检查（read-context.ts L114–119）对 **`visible`（能力过滤后、skew 剔除前）** 计算，而非对 `keep`（skew 剔除后）计算。边角：若带顶层数字 `describedAt` 的行恰好全部被 skew 剔除，则 `rows=[]` 且 `timeFieldMissing=false`、`hiddenByContractSkew>0`。故事仍可判定（计数指明了成因），**不违反 C12/T-05**；但 S-2 注释写的是"可见行里"，两个计数串联解释时集合口径会误导。建议后续把形状检查改对 `keep` 计算，或在注释中显式声明口径。

## 三、出口核查：Kernel.eventsFor 是否 F-EV-R2 漏网出口？

**明确表态：不算 P1 漏网出口。** 作者假设（"可能不算"）的核心成立，但我不同意"就此静默"——残余问题是真实的，且应被**显式裁定**而非省略（见下）。

### 为什么不是 F-EV-R2 同一读面族（不是漏装判据）

1. **判据在该面上没有可执行的比较对象。** `assertContractVersion(effective, recorded)`（kernel.ts L162–169）要求：行上有写入时戳 + 属主可判定 ⇒ 生效版本可知。`ledger` 全部 7 类 insert（L340、L540、L590、L624、L656、L686、L757）均无 `contract_version` 列；ledger 行的版本属性是**记录时点的历史事实**，不是"当前读者的形状保证"。若强行套当前生效版本判据，"升级契约版本"就等于"升级前全部历史不可读"——直接违反 ID-08/T-01/T-02 的 `recorded_as_of` 回放要求（即作者说的"升级即失忆"）。所以对这个面，"拒"与"剔除"都**不是良定义选项**：这不是"同一判据漏装在一个面"（F-EV-R2 原发现是"同一行数据在三个读面上给出两个答案"，kernel.ts L559–560），而是一个判据不适用的不同读面族。
2. **机制对事件载荷是显式不透明的**：「Kernel 把 eventType 当不透明字符串，判读 payload 是领域的事」（L403–405）；窄面契约同语（L509）。不存在"当前读者"，就没有"形状保证被违反"这一事件。F-EV-R2 判据装在**机制把 domain_state 形状端给当前读者**的每一面：`NamespaceWriterImpl.readLatest`（L558–561）、`UnitOfWorkImpl.readLatest`（L732–736）、`readAsOf`（read-context L92–103）、单对象面（read-context L88 注释）——本次 9/9 测试全绿即这些面的行为证据。
3. **ledger 载荷中机制固定的 envelope 是稳定的**（`{}`、`{capability}`、`{capability, from, to, fromNs, toNs}`、`{validatorId, ruleVersion, verdict}`），跨版本无形状漂移；唯一版本敏感的内容是 `appendLedger` 的领域自选载荷（L632–662），其可解释性契约在领域层，不在内核读面。

### 对作者假设的直接回应（同意核心 + 两点修正）

- **同意**：eventsFor 是"按记录时点的历史事实"回放面，不应装当前版本判据；这不是被拒读面的漏网出口。
- **修正 1（不豁免静默）**：残余风险是真实的——**v2 契约的实现经 `faceFor → eventsOf`（L414–428）读 v1 时期 `appendLedger` 载荷时，若领域事件载荷形状在版本间变化，会被静默误读**。这不是内核面的"静默剔除/静默端出"（eventsFor 不剔、不拒、不藏，所有行都端出，无跨面不一致），所以不是 P1；但它是 **P2：ledger 行缺写入时版本戳 ⇒ 调用方无法自知载荷可解释性**。作者假设里"真问题可能是载荷要不要带写入时版本戳"方向正确，我进一步指出：**修法应是加 `ledger.contract_version` 列（写入时从生效路由盖戳，与 domain_state L536/586/619–622 同形），而不是往 payload 里塞字段**——payload 字段是领域可丢可改的，列才是机制级事实。且该列一旦加，存量行即成未盖章（`''`），按 F-27 纪律读侧只能回显"N 行未标记"、不得默认放过 ⇒ **回填器问题与 D-6 同款债务**会再现。
- **修正 2（必须显式裁定）**：如果项目对 P2 的答案是"PoC 阶段不做"，那必须写进 READINESS/裁决记录（与 D-6 并列），**不能以"不算漏网出口"为由让它消失**——否则下一轮审查会再次把它当作 F-EV-R2 漏网出口重新提出。

## 四、实际跑过的命令 + 输出摘要

1. `git rev-parse HEAD` → `4255722f8264dad04bcdc023a840eab4565412ba`；`git merge-base --is-ancestor 4255722 HEAD` → 通过（HEAD ≥ 4255722 ✓，实际恰为该基线提交）。
2. `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts tests/contract-skew-echo.test.ts attacks/evolution/contract-version-skew.test.ts`（仓库根执行）
   → `Test Files 2 passed (2)`；`Tests 9 passed (9)`；Duration 385ms。
   → `tests/contract-skew-echo.test.ts` 4 tests ✓（199ms）；`attacks/evolution/contract-version-skew.test.ts` 5 tests ✓（221ms）。

## 五、未做清单（明确标注）

1. **未跑全量测试**、未跑其余任何测试文件（硬纪律 + 预算）；只跑了任务指定的两个文件。
2. **未读两个测试文件的断言内容**——只记录 vitest 输出的测试数/通过状态；未逐条核对断言文本。
3. **未读单对象面实现**（`readRevision`/`readObject` 所在文件不在允许读取的两个文件内）——其"拒读"行为依据 read-context.ts L88 注释与 F-EV-R2 注释推知，未直接读码验证。
4. **未读 storage schema 定义文件**——"ledger 无 contract_version 列"依据 kernel.ts 内全部 7 类 insert 语句（均无该列）+ 任务前提；未读 CREATE TABLE 原文。
5. **未新增攻击测试**（可选项）：既有两测试文件已覆盖混合版本库主要断言且全绿；新增测试需读测试 harness API（超预算）。第二节 P3 观察（`timeFieldMissing` 口径）建议后续用攻击测试覆盖，本轮未做。
6. **未读 F-24/F-EV-R2/RF-02/C12/T-05/RPT/ID-08 的裁定原文**（PoC 文档目录）——裁决依据 = 任务列明的判据 + 代码内注释（注释引用同一编号体系，自洽）；若裁定原文与任务转述有出入，以原文为准（本轮无法核验）。

## 六、工具用量

实际 8 次 / 预算 14 次：
1. write 报告骨架；2. bash（HEAD 验证 + vitest 指定两文件）；3. write 追加实测结果；4. read read-context.ts（全文）；5. read kernel.ts L1–280；6. read kernel.ts L330–549；7. read kernel.ts L550–807；8. write 本报告定稿。
