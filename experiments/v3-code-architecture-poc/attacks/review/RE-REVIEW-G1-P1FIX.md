# RE-REVIEW-G1-P1FIX —— G1 工程 3×P1 修复的独立复验（复验席）

> **席位**：独立复验席（只读）。**对象只有一件事**：工程审查 `RE-REVIEW-G1-ENG.md` 的 P1-1/P1-2/P1-3
> 在 R-8/R-9/R-10（`G1-CONTRACT-RECONCILIATION.md` §11–§13，提交 `a481d88`）修复后**原问题是否不再成立**。
> 不另开新战场、不重复领域语义审查、不重开已裁 Q 项。
> **工作树**：分支 `g1/contracts-20261031`，HEAD `9e304c7`；全部判据来自**本席亲手重跑**，
> 无一采信修复者结论。构造物全部落 `.scratch/p1fix-reverify/`（gitignored），`G1-RECONCILIATION-CHECKLIST.yaml`
> 本体复验前后 `sha256 = c0a7ffffc541e0a0233ce8a5581079d22d6199468bfc9e691920503c578f197e` 逐等未动。
> **计数**：闭合 3 / 部分闭合 0 / 未闭合 0（各带如实残口，见各节）。

---

## 1. P1-1（R-8）—— `domain_state_no_update` 窄化触发体 —— **闭合**

**原问题三件套**：① RL-5.1 步 3 的 UPDATE 被现体当场拒绝且契约无出口；② P-07 锚点在自称基准提交
`d2f19cc` 上即为假（「无不可变性触发器」）；③ RL-5.2「不相容恰两处」穷尽性失守。

**本席亲手重跑（不采信 `.scratch/rl51.mjs` 旧日志，新写 `p11-trigger-check.mjs`）**：
所有 DDL 与触发体一律**正则逐字提取**自 `src/storage-sqlite/sqlite-port.ts`（现体）与
`g1/G1-CONTRACT-RELOCATION.md:424-429`（窄化规范 SQL 的「…」内全文），`node:sqlite` **真库真触发器**执行，非模型形：

| 反例（RL-5.2 判据形） | 期望 | 实测 |
| --- | --- | --- |
| 现体（sqlite-port.ts 逐字）跑 RL-5.1 步 3 纯 ns UPDATE | 拒（原反例基线） | **拒，`DOMAIN_STATE_APPEND_ONLY`**（原反例复现成立，exit 语义同 RL51_EXIT=3） |
| 窄化体 · 纯 ns 改写 | 放行且零碰其余列 | **放行**，五列逐字未动（回读逐列核） |
| 窄化体 · 五个非位置列**逐个单改**（oid/revision/payload_json/recorded_seq/contract_version） | 全拒 | **5/5 全拒**，信号文本逐字 `DOMAIN_STATE_APPEND_ONLY` |
| 窄化体 · **ns + 非位置列同语句**改写 | 拒且零半成品 | **拒**，回读整行原样 |
| 窄化体 · `INSERT OR REPLACE`（recursive_triggers=ON 隐删） | 照拒 | **拒**（撞一字未动的 `domain_state_no_delete`） |
| 窄化体 · no-op 全同值 UPDATE | 放行（契约明写不加判据） | 放行 |
| 窄化体 · 直接 DELETE | 照拒 | 拒 |
| **MUT-11 架空形**（规范 SQL 的 WHEN 等式清单换 `when 0` = 全量放行） | 必须**放过**同一内容改写负例（判别力配对） | **放过**——T-N22 两侧判据对架空体有判别力，配对断言在真触发器上成立 |

⇒ 判据「纯 ns 放行 ∧ 任一非位置列改写（连带 ns 与否）仍拒」两侧都在**真 SQLite 真触发器**上由本席独立成立。
提取到的规范 SQL 与 `G1-CONTRACT-RELOCATION.md:424-429` 逐字（输出内嵌回显核对）；
等式清单五列 = RL-6.1 列语义表四类列 = 夹具 `DOMAIN_STATE_IMMUTABLE_COLS`
（fixtures.mjs:327），夹具 `S16` 机验三方逐等（本席实跑夹具 **60 PASS / 0 FAIL，exit 0**，
T-N22/S16/MUT-11 行在案）。

**P-07 错锚留痕核对（更正纪律，非悄悄改掉）**：`git show a481d88` diff 实证——P-07 行旧句
「`domain_state` PK=(ns,oid,revision) 且**无不可变性触发器**」**原文保留**、以删除线
`~~…~~` 标注，就地接【R-8 更正段】（RELOCATION.md:72，含 `git show d2f19cc` L202/L204 取证与
REQUIRED_TRIGGERS 在列陈述）；RL-5.2 标题下旧「两处」计数句同样保留原位 + 作废更正段
（RELOCATION.md:396-404），「三处」逐点重裁（:404 起）；穷尽性 grep `domain_state_no_update|DOMAIN_STATE_APPEND_ONLY`
现命中 RELOCATION 13 处 / G2-DEV-PLAN 1 处（PR-8 范围行 :283-285 四处改造点名 + 三件套进入门禁）/
矩阵 51/35/60 终态重锚在位（矩阵 :49-50、:63-66、:79）。⇒ ①②③三件原陈述全部**不再成立**，且失真痕迹留档。

**如实残口（修复方自登记、本席核在其边界内，不影响闭合判定）**：
- 生产 Port 的**集成半边**——新体摘要登记进 `REQUIRED_TRIGGERS` 期望摘要、`SCHEMA_VERSION` 7→+1、
  打开判据同批（sqlite-port.ts:428-445 的 F5c 体摘要机制本席读码核实在位、机制可行）——
  在 PR-8 落地前仍只是「契约 + 夹具」形态；R-8 明写「仍开放：真库对应物（真触发器 SQL 的
  T-N22 化）在 PR-8 落地前只是模型形」，承接人 = **PR-8 实施批**（G2-DEV-PLAN PR-8 验收行
  「T-P1..P10 / T-N1..N22 **真库化**」），期望摘要外置正源文件 = `G1-STORAGE-02` 范围。
  本席的增量：**窄化 SQL 本体已越过模型形**（真触发器实证），停在下限的是三件套集成而非 SQL 语义。

## 2. P1-2（R-9）—— DONE 锚点真值校验 —— **闭合**

**原问题**：`--require-clear` 的锚只判形不判真——27 条全 done + 假提交号 + 幽灵路径可把唯一放行命令洗成绿。

**本席亲手复现（自造副本，绝不触碰本体；`--file` 形态——见残口③关于裸位置参数的实测）**：

1. **洗白必红**：本席自造 `fake-launder.yaml`（27 条全 done、owner 伪造「Q40（复验席伪造归属）」、
   全部 evidence（含既有 4 条 done 的原锚）换成**本席自造假锚** `deadbee0123 见 ghost-reverify-p1fix-no-such-file.md`
   ——假号与幽灵名均**区别于**原反例与修复者的 `abcdef0`/`ghost-evidence-*`，排除撞缓存）跑
   `--file … --require-clear` ⇒ **exit 1**；违规 **54 条全部 `[DONE-EVIDENCE]` 且全部带「锚点真值未过」**，
   **逐条点名 27 个 id**（去重计数 27；首条 G1-TIME-01、G1-RECON-01 亦在列），计数行
   `items=27 open=0 done=27 违规=54`——即「形合面全过、真值面逐条点名」，正是修的反方向被堵死。
2. **差分证据（不是「本来就红」）**：`git show a481d88^:…/g1-checklist-validate.mjs`（修前版）对**同一份
   本席副本**跑 `--file … --require-clear` ⇒ **exit 0、违规=0、判绿**——原反例在修前成立、修后不成立，
   由同一输入二分坐实。
3. **修的不是一把梭（M20 型独立复跑）**：本席自造 `clean-anchors.yaml`（同洗白构造但 evidence =
   **HEAD 实测提交号 `9e304c7bb6…` + 真路径** `experiments/…/g1/G1-CONTRACT-RELOCATION.md:394`）⇒
   `--require-clear` **exit 0 判绿**；另造 basename 形 `g1-checklist-validate.mjs:328`（走
   `git ls-files` 后缀兜底半边，G1-DONE-04 现存合法形态同路）⇒ 亦 **exit 0**。真值段不误伤。
4. **supersession 侧同判**（原 P1-2 顺带点名的 SUPERSESSION-* 面）：本席自造全 superseded 洗白形
   （reason+evidence 同假锚 + `REVIEW: 9999-99-99` 假审查者）⇒ **exit 1、SUPERSESSION-EVIDENCE ×46 点名**——
   证据锚假同样红；reason 只判形是 R-9 写死的分工（叙事文本，校验器注释 :496-497 在案）。
5. **常驻与日常门**：`--self-test` **21/21 exit 0**（M18/M19 假锚红、M20 真锚绿、M21 原反例全形红）；
   主清单日常门 **exit 0**（真锚零误伤）、`--require-clear` **exit 1**（NO-GO 预期红，违规=0）。

⇒ 原 P1-2 的核心反例（形合假锚洗白终局放行）在本席独立构造、独立判跑下**不再成立**。

**如实残口（不升格为新洞）**：
- ① 机器证「锚存在」**不证**「锚内容支持结论」——真锚空转仍是人工面（R-9 头注已登记，M20 判绿不许被
  误读为内容过审）；`REVIEW_RE` 仍收 `9999-99-99` 式畸零日期（本席实测形合过）——属「审查者权威性」
  同一人工界（头注人工边界三豁免的邻面），**建议**下轮把日期合法性补进形态判据（分钟级改动），
  但它不构成 P1-2 核心反例的复活路径：supersession 洗白仍被证据锚真值 + 终达 done 链闸拦死（本席第 4 跑）。
- ② `supersession_reason` 锚只判形——R-9 写死的分工（证据面由 SUPERSESSION-EVIDENCE 真值把门），如实记录。
- ③ **校验器 CLI 小形**（非 P1-2 本体，登记备考）：`--require-clear <裸路径>` 的**位置参数被静默忽略**
  ——本席实测该形态校验的是**默认清单**（计数行 open=23 暴露之），不是所给副本；幸而方向 fail-safe
  （校验真清单且仍红），但任务书里那种「`--require-clear <副本路径>`」写法会给人已验副本的错觉，
  正确用法是 `--file <副本>`。建议下轮把未知位置参数拒收（exit 2）。

## 3. P1-3（R-9）—— `synth:raw-intake` 无合规落点 —— **闭合（计划层）**

**原问题**：EA-1.2.2 unregistered 拒写 × 现实现走通用通道 × 登记义务唯一排 PR-10 × 作者测试钉死落账成功
——四事实互斥，PR-2..PR-9 每个中间 PR 的 `g0-gate exit 0` 结构性不可满足。

**只读核文（引用行号，本席实核未实现 PR-2，亦无需）**：
- **已在 PR-2 范围内登记/改道**：`G2-DEV-PLAN.md:145-155`——范围行明写「**`synth:raw-intake` 登记 +
  命令 Port 改道（R-9 从 PR-10 提前）**」，且 :151「同名义务**不许**再押给 PR-10：**登记与 Port 改道
  与本 PR 的拒写翻转同批**」；:153-155 给出为何不放 PR-1 的理由（「账上有名、无人拒写」空转窗）。
- **退出门禁双向钉死**：:163-167「**`tests/p3-intake-validation.test.ts` 的 intake 落账成功例无新红**——
  必须经『登记 + 命令 Port 改道』转绿，**不许改写成接受拒写**」+ 异源对账 R1/R2 确认该名为已登记名；
  §2 通用退出门禁铁律（:62-72）把「g0-gate 仍 exit 0 ∧ 作者套件无新红、禁止改测试消缝」写成每 PR 通则，
  :69 直接点名「PR-2 的 `synth:raw-intake` 即此形」。
- **押后路被堵**：PR-10 基数收缩注记（:336-338「不许拿『PR-10 再统一迁』把 PR-2 的登记义务押回去」）；
  `grep -rn raw-intake g1/` 除台账与计划外**零残留旧排期句**（本席实测零命中）。
- **修法可行性有在案先例**：姊妹名 `synth:fact-designation` 已按同形收口——登记在
  `src/domains/test-records.ts:55`（`ownsEventTypes` 在列、`requiresAuthority:'domain-admission'`），
  用例改走命令 Port（`src/app/standing-use-case.ts` 头注 D-20 收口说明在案），作者套件全绿即活证。
- **钉死落账成功的测试在 PR-2 后仍可能绿**：`tests/p3-intake-validation.test.ts:51-60`（`expect(rec.seq).toBe(seq)`
  钉「返回 seq = 落账 seq」+ :58 来源回读）——登记 + 改道**不改写成功语义**，只把写点从通用通道
  （现 `src/app/intake-use-case.ts:53` `tx.appendLedger(…)` 带 `D-19c-ALLOWED` 标记）移进归属域的
  命令路径，断言面（seq 相等 / 来源保留 / 不产生对象）在新写点下同样可满足；先例名同形迁移时套件即绿。
  今天（PR-2 前）实测 `npx vitest run …/p3-intake-validation.test.ts` ⇒ **exit 0，15/15 全绿**——
  「翻转 + 登记同批」在计划文本上互斥已解，测试无被迫改红之据。

⇒ 原四事实的互斥环被拆掉（第三事实「唯一押 PR-10」作废），P1-3 在**计划文本层闭合**。
**如实残口**：最终实证在 PR-2 落地当天（`g0-gate` 三条流逐等 + 该测试无新红是其退出门禁，:163-167），
复验席按计划文本 + 在案先例判定，不代做实现；PR-2 进入门禁的两个人工 `Approved-By`
（:158-162）是 R-5 fail-closed 设计后果（用户动作），与本 P1 无冲突。

---

## 实跑命令与退出码（本席亲跑全清单）

| # | 命令 | 退出码 / 关键输出 |
| - | --- | --- |
| 1 | `node .scratch/p1fix-reverify/p11-trigger-check.mjs`（DDL/触发体逐字提取自 sqlite-port.ts 与 RL-5.2；node:sqlite 真库） | **0**；现体拒纯 ns（原反例复现）、窄化体 a/e 放行 + b/c/d/f 全拒、MUT-11 架空形放过改写 |
| 2 | `node g1/G1-CONTRACT-RELOCATION.fixtures.mjs` | **0**；60 PASS / 0 FAIL，T-N22/S16/MUT-11 行在列 |
| 3 | `git show a481d88 -- …/G1-CONTRACT-RELOCATION.md` + grep | P-07 旧句保留（删除线）+ 就地更正段；「两处」作废句保留原位 |
| 4 | `node g1-checklist-validate.mjs --require-clear <裸位置参数副本>` | 1——但校验的是**默认清单**（裸位置参数被静默忽略，见 P1-2 残口③） |
| 5 | `node g1-checklist-validate.mjs --file .scratch/p1fix-reverify/fake-launder.yaml --require-clear` | **1**；DONE-EVIDENCE 真值违规 ×54、点名 27/27 条 |
| 6 | `git show a481d88^:…/g1-checklist-validate.mjs` → `node <修前版> --file <同一副本> --require-clear` | **0 判绿**（差分证据：原问题修前成立） |
| 7 | `node g1-checklist-validate.mjs --file clean-anchors.yaml --require-clear`（真提交号+真路径，全路径与 basename 两形） | **0 / 0**（真锚不误伤） |
| 8 | `node g1-checklist-validate.mjs --file fake-supersede.yaml --require-clear`（全 superseded + 假证据锚 + 9999-99-99 假 review） | **1**；SUPERSESSION-EVIDENCE ×46 点名 |
| 9 | `node g1-checklist-validate.mjs --self-test` | **0**；21/21 全部捕获（M18/M19/M21 红、M20 绿） |
| 10 | `node g1-checklist-validate.mjs` / 同一 `--require-clear` | **0**（真锚零误伤） / **1**（NO-GO 预期红） |
| 11 | `sha256sum G1-RECONCILIATION-CHECKLIST.yaml`（复验前后各一次） | 逐等 `c0a7ff…f197e`，**本体零改动** |
| 12 | `npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts experiments/v3-code-architecture-poc/tests/p3-intake-validation.test.ts` | **0**；15 passed (15) |

## 读不到的东西

- GitHub PR #42/#44/#47 原文（只按仓内转录，沿原审查席口径）。
- PR-8/PR-2 的**落地实现**（不存在于本工作树——G1 契约阶段，属预期而非缺陷）。
- `G1-ACCEPTANCE-MATRIX.md` / `G2-DEV-PLAN.md` / `IMPLEMENTATION-PLAN-DRAFT.md` 全文（按引用点核读：
  矩阵 :49-79、计划 §2/PR-2/PR-8/PR-10/§3.2/§5-2 相关段、台账 §11–§13）。
- `tests/dsh-homes` e2e 面与本复验无关，未触碰。

## 三句回报

- **P1-1：闭合**——窄化规范 SQL 在真 SQLite 真触发器上「只放行 ns 单列、五非位置列单改/混改/REPLACE/DELETE
  全拒、MUT-11 架空形放过同一改写」两侧本席独立实证；P-07 错锚删除线留原文 + 就地更正段，非静默覆盖。
- **P1-2：闭合**——本席自造洗白副本（异源假锚）修后 exit 1 逐条点名 27 条、修前同一副本 exit 0 判绿、
  真提交+真路径两形 exit 0 判绿：原反例死亡，非一把梭。
- **P1-3：闭合（计划层）**——登记+改道已钉进 PR-2 范围与退出门禁、PR-10 押后路被明文堵死、
  姊妹先例 `synth:fact-designation` 同形在案，p3 钉桩测试今天在绿且按计划在 PR-2 后仍可绿（终证待落地日）。
