# G2 实施入口（单一入口，仅现行有效规范，2026-11-01 建立）

> **性质**：G2 实施者的**唯一入口**。本文只列**现行有效**的规范与状态；一切「被取代旧文」
> 不进本文（旧文逐字保留在各自原文件就地标注，演化面以原文件为准，本文不重复、不转述）。
> 本文自身不是契约条文：判据冲突时以下文「权威序」上位文件为准，本文只负责指路。
> **状态（2026-11-01 收口后更新）**：G1-RECON-01 已闭（#47 全文对账完工，父席核验）；
> `g1-checklist-validate.mjs --require-clear` **exit 0**（A 层 20/20 done、B 层 7 全归属、违规 0，
> 父席实测）。甲类工务（PR-0/PR-1）可开工；
> 乙类（PR-2 起）的清单机验门已绿；2026-11-03 §0bis 三项已收口（P-NS/P-EXT/T-SEC，见 `g1/G2-CLOSEOUT-REPORT-20261103.md`），非作者冻结复核已出结论（复验无阻塞，原文归档 `g1/G1-FREEZE-REVIEW-20261103-SEAT.md`）；**仍待用户对 G1 冻结及 G2 乙类开工的明确批准**（开发批准）；科研采纳权另属业务权限（见 `g1/G1-TRUSTED-PROFILE-DELTA.md §4`）。

## 1. 权威序（冲突时上位压低位，就地标注是演化证据不是现行判据）

1. `g1/G1-UNIFIED-CONTRACTS.md` —— 统一规范句。其中 **§2.11（JC-1）** 是提交边界 × 唯一发号点
   的**唯一规范**；**§2.12（2.12.1–2.12.4）** 是 2026-11-01 冻结前收口的现行规范句
   （2.12.1 = ADJ X-7 转录；2.12.2–2.12.4 = 本轮父席技术裁决，明标「本轮父席新技术裁决」）。
   §7.4 J-1…J-6 登记字面冲突与裁决，**裁决句现行，冲突原文保留**。
2. 各专项契约（条文在盘，夹具即机验面）：
   - `g1/G1-CONTRACT-COMMIT-SEQUENCE.md`（CS，夹具 50 项）—— 事件序 `LedgerEventSequence`（排序键，
     可当游标内位置、**禁当截点**）× 提交序 `CommitSequence`（唯一快照边界）两轴语义；
     写回执只回事件轴（CS-2.5）。
   - `g1/G1-CONTRACT-DOMAIN-COMMAND.md`（DC，夹具 52 项）—— 写面权威形状（X-5 三条定死）。
   - `g1/G1-CONTRACT-EVENT-AUTHORITY.md`（EA，夹具 51 项）—— 机制事件封闭名单/全形信封/权威入口；
     EA:117 与 :341 的换轨注（旧类型名保留为登记原文）已落。
   - `g1/G1-CONTRACT-IDEMPOTENCY.md`（IDC，夹具 29 项）—— 幂等账，取值读 §2.11 JC-1 **步 6**（2026-11-03 P0 后步号：发号 3、落账 5、回执 6）。
   - `g1/G1-CONTRACT-RECONCILIATION.md` —— 对账 R 系列（R-1 审计出口 / R-5 批准面 / R-6 / R-7 纪律等）。
   - `g1/G1-CONTRACT-FACET.md`（FM，夹具 35 项）/ `g1/G1-CONTRACT-RELOCATION.md`（RL，夹具 60 项）/
     `g1/G1-CONTRACT-IDENTITY-GRAMMAR.md`（IG，夹具 38 项）。
   - `g1/G1-ADJUDICATION-TABLE.md` —— 裁定表；**D2-a…f 六行带 2026-11-01 CS 换轨修订注**，
     读 D2 一律读修订后形态。
3. `g1/G2-DEV-PLAN.md` —— 排期与 PR 卡（含 2026-11-01 就地标注：PR-0 甲类、PR-6b 判据依赖与
   首切片事务边界、§1 含 W11 完整读法）。**PR 卡内的旧括注（如「解除 NO-GO 后第一个 PR」）为
   登记原文，就地标注优先。**
4. `G1-RECONCILIATION-CHECKLIST.yaml` + `g1-checklist-validate.mjs` —— 机验对账面（27 项；
   A 层 20 / B 层 7；2026-11-01 收口后 A 层 20/20 done、B 层 7 open 全归属）。
5. `g1/G1-FREEZE-CRITERIA.md`（判据件）/ `g1/G1-ACCEPTANCE-MATRIX.md`（矩阵）/
   `g1/G1-REMAINING-USER-DECISIONS.md`（四项用户决策，其中**项 4 已收窄**为「批准签署人」）。

## 2. 授权边界（现行，一字为准）

- **甲类**（合同准备 / 夹具 / 门禁与判据工务，非 DDL、非生产机制代码）：**G1 未冻结期即可做**。
  在位条目：PR-0（门禁机械防线）、PR-1（事件名单锚文件 + 异源对账 R1–R4）、本收口工单类。
- **乙类**（PR-2 起所有改 `src/**` 生产判据 / `schema/**` / DDL）：**双门同时成立**才开工：
  ① `g1-checklist-validate.mjs --require-clear` exit 0（A 层口径）；② 用户对本 PR 的开工授权。
  当前：**① 清单机验已过**（`01db6f6` 记录 exit 0；不等于已冻结）；非作者冻结复核已完成（两轮：2 BLOCKER → 复验无阻塞）；§0bis 三项对账已完成并已按外部审查 P1 意见修正迁移形态（`preflight/ns/VERDICT.md` §0/§2）；**② 用户乙类开工授权未取得**。
- **唯一最新实施计划补充**：见 `g1/G2-DEV-PLAN.md §0bis（2026-11-03）`：P-NS（稳定 ns/重定位必要性）、P-EXT（Kernel 扩展缝）、T-SEC（可信部署范围）均属甲类；P-NS `PASS_STABLE_NS` 时 PR-8 DEFERRED，`RELOCATION_REQUIRED` 时走原 PR-8。PoC 不授权乙类，安全条款范围变化需按高位合同流程同步，不得以本入口覆盖上位契约。
- 禁止面（不变）：整体合并 #48/#49 不授权；正式 DDL / 存量数据迁移不做；
  8 根文档 + `schema/**` 冻结面不走流程不动；Q1–Q45 不重开；E2-VERDICT §8 ①④⑤⑥ 属 G2 后议题，
  不在本轮。

## 3. 现行有效关键规范点（一行一条，判据锚在上位文件）

| # | 规范点（现行形态） | 锚 |
| --- | --- | --- |
| 1 | 两轴：事件序 `LedgerEventSequence`（+1 登记序，排序键/游标内位置，**禁当截点**）× 提交序 `CommitSequence`（唯一快照边界，提交账 `commit_record` + `commit_recorded_at_ms` 一提交一枚墙钟） | CS-1.4/2.5/3.3；ADJ D2-a/b 修订注 |
| 2 | 外部墙钟 → 截点：`cutoff(t)=max{c∈committed∪{0}: M(c)≤t}`，M = 提交账墙钟；已解析截点固定（禁二次解析/回落当前时间） | CS-3.1/3.2/3.3；ADJ D2-b/c/d |
| 3 | JC-1 **八步**（2026-11-03 P0 修订）：开事务 → 幂等判定 → **发号（只推 `meta.commit_sequence`，不落账）** → 领域写与事件 → **落不可变 `commit_record`（区间取自真实事件）** → 落回执（c1 读自 `commit_record(c1)` 行、结果取自领域返回）→ 重放/拒绝 → 可解析；回滚同生同灭零 ghost。**禁止**「预留即插提交账」旧序（区间未知且提交账禁 UPDATE ⇒ 不可实现） | UNIFIED §2.11 + `preflight/tx/VERDICT.md` |
| 4 | 写面：协调方不持有通用写面；Capability-scoped Storage Port ≠ Domain Command Port；机验 = 跨归属写点 == 命令 Port 调用点静态集合等值 | X-5/DC-1…13；UNIFIED P4 |
| 5 | resolver 绑定：装配根声明 + 宿主供证；机制核形状不核内容；空视图 ≠ 完整视图，完备性凭证 fail-closed | UNIFIED §2.12.1（X-7 转录） |
| 6 | `eventsOf` 跨能力读正式形态：默认拒绝 + 装配根 `CROSS_EVENT_READ` 显式授权表（capability-admin 轴，枚举零扩张）；拒绝同形随 D1-c，泄露面随 D1-d | UNIFIED §2.12.2（父席 2026-11-01） |
| 7 | 计数差适用域 = 可见空间行 ∪ 授权对（可枚举）；计数差不外发（`hiddenBy*` 仅内部审计面） | UNIFIED §2.12.3 + D1-d（父席 2026-11-01） |
| 8 | 边四问定案：① 创建权 = 边拥有域的拥有者命令 Port（目标侧不发许可，禁跨域边一刀切）；② 源侧存在判据含拥有 ns；③ 引用合法（RF-05/06 只禁冒用），解析次序随 X-7；④ 保留前缀全集 `{RPT-,FM-,FR-,NSR-}` 封闭 + 扩员走冻结面变更流程 + 发号区间 namespace 化 | UNIFIED §2.12.4 + IG §2.3 ④（父席 2026-11-01） |
| 9 | 路由方向判据第四维：路由行 INSERT 同事务携 capability-admin 全形信封方向事件（`capability-enabled` 族，`changed_seq` 非 NULL）；bootstrap 另立界；墓碑行巡检只报不阻 | RL 子句③补句（F-G6A-3 修法，父席 2026-11-01） |
| 10 | 机制事件名单正源 = `contracts/event-registry/EVENT-CONTRACT-LEDGER.json`（正式仓内版本化、独立批准）；实验侧车永久非生产名单来源；入账唯一批准面 = EA-2.4 步骤 2 人工 `Approved-By` | 专题⑤ P2-③；EA-2.4/6.1/6.2；REMAINING 项 4 收窄注 |
| 11 | 首条纵向切片事务边界（2026-11-03 P1 修订，**两个保证**）：**A** 两个拥有者命令（`object-registered`→`object-revised`）在**同一 UoW** = 一个 `CommitSequence` c1，失败全回滚；**B** `check-report-recorded` 是**独立原子提交**（对已提交的精确 RevisionRef 另发 Check Request，外部检查不进写事务，Q40）；各事件各得 `LedgerEventSequence`；读回在事务外（只读面，禁按 `recorded_at` 重算截点）。不再读作「三事件同一事务」 | G2-DEV-PLAN PR-6b（A/B/可选 C 三保证） |
| 12 | 排期含 W11：`W1 → W2 → W3 → W4 → W5 → W6 → PR-6b → W7 → W8 → W9 → W10`，W11 自 W2 后并行、于 PR-6b 与 W10 退出门禁前收口（PR-6b ← W11 为**判据**依赖非代码导入依赖） | G2-DEV-PLAN §1 ★ 注（2026-11-01 回填） |
| 13 | GATE-01 指定：流程位 = 门禁基线管理位（GT-2/3/4 机械执行）；人占两位置（二人标记 + 冻结时非作者复验）；责任人 = 父席复验批准 + PR-0 席位实施 | G2-DEV-PLAN PR-0 卡就地标注（父席 2026-11-01） |
| 14 | 版本责任三分：报告/记录版本自持（形门）、解释器保留 = 领域 owner、机制 = 截点原字节 + 不再解释；`contract_version` 增列随 D-11 同批 | ADJ X-6 + D5-c |
| 15 | 首版分离：V3 侧车历史与 V1 事件面不合一不互推，接缝只经 `external_citations[]` 显式登记；事件面禁跨平面混名 | ADJ X-8 |

## 4. B 层实施义务（open 不阻塞冻结，但归属与退出门禁已在位）

| 条目 | 交付 PR | 责任者（判据面 + 实施载体） |
| --- | --- | --- |
| G1-BIND-03 | PR-6 | ADJ C5/D4-a 行 + G2-DEV-PLAN PR-6 |
| G1-READ-02 | PR-3 | ADJ C1/D1-c 行 + G2-DEV-PLAN PR-3 |
| G1-VER-03 | PR-5/PR-7（PR-8 DEFERRED 后由其承接；2026-11-03 改锚） | RL-8.4 回填禁令 + G2-DEV-PLAN PR-5/PR-7 |
| G1-STORAGE-01 | PR-5 | 第五轮裁定 D-23 行族 + G2-DEV-PLAN PR-5（TransactionLease） |
| G1-STORAGE-02 | PR-5（2026-11-03 去掉 PR-8：digest 外置与重定位无关） | 第五轮裁定 + G2-DEV-PLAN PR-5（digest 外置） |
| G1-AUDIT-01 | PR-2 | EA-7.1/7.2 + R-1 行 + G2-DEV-PLAN PR-2（两名批准 = 进入门禁） |
| G1-OWN-01 | PR-11（判据面 X-5 已 done 于 A 层） | Q12（既有 owner 不变） |

## 5. 门禁命令面（本地可复跑；「记录 PASS ≠ 独立复跑」，放行报告前父席全套复跑）

```sh
# 七夹具（期望全部 exit 0）
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs      # 51/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET.fixtures.mjs                # 35/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs           # 60/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-COMMIT-SEQUENCE.fixtures.mjs      # 50/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-IDEMPOTENCY.fixtures.mjs          # 29/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-DOMAIN-COMMAND.fixtures.mjs       # 52/0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-IDENTITY-GRAMMAR.fixtures.mjs     # 38/0
# 清单三命令
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs            # exit 0（当前实测绿）
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs --self-test # exit 0（31/31）
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs --require-clear # exit 0（2026-11-01 收口后父席实测）
# 仓级
node experiments/v3-code-architecture-poc/g0-gate.mjs   # 225 绿 + 33 已知红基线
pnpm run build && pnpm run check:freshness              # 冻结面漂移面
npx tsc -p experiments/v3-code-architecture-poc/tsconfig.json
pnpm run lint && pnpm run docs:check
```

## 6. 不在本入口内的（显式排除，防误读为现行）

- 一切「作废 / 旧文 / 登记原文」标注（在各自原文件，本文不收录）。
- E2-VERDICT §8 ①④⑤⑥（G2 后规划议题，本轮不碰）。
- 四项用户决策本体（`G1-REMAINING-USER-DECISIONS.md`；项 4 收窄后残余 = 批准签署人）。
- PR #48/#49 合并与 Current 生效（未授权）。
