# RE-REVIEW-G1-DOMAIN —— G1 契约族「领域正确性」独立复审（第二轮）

- 复审人：独立领域复审席（非契约作者；父席 session-3e3f10a7 委派）。
- 对象（`experiments/v3-code-architecture-poc/g1/`，分支 `g1/contracts-20261031`，HEAD `243f8f4`，工作树干净）：
  `G1-ADJUDICATION-TABLE.md`、`G1-CONTRACT-EVENT-AUTHORITY.md`（EA）、`G1-CONTRACT-FACET.md`（FM）、
  `G1-CONTRACT-RELOCATION.md`（RL）、`G1-UNIFIED-CONTRACTS.md`（UNIFIED）、`G1-CONTRACT-RECONCILIATION.md`（RECON）。
- 上位权威：#42 `0369c3196c`、#44 `5ec38974fc`、#47 `37de107ed5`（一律 `git show <sha>:<path>` 取 blob 原文；
  #47 base=#42 未合并 ⇒ 涉及 #47 的关系一律条件式）。
- 证据纪律：每条发现 = 可复现反例（命令 + 真实退出码）或 两处条文原文互斥（各带文件:行）。禁「建议加强」式空话。
  已批 Q1–Q45 一律不重开。
- 结论：**P0 = 0，P1 = 0，P2 = 3**。五问（Q1–Q5）逐项判定见 §2；清除项（查过、判不成立，附理由）见 §3。

---

## 1. 发现清单（P2 三条，各带证据）

### P2-1 —— EA 现行时态断言「夹具 S 组就是三方逐等的当场执行器」为假；锚文件未物化、夹具从不读它
- 互斥两引：
  - `g1/G1-CONTRACT-EVENT-AUTHORITY.md:523-524`：「对账脚本消费锚文件时同时核对本契约 §2.4 名单块 ↔ 锚文件 ↔
    夹具名单三方逐等（**夹具 S 组结构校验就是这三方的当场执行器**）。」——现在时断言。
  - `g1/G1-UNIFIED-CONTRACTS.md:193-194`：「……与夹具逐等（S1/S1b，顺序敏感；**锚文件为第三方位，尚未物化 ⇒
    物化前『三方逐等』实为契约↔夹具两方**）。」
- 可复现：
  - `ls g1/EVENT-CONTRACT-LEDGER.json` → **exit 2**（锚文件不存在；EA §6.1 冻结的「名单唯一正源」，
    RECON:237 亦载「按 EA §9.4 尚未创建」）。
  - `grep -n "EVENT-CONTRACT-LEDGER" g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` → 命中 **仅 2 处**（L331、L464），
    都是 R4 耦合模型的**路径字符串常量**；夹具全文对锚文件**零 readFileSync**（读过的只有契约 .md、夹具自身源码、
    REFUSAL_CODES、FM/RL 文档）。⇒ 「三方逐等」的第三方位是夹具内自建最小模型（夹具 L106 注释自认），
    当下为自反比对（`G1-ACCEPTANCE-MATRIX.md:60/73/164` 同样如实登记）。
- 为什么仍是发现而非已清偿：同批 R-1…R-6 的每一处旧句都按「旧句保留 + 原位作废/更正」处理（EA-7.4、EA-2.4、
  RL-2.2、FM-2.5、UNIFIED 各注记），唯独 EA §6.2 这句**现状为假的断言**未获同等待遇；「异源对账必过」
  （EA-2.4 步骤 4）在锚文件物化前是被夹具**绿着满足**的（夹具 exit 0 而锚缺席），恰是 EA 自己 §6.2 判词
  「异源漏一次就重演一次」（L521）所警戒的形态。语义无害（下游两文件诚实登记），故 P2 不升级。

### P2-2 —— D5-a 裁决的「唯一责任者」文书住所枚举与 RL-4 的自指不一致；两枚举住所现均无清单本体
- 互斥两引：
  - `g1/G1-ADJUDICATION-TABLE.md:65`（D5-a 裁决列）：「唯一责任者 = **我方 G1 契约**
    （**本表 + `CONTRACTS.md` 打开面小节**）写『打开判据次序 + 迁移前校验清单』」。
  - `g1/G1-CONTRACT-RELOCATION.md:311`（RL-4 标题）：「## 4. RL-4 迁移前校验与目标准备清单
    （封闭清单；**唯一责任者 = 本契约**，P-12 D5-a）」——而「本契约」（RL 分契约）不在 D5-a 的枚举里。
- 辅证（非独立发现）：`G1-CONTRACT-RECONCILIATION.md:9` 登记 CONTRACTS.md「未改动（授权面外）」⇒ D5-a 枚举的
  两个住所（本表 / CONTRACTS.md 打开面小节）**当前都不含 12 门封闭清单本体**；本体只存在于 RL-4。
  另 RL:76（P-12 行）转引 D5-a 时把括注换写成「（打开判据次序 + 迁移前校验清单）」，即引用侧已按
  「对象」而非「文书住所」读 D5-a——两种读法不可同真。
- Q5 判定语境：责任**面**唯一（我方 G1，无「属 #47 决策面」残留，见 §2-Q5），但唯一责任者的**条文住所**在
  D5-a 的枚举与 RL-4 的现实之间错位；CONTRACTS.md 打开面小节回填时若照 D5-a 枚举另写一份清单，即造出
  第二个清单正源。P2。

### P2-3 —— 引用保真度：EA 关系表以引号转引 #44 L223 非逐字（「不并行…」应为「不能并行…」）
- 两引：
  - `g1/G1-CONTRACT-EVENT-AUTHORITY.md:695`：「OA-3 把「**不**并行创建第二套事件真源」做成装配期机验」。
  - #44 blob `5ec38974fc:docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md` L223 原文：「**不能**并行创建第二套事件真源」
    （`git show 5ec38974fc:… | sed -n '223p'` → exit 0）。
- 对照：同文件 EA:40（C-03 锚行）逐字正确（「不能并行…」）。本仓对引号内逐字性有先例级纪律
  （ADJ §3 溯源专节以「commit message **逐字**含」为证据标准）。单字之差、语义不翻转，P2。

---

## 2. 五问逐项判定（各附条文锚）

### Q1 是否改变 #42/#44 已裁科研语义 —— **判定：未改变（0 项发现）**
- H/S/R、五类、RD-05、RD-38：EA-1.2.2 明文「层结果判定、RD-38 归约、RD-05 精确指称的判定……**一字不动**；
  本契约只规定载体与入口」；FM-1.2 把 FR 标识挡在端点/正式声明槽位外（T-N1 eventType∉五类 ⇒ 入口即拒）；
  RD-38 四值优先级与 SCR-11 的 INDETERMINATE 理由**四值**经 blob 逐字核对（`H_S_R_CHECK_SCHEMA_DRAFT.md` L39，
  `{WITHHELD_REFERENCE, CHECKER_UNAVAILABLE, DEPENDENCY_MISSING, RULE_UNREGISTERED}`，exit 0）。
- SP-03（无屏蔽精确计数）：R-1 更正段（EA:606-619）方向是**收紧**（`hiddenBy*` 整体退出调用方 echo，
  「改的是出口，不是算法」），与 D1-d/C4 同尺；#42 SP-03（DOMAIN:149 blob 逐字核对）未被任何新句放宽。
- Q37（Raw Intake 宽容）：T-P3（未识别材料必收、行名固定、超限仍收）+ T-N8（预留闸接进 Raw 通道 = 契约违例）
  双向钉死；`raw-record-declared` 未入账期间的 `ACTIVATION_IMPOSSIBLE` 是**装配期进入门禁**（系统不激活 ⇒
  无降级运行态），UNIFIED:195-197 把代价如实登记为人工 `Approved-By` 动作，非语义弱化。
- Q40（单 Space 原子）：RL-5.1 切换五要素同事务 + RL-3.4 `oidScope:'ALL'` 禁分批（分批 = D-31 毒化形态）；
  ADJ X-4 行明示「**不重开 Q40**，本行仅作闭合登记」。
- Q44（重启式边界）：RL 的 R-01/R-13 引 #44 L198 原句（blob 核对）；RL-1.4 B2（解冻 `dir.ns`）弃案维持；
  重定位改的是物理位置键（RL-1.1 层界句），不触碰身份/owner/权威——与「不做在线热迁移」不冲突。
- Q45（合法跨 Capability 扩展）：FM-3.2 规范句「任何条款不得使该正例判红；与 F-17 护栏冲突 ⇒ **改契约不改护栏**」
  + 护栏测试 `attacks/review/g1a-regression.test.ts:196` 入 BASELINE 对拍 + EA T-P2 引用形状。
- 版本墙 vs SF-60：D3-b/C6 撤案（SF-60 是工件层可读性，blob L114 核对；墙是 G2 打开期物理形态），撤案正确。

### Q2 存在性泄露（新形态） —— **判定：未发现新泄露面（0 项发现）**
- 五类载体封闭清单（计数/detail/水位/分页 total-exhausted/缓存键）在 ADJ D1-d 定死，UNIFIED:63-64 承接。
- hiddenBy* 键撤回后的新形态：调用方体「隐藏 0/1/≥2 逐字节同形」（EA-7.4 R-1 新句）+ 三份夹具负例
  T-N11/T-N9/T-N19 + 架空判据 MUT-5/MUT-8 判别力自验（本轮实跑 exit 0）。
- 拒绝形状：EA-2.3 detail 只回显调用方输入 + 机制本地事实；FM-3.1(a) 两来源 detail 封闭键集
  `{oid, capability}` 逐字节等、内部信号（`REFUSE_UNMOUNTED` 等）不得出现在对外字节；
  RL-6.5③/§11.2 拒开体对任意两主体逐字节等、点名与 drift 计数只进运维/审计面。
- FM-2.2 入口序（空间写权→激活→挂载轴→**目标解析最后**）满足 #44 L147 授权先于解析；缺轴零残留（F-20）。
- 分页/游标（D2-e 自包含截点+授权类绑定）、水位对外只发定性态（D1-d）、缓存按授权类分键（SI-34 blob L83 核对）。
- 审计事件差分：T-P7 断言落账前后普通响应逐字节等 + 键集零增长；审计行读取通道封闭（EA-7.4）。
- `EVENT_AUTHORITY_REQUIRED.detail.owner` 回显 = 装配期归属账事实（EA:279「注册只在装配期发生」），
  非空间内对象存在性判据；`classification` 三值只依赖名单/归属账。判不构成 oracle。

### Q3 科研决策由谁做 —— **判定：无越权（0 项发现）**
- 无任何机制条款主张正式采纳/真值：ADJ D4-c「**科研正式采纳权不进机制**：机制只做不透明业务轴取证……
  采纳权委托与政策属用户/宿主政策面（§4 清单项 1）」；`truthSource` 字段 = C-03 数据真源形态
  （`'ledger-payload' | 'ledger-referenced-store'`，EA:269），不是真值判定。
- `AuthorizationContext` 不可读成「机制自签授权」：`authorized` 恒为 `principalCan`（宿主注入策略）取证结论
  （EA-4.2），构造顺序「归属核对→激活核对→取证（先于对象解析）→解析」（EA-4.3）；EA-4.6 明文复算
  **不证明**宿主主体真实性（CONTRACTS §10 未证明面）；B-3 未生效声明形态（authorized=false 落账不投影）
  保留 SP-09 两分。
- `Approved-By` 缺席 fail-closed 为真闭环：EA-2.4 R-5 更正段（本契约**不得自称已批准**，判据≠批准）+
  批准三要素两处同现（锚文件 + trailer）+ UNIFIED:195-197 进入门禁 + RL-2.2 同批更正；
  机验 T-N13/T-N20（无标记 ⇒ 通用通道拒 + 机制直写装配红零行）与架空 MUT-6（自称批准即过 ⇒ 放走同一负例），
  本轮实跑两份夹具 exit 0。

### Q4 历史可解释性 —— **判定：闭合（0 项发现）**
- 旧事件名：EA-5.1/5.1a（对 `ledger.event_type/actor/authority_basis` 的任何 UPDATE 路径 = 违宪；切换前解释
  逐字段等 + 预留只约束未来写入，T-P6 三面同钉）；EA-5.2 逐名处置表（同名同判、就地升格不改读语义）；
  EA-5.4 别名映射**否证**留痕（与 C-18/C-06 同立场 + 映射表自身成第二真源）。
- 旧版本行/无戳行：EA-5.3 缺省档 + `UNINTERPRETED_FAIL_CLOSED`；R-6 收口句把 D5-c「显式修补事件」与
  EA-5.3「不回填」收成一句（只追加、零 UPDATE、只调呈现档、可回看；修补≠洗白），
  T-P9/T-N14/T-N21/MUT-7/MUT-10 两侧对称钉住。
- AFTER-THE-FACT-REPAIR：`provenance` 永久字段 + `repairEvidence` 必填（RL-2.2）；链接受 hop 仅担保「漂移有
  来源核验的修复记录」，审计面永久点名；RL-6.5a 把链源异源性实话分层写尽。
- 物理搬迁「零新科研事实」：RL-6.3 冻结判据 + T-P6 全表行集差分机验（`ledger` 差集恰一条机制事件、
  `domain_state` 按 (oid,revision) 逐字节等、directory/records/journal 差集为空、零新 revision）。

### Q5 归属缺口（「属 X 决策面」病灶） —— **判定：残留仅文书层（P2-2、P2-3）**
- `grep -rn "属 #47\|属#47"` 六文件命中 3 处，全部是**禁令句或作废声明**
  （ADJ C8 行是撤案记录、RL:856 是「作废句随附」登记、UNIFIED:28/444 是禁令本身）⇒ 无裸「属 #47 决策面」残留。
- 「凡写归 X 必须给条文锚」抽验通过（如 EA:644 T-N1 归 A1 给 DESIGN A.8 锚；X-2 归 #47 HCF 层给 SF-50/52a
  且 blob L107 实文存在——该面 #47 **有**条文，不属被禁形态）。
- 残余问题即 P2-2（唯一责任者的文书住所错位）与 P2-3（引号转引非逐字）。

---

## 3. 清除项（查过、判不成立——各附不成立理由，防下轮重复劳动）

1. **D2-b 分支句 vs D2-c 回拨句**：ADJ:53「该毫秒无提交 ⇒ 落此前最后一个提交」若按**墙钟时刻**读，与
   ADJ:54「前缀界天然吸收回拨（乱序时间只让 cutoff 保守不前移）」在乱序语料上可判出不同 cutoff；但同格
   前半句的形式定义「cutoff(t) = 最大 c 使提交序 ≤c 的行的 recorded_at 全 ≤ t（前缀界）」使分支句按提交序
   推论读为恒等复述——**正式定义与推论同处一格，取自然读法不互斥**，故不计发现；双读法在此留痕，
   CONTRACTS.md §7 回填映射小节时应只抄形式定义句。
2. **UNIFIED 陈旧说**（第一轮线索）：证伪。UNIFIED 已含 R-1/R-2/R-3/R-4/R-5 落地注记
   （L67/L172-181/L226/L243/L185-194，「首批 10 + planned 3」被原位作废、gateFullShape 已三分、
   基数已改「已入账 7 + 提案未入账 4」）；`grep 已批准` 无「属已批准」残留断言。
3. **raw-record-declared 门控违 Q37 说**：装配红 ⇒ 无运行态可违约（fail-closed 于激活前），
   宽容语义在入账后稳态由 T-P3/T-N8 双向钉住——不构成对 #44 L234 的改变（见 Q1）。
4. **`declareRawIntake-input` 通道与 `input-carries-witness-field` 复用码**：封闭集不扩张（EA:193-195），
   与 §14.2 纪律一致；非新拒绝面。
5. **EA-4.5 ① 支不要求 `authorized=1`**：全形九字段仍必查（`authorized` 字段必在），false 落账不投影 =
   B-3/SP-09(a) 原裁定，非漏洞。

---

## 4. 我实际跑过什么（命令 + 真实退出码；均在仓根或 `g1/` 下执行）

| 命令 | 退出码 | 关键输出 |
| --- | --- | --- |
| `node g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | **0** | 合计 48 PASS / 0 FAIL |
| `node g1/G1-CONTRACT-FACET.fixtures.mjs` | **0** | 合计 35 项：PASS 35 / FAIL 0 |
| `node g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | **0** | 合计 57 PASS / 0 FAIL |
| `node g1-checklist-validate.mjs` | **0** | items=27 open=23 违规=0（绿） |
| `node g1-checklist-validate.mjs --require-clear` | **1** | 终局放行未满足（NO-GO 阶段预期红；违规=0） |
| `ls g1/EVENT-CONTRACT-LEDGER.json` | **2** | 锚文件不存在（P2-1） |
| `grep -n EVENT-CONTRACT-LEDGER g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs` | **0** | 仅 L331/L464 字符串常量，零 readFileSync（P2-1） |
| `git merge-base --is-ancestor 8f2795b 37de107ed5` | **0** | ADJ §3「8f2795b 为 #47 祖先」成立 |
| `git merge-base --is-ancestor 8f2795b HEAD` / `... origin/main` | **1 / 1** | 非 HEAD、非 main 祖先——与 ADJ §3 逐句相符 |
| `git log -1 e84524d`（+ `--is-ancestor e84524d 37de107ed5`） | **0** | 「PoC-1 暴露的两处未定项收口（SS-15a）」存在且为 #47 祖先 |
| `git show <sha>:<blob>` 抽行核对 | **0** | #42：T-01/T-02（L81-82）、SP-03（L149）、RD-38（L76）、F-CHECK-UNAVAILABLE（L37）、C11（L103）；#44：L147/L167/L171/L175/L198/L223/L234/L242/L293/L325/L327-328；#47：SCR-11（L39 四值逐字）、SF-60（L114）、SF-N-04（L127）、SF §12（L154）、SF-52a（L107）、A-01（SD:48）、T-GAP-09/10（L122-123）、T-GAP-13（L126）、SI-14（L46）、SI-34（L83）、SI-41（L93）、ICX-06/07（L99-100）、SS-15/15a（OBJ:53-54）、SD-07（L17）、SF-28（L72） |
| `grep -rn "属 #47\|属#47" g1/*.md` 等归属审计 | 0/1 见 §2-Q5 | 三命中全为禁令/作废语境 |

## 5. 我读不到的东西（未取得）

- **C-19「既有评审事实」的一手记录**：五名预留的批准过程只经 `CONTRACTS.md` §16.3/D-27 二手转述可见，
  对应评审/讨论原文不在本仓。
- **A.6-6 / A.8 / 附三等父席裁定的外部复审原始件**：仅经 `G1-CONTRACT-DESIGNS.md` 承载；其上游「外部复审点名」
  的原文未取得（本轮全部按 DESIGN 文书为权威面处理）。
- **#47 PR 面元数据**（review 评论、合并条件）：只取得三个 blob SHA 的文件内容与 commit message（`git log -S`）。
- **宿主侧未证明面**：`CONTRACTS.md` §10（宿主主体真实性）无执行体；G1-TOOL-01 工具面（D6-a/b）在 PoC 无落点，
  其「同批裁定」承诺无法在本仓核验。
- **锚文件 `g1/EVENT-CONTRACT-LEDGER.json`**：不存在，读不到——本身即 P2-1 的证据。
- **G2 实现批**（真实 DDL/触发器/故障注入）：未存在；本轮判定全部止于契约文本 + 零依赖夹具层。
