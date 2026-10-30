# ADJUDICATION — 扫描读面 `readAsOf` 契约版本偏差的失败形态（A 拒读 vs B 剔除+回显）

- 记录开始：独立裁决，非作者自审。
- 裁决范围：仅 V3 PoC 扫描读面 `readAsOf` 遇「行的契约版本 ≠ 当前生效路由版本」时的失败形态。
  单对象读面（`readObject`/`readSnapshot`/`readRevision`/`PluginFace.readLatest`）已统一为拒读，不在裁决范围。
- 判据（项目已裁定，不另自创）：RF-02（失效必须可判定、不得静默）；C12/T-05（空结果不得被读成"没有"）；
  RPT 系列（不可判定不得伪装成答案）；先例 F-24（能力被禁用时扫描面选"剔除 + 回显
  `hiddenByInactiveCapability`"且经独立复审判为真修好；单对象面抛错——"失败形态按读面性质分"已被接受过一次）。
- 纪律：本文件是本次裁决唯一写入物（attacks/review/ 内新建）；不改 src/**、tests/**、他人文件、交付文档。

---

## 0. 记录：调查事实（只列裁决用到的）

- 现状：`src/kernel/read-context.ts:85-103` 的 `keep` 循环——`assertContractVersion` 抛
  `SCHEMA_INCOMPATIBLE` 时 `hiddenBySkew += 1; continue;`；echo 只带该计数（:121-127），
  无 oid、无版本对、无 seq。同一函数里 ns 漂移是另一形态：`serveable`（:71-79）把
  `routeNs` 的 `SCHEMA_INCOMPATIBLE` 重新抛出 ⇒ 整页拒读。
- 单对象面统一拒读（前提核验，属实）：`readRevision`（kernel.ts:316）、
  `readSnapshot→readLatest`（:726,:735）、`PluginFace.readOwn→readLatest`（:561）
  都装同一条 `assertContractVersion`（:162-169），skew 行逐行抛
  `SCHEMA_INCOMPATIBLE`，payload 带 `{capability, recordedContractVersion, effectiveContractVersion}`。
- F-24 先例链：`attacks/review/RE-REVIEW-R3.md:27-32`（禁用分支真修好＝扫描面剔除+回显、
  单对象面抛错，被独立复验接受；ns 漂移 fail-loud 被接受）；:108（残余 P1：剔除结果与
  "从未存在"不可区分 ⇒ 按 C12/T-05 加 echo 计数）；`REVIEW.md:317-318`（作者自认裁量，
  两派各一条代价）；`CONTRACTS.md:244`（"扫描面的失败形态选择属设计裁量，沿用 F-24 先例，
  仍需独立裁决"）；`READINESS.md:61`（D-8）。
- 实测探针（加分项，6/6 绿）：`attacks/review/ADJUDICATION-scan-face.oracle-probe.test.ts`，
  命令与输出见 §4。
- 关键结构事实（探针确认）：每行 `recorded_seq` 独立递增（kernel.ts:579 等）；
  oid 形如 `OBJ-<space>-<n>`，n 按创建序单调（:576-578）；默认截点的 echo
  `usedRecordedAsOf` 泄露 head（T-05 回显纪律的必然）。

## 1. 选边：**B**（剔除 + 回显 `hiddenByContractSkew`，即现状）

默认形态就是现状：逐行剔除、每次读必回显计数、只给数量不给 oid。

允许的实现加强（**不改形态**，仍属 B）：echo 增加首个被剔行的**版本对**
`{capability, recordedContractVersion, effectiveContractVersion}`——这是单对象面
`SCHEMA_INCOMPATIBLE` 拒绝 payload 已有的形状（kernel.ts:164-167），给出可定位线索
（跨了哪个迁移边界）而不给 oid。
明确否决另一个候选第三形态"首次遇到即置 `truncated` + 计数"：`truncated/moreRows`
是页截断的归因轴（C12/CS-24），把版本偏差剔除混进同一标志，就是把"空结果三种成因
互相可区分"（S-2/F-24 残余，`REVIEW.md:299-311`）刚钉死的设计再拆掉一条。

## 2. 依据

**先摆结构问题**：A 派最强的招不是"损坏比禁用严重"，而是"同一个读面对 ns 漂移已经抛
`SCHEMA_INCOMPATIBLE`，对版本偏差不抛是不对称的"。现状三条失败形态的分界线不是严重度，
是**该行对契约家族的归属是否可判定**：

| 触发 | 归属可判定性 | 形态 |
|---|---|---|
| ns 漂移 | **不可判定**：行的 ns 不再被任何生效能力声明，其形状不归任何生效契约所有；它原属谁（owner 旧声明，还是已消失的能力）当前路由判不出 ⇒ RPT：不可判定不得伪装成答案，也不能在"已知原因"的剔除下伪装 ⇒ 只能整读拒 | 抛（现状 :74-78，F-03 泄漏面，R3 复审已接受） |
| 能力禁用 | 可判定：有意运维态，原因完全确定 ⇒ 剔除 + 计数是忠实的机制事实 | 剔除 + `hiddenByInactiveCapability`（F-24，独立复验接受） |
| 契约版本偏差 | **可判定**：行的 ns 仍由生效 owner 声明、owner 活跃、recorded/effective 两个版本都有名 ⇒ 剔除原因完全可归因（"C@v1 写的行，C 现生效 v2"），剔除 + 计数不是把不可判定伪装成答案，RPT 满足 | 剔除 + `hiddenByContractSkew`（本裁决项） |

对照判据：
- **RF-02（失效必须可判定，不得静默）**：B 不是静默剔除。计数在**每次**命中的读里必回显
  （read-context.ts:126），读级可判定；行级可判定由单对象面承担——逐行抛
  `SCHEMA_INCOMPATIBLE` 且 payload 带版本对（kernel.ts:316/:735/:561）。两级可判定都在；
  RF-02 禁止的是静默，不是不抛异常。
- **C12/T-05（空结果不得被读成"没有"）**：A 在此条上损失最大。A 把"一行偏差"变成
  "整个窗口无结果"，而**错误路径上没有 echo 可挂**（T-05 的归因纪律只作用于结果形态）——
  调用方（尤其自动化管线）捕获异常后记下的"本窗口：无数据"，正是本项目最禁止的误读，
  窗口里其余合规行（审计者要的证据）被一并抹掉。B 保住"空页 + 计数>0 ≠ 没有"
  （作者回归第一例已钉住：`tests/contract-skew-echo.test.ts:46-56`）。
- **RPT（不可判定不得伪装成答案）**：B 的每行返回都过了同一条版本判据，不端出任何
  不可判定形状；计数是机制层真值，不主张窗口内容。A 在核层面也满足 RPT（不给答案），
  但它把"可判定的行级事实"升级成"窗口级不可用"，丢掉的恰是 RF-02 要求的那份归因。
- **F-24 先例**：正中靶心——扫描面性质（窗口枚举、没有"这个对象"可报、一行不得毒化整页）
  是被接受的轴，且已过独立复验；单对象面抛错是同一条先例的另一半。

**被否派（A）的最强论点及为何不足以翻盘**："版本偏差是数据损坏信号，比能力禁用严重
得多，静默剔除会让损坏长期隐身。"
1. B 不是"静默剔除"——回显是每次读的强制标注，只要偏差行在，信号永不消失。A 相对 B
   多给的只是**即时性**（不看见就不许读），不是**可检测性**——后者 B 已有（计数 +
   逐行带版本对的抛错）。
2. "长期隐身"只对忽视 echo 的调用方才成立；而这样的调用方在 A 下会捕获异常后吞掉，
   同时丢掉整个窗口——同样调用方纪律问题下 A 的代价更大。对策是把 `count>0` 报警放在
   消费端边界，而不是把内核形态改成整页毒化。
3. 严重度不对称（损坏 vs 有意态）是真的，但它论证的是"B 的信号要足够响"（见 §3），
   不是"窗口要不可读"——两个论点在不同轴上。

## 3. 一条代价

B 留下的风险：**不查 echo 的消费端会把部分页当整页**，慢性偏差退化成"正常运行"（习惯化）。
缓解（一句话）：把 `hiddenByContractSkew>0` 的报警压到消费端/集成边界（审计工具以
count=0 作为"干净窗口"声明的前置门），并在 echo 里补版本对线索，把"知道有事"到
"知道跨了哪个版本边界"的路径从探测缩成一次读。

## 4. 加分项：`hiddenByContractSkew` 能否被枚举出身份（实测）

探针：`attacks/review/ADJUDICATION-scan-face.oracle-probe.test.ts`（本目录新建，6/6 绿；
断言全部针对当前实现，记录事实）。夹具＝作者回归同款：v1 建 3 行 → 移交 v2 → 重开 → 加 1 行 v2。
复跑命令（仓根）：
`npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/attacks/review/ADJUDICATION-scan-face.oracle-probe.test.ts`

结论：**部分能——位置可完全枚举，无 revise 场景下 oid 可命名；启停能力无新信息。**

1. echo 确认只回数量（无 oid/版本对/seq）：
   `echo = {"usedRecordedAsOf":5,…,"hiddenByContractSkew":3,…}`。
   注意 `usedRecordedAsOf` 在默认截点下就是 head——走表上界不需要旁路。
2. **改截点枚举位置（连二分都不必）**：C(X)＝前缀计数，非降阶函数，
   C(X)−C(X−1)=1 即一行隐藏行的精确 `recorded_seq`。
   实测 `(X,C)` = `(0,0)(1,1)(2,2)(3,3)(4,3)(5,3)` ⇒ steps=1,2,3＝三行 v1 行
   （seq 4 是移交事件，C 不步、无可见行，攻击者自然识别为"非创建 seq"）。
   二分只是优化：第 k 个隐藏行＝满足 C(X)≥k 的最小 X（O(log head) 次读），实测 k=1,2,3 ⇒ 1,2,3。
3. **身份可命名（无 revise 场景）**：oid＝`OBJ-<space>-<n>`，n 按创建序单调
   （kernel.ts:576-578）。把隐藏行的 seq 放进"全部创建 seq 有序表"（可见创建行＋隐藏步）
   取秩，秩即 n。实测三行隐藏行被完整命名为 `OBJ-SP-ADJ-1/2/3`（第 4 个创建 seq 5 对应
   可见的 `-4`）。**边界**：隐藏的 **revise 行**（revision≥2）只能定位、不能命名——
   计数 oracle 分不清某一步是 create 还是 revise。
4. **启停能力无新信息**：卸载 owner 能力把同一批行从 skew 桶搬进 inactive 桶，
   实测 `(rows,skew,inactive)` = `1,3,0 → 0,0,4 → 1,3,0`。只重新分桶（可探出按 owner
   能力分组的计数），无任何行级身份。
5. 旁证（影响"只给数量"这一设计的实际保证范围）：单对象面本身就是逐 oid 判别器——
   skew 行抛错且带版本对、可见行照常、不存在 ⇒ undefined（实测
   `detail={capability, recordedContractVersion:"v1", effectiveContractVersion:"v2"}`）。
   因此一个有决心的调用方**不靠计数 oracle** 也能按 `OBJ-<space>-1..n` 试探枚举身份。
   "只给数量不给 oid"的真实语义是**不在单次批量应答里交出全集合**（F-24 残余的泄漏
   考量，`REVIEW.md:305`），不是抗探测。

**对裁决的影响**：枚举泄露的是偏差行的**存在与位置**（无 revise 时加 oid），不是偏差
**内容**——skew 行逐行抛错、payload 永不端出。这不翻盘 B，但支持 §1 的加强项：
把版本对写进 echo，让操作者不必探测就能从第一次回显直接行动。

## 附：证据索引

| 事实 | 落点 |
|---|---|
| keep 循环（剔除+计数） | `src/kernel/read-context.ts:85-103` |
| echo 字段集（两计数+布尔，无 oid） | `src/kernel/read-context.ts:12-37,121-127` |
| ns 漂移整页抛 | `src/kernel/read-context.ts:71-79` |
| 单对象面统一拒读 | `src/kernel/kernel.ts:316,552-563,721-741,162-169` |
| oid/seq 生成 | `src/kernel/kernel.ts:576-579,488-493` |
| F-24 先例与独立复验 | `attacks/review/RE-REVIEW-R3.md:27-32,108` |
| 作者裁量自述（两派代价） | `REVIEW.md:317-318`、`CONTRACTS.md:244`、`READINESS.md:61` |
| 空集三成因分离（否决 truncated 混用的依据） | `REVIEW.md:299-311` |
| 作者侧回归（4 例） | `tests/contract-skew-echo.test.ts` |
| 本裁决探针（6 例，全绿） | `attacks/review/ADJUDICATION-scan-face.oracle-probe.test.ts` |
