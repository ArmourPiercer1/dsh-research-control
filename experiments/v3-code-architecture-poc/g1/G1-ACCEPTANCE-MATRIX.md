# G1 验收矩阵 —— 契约条款 ↔ 可核对锚点 ↔ 缺口 ↔ 责任层

> **性质**：G1 阶段 3 交付物 5。本矩阵把 G1 契约正文的**关键条款**逐条对到「谁能验、拿什么验、
> 现在验到哪、还差什么」，供 G2 实施批按行领取，也供冻结评审按行否证。
> **本矩阵不是放行文书**：G1 放行谓词 = `node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs
> --require-clear` exit 0 **+ 用户授权**（`G1-ADJUDICATION-TABLE.md:6-8`）。本矩阵不关闭任何清单条目。
> **输入**：`g1/G1-CONTRACT-EVENT-AUTHORITY.md`（EA，632 行）、`g1/G1-CONTRACT-FACET.md`（FM，481 行）、
> `g1/G1-CONTRACT-RELOCATION.md`（RL，814 行）三份契约正文 + `g1/G1-ADJUDICATION-TABLE.md`（裁决面）
> + 三份夹具 + `G0-R-CLOSURE.md` §5/§7 + `IMPLEMENTATION-PLAN-DRAFT.md` §2-G1/§15/§16 +
> `CONTRACTS.md` §16 + `docs/development.md`。
> **在途件**：`g1/G1-UNIFIED-CONTRACTS.md` 在本席位工作期间**已由另一席位落盘**（未跟踪状态，实测存在）。
> 按任务边界本席位**未读未改**该文件；因此本矩阵的条款编号一律取自三份已落盘的契约正文，
> 凡需与统一契约对编号的行，见 §4「统一契约条款编号回填」行——该行是当前**唯一未闭合的对账面**。
> **锚点纪律**：`文件:行号` = 工作树实测；行号会随正文追加漂移，**判据文字优先于行号**。
> **路径约定**：不带前缀的路径（`g1/…`、`tests/…`、`attacks/…`、`src/…`、`CONTRACTS.md`、
> `READINESS.md`、`G0-R-CLOSURE.md`、`IMPLEMENTATION-PLAN-DRAFT.md`）均相对**本侧车根**
> `experiments/v3-code-architecture-poc/`；`docs/development.md`、`AGENTS.md`、`schema/**`、`SNAPSHOT.md`、
> 8 份根文档相对**仓库根** `dsh-research-control/`。

---

## 0. 证据口径（本席位实测，先于任何一行矩阵）

工作树 = 分支 `g1/contracts-20261031`，HEAD = `777ae92`；工作树含另一席位对
`g1/G1-CONTRACT-FACET.fixtures.mjs` 的未提交改动（5 行）——**本席位未改任何被测文件**，
下表退出码即该工作树状态的实测结果。

| 命令 | 期望 | **本席位实测 exit** | 输出要点 |
| --- | --- | --- | --- |
| `node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | 0 | **0** | 35 PASS / 0 FAIL（S1–S14 + T-P1..P7 + T-N1..N10 + MUT-1..3 + R3 合规对账器） |
| `node …/g1/G1-CONTRACT-FACET.fixtures.mjs` | 0 | **0** | 29 PASS / 0 FAIL（S1–S11 + T-P1..P7 + T-N1..N8 + MUT-1..3 判别力） |
| `node …/g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | 0 | **0** | 42 PASS / 0 FAIL（S1–S11 + T-P1..P9 + T-N1..N16 + MUT-1..5） |
| `node …/g0-gate.mjs` | 0 | **0** | 「PASS —— 三条流均符合预期（审查方红条是"已定性的已知项"，不代表产品通过）」（脚本自带措辞） |
| `node …/g1-checklist-validate.mjs` | 0 | **0** | `items=27 open=23 assigned=0 done=4 superseded=0 unassigned=22 superseded_unreviewed=0 违规=0` |
| `node …/g1-checklist-validate.mjs --self-test` | 0 | **0** | 「变异自验：17/17 全部捕获」 |
| `node …/g1-checklist-validate.mjs --require-clear` | **1（预期红）** | **1** | `open=23、assigned=0、unassigned=22、违规=0` ⇒ 放行谓词未满足 |
| `node …/g1-checklist-validate.mjs --max-open 23` / `--max-open 22` | 0 / 1 | **0 / 1** | 进度护栏可用（`open=23 > 允许上限 22`） |

**夹具性质的一句话诚实**（贯穿全矩阵，不逐行重复）：三份夹具是**零依赖判据模型**——它们验的是
「契约文本 ↔ 名单 ↔ 判据模型」的三方逐等、正反例的可执行形状、以及**架空判据的判别方向**
（真实判据必须拦住负例、架空判据必须放过同一负例）。它们**不**跑 SQLite、不跑 `src/**`。
因此凡条款落在真实库 / 真实触发器 / 真实宿主进程上，本矩阵的「现有证据」列只能给到夹具模型行，
「缺口」列写明真实面待 G2 —— 这是**如实登记**，不是判据不足。

---

## 1. EA 契约（事件命名空间 / 唯一所有权 / 授权签发）

标签：【机】= 可机验（当场有命令与退出码）；【复】= 需独立复核（夹具已验判据方向，真实面待实施批
或独立席位复验）；【批】= 需最终人工批准（机器只能验形态，语义权威在人）。

| 条款 | 可机验？ | 现有证据（文件+锚点+实测退出码） | 缺口（落码前无法验的） | 责任层 |
| --- | --- | --- | --- | --- |
| EA-1.2.1 运行时分类器是唯一判据点，三类封闭划分（`:88-137`） | 【机】夹具 `G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` S1 | S1「机制封闭名单三方逐等（契约 §2.4 名单块 ↔ 夹具模型，成员逐一含顺序）」PASS，夹具 exit 0 | `classifyEventType` 在 `src/kernel/**` 的真实实现与「拒绝面只许消费它的输出」的构造性禁 —— 夹具只比名单文本 | G2 代码 |
| EA-1.2.2 封闭性公理：`unregistered` 在一切通用通道拒写（deny-by-default 翻转 C-23） | 【机】夹具 S2 + T-N3/T-N4 | S2「planned 条目不入运行时名单（`ns-relocated` 仍被分类为 unregistered）」；T-N3 名单外名 ⇒ `classification='unregistered'`；T-N4 名单内名 mint ⇒ `classification='mechanism'`，exit 0 | 真实 `appendLedger`/`NamespaceWriter.write()` 两条通道的运行时拒写；夹具判据模型不是那两条通道 | G2 代码 |
| EA-1.3 Raw Intake「正式事件拒写 ≠ 原始材料拒收」四条边界（`:138-155`） | 【机】夹具 T-P3/T-N8 + S13 | T-P3「未识别 `declaredType` 收 + 台账行名 = `raw-record-declared` + 绝不出现 `EVENT_AUTHORITY_REQUIRED`」；T-N8「把预留闸接到 Raw 通道 = 契约违例」，exit 0 | 真实 `declareRawIntake` 落库后「原文逐字节留存」的字节级断言（夹具只在模型内比） | G2 代码 |
| EA-1.3a `declaredType` 形状上限 + 畸变仍收 + 三不参与（`:112-137`） | 【机】夹具 T-P3 + S11/S13 | S11「`declaredType` 形状正则：契约两处引用与夹具实现逐字同步」；T-P3 含超限样本落 `declaredType:null ∧ note=PARSE_FAILED` 与「classify 调用计数 = 0」，exit 0 | 「构建期扫描断言 intake 通路中索引列/路由参数/授权入参三类调用点对 `declaredType` 零引用」= 扫描器尚不存在 | G2 代码 |
| EA-2.2 通道 × 类别矩阵是唯一合法写面（`:164-179`） | 【机】夹具 T-P1/T-N3/T-N4/T-N7 | 夹具通道矩阵与契约表逐格对拍；T-P1 合法签发放行、T-N3/T-N4 通用通道拒，exit 0 | 原经 `appendLedger` 落协调台账行的用例层路径迁移（`D-19c-ALLOWED` 签字清单重排）未做 | G2 代码 |
| EA-2.3 拒绝码不新增，detail 合同只回显调用方输入与机制本地事实（`:179-196`） | 【机】夹具 S5 | S5「契约内出现的全大写码全部落在封闭拒绝码集 ∪ 声明的构建期/存储层信号（无自造运行时码）」PASS | 「不含任何他空间存在性判定」的跨空间同形负例（与 E-01/G1-READ-02 同题）夹具不建世界 | G2 代码 + G3 领域正反例 |
| EA-2.4 新增机制名六步流程（提案→**用户批准**→锚文件独立提交→异源对账→护栏同批→重锚）（`:197-229`） | 【批】流程义务；【机】夹具 S1/S10 验名单与常驻 | S1 名单三方逐等；夹具 S10「本夹具自身保留三条架空判据（变异常驻不删除）」，exit 0 | 步骤 2 的 `Approved-By: <日期> <非作者>` 是**人的签字**；`g1/EVENT-CONTRACT-LEDGER.json` 锚文件本席位实测**不存在** ⇒ 六步的第 3 步目前无落点 | G1 文档（已裁）+ G2 代码（物化锚文件）+ 人工批准 |
| EA-2.4 机制封闭名单首批 10 名 + `ns-relocated` 保持 `planned:true, gated_by:'G1-NS-01'`（`:216-229`） | 【机】夹具 S1/S2 | S1 逐名逐序等；S2 `planned` 条目不入运行时名单，exit 0 | 锚文件本体未物化 ⇒ 「三方逐等」目前是 契约 ↔ 夹具 两方，第三方位占位 | G2 代码 |
| EA-3.1 `EventOwnershipEntry` 形状（唯一 owner / `truthSource` / 版本钉 / approval / retired 只标不删）（`:241-264`） | 【机】夹具 S7 | S7「EA-4.3 入参字段集与夹具模型逐字对账」；归属账示例 `facet:calibration-observed` 在账（FM 夹具 S2 交叉核） | 真实注册表持久形态与「运行期无注册写面」的运行时保证 | G2 代码 |
| EA-3.2 注册判据五序（双认领/认领机制名/缺轴/轴属机制/未激活 ⇒ 装配红）（`:264-273`） | 【机】夹具 T-N6/T-N7 | T-N6「`assemble` 抛 `AMBIGUOUS_AUTHORITY` ∧ `registry.entries()` 零增量」；T-N7 认领机制名同红且名单逐字未变，exit 0 | 真实装配根的判据序实现与「零装配副作用」（夹具只断言模型零增量） | G2 代码 |
| EA-3.3 OA-1..OA-4 双重权威禁止（`:273-281`） | 【机】夹具 T-N6/T-N7 + 夹具 S6 | 正反例表与夹具双向一致（无孤儿实现）PASS | OA-3「每 eventType 恰一真源」在真实 `truthSource='ledger-referenced-store'` 分支需解析器注册的可验性未落码 | G2 代码 |
| EA-4.2 `AuthorizationContext` 九字段信封，机制独占生成（`:308-322`） | 【机】夹具 S2/S7 + FM 夹具 S2 交叉 | FM 夹具 S2「`AuthorizationContext` 九字段与 EA 夹具逐字逐序等」，两夹具各 exit 0 | 真实 `ledger.authority_basis` JSON 列写入的字段完整性（夹具不碰库） | G2 代码 |
| EA-4.3 Port 入参字段集封闭 ⇒「不得自带见证」是结构性质（`:322-335`） | 【机】夹具 S7 + T-N2 | T-N2「入参附加 `actor/authority_basis/ruleSetVersion`（值还全对）⇒ 结构拒，`reason='input-carries-witness-field'` ∧ ledger 零行」，exit 0 | 运行时守卫（JS/`as unknown as` 面）+ 构建期 Port 形状检查「双向钉」目前只有夹具侧一半 | G2 代码 |
| EA-4.4 信封落账增 `actor` 字段但**不动 DDL 不推 `SCHEMA_VERSION`**（`:335-342`） | 【复】 | 条款在文；`CONTRACTS.md:387`（§16.2）既有列形状；夹具按 JSON 列建模 | 「加字段不推版本」在真实库打开判据/触发器摘要上是否真的零影响，需 G2 真库复验（N6/N7 冻结面原型教训同族） | G2 代码 + 独立复验 |
| EA-4.5 `gateFullShape` 全形闸（actor 非空 ∧ 九字段齐 ∧ actor 同源 ∧ 轴谓词 ∧ `authorized=1` ∧ owner 复算）（`:342-358`） | 【机】夹具 T-N5 + MUT-1 | MUT-1「架空『actor 非空即过』被 T-N5 判据区分（真判据拦得住、架空的拦不住）」，exit 0 | 真实 `route_change_guarded` 触发器体现在只核三件（P-04 现状），改造后触发器体在 SQLite 中的实际拒绝形态待 G2 触发器改造批 | G2 代码 |
| EA-4.6 `replayAuthorityEvidence` 三态（VERIFIED / INCONSISTENT / UNVERIFIABLE_LEGACY），禁按当前权限回算（`:358-372`） | 【机】夹具 T-P1/T-N5 形态 | 夹具复算面三态可达；T-N5 全形拒 + 复算 `INCONSISTENT` 双钉，exit 0 | 「复算不证明宿主主体真实性」——`CONTRACTS.md §10` 未证明面仍在，属 G2 最小装配冒烟 / G4 | G2 代码 + G4 |
| EA-5.1a 预留三面合一（只约束新写 ∧ 历史解释逐字不变 ∧ 禁重写 Ledger）（`:374-390`） | 【机】夹具 S8/S12 + T-P6 | S12「EA-5.1a 合一判据 + 『不允许为统一命名重写既有 History Ledger』+ 两旧名各有解释器版本行」；T-P6 历史行解释切换前后逐字段等，exit 0 | 真实库的 `ledger_no_update/no_delete` 触发器覆盖 `event_type/actor/authority_basis` 的**实测**（现状有触发器，但「任何 UPDATE 路径不存在」需真库负例） | G2 代码 |
| EA-5.2 两旧名就地升格、不做别名映射、解释器按名入表（`:390-399`） | 【机】夹具 S8/S12 | S8「历史节覆盖两个存量名 + 『不重写 Ledger』机验句在位」，exit 0 | `interpretationRuleSetVersion` 缺项 ⇒ 装配红的真实装配期实现 | G2 代码 |
| EA-5.3 `ledger` 无 `contract_version` 列；新行必填盖戳、**存量无戳行不回填**、无戳按缺省档读并如实报告（`:399-408`） | 【复】 | 缺口事实锚：`READINESS.md` D-11 行；与清单 `G1-VER-01`（status: open，实测）同批 | 列推进 + 版本墙交互 = 真实 DDL；「读者必须能报告此版本来自缺省档」无实现 | G2 代码（DDL）+ G1-VER-01 条目责任者 |
| EA-6.1 锚文件为唯一正源 + 批准三要素（目录/批准者≠实现者/两处标记同现）（`:418-446`） | 【批】+【机】S3/S4 | S3「每条引用行齐四要素」；S4「三份外部契约各有实取引用（#44/#42/#47）」，exit 0 | 锚文件 `g1/EVENT-CONTRACT-LEDGER.json` **实测不存在**；「批准者是否真读了 diff」契约自陈为**人认边界** | G2 代码（物化）+ 人工批准 |
| EA-6.2 R1 孤儿（写点写名单外名）/ R2 名单膨胀 / **R3 同源即红** / **R4 名单与写码同提交耦合** 四条构建判据（`:446-468`） | 【机】夹具 S10 + MUT-3 + T-N9/T-N10 + 「R3 合规对账器」行 | MUT-3「架空『同源自证对账』被 T-N9 判据区分（异源点名、同源失明）」；末行「R3 合规对账器拒绝同源取期望集（`expectSource` 不合规 = 构建期信号）」exit 0 | **对账脚本本身未写**（G2 交付物）；R4 的 CI 判据形态（`git show --name-only` 文件集合命中）在无 CI 下只能本地跑（见 §6） | G2 代码 |
| EA-7.1/7.2 两名机制审计事件命名批准 + 载荷形状 + 阈值 **K=32 为契约常量**（运维不可私调）（`:475-505`） | 【机】夹具 S5 + S14 | S14 覆盖 EA-7.4 与批准三要素；S5 码封闭性，exit 0 | 真实落账（首现非零遮蔽 / 累计达 K）的触发时机与「不阻塞任何读写」的运行时证明 | G2 代码 |
| EA-7.3 「同一个 6」可分：同数不同集 ⇒ `targetsDigest` 不同（`:505-515`） | 【机】夹具 T-P5 | T-P5「两次运行同为 6 条幽灵但目标集不同 ⇒ 两条行且 digest 不同 ∧ counts 相同」，exit 0 | digest 非加密承诺、小集合可被运维面枚举 = 契约自陈边界（与运维信息面同界），不再验 | 已裁（G1 文档），残余如实登记 |
| EA-7.4 非 oracle 三条（通道封闭 / 响应面零差分 / 暴露唯一通道）（`:515-536`） | 【机】夹具 T-P7 | T-P7「落账前后普通调用者响应形状与取值逐字节等 ∧ 内部审计行数 +2 ∧ 普通响应无 `audit/shadow/digest` 键」，exit 0 | 真实插件可见成员名集零增删需 `arch-independence.test.ts` 运行时面对拍在 G2 重跑 | G2 代码 |
| EA-2.5 裸面诚实边界（预留使插件可达 mint 归零；裸面伪造痕迹不可删、处置归运维/审计）（`:230-239`） | 【复】 | 与 RL 夹具 T-N7/T-N16 同族（「检测 ≠ 防御」）；P-04 现状锚 | 不承诺检出 = 设计边界，不列为缺口，但**文档不得日后把它写成防御** | 已裁（G1 文档） |
| EA-9.2-⑤ 跨进程陈旧：名单编译期固化、归属账重启重载；deny-by-default 的方向性红利（`:584-588`） | 【复】 | 与 `CONTRACTS.md` D-25 家族同界；真多进程证据 `tests/multiprocess-contention.test.ts` 在册 | 陈旧窗口实测（新名/旧进程）+ 是否补主动失效 = G1 余项（未决项，非用户决策） | G2 代码 |
| EA-9.4 **U-1**：机制名单锚文件与归属账在**正式仓**的承载面（8 根文档冻结面 / `schema/**` / #44 侧文档层）（`:603-616`） | 【批】 | 契约只登记「需用户指名裁定人 + 交付物名」；本侧车 `g1/EVENT-CONTRACT-LEDGER.json` + 本文为 G2 前工作正源 | 承载面未定 ⇒ 冻结面归属、`snapshot:update` 是否适用、`Frozen-Face-Review` 是否触发 **全部悬空** | 用户决策（见《G1-REMAINING-USER-DECISIONS.md》项 4） |
| EA 契约自身变更纪律（§2.4 名单块 / §8 表 / EA-4.2 字段集 / EA-7.2 阈值 K 任一变动 = 冻结面变更，夹具必红或三方逐等后绿 + 人工批准标记）（`:615-616`） | 【批】 | 夹具常驻（S10）+ 本矩阵 §0 三夹具 exit 0 | 标记形态（`Frozen-Face-Review:` / `Event-Name-Review:`）在无 CI 下靠人核对（§6） | 人工批准 |

---

## 2. FM 契约（Facet 双身份与挂载）

| 条款 | 可机验？ | 现有证据（文件+锚点+实测退出码） | 缺口（落码前无法验的） | 责任层 |
| --- | --- | --- | --- | --- |
| FM-1.1 两套身份共同冻结：挂载登记不得把目标对象 ID 充当 Facet 自身版本身份（`:72-90`） | 【机】夹具 S8 + T-P1 | S8「双身份正文在位：『两套身份』+『挂载登记不得把目标对象 ID 充当 Facet 自身版本身份』+ `FacetRecordID` + 核心不可覆盖」；T-P1「跨 Capability 合法挂载 + 双身份 + 快照 + 核心再修订不改写解释」，exit 0 | 真实发号器（`FR-<seq>` 走机制计数器）与 append 序列未落码 | G2 代码 |
| FM-1.2 标识不得冒充：`FM-`/`FR-` 声明 ⇒ `RECORD_ID_RESERVED`；`FR` 进正式端点槽位 ⇒ 领域契约拒（`:90-100`） | 【机】夹具 T-N2 | T-N2「自带 id / 保留前缀 / FR 进正式槽 各拒」，exit 0 | 「机制读面回执不产出『FR 可当对象引用』的形状」= 形状级面锚，需 G2 面锚对拍 | G2 代码 |
| FM-2.1 登记形状（`binding` 两态 / `gen` 链 / 机制写快照 / `witnessSeq`）（`:108-125`） | 【机】夹具 S1/S2/T-P3 | T-P3「PINNED 精确绑定 / 浮动与错绑各拒 / 正式槽位形状」，exit 0 | 物理表 `facet_mount` 布局、PK、索引 = G2 DDL（A2 方向） | G2 代码 |
| FM-2.2 入口判据序①→⑥，**取证先于对象解析**，缺轴即拒且**零幽灵审计行**（`:125-145`） | 【机】夹具 T-N6 + T-P6 | T-N6「缺 facet-mount 轴 = `AUTHORITY_REQUIRED` 且**零幽灵审计行**」；T-P6「未入账装配红 fail-closed 零残留」，exit 0 | 真实事务内的「先审计行后挂载行」原子性（触发器 `facet_mount_insert_guarded`）= 真库验收 | G2 代码 |
| FM-2.3 建立时修订快照 = 快照事实，非跟随承诺；核心再修订不改写历史解释（`:145-156`） | 【机】夹具 T-P1 | T-P1「此后核心再修订，挂载快照与既有扩展记录解释不变」，exit 0 | 「机制不对 mount 提供解析到最新的授权性服务」= 读面负空间，需 G2 面锚 | G2 代码 |
| FM-2.4 挂载不授予读权限；**不提供**「目标的挂载方列表」；默认不上插件读面（`:156-164`） | 【机】夹具 T-P5 | T-P5「挂载对属主读面零差分（非 oracle）+ own 面只见自己」，exit 0 | 真实插件可见成员名集零增删（`arch-independence.test.ts` 面锚重跑） | G2 代码 |
| FM-2.5 账本守卫三信号（`MOUNT_ROW_FROZEN`/`MOUNT_AUDIT_REQUIRED` 为存储层信号文本，不入封闭码集）（`:164-175`） | 【机】夹具 S4 + S11 | S11「存储层信号文本登记在位（不是 `RefusalCode` 封闭集成员）且 EA 夹具 `REFUSE_UNMOUNTED` 引用形状承接」，exit 0 | 真实触发器体 + 打开期判据（表在位/触发器在位/链终态合法/目标 ∈ 目录/见证可解析）+ `SCHEMA_VERSION` 推进 = 真库 | G2 代码 |
| FM-3.1 唯一判据点 `hasActiveMount`；对外 `CAPABILITY_SCOPE_ESCAPE`、内部信号 `REFUSE_UNMOUNTED`（`:177-205`） | 【机】夹具 T-N1 + MUT-1 | MUT-1 判别力「真实挂载判据拦下无挂载伪造行；架空行形态判据（= D-24 现状）放过同一负例」，exit 0 | 现行 `NamespaceWriter.write()` 的他人-oid 形态仍在「已登记边界」内（F-16）；收敛批未落 | G2 代码 |
| FM-3.1(a) detail 封闭键集 `{oid, capability}` + 唯一塑形函数 + 信号词零对外（`:188-197`） | 【机】夹具 T-N8 | T-N8「未挂载 vs 越权：同一响应面逐字节等 + 信号词零对外」，exit 0 | 「唯一塑形函数」的构造面单一性在真实代码里可被复制 —— 需 G2 一条静态门（禁复制逻辑） | G2 代码 |
| FM-3.1(b) 内部审计保留真因 `{UNMOUNTED,NO_RIGHT,OWNER_OK,MOUNT_ACTIVE}`，插件面零入口（`:190-196`） | 【机】夹具 T-P7 | T-P7「内部审计真因可区分（UNMOUNTED/NO_RIGHT/MOUNT_ACTIVE）插件零入口」，exit 0 | 复算面（挂载账 ⋈ 目录 ⋈ 路由激活态）真实查询实现 | G2 代码 |
| FM-3.1(c) 复用声明：不改 `CAPABILITY_SCOPE_ESCAPE` 原有越权语义（防反向引用）（`:196-205`） | 【机】夹具 S9 | S9「『复用不改变该码原有越权语义』原句在位」，exit 0 | 无（文本条款） | 已裁（G1 文档） |
| FM-3.2 **Q45 正例永不判红**；冲突时改契约不改护栏；钉 `g1a-regression.test.ts` 该条 | 【复】+【批】 | FM 夹具 S6 三重对拍：「护栏测试名在契约逐字在位 + 『任何条款都不得使该正例判红』声明在位 + 测试源与 BASELINE passes 实含该条」；`attacks/BASELINE.json` `passes` 实含「D-24 正例护栏：Facet 把扩展记录挂载到他人拥有的核心对象（Q45 合法形态）必须继续成功」（本席位读 `passes` 实测 100 条含该行） | 实施批义务：在该测试世界 `FacetStore` 式 helper 前补 `declareMount`，**三条断言一字不改** —— 未做即「未实现」；基线逐等由 `g0-gate` 持续执行（但 GT-2/GT-3 未闭合，见 §6） | G2 代码 + 独立复验 |
| FM-4 卸载实现 / 解除挂载 / 所有权移交**三操作分立**，不得互为替代（`:248-264`） | 【机】夹具 T-P4 + MUT-2 | T-P4「三操作各走各路（卸载≠撤销≠解除≠移交）+ 移交不动挂载行」；MUT-2「架空『卸载即撤销』使恢复后写入被拒（T-P4 会红）」，exit 0 | 真实 `setRouteEnabled`/`transferRoute` 与挂载账的隔离实现 | G2 代码 |
| FM-5.1 核心修订不可被 Facet 覆盖 = **类型面无写点** + 运行时守卫双向（`:266-277`） | 【机】夹具 T-N4 | T-N4「核心改写位结构拒 + facet 面核心改写方法枚举空集」，exit 0 | 真实类型面 + 运行时守卫的 JS 面（D-17/N3 教训：类型面不是墙） | G2 代码 |
| FM-5.2 核心读面不并入扩展行；**任何未来读面加速/物化**不得合并（`:277-284`） | 【机】夹具 T-N7 | T-N7「第二真源三面：机制零误炸 + 不入核心快照 + 不认领核心边 + 报告可落」，exit 0 | 物化/缓存形态的反例（D-2f 无水位物化）夹具不建；G2 读面批配 | G2 代码 |
| FM-5.3 第二真源禁令 + 判据归属：领域出判据、机制执行三面、不自判真值；`NAMESPACE_ESCAPE` 不得互替（`:284-298`） | 【机】夹具 T-N7 | 同上（三面各一断言），exit 0 | XC-28 型重复检测作为领域校验规则 = G3 领域正反例（`tests/xc28-detectability.test.ts` 现状是「可检测性」限定形态） | G3 领域正反例 |
| FM-5.4 缺席只降级：不消失、不改写、缓存非权威（`:298-303`） | 【复】 | 条款在文（F-05 承接）；夹具 T-N7 覆盖「零误炸」侧面 | 「降级」的产品形态属 G3/G4 呈现面 | G2 代码 + G4 |
| FM-6 Port 签名（`declareMount`/`unlinkMount`/`mountState`/`listOwnMounts`/`writeFacetRecord`；移交无新 Port）（`:303-345`） | 【机】夹具 S2/S5 + T-P1..P7 | 夹具实现与契约签名逐字对拍（正反例双向一致，S5 等数 = 15），exit 0 | 真实 `PluginFace` 扩一具名成员 ⇒ 面锚/词表门（Kernel 只增三词）需 G2 重跑 | G2 代码 |
| FM-7 错误码与轴值：九码**零扩张** + `MECHANISM_RESOURCES` 增 `'facet-mount'`（`:345-372`） | 【机】夹具 S4 | S4「契约内出现的全大写码全部落在封闭拒绝码集 ∪ 声明的存储层信号文本（封闭集零扩张，FM-7）」，exit 0 | `MECHANISM_RESOURCES` 从二值扩为三值的真实代码改动（判据④同型拒） | G2 代码 |
| FM-8 权限矩阵（八行动作 × 通道 × 前置序 × 见证 × 对外拒绝形状；「目标侧挂载列表」**不存在此读面**）（`:372-385`） | 【机】夹具 T-P5/T-P7/T-N6/T-N8 | 各动作对应夹具行 PASS，exit 0 | 面锚对拍「成员名集零增删」在真实包内重跑 | G2 代码 |
| FM-9 事件复用不另造；两名 `facet-mounted`/`facet-unlinked` 保持 planned；**未入账期间装配红 fail-closed**（`:385-415`） | 【机】夹具 S1 + T-N5 | S1「planned 名单三方逐等 … `gated_by=G1-FACET-01` 在位」；T-N5「planned 名通用通道 mint 两阶段必拒 + 裸插触发面拒」，exit 0 | 入账走 EA-2.4 六步 ⇒ 依赖锚文件 + 用户 `Approved-By`（同 EA-2.4 行） | G2 代码 + 人工批准 |
| FM-10/MUT-3 见证脱钩（审计后置异步补）必产孤儿；原子形态对账干净（`:440-441`） | 【机】夹具 MUT-3 | MUT-3「见证脱钩产出无见证挂载链被点名；同事务原子形态对账干净」，exit 0 | 崩溃窗口的真实注入（进程 kill 于两步之间）= G2 故障注入 | G2 代码 |
| FM-11.1 A.6 六问逐条清偿（含挂载账与 ns 重定位的联动 = RL 清单接口）（`:445-456`） | 【机】夹具 S6/S7/S8/S9 分面 | 各问对应夹具行 PASS，exit 0 | 无（文本清偿完成） | 已裁（G1 文档） |
| FM-11.4 本契约变更纪律（形状/判据/表/码表/planned 块任一变动 = 冻结面变更；Q45 护栏方向**永不重开**）（`:477-481`） | 【批】 | 夹具常驻 + 本矩阵 §0 实测 | 人工标记落 PR body（无 CI ⇒ 靠人，见 §6） | 人工批准 |

---

## 3. RL 契约（物理命名空间重定位）

| 条款 | 可机验？ | 现有证据（文件+锚点+实测退出码） | 缺口（落码前无法验的） | 责任层 |
| --- | --- | --- | --- | --- |
| RL-1.1 层界句：不可迁移的是逻辑身份，可迁移的是物理 ns（物理 ns **不是**科研身份）（`:87-96`） | 【机】夹具 S8 | S8「冻结关键句在位（自立/C6 撤销/不产生新科研事实/backfill 默认禁止/隔离并明确报告/回退不删历史）」，exit 0 | 无（文本判据） | 已裁（G1 文档） |
| RL-1.2 重定位对 `object_directory` **零行写入**（既不 UPDATE 亦不 INSERT）；写即契约违例（`:96-109`） | 【机】夹具 T-P6 | T-P6「`object_directory`/`records`/`journal` 差集空」，exit 0；现状触发器锚 P-02 + `tests/d28-directory-identity.test.ts` | 真实库上「重定位通道写 directory」的负例注入（夹具模型不建触发器） | G2 代码 |
| RL-1.3 重定位五要素缺一不可（搬数据 + 改位置键 + 审计见证 + 原子切换 + 历史可读）；**「只改 `route.ns`」明文禁止**（`:109-128`） | 【机】夹具 S7 | S7「五要素（RL-1.3）+ B.7 五项映射逐条在位，『只改 route.ns 被明文禁止』句在位」，exit 0 | 五要素的原子实现 = 一条 SQLite 事务，G2 真库 | G2 代码 |
| RL-2.1 `namespace_relocation` append-only 账形状 + **信任方向**（工作流账不是读判据的链源）（`:137-168`） | 【机】夹具 S5/S6 + 状态机行 | 账步链与故障矩阵双向逐等（S5 夹具 18 条 ↔ 正文表行），exit 0 | `RELOCATION_LEDGER_FROZEN` 触发器（UPDATE/DELETE 拒）真库 | G2 代码 |
| RL-2.2 `ns-relocated` 事件载荷（本合同 = B 侧自裁文书，翻转 EA 锚文件 `planned` 位）（`:168-201`） | 【机】夹具 S11 | S11「`ns-relocated` 锚文本沿用事件契约 planned/gated_by」，exit 0 | 翻转 `planned:false` 需 EA-2.4 六步 + 用户批准；锚文件未物化 | G2 代码 + 人工批准 |
| RL-2.3 `meta.ns_epoch` 新计数键（受 `meta_counter_monotonic` 保护）（`:201-208`） | 【机】夹具 S8 侧面 | 现状锚 `tests/d29-meta-counters.test.ts`「只增不减，归零两式与删除形均拒」在册 | 新键的真实注册 + 打开期水位判据交互 | G2 代码 |
| RL-3 Port 全在**机制运维面**；插件可见面（face/tx/writer）**零增删**（`:208-259`） | 【复】 | 条款在文；现状对拍先例 `tests/arch-independence.test.ts`（运行时面锚） | 加七个成员后的面锚对拍 = G2 重跑；「运维授权」在真实宿主侧的授予未证明 | G2 代码 + 独立复验 |
| RL-3.3 批准判据（批准人持 `capability-admin` ∧ 批准人 ≠ 提案人 ∧ 绑 `proposalDigest` ∧ 修复另需 `operationGrant`）（`:259-266`） | 【机】夹具 T-N2/T-N3 | T-N2「未批准 / 批准人=提案人 即执行 ⇒ `RELOCATION_PRECONDITION(failedGate='APPROVAL')` 零写」；T-N3 无轴零账步，exit 0 | 真实主体注入（宿主 principal 真实性仍属 `CONTRACTS.md §10` 未证明面） | G2 代码 |
| RL-3.4 覆盖范围封闭单值 `'ALL'`（禁止分批 ⇒ 无半旧半新窗口）（`:266-274`） | 【复】夹具无『分批』专属用例；S7 只覆盖『只改 route.ns 被明文禁止』句在位 | S7「五要素（RL-1.3）+ B.7 五项映射逐条在位」+ S6「门清单封闭集三方逐等」，exit 0；**『半旧半新窗口』本身无夹具** | 与 FM 挂载/扩展表并入同一事务 = `RELOCATABLE_NS_KEYS` 联动，两契约同批落地才成立 | G2 代码（跨 FM/RL 同批） |
| RL-4 十条门封闭清单（AUTHORITY…EPOCH_STABLE），`detail.failedGate` 取值即清单名，**不得旁加**（`:282-316`） | 【机】夹具 S6 | S6「门清单封闭集三方逐等（契约正文逐名在位 ↔ 模型 GATES；不多不少）」，exit 0 | 每条门的真库实现（尤其 7 `CONTENT_DIGEST` 的 sha256 度量、9 `CHAIN_INTACT` 的链遍历） | G2 代码 |
| RL-4.1/4.2 precheck **全程零写**；任一 gate 失败 ⇒ `RELOCATION_PRECONDITION` + 账记 REJECTED + 路由/数据/事件零动（`:309-313`） | 【机】夹具 T-N4/T-N5/T-N10/T-N12/T-N14 | 五条负例各点名 `failedGate` 且断言零切换，exit 0 | 「禁跳行继续」的真实实现（游标式搬迁易犯） | G2 代码 |
| RL-4.3 TOCTOU 事务内复核 gate 1/2/5/7/10，失配 ⇒ 回滚且**序号不留 ghost**（`:313-315`） | 【机】夹具 T-N15 | T-N15「precheck 后并发路由变更再 execute ⇒ 回滚零残留（含 ghost 序号零留）；重试成功」，exit 0 | 真实并发（多进程写同一库）与 WAL 交互 = G2 故障注入（`tests/multiprocess-contention.test.ts` 家族） | G2 代码 |
| RL-5.1 唯一合法切换事务写序（复核→重算 digest→重映射→落审计→改路由→推 epoch→commit）；**无可观察中间态**（`:318-337`） | 【机】夹具 T-P1/T-P6/T-N15 | T-P1 逐截点历史快照逐字节等；T-P6 全表差集，exit 0 | SQLite `begin immediate` 的真实原子性与提交期失败形态（P-01 先例） | G2 代码 |
| RL-5.2 触发器相容改造三判据（子句②名单加 `ns-relocated`；子句③拆三条：enabled / transferred / ns；混合语句 ⇒ `ROUTE_RELOC_SPLIT_REQUIRED`）（`:337-371`） | 【机】夹具 T-N7/T-N11 + MUT-2/4/5 | MUT-2/4/5 三条架空形分别被 T-N7/T-N11 类负例区分（真实拦、架空放），exit 0 | 真实触发器体改造 + `SCHEMA_VERSION` 推进 + `REQUIRED_TRIGGERS` 摘要重登 + 打开判据同批（P-17 外置锚随批） | G2 代码 |
| RL-5.3 `TRANSFER_NS_DRIFT` **永久保留**，移交通道永不携 ns；「反正有重定位了」的旁路申明被明文禁止（`:371-378`） | 【机】夹具 T-N1 + 现状测试 | T-N1「`transferRoute` 携 ns ⇒ `TRANSFER_NS_DRIFT`，零半成品（行为零变化钉）」，exit 0；现状 `tests/g5a-d31-transfer-ns.test.ts` 三条在册 | 无（行为零变化 = 回归钉，G2 不得放松） | 已裁 + G2 回归 |
| RL-5.4 见证 = EA-4.5 全形，不减不增（`:378-387`） | 【机】夹具 S3 + T-N7 | 码封闭性与全形对拍，exit 0 | 真库触发器核形回退位 | G2 代码 |
| RL-6.1 列语义四类（位置键可改；身份/内容/时刻/版本列逐字节不变）+ `contentDigest` 度量（`:389-404`） | 【机】夹具 T-P1/T-P6 | 两行夹具断言 digest 前后等、内容逐字节等，exit 0 | 真库列级断言（SQLite 无类型强约束的历史列） | G2 代码 |
| RL-6.2 零写面清单（directory/records/journal/projection…；ledger 除那条事件行外零增删改）（`:404-412`） | 【机】夹具 T-P6 | 差集断言，exit 0 | 真实投影/游标在搬家后「无需被惊动」的读侧证明（按新位置解析） | G2 代码 |
| RL-6.3 物理搬迁**不产生新科研事实、不产生新科研修订**（冻结判据）（`:412-424`） | 【机】夹具 T-P6 | 「`ledger` 差集恰 1 条 ns-relocated；无新 revision」，exit 0 | 领域侧观测面（投影/报告不因搬家而多一条）= G3 配正例 | G2 代码 + G3 领域正反例 |
| RL-6.4 `RELOCATABLE_NS_KEYS` 封闭清单 + **构建期扫描**（ns-keyed 表未入清单 = 构建红）（`:424-431`） | 【机】夹具 S6 侧面 | 门清单封闭集夹具验；扫描器**未实现** | 该构建期判据是 G2 交付物（与 EA-6 对账同族异源要求） | G2 代码 |
| RL-6.5 `routeNs` 升维为「出生 ns + 重定位链」，**前缀完备**为反洗白判据；其余形 ⇒ `SCHEMA_INCOMPATIBLE` fail-loud（`:431-471`） | 【机】夹具 T-P9/T-P3 + MUT-1 | T-P9「A→B→C 三级链，birth=A/B/C 的对象各按自己 birth 点链段可读」；MUT-1「架空链前缀完备被区分（真判据拒起点不符的孤立尾跳）」，exit 0 | 真实 `routeNs` 读写共用单点改造（P-06 现状）后的读面回归整页形态（§14.5 分界不毒化整页） | G2 代码 |
| RL-6.5a 链的诚实分层：界内 = 防御、界外裸面 = **登记边界**；`relocationGapCount` 是**检测不是防御**（`:447-471`） | 【机】夹具 S10 + T-N16 | S10「6.5a 界内防御 vs 界外登记边界与 RL-INFO 单一判据在位，且未把检测写成防御」；T-N16 并列断言「伪造链过闸 = 已登记界」与「界内 mint 仍零」，exit 0 | 设计上不承诺检出（不是缺口）；文档/实现日后写成「防御」即为违例 | 已裁（G1 文档） |
| RL-7.1–7.7 恢复条件逐条（前崩溃只读 / 事务中崩溃两态 / **陈旧 ns_epoch ⇒ 宁可拒答不可假答** / 数据不完整禁跳行 / 目标残留并发 / 跨版本读取 / 裸面残余）（`:472-503`） | 【机】夹具 T-P2/T-P7/T-N5/T-N15 + S9 | 故障矩阵 18 条与夹具双向逐等（S5），exit 0 | F-04（半写文件/WAL 截断）夹具列**明确留空** = 「G2 故障注入验收，P-12 D5-b」；重启式边界（Q44）实测属 G2/G4 | G2 代码 |
| RL-8.1 打开判据序五步（版本墙→触发器名+体摘要→水位→**ns 链完备性全表比对**⇒拒开→其余），**顺序即判据**（交换步 1/4 的变异必须红）（`:509-537`） | 【机】夹具 T-P4/T-N8 | T-P4「`routeDirMismatch>0` 且 `relocationGap=0` ⇒ 开库成功」；T-N8「无链漂移库重开 ⇒ `SCHEMA_UPGRADE_REQUIRED`；点名仅运维面、插件面同形；QUARANTINED」，exit 0 | 真实漂移库（`tests/fixtures/g6a-p5-drift.db` 家族）上的五步实测；**「交换步 1/4 必红」的判据次序变异在 G2 配**（GT 系列先例） | G2 代码 |
| RL-INFO 单一信息面判据：拒开 / 陈旧 fail-loud / 无链快照三个触发点**共用同一个 `callerBodyFor(caller)`** ⇒ 普通调用者响应面零差分（`:525-537`） | 【机】夹具 T-N8/T-P7/T-N13 三钉 | 三条夹具行同断言（同 `(code,键集)`、不含 oid/计数/hop/epoch），exit 0 | 真实代码的「构造面单一」约束需一条静态门（禁两处各写各的） | G2 代码 |
| RL-8.3 隔离：`QUARANTINED` 拒开不降级；不可证实来源 ⇒ `PERMANENTLY_QUARANTINED`（**再启需用户级重新评审记录**）（`:545-552`） | 【机】夹具 T-N8/T-N9 | T-N9「修复证据 digest 不符 ⇒ `REPAIR_PROVENANCE`，**零伪造链**，转 PERMANENTLY_QUARANTINED」，exit 0 | 「用户级重新评审记录」= 人工动作，机器不推导 | 人工批准 |
| RL-8.4 backfill 默认禁止补造「当时合法迁移」；唯一合法入账 = 来源验证后的显式修复；`AFTER-THE-FACT-REPAIR` 永久留痕；无来源 ⇒ 隔离并明确报告（`:552-571`） | 【机】夹具 T-P5/T-N9 + S8 | T-P5 修复端到端（链 hop 永久 AFTER-THE-FACT-REPAIR、路由行零改）；S8 冻结句含 backfill 默认禁止，exit 0 | 「证据所引备份是否真为事实来源」= 人认边界（契约自陈，与 EA-6.1 同界） | 已裁 + 人工批准 |
| RL-8.5 修复事务形与 §5.1 的差异逐项（仅残留行 remap + epoch；路由零改）（`:571-583`） | 【机】夹具 T-P5 | 同上，exit 0 | 真库上 remap 与 `domain_state` PK 交互 | G2 代码 |
| RL-9.1/9.2 两层版本职责表 + **C6 二选一撤销**（层界不同可同真；墙与可解释冲突时墙让位为「可旧读+标注」，永不改写历史记录）（`:583-608`） | 【机】夹具 S8 + 裁决表锚 | S8 覆盖「C6 撤销」句；`G1-ADJUDICATION-TABLE.md` D3-b/C6 行为裁决面（本席位读表实测 39 行） | 真实迁移器的「墙让位」分支实现 | G2 代码 |
| RL-10.1 状态机（非法迁移 ⇒ `RELOCATION_PRECONDITION` + 账零污染；回退产新 `relocationId`，原链一字不动）（`:610-627`） | 【机】夹具 S5 + T-P3 | 状态机链与故障矩阵双向逐等；T-P3 回退 = 反向提案走完且两条 AT-TIME 事件俱在，exit 0 | 真实账步 UPDATE/DELETE 触发器拒（`RELOCATION_LEDGER_FROZEN`） | G2 代码 |
| RL-10.2 故障矩阵 18 条（每条给机制行为/事后态/恢复条件/夹具锚）（`:627-652`） | 【机】夹具 S5 | 「故障矩阵 id 双向逐等（夹具 18 条 ↔ 正文表行，无缺无多）」，exit 0 | F-04 行夹具列为「—」⇒ 该项**只能**由 G2 故障注入验收闭合 | G2 代码 |
| RL-11.1/11.2/11.3 错误码：复用表 + **新增恰一枚** `RELOCATION_PRECONDITION` + 四条存储层信号文本（`:652-683`） | 【机】夹具 S3/S3b | S3b「新增拒绝码恰一枚 = `RELOCATION_PRECONDITION`（其余全在现状封闭集）」，exit 0 | 每码「不得泄漏跨空间存在性」的负例（空空间 vs 有对象空间同形）夹具不建世界 | G2 代码 + G3 领域正反例 |
| RL-11.4 `NSR-` 保留前缀登记（完整前缀语义归 `G1-LINK-01`）；`RELOCATABLE_NS_KEYS` 为构建期名单（`:683-691`） | 【批】+【复】 | 登记义务按 D-21 先例；现状止血 `tests/g5a-d21-reserved-prefix.test.ts` | 保留前缀**全集**未定 = 清单 `G1-LINK-01`（status: open，实测计数在册） | G1 文档（`G1-LINK-01` 责任者） |
| RL-12 事件对应与见证来源（提案/批准/precheck/abandon **H 零条**；execute 恰一条；领域事件与两旧名恒零）（`:691-707`） | 【机】夹具 T-P1/T-P6/T-P8 | 各动作 H 差集断言，exit 0 | 真实「H 事件不进业务投影」的投影面断言 | G2 代码 |
| RL-13/T-N16 界外裸面伪造链的**并列断言**（过闸 = 已登记界 + 界内 mint 仍零 + `relocationGapCount` 报 0 如实）（`:734-735`） | 【机】夹具 T-N16 | T-N16 PASS，exit 0 | 不承诺检出（设计边界） | 已裁（G1 文档） |
| RL-14.2 B.7 五项技术不变量 → 落点映射（「缺一即未冻结」）（`:761-771`） | 【机】夹具 S7 | S7 覆盖五要素 + B.7 映射逐条在位，exit 0 | 无 | 已裁（G1 文档） |
| RL-14.4 变更纪律（§2 形状/§4 门清单/§5.2 触发器子句/§10.2 矩阵/§11 码表任一变动 = 冻结面变更 + 人工批准标记）（`:786-800`） | 【批】 | 夹具常驻（S9 五条变异常驻） | 标记落 PR body；无 CI ⇒ 人工核对（§6） | 人工批准 |

---

## 4. 跨契约与在途件（不属于单份契约，但验收时必须一并核）

| 条款 | 可机验？ | 现有证据 | 缺口 | 责任层 |
| --- | --- | --- | --- | --- |
| 三方名单逐等：**契约 ↔ 锚文件 ↔ 夹具**（EA-2.4 / FM-9 / RL-2.2 共用） | 【机】但**当前只两方** | 三夹具 S1 类行全 PASS（exit 0） | `g1/EVENT-CONTRACT-LEDGER.json` 实测不存在 ⇒ 第三方位占位；「逐等」目前是自反比对 | G2 代码（锚文件物化，登记为实施批首项） |
| 夹具常驻架空判据（**新/改判据必带变异，变异只架空不删除**） | 【机】 | EA S10（3 条）/ FM S10（3 条）/ RL S9（5 条）全部常驻 PASS；三夹具 exit 0 | 无常驻的条款即「对架空无判别力」——本矩阵未发现缺常驻的新判据 | 已裁（G1 文档）+ G2 沿用 |
| 统一契约条款编号回填（`g1/G1-UNIFIED-CONTRACTS.md`） | 【机】待对拍 | 文件已存在（实测），但本席位未读未改 ⇒ 无数可引 | 落盘后须补：编号映射表 + 与本矩阵行一一对拍 + 夹具三方逐等扩展 | G1 文档（另一席位） |
| `ns-relocated` / `facet-mounted` / `facet-unlinked` 三个 planned 名的**入账顺序**（RL 先于 FM 挂载 Port 落地？两名互不代裁） | 【批】 | EA §9.2-④「`ns-relocated` 保持 planned-gated 待 G1-NS-01」；FM §9「本块在此之前不得被引用为已入账」 | 入账的**先后与同批**属实施批排期（见《G2-DEV-PLAN.md》PR-1/PR-4/PR-7 的进入门禁） | G2 代码 + 人工批准 |
| Q45 护栏 + GT-2/GT-3/GT-4 基线身份未闭合（护栏的「持续否证权」依赖基线可信） | 【复】 | `G0-R-CLOSURE.md §7`：三条 + 覆盖面流程位**全部去向 = `G1-GATE-01`**（实测 status: open） | 基线内容零校验 / 删测试后自洽重算 / 改断言体重锚 ⇒ 护栏目前靠「红条逐条定性」人工面支撑 | G1 文档（`G1-GATE-01` 责任者）→ G2 落 CI |

---

## 5. 三类验收条目统计（数字由脚本数出，不是手填）

**分类口径**：每行按「可机验？」列的**首个**标签定主责类（一行可并列两类，次类在行内文字说明，
不重复计数）；「责任层」按该列首 token 归类。**复算命令**（本席位用它生成下表，任何人可复核）：

```sh
python3 - <<'PY'
import re,collections
lines=open('experiments/v3-code-architecture-poc/g1/G1-ACCEPTANCE-MATRIX.md',encoding='utf-8').read().split('\n')
sec=''; per=collections.defaultdict(collections.Counter); lay=collections.Counter()
for l in lines:
    m=re.match(r'^## (\d)\. ',l)
    if m: sec=m.group(1); continue
    if sec in ('1','2','3','4') and l.startswith('|'):
        c=[x.strip() for x in l.strip().strip('|').split('|')]
        if len(c)<5 or c[0]=='条款' or set(c[0])<=set('-: '): continue
        mt=re.search(r'【([机批复])】',c[1])            # 主责类 = 第二个字段的首个标签
        per[sec][mt.group(1) if mt else '未标']+=1
        L=c[-1]
        lay['G2代码' if L.startswith('G2') else '已裁(G1文档)' if L.startswith('已裁')
            else 'G1文档' if L.startswith('G1 文档') else '人工批准' if L.startswith('人工批准')
            else '用户决策' if L.startswith('用户决策') else 'G3领域' if L.startswith('G3') else '其他']+=1
print({s:dict(per[s]) for s in '1234'}); print(dict(lay))
PY
```

### 5.1 三类统计（**共 94 行**：§1 EA 28 + §2 FM 24 + §3 RL 37 + §4 跨契约 5）

| 类别 | 含义 | EA | FM | RL | 跨契约 | **合计** |
| --- | --- | --- | --- | --- | --- | --- |
| **【机】可机验** | 当场有命令 + 实测退出码 + 夹具用例 id 可核对（含「夹具已验判据方向、真实面另计缺口」的行——见 §0 的夹具性质一句话） | 20 | 21 | 33 | 3 | **77** |
| **【复】需独立复核** | 夹具/文档已给判据，但结论依赖真实库 / 真实进程 / 真实宿主面，或依赖**尚未闭合的门禁身份**（GT-2/GT-3/GT-4），须由非作者席位复跑并登记 | 4 | 2 | 2 | 1 | **9** |
| **【批】需最终人工批准** | 机器只能验形态与「签字非本人」，语义权威 / 权柄归属在**人**（含用户级动作与冻结面标记） | 4 | 1 | 2 | 1 | **8** |

**读法（防被误读）**：【机】= 77 条**不等于** 77 条已实现——它说的是「判据的形状与判别方向已被
当场验过」；同批行的「缺口」列写明真实面待 G2。三类的**并集不是完成度**，G1 的完成度只看清单
（§5.3）与放行谓词（§6.2）。

### 5.2 责任层分布（同一 94 行按「责任层」首 token 计）

| 责任层 | 行数 | 说明 |
| --- | --- | --- |
| G2 代码（含跨批：+G3 领域正反例 / +独立复验 / +人工批准 / +G4） | **73** | 落码前无法闭合；G2 排期输入（见《G2-DEV-PLAN.md》§2 的 PR 拆分与本矩阵行号对拍） |
| 已裁（G1 文档层即终局） | **11** | 文本判据、变更纪律、诚实边界；G2 只许沿用不得放松 |
| G1 文档（其他条目责任者，非本矩阵） | 4 | `G1-LINK-01`（保留前缀全集）、`G1-GATE-01`（基线身份与重锚流程位）、统一契约编号回填 |
| 人工批准 | 4 | 冻结面变更标记、`Approved-By`、隔离终态再启 |
| G3 领域正反例 | 1 | FM-5.3 第二真源检测规则的科研正当性与词表 |
| 用户决策 | 1 | EA-9.4 **U-1**（锚文件正式承载面） |

### 5.3 与清单的关系

对**清单**的映射（放行谓词只看清单，不看本矩阵）：本矩阵 94 行中落在 open 清单条目名下的部分
= `G1-EVT-01 / G1-AUDIT-01`（EA 全节）、`G1-FACET-01`（FM 全节）、`G1-NS-01`（RL 全节）、
`G1-ROUTE-01`（路由审计谓词化）、`G1-VER-01`（版本戳/正源）、`G1-READ-02`（E-01 呈现）、
`G1-LINK-01`（保留前缀全集）、`G1-STORAGE-01/02`（TransactionLease / 触发器摘要外置）、
`G1-GATE-01`（基线身份与重锚纪律）、`G1-DONE-03`（真库 DDL + 故障注入）。实测清单计数：
**27 条 / open 23 / done 4 / 违规 0**（`--require-clear` exit 1）。

---

## 6. 门禁现状口径（写给下一个读者，别让 TA 猜）

### 6.1 日常门禁（每次契约/实施提交都跑，绿是常态）

```sh
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs            # 结构+自测：实测 exit 0
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs --self-test # 变异自验：实测 exit 0（17/17）
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs  # exit 0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET.fixtures.mjs           # exit 0
node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs      # exit 0
node experiments/v3-code-architecture-poc/g0-gate.mjs                                  # exit 0（三条流）
```

`--max-open <N>` 是**进度护栏**（评审期断言「open 面不扩大」；实测 `--max-open 23` ⇒ 0、`--max-open 22` ⇒ 1），
**不是**放行谓词。

### 6.2 `--require-clear` 只用于**申请冻结**，且 `supersession_review` 必须是真证据

```sh
node experiments/v3-code-architecture-poc/g1-checklist-validate.mjs --require-clear   # 当前 exit 1（NO-GO 期预期红）
```

- 谓词 = 违规==0 且 open==0 且 **assigned==0** 且 unassigned==0 且 superseded 未经人工确认==0。
  `assigned` 是推进态不是终局态（旧版「全部 assigned + 有主」即可骗过谓词的洞，校验器自验 M8 钉死）。
- **`supersession_review` 不得用一段 `REVIEW: <日期> <人>` 字符串冒充**：机器能钉的只有
  「形态合法 + 审查者 ≠ owner」（`g1-checklist-validate.mjs:308`），**签字的两个人是否真有其人、
  是否真读过 diff 不在机验面**（校验器头注「已知边界」原句：与 `owner` 的「权威性」同一人工边界）。
  因此申请冻结时必须**另附**：替代关系的裁定出处（提交号 / 裁定文行号）+ 一位**非作者**审查者的
  具名结论；字符串齐形只是准入条件，不是替代关系的证明。第七轮已实测过一次「23 条 open 全改
  superseded 指向任一 done ⇒ `--require-clear` 假绿」的洗白（`G0-R-CLOSURE.md §6`，反例复现于 `e3be0ce`）。
- `--self-test` 绿**必须先于** `--require-clear` 绿被引用（`IMPLEMENTATION-PLAN-DRAFT.md §2-G1`）：
  判据工具自己坏时，它的绿无意义。
- 清单每条的 `owner` 必须是 Q 编号 / 裁定提交 / 用户指令三者之一 —— **仍是人工判据**，不许读成已机验。

### 6.3 `docs:check` 只在**提交态**可信

- 采集面是 `git ls-files`（`scripts/docs/check.mjs`）：**未跟踪的新文件完全不在扫描面内**；
  已跟踪文件读的是**工作树内容** ⇒ 脏树给出的 OK 对「提交态」不成立（`G0-R-CLOSURE.md §4` 三跑实测）。
- 纪律口径：**提交前跑一次、提交后对 HEAD 再跑一次，两次都入账**才算「提交态 docs:check 绿」；
  新文档须**先跟踪再 `docs:sync --write`**（否则进不了派生索引，`docs/development.md` 红线区第「新文档」条）。
- 本席位三文件在**未提交**状态下跑 `docs:check` 只能得到「工作树参考值」，不自称提交态结论。

### 6.4 无 GitHub CI ⇒ **本地通过 ≠ CI 验收**

- `G0-R-CLOSURE.md §5` 的门禁表「来源」列**没有「CI」这一类**——原文：「所有绿灯均无 CI 背书，
  不构成 CI 验收（G2 NO-GO 的另一面）」。本矩阵引用的全部绿灯同受此限定。
- 推论三条：① EA-6.2 R1–R4、FM/RL 的构建期扫描、RL-8.1 顺序变异在 G2 之前**只有本地纪律**；
  ② `Frozen-Face-Review:` / `Event-Name-Review:` 标记靠人在 PR body 里核对（`docs/development.md`
  「冻结变更的机器门」的投票面在 CI 侧，本侧车无 CI ⇒ 标记门退化为人工门）；
  ③ 基线/身份锚（`attacks/BASELINE.json` 生成提交 `7d61ec3`，total 133 / failures 33 / passes 100；
  `AUTHOR_ANCHOR.json` 四项逐等）是**作者侧自证**，GT-2/GT-3/GT-4 未闭合 ⇒ 「与基线逐等」不等于
  「基线内容仍然可信」。这三条在 G2 前必须由 `G1-GATE-01` 给出流程位与责任人。

### 6.5 冻结面变更（G2 期间适用）

`docs/development.md` 红线 1 + 「冻结变更的机器门」：改 8 根文档 / `schema/**` / `SNAPSHOT.md` 或
事件不变量、权限与持久化格式 ⇒ 改文件 → `pnpm run snapshot:update` → 契约与清单**同一提交**评审，
PR body 必须含一行 `Frozen-Face-Review: <YYYY-MM-DD> <批准人>`；「快照哈希与清单同步**绝不代替审查**」。
本地复现投票：`pnpm run docs:probe --paths /tmp/changed.txt --fail-on-blocking`（不带标记 ⇒ 红，带标记 ⇒ 绿；
`IMPLEMENTATION-PLAN-DRAFT.md §8` 有该两态的实测留痕）。
