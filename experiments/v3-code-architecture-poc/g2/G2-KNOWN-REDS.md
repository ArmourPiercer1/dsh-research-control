# G2 已知红灯登记（起点即红，非本轮引入）

> 纪律依据：用户 G2 授权「不得为了过门禁而降低测试标准、删除负例、伪造基线或接受新增的未登记红灯」。
> 本文件登记**在 G2 起点（`04c773a`）已存在**的红灯——它们不阻塞 G2 开工，但必须可追溯，且**不得**
> 用重锚（`snapshot:update` / 改 `gates/G0-inventory.yaml` 哈希）或删测试的方式「转绿」。

## R-1 `tests/engineering/eb1-canonical.test.ts` — G0 批准哈希与工作树不符

- **现象**：`every G0-ratified hash still matches the working tree` 失败：
  `SUBAGENT_ROUTING.md: expected '7c23e850…' to be '4b1f3f5f…'`。
- **复现（起点 `04c773a`，独立 worktree，未含本轮任何改动）**：
  ```
  $ npx vitest run tests/engineering/eb1-canonical.test.ts
  × every G0-ratified hash still matches the working tree
  Tests  1 failed | 7 passed (8)
  ```
- **性质**：G0 台账（`docs/engineering-baseline/gates/G0-inventory.yaml`）里的批准哈希与
  当前 `SUBAGENT_ROUTING.md` 内容不一致。即：文件在批准后被改过（或台账登记时即不一致），
  而 `git status` 显示该文件无未提交改动 ⇒ 是**已提交状态下的既存不一致**。
- **为什么不在 G2 修**：修它有两条路，都必须由用户裁决，不能实现者自选：
  ① 恢复文件到批准哈希对应内容（可能丢掉批准后的纪律更新）；
  ② 重锚台账（`SUBAGENT_ROUTING.md` 属 8 根冻结文档之一 ⇒ 须走冻结变更流程 + `Frozen-Face-Review`）。
  G2 授权明确排除「自行修改冻结契约」与「重锚掩盖回归」，故**只登记、不处理**。
- **影响面**：`pnpm test` 全量运行恒有 1 red（5081 passed / 1 failed）。任何 PR 的 `pnpm test`
  证据都必须援引本登记，而不是声称「全绿」。
- **建议**：G2 首个冻结面 PR（PR-2）提交前，请用户给一句裁决（恢复 vs 重锚），届时按对应流程一次办掉。

## 登记纪律

- 新增条目必须附**起点复现证据**（命令 + 输出），否则视为本轮引入的红灯，不许登记。
- 条目被修复后不删除本条，改标注「已修复 + 修复提交」。

## R-3 — `raw-record-declared` 翻面受阻：写点面与「唯一入口」冲突（**已闭合，方案 2 最小形态**）

登记时间：2026-11-04（G2 第 37 轮）。实测：把锚文件 `raw-record-declared` 由 `planned:true`
翻 `planned:false`（Port 形状、实现、清单登记均已就位）后，对账立刻红：

```
FAIL [EVENT_RECON_STALE] 入账条目 raw-record-declared 既无写点又非 planned:true
```

根因是两条规则相互拉扯：
- 锚文件 `writeSites: ["src/kernel/**", "src/storage-sqlite/**"]` —— 写点只认机制面；
- 契约要求端口内部走**拥有者的** `appendAuthoritativeEvent`，而调用点必然在领域包（`src/domains/**`）。
  领域包不在写点面内 ⇒ 对账认为「这个名字没有写点」。

三种可能出路（**必须由人裁定，不是实现细节**）：
1. 扩锚 `writeSites` 加入 `src/domains/**`——但 `writeSites` 是语义行，改它需要 `Event-Name-Review`
   trailer（我们自己 R4 的规则），且这会放宽「写点只在机制面」的既有立场；
2. 在 kernel 内部加一条机制原语 `declareRawRecord(...)`，领域端口调用它——保持写点面不变，
   但「唯一入口」从 Port 移到机制原语，需要在契约里重新表述（DC-5/DC-7 的可实现形式）；
3. 由机制在装配期把端口实现注入 kernel（翻转控制权），写点自然落在 `src/kernel/**`。

**登记原因**：这是 G1 冻结文本内部的一处张力，不该由实施者用「反正能过对账」的方式私自解决。
在裁定前，PR-2 的最后一片保持**不做**：清单已导出但未接线、锚未翻面、无入口可用。

### R-3 闭合记录（2026-11-04，用户裁定「方案 2 最小形态，不新设计架构」）

裁定要点与落地：
- `raw-record-declared` 是**机制事件**（EA-1.2.3 / EA-3.2 / OA-4）：由机制内部签发，
  `RAW_INTAKE_PLUGIN.ownsEventTypes` 不再认领（该清单**已删除**：没有领域自有事件可认领，
  留一份空清单只会诱使后来者把机制名填回去），领域也不得经 `appendAuthoritativeEvent` 签发。
- `RawIntakeCommandPort.declare()` 保留为 Application 唯一具名入口，内部**只做命令→数据**的剥离，
  转调机制签发点 `Kernel.declareRawIntake(RawIntakeEnvelope)`；事务边界在机制侧。
- `writeSites` **未改动**（仍只有 `src/kernel/**` + `src/storage-sqlite/**`）；机制内部
  真实落账（`insert into ledger ... 'raw-record-declared'` 字面量写点）后，对账事实扫描
  自然识别（事实 9 → 10），再把 `planned:true` 翻 `false`。**没有**加任何"无调用效果的名字常量"。
- 回执改为 `RawIntakeReceipt { recordId, witnessSeq }`：不伪造 ObjectID / RevisionRef
  （原始记录不是对象面事实，伪造 oid 会让后续以 oid 为前提的读面拿到查不到的对象）。
- 接口一致性澄清（最小）：`RawIntakeCommandPort.declare()` **不再接收 `tx`**——事务边界属机制；
  把 `tx` 透给领域就等于允许"记录已登记但事件未落账"的中间态。
- 实测（真实 Kernel + SQLite）：未解析材料正常收存、原始记录可被引用、机制事件唯一签发
  （`appendLedger` / `declareRecord` 双通道均拒）、重复 recordId ⇒ `RECORD_ALREADY_DECLARED`
  且失败事务零残留、保留前缀 `RPT-` 拒占、领域插件冒领机制名 ⇒ 装配期 `AMBIGUOUS_AUTHORITY`、
  无空间写权 ⇒ `NO_SPACE_WRITE`；对账 R1–R4 全绿（planned 4 → 3）。

## R-5 — PoC 实现根对账红（2 条，**范围性**，非代码缺陷）

登记时间：2026-11-04（G2 第 41 轮）。`node scripts/events-recon.mjs --impl-root experiments/v3-code-architecture-poc`
报：

```
FAIL [EVENT_RECON_STALE] 入账条目 integrity-audit-recorded 既无写点又非 planned:true
FAIL [EVENT_RECON_STALE] 入账条目 read-shadow-recorded 既无写点又非 planned:true
```

原因：锚文件 `writeSites` 指向的是**生产实现根**（`src/kernel/**`、`src/storage-sqlite/**`），
而 EA-7.1/7.2 的机制写点只在生产根落地（PR-2 范围内）；PoC 树（G1 实验产物）尚未同步这两条。
生产根对账 **exit 0**（R1–R4 全绿），CI 与门禁也只跑生产根。

**处置**：不把 PoC 树补成第二条生产实现面（那会让"两套实现"长期并存且都要过账）。
待 PR-2 评审时确认：PoC 树是否仍需与生产根保持事件面同步——若需要，作为独立工作项排期；
若不需要，则在契约里明确"对账的 impl-root 仅指生产根"，本项即关闭。**未闭合，等评审裁定。**

## R-6 — EA-7.2 的 K=32 聚合无读侧计数基底（**未落地**，2026-11-04）

契约 `EA-7.2` 要求：读侧遮蔽计数（`hiddenByContractSkew` / `hiddenByInactiveCapability`）
满足「首次非零」或「距上次落账后非零遮蔽读次数达 K=32」时落一条 `read-shadow-recorded`，
且计数**退出调用方 echo 面**（EA-7.4）。

现状：G2 生产 Kernel 里根本没有读侧遮蔽计数（`hiddenBy*` 只在旧宿主 `src/host/persistence`
的无关变量名出现）。`read-shadow-recorded` 的**写入口存在**（`recordMechanismAudit`，
九字段信封已就位），但"什么时候该落"的聚合逻辑与计数来源都不存在——读面遮蔽语义
（契约偏斜 / 能力停用导致的不可见）要到 PR-3（ReadContext / refuse-vs-withhold）才成形。

**处置**：不造一个假计数器来"点亮"这个事件名（那正是本仓反复拒绝的假绿）。PR-3 落地
读侧遮蔽后，把计数与 K=32 聚合接到 `recordMechanismAudit`。**未闭合，等 PR-3。**

## R-7 — 复算数据源仍有一处缺口（**版本化归属未建**，2026-11-04 修订）

第一轮登记的形态是「`replayAuthorityEvidence` 无生产调用点」；第二轮复审指出真正缺的是
**三个数据源**而不是一个调用点。现已补：

- 生产入口 `Kernel.replayLedger(seq)`（按 seq 复算一行，返回全形闸裁决 + 三态复算）；
- 生产数据源 `Kernel.gateSources()`：分类器（机制名单 ∪ 归属账）、机制轴表
  `MECHANISM_EVENT_AXIS`（13 条与锚逐条相等，有测试钉住）、冻结版本集（`g1/fa3b892` ∪
  各登记条目钉住的版本）。

**剩余缺口**：`ownerAt(eventType, contractVersion)` 只能回答**当前**登记版本——契约要求按行
自己钉住的 `contractVersion` 复算，历史版本归属表尚未建立。当前实现对旧版本行返回
`undefined`（判不一致），即"复算不出"而不是"猜成一致"。

**同族限制（第三轮复审补记）**：`gateSources().frozenVersions` 也由**当前**登记推导
（`g1/fa3b892` ∪ 在册条目钉住的版本）。即使 PR-6 补齐 `ownerAt` 历史表，旧版本行仍会先卡在
版本集上——PR-6 必须同时建"历史冻结版本集"，否则会看起来做完了而历史行仍不可复算。

**处置**：PR-6 建版本化归属账后补齐；在那之前不得声称"历史行复算已上线"。
另：锚文件没有 name→axis 字段，`MECHANISM_EVENT_AXIS` 是机制的自我陈述而非第二正源——
待锚补字段后它应降级为"与锚逐条相等的断言"（本文件已记该方向）。**未闭合，等 PR-6。**

## R-8 — 机制轴表的值无锚来源，且曾经与契约相反（**部分闭合**，2026-11-04 修订）

`MECHANISM_EVENT_AXIS` 是机制自我陈述：锚文件（EA-6.1）条目只有 `class/truthSource/
interpretationRuleSetVersion/writeSites/planned`，**没有** name→axis 字段，所以"轴值"只能由
机制自己声明，无法与锚对拍。

第三轮复审实测指出：本表曾把 `facet-mounted`/`facet-unlinked` 写成 `space-write`，而 G1 契约
FM-7 / I-2 与本仓单测都要求 `facet-mount` —— 那一刻轴表不是"缺来源"，而是**与契约相反**
（真行会被判红、伪造的 `space-write` 行反而通过，相对契约是 fail-open）。现已改为
`facet-mount`，并把 `facet-mount` 扩入 `MechanismResource` / `MECHANISM_RESOURCES`（FM-7 的要求）。

**仍缺**：轴值的锚来源。待锚补 name→axis 字段后，本表应降级为"与锚逐条相等的断言"
（`tests/kernel-event-authority.test.ts` 现有"键集合 ≡ 锚"断言，值仍需人工复核）。**部分闭合。**

## R-9 — `NamespaceWriter.write()` 恒拒 ⇒ D-24 合法 Facet 挂载面在生产不可达（**契约分歧**，2026-11-04）

EA-2.2 第二行要求 `write()` 的登记式台账行对三类事件名一律拒；实现按 deny-by-default 收死后，
**任何** `write()` 调用都抛 `EVENT_AUTHORITY_REQUIRED`。后果：CONTRACTS §16.1 D-24 明写的
"合法 Facet 挂载（oid 在目录、行落自己 ns）不受影响（Q45 / #44 §6.2）" 在 G2 生产代码里
**不可达**，D-24 ① 的幽灵 oid 判据也随之不可观测。

这不是偷偷删功能：本文件如实登记，且已补一条"恒拒 + 零残留"回归测试把这个死状态钉成
**有意为之**（`tests/kernel-event-authority.test.ts` 的 `write() 恒拒是有意的死状态`）。
**处置**：需要 `Frozen-Face-Review` 显式覆盖此分歧，或走冻结变更流程改 CONTRACTS §16.1
（明确 `write()` 退役、Facet 挂载改由专门的挂载原语承担，并在 FM-7 落地时提供 Q45 正例护栏）。
**未闭合，等人工裁定；不得声称"Facet 挂载可用"。**

## R-10 — `auditRequiredIntegrity` 无生产调用方，`trigger:'open'` 无生产路径（**接线缺**，2026-11-04）

`recordMechanismAudit` 的生产调用方是 `auditRequiredIntegrity`，但后者自身**零调用方**
（`grep -rn auditRequiredIntegrity src/` 只有定义）。因此"装配根打开时巡检一次并落账"这条
路径不存在，`trigger:'open'` 只是一个还没人用的枚举值。

**处置**：PR-5（装配根/打开路径）落地时把打开期巡检接上；在那之前 EA-7.1 只能声称"巡检被调用时
必落一条"，不能声称"每次打开都落"。**未闭合，等 PR-5。**

## R-11 — 全形闸不防裸面改写；`axis=capability-admin` 恒走 route-audit 支（**既定边界**，2026-11-04）

第三轮复审用 `new DatabaseSync(file)` 手抄九字段信封直插伪造行，`replayLedger` 判
`mechanism-op / VERIFIED`。这是 EA-4.6 明写的边界（"不证明宿主主体真实性，也不证明裸面未被
改写"），且经插件可达通道已无法做到——记录为边界，不是新增洞。

同时记录一个判据形状：任意机制名 + `axis='capability-admin'` + `authorized=1` 恒走 ②
（route-audit 支），与名字无关。契约把 ② 定为 ③ 的特例（既有设计），故伪造者若同时掌握
运维轴仍可过闸——**这不是闸的漏洞，而是"运维权威本身就是最高权威"的定义**。
**无需修复；作为评审记录保留。**
