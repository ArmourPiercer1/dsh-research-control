# RECON01-RESULT — G1-RECON-01 全文对账结果（2026-11-01）

> 席位：#47 全文对账（G1-RECON-01 证据执行；父席授权单文件文档修订）
> 性质：只读证据 + 单文件文档修订（`experiments/v3-code-architecture-poc/G1-CONTRACT-DESIGNS.md` 原位加注，原文全部保留）
> 工作树：`.scratch/wt-recon`（detached @ `f3c060a7b5e16add3ebd8f0bc2d4c61053a08688`）；零 git 状态变更（仅建 worktree 时一次 `git worktree add` + 只读 git）
> 诚实口径：本文件所有引文均经 head `37de107e` 实测逐字核对；与登记引文不符处全部入 §6 漂移表，不掩盖。

## 1. #47 Head 核验（无漂移，停止条件未触发）

- 命令：`gh pr view 47 --json headRefOid,state,title`（exit 0）
- `headRefOid` = `37de107ed5297e91ba122976eac734a8f2ce38db` ＝ DESIGNS 附二登记记录 → **无漂移**
- `state` = `OPEN`（closed / merged / 大幅漂移三个停止条件均未触发）
- `title` = 「docs(architecture): 上层契约的 Schema 与接口层设计（Proposed，stacked on #42）」
- branch = `design/hsr-schema-interface-20261029`（与 DESIGNS 附二登记一致）
- #47 状态：全库 **Proposed**（7 份 `docs/architecture/H_S_R_*` 文件头自标 `DRAFT-PROPOSAL`；`docs/README.md` L56/65/66/69/71/72/73 共 7 处 `Proposed`；`docs/architecture/README.md` L20-26 共 7 处「Draft · 依赖未合并的 #42」式标注）——**一切 #47 引文均为草案条文，不意味「#47 已裁定」**

## 2. 9/9 取文状态（全部 gh api，全部 exit 0）

取文命令形如：`gh api "repos/ArmourPiercer1/dsh-research-control/contents/<path>?ref=37de107ed5297e91ba122976eac734a8f2ce38db" --jq .content | base64 -d`

| # | 路径（ref=37de107e） | 取文 | 缩写 | head 行数（实测） | 本地缓存 |
|---|---|---|---|---|---|
| 1 | `docs/architecture/H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md` | exit 0 | SF | 156 | `.scratch-fetched/docs/architecture/` |
| 2 | `docs/architecture/H_S_R_OBJECT_SCHEMA_DRAFT.md` | exit 0 | OBJ | 273 | 同上 |
| 3 | `docs/architecture/H_S_R_REGISTRY_SCHEMA_DRAFT.md` | exit 0 | RG | 73 | 同上 |
| 4 | `docs/architecture/H_S_R_CHECK_SCHEMA_DRAFT.md` | exit 0 | CK | 129 | 同上 |
| 5 | `docs/architecture/H_S_R_SCHEMA_DECISIONS_DRAFT.md` | exit 0 | SD | 154 | 同上 |
| 6 | `docs/architecture/H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md` | exit 0 | IF | 151 | 同上 |
| 7 | `docs/architecture/H_S_R_INTERFACE_CATALOG_DRAFT.md` | exit 0 | CAT | 106 | 同上 |
| 8 | `docs/README.md` | exit 0 | — | 122 | `.scratch-fetched/docs/` |
| 9 | `docs/architecture/README.md` | exit 0 | — | 51 | `.scratch-fetched/docs/architecture/` |

注：`ref=37de107e` 为 PR head 的**工作分支内容**，不在仓内 main 上；本地缓存仅工作树内、**不提交**。本文与 DESIGNS 加注所引一切行号均为上表 head 版本实测行号。

## 3. 注册锚点抽查表（逐字核验）

「✓」= 登记引文与 head 原文逐字一致；其余见 §6 漂移表。

| 锚点 | 登记位置 | head 实测行号 | 核验 |
|---|---|---|---|
| `T-GAP-09` 族名 | DESIGNS 附三 F-1 | `SD:122` | 原文「须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明前缀」（F-1 旧引文为压缩转述 → D5） |
| `T-GAP-10` 族名 | DESIGNS 附三 F-1 | `SD:123` | 原文「与 `T-GAP-09` 同源同批，须与 B（底层架构）连同 V1 命名空间一并定，本层不自行发明」 |
| `SI-02` | DESIGNS 附三 F-2 | `IF:12` | ✓（登记「:15 区」→ D1） |
| `SI-14` | RECON-PR47 | `IF:46` | ✓（登记「:60 区」→ D2） |
| `SI-51` | RECON-PR47 / ADJ D2-e | `IF:103` | ✓（登记「:101 区」→ D3；ADJ D2-e 已引 IF:103，一致） |
| `SI-16`（space_id 宿主映射未裁） | DESIGNS 附二 item1 | `IF:54` | ✓（附二 `:50-54` 区间锚正确） |
| `space_id` §2.1 必填/修订类禁提交 | DESIGNS 附二 item1 | `IF:23` | ✓ |
| SF-60（读侧历史版本可读） | RECON-PR47 4.1 / DESIGNS 附二 item4 | `SF:114` | 原文「读侧**必须**能读取所有历史版本」（台账引文脱「取」→ D6） |
| SF-61（兼容分级） | RECON-PR47 4.2 / DESIGNS 附二 item4 | `SF:115` | 原文「**缺省档是破坏**」（台账引「默认档」→ D7；DESIGNS 附二 L451 原引文逐字正确） |
| SF-62（破坏绝不回溯） | DESIGNS 附二 item4 | `SF:116` | ✓ |
| SF-63（报告钉版本 / 重检新报告） | DESIGNS 附二 item4 | `SF:117` | ✓ |
| `T-GAP-13`（同毫秒多提交） | DESIGNS 附二 item2 / ADJ D2-b | `SD:126` | ✓（含①②分支原文） |
| `T-GAP-14`（迁移顺序与判据） | DESIGNS 附二 item5 | `SD:127` | ✓（尾句台账引文非逐字 → D4） |
| SD-13（本轮不入 `schema/**`） | —（本席新引） | `SD:23` | ✓ |
| SD-07（无共享序号轴 / 跨平面只允许 external_citations） | DESIGNS 附二 item5 / ADJ X-8 | `SD:17` | ✓ |
| SD §6（明写不裁） | DESIGNS 附三 F-1 | `SD:152`（§6 题头）/ `SD:154` | ✓ |
| SF §12（明写不裁） | DESIGNS 附三 F-1 | `SF:154-156` | ✓（`:156`「……这些不属于本层职责，也不得被误当作已裁决。」） |
| SF §5 四类时间语义 / 瞬时行 | DESIGNS 附二 item2 | `SF:76` / `SF:79` | ✓（附二「瞬时槽位」为概括 → D8） |
| IC-H6（过滤顺序 / 晚到登记） | DESIGNS 附二 item2 | `CAT:23` | ✓ |
| ICX-06 封闭四只读 + 39=35+4 等式 | DESIGNS 附三 F-2 | `CAT:99` | ✓（35 契约操作逐枚枚举核对，等式自洽） |
| SCR-01/03/21 | DESIGNS 附二 item3 | `CK:23` / `CK:25` / `CK:53` | ✓ |
| SF-22/25/28（D1-a 采认面） | ADJ D1-a | `SF:66` / `SF:69` / `SF:72` | ✓ |
| 其余抽查（OBJ:48/53/54、RG:34、CK:39、IF:45/50/55/68/70/71/82/106、SF:74/110/127、SD:152） | 本席交叉引用 | 见左 | ✓ |

**负命题核验（本席独立 grep 实测，非转引台账）**：
- #47 七文件对「ns 漂移 / 物理命名空间 / 重定位 / 打开期」**零命中**；SF §8 = SF-60…SF-64 仅 9 行（`SF:110-118`）→ F-1「`SF §8` 全节对打开期检出 ns 漂移零要求、零承接」负命题成立。
- #47 七文件对 `facet`/`挂载` **零命中**（0）→ FACET §11.2 F-14「#47 现文对 Facet/挂载零规则」成立；UNIFIED §6 L536 ① 同文。
- #47 七文件对「归属账/名单存储形态」零条文：「名单/名册」6 命中均为白名单/名称映射表语义（`SF-02`/`SRG-13`/`SI-14`/`SS-13`/`SS-49`/`SS-56`）；「事件名」唯一命中 `SD-07`（方向与本席侧车名册机制同向）。

## 4. 附二五主题项判定表

| 主题（附二项） | ① #47 直引锚点（head 实测行号） | ② 仓内裁定面 | ③ 判定 | 一句话理由 |
|---|---|---|---|---|
| T1 SpaceContext（item1） | `IF:23`（space_id 必填/修订类禁提交）+ `IF:54`（SI-16 宿主映射未裁）+ `SD:122`（T-GAP-09 交 B） | `g1/G1-ADJUDICATION-TABLE.md:49`（D1-a）；`g1/G1-UNIFIED-CONTRACTS.md:84-96`（P1）+ `:577`（M-4 行，IG-1/IG-2 已落） | **一致（条件式）** | 「裁决前不得由实现自行选择」两侧同句；文法交 B（B 线=本 PoC 线）与 IG-1 命名同向承接，无冲突条款 |
| T2 时间截点（item2） | `SF:76`（四语义不替换）+ `SF:79`（瞬时行）+ `CAT:23`（IC-H6 过滤顺序）+ `SD:126`（T-GAP-13） | `g1/G1-ADJUDICATION-TABLE.md:53-58`（D2-a…f，D2-b 采②）；`g1/G1-CONTRACT-COMMIT-SEQUENCE.md:365-431`（§3）+ `:177-189`（§1.6 I-1…I-6） | **一致（条件式）** | T-GAP-13 自认未定并给出①②分支，裁定面采其②分支落地，两侧同向无矛盾 |
| T3 检查报告（item3） | `CK:23`（SCR-01 非对象记录）+ `CK:25`（SCR-03 三版本字段必填）+ `CK:53`（SCR-21 三前提）+ `SF:117`（SF-63 钉版本/重检新报告） | `g1/G1-UNIFIED-CONTRACTS.md:309-335`（P9 条件式采 SI-60/61，四值 reason ADJ D4-a）；`g1/G1-ADJUDICATION-TABLE.md:62`（D4-a）+ `:84`（X-6 三分） | **一致（条件式）** | 钉集/不可改写/重检新报告/INDETERMINATE 四值两侧同向互援，裁定面引 #47 一律条件式 |
| T4 存量版本（item4） | `SF:114`（SF-60 读侧必须能读取所有历史版本）+ `SF:116`（SF-62 绝不回溯） | `g1/G1-ADJUDICATION-TABLE.md:60`（D3-b 两层判据，C6 撤销）+ `:59`（D3-a 五层版本轴）；`g1/G1-CONTRACT-RELOCATION.md:724-745`（§9 RL-9） | **一致（条件式）** | 原记冲突 C6 已被 D3-b 裁定撤销（两层判据对象不同、可同真）；版本墙与 SF-60 无实质矛盾 |
| T5 迁移合同（item5） | `SD:127`（T-GAP-14 自认未定）+ `SD:17`（SD-07 无共享序号轴/跨平面只允许断言） | `g1/G1-CONTRACT-RELOCATION.md:312-369`（§4 RL-4 12 门）+ `:638-745`（§8 RL-8 自立）；`g1/G1-ADJUDICATION-TABLE.md:86`（X-8）；`g1/G1-CONTRACT-COMMIT-SEQUENCE.md:191-196`（§1.7） | **一致（条件式）** | T-GAP-14 自认不裁迁移时序，裁定面按 D5-a「唯一责任者=我方」自立承接，归属方向两侧一致 |

**计数：一致（条件式）5 / 需澄清 0 / 冲突 0。**
条件（RECON-PR47 固定注记）：#42 合并且条文文本不变；#47 条文以 head `37de107e` 原文为准；无条件一致恒为 0。判定依据不含 #47 作者侧三轮复审（零使用）。

## 5. 替换行清单（三行「#47 需澄清」关系行，原位加注、原文保留）

| 原行号（加注前） | 现行号 | 行内容 | 加注 |
|---|---|---|---|
| L115（A.7 末行） | L122 | #47 挂载登记表 DDL/触发器/版本推进 | 末格加注：判**一致（条件式）**；直引 `SD:23`（SD-13 本轮不入 `schema/**`）+ `SF:156`（§12 明写不裁）+ Facet/挂载零规则（本席 0 命中实测）；前句「属 Schema 决策面」归属预期被否定（F-1 型，非冲突），后句与 FACET L503 同向 |
| L228（B.6 行） | L235 | #47 重定位表 DDL/版本推进/打开判据次序 | 保留【第七轮更正…附三 F-1】标记后加注：判**一致（条件式）**；直引 `SD:123`（T-GAP-10）+ `SD:154`（§6 明写不裁）；裁定面 `RL-4`（唯一责任者=本契约）/ `RL-8`（「等 #47 定了我们再对齐」被永久废止） |
| L360（C.6 行） | L367 | #47 归属账/名单存储形态 | 保留【第七轮更正…附三 F-2】标记后加注：判**一致（条件式）**；直引 `IF:12`（SI-02）+ `SD:23`（SD-13）+ `SD:17`（SD-07 事件族=冻结面变更）；裁定面 `g1/G1-CONTRACT-EVENT-AUTHORITY.md:197-250`（§2.4 车面自立）/ `g1/G1-UNIFIED-CONTRACTS.md:539-540`（未覆盖④ 工具面 D6-a/b G2 工具层） |

## 6. 漂移登记（8 项，均 minor，无一推翻判定）

| # | 位置 | 登记形态 | head 原文 | 类型 |
|---|---|---|---|---|
| D1 | RECON-PR47 SI-02「:15 区」 | IF:15 区 | 实际 `IF:12` | 行锚（±3 行，语义同条） |
| D2 | RECON-PR47 SI-14「:60 区」 | IF:60 区 | 实际 `IF:46` | 行锚（±14 行，语义同条） |
| D3 | RECON-PR47 SI-51「:101 区」 | IF:101 区 | 实际 `IF:103`（ADJ D2-e 已引 IF:103） | 行锚（±2 行） |
| D4 | RECON-PR47 5.1 T-GAP-14 尾句 | 「本层不允许在任何裁决前给出统一表述」 | 「本层在裁决前不放行任何合一表述。」（`SD:127`） | 引文非逐字 |
| D5 | DESIGNS 附三 F-1 T-GAP-09/10 引文 | 「本层不自行发明，须与底层架构一并定」 | 两条文的**压缩转述**（语序与原句相反，非任一条单句原文）；逐字出处 `SD:122`/`SD:123`（F-1 加注已修正） | 引文（语义无漂移） |
| D6 | RECON-PR47 4.1 SF-60（同见 ADJ D3-b 上层条文列） | 「读侧必须能读所有历史版本」 | 「读侧**必须**能读取所有历史版本」（`SF:114`，脱「取」字） | 引文一字脱漏 |
| D7 | RECON-PR47 4.2 SF-61 | 「默认档是破坏」 | 「**缺省档是破坏**」（`SF:115`，默认→缺省） | 引文字词 |
| D8 | DESIGNS 附二 item2「瞬时槽位」 | 瞬时槽位 | 原表行标签为「瞬时」（`SF:79`） | 概括表述（锚 `:74` 正确） |

处置：本席 DESIGNS 加注一律以 head 原文为引文基准；D1-D3 为台账「区」行号精度不足（登记为约数），D4-D7 为引文非逐字/脱字——**均不改变台账 38 行任何一行的判定**；D5/D8 已在 DESIGNS 原位加注修正/说明。

## 7. 残留 / 未验证项（如实清单）

1. 9 文件取文自 gh api（ref=37de107e），本地缓存 `.scratch-fetched/` **不提交**、不入任何提交；任何方可按 §2 命令复取（ref 固定，结果可复现）。
2. #42 head（`0369c319`）与 #44 仓内文件行号**未在本席复验**（超出 G1-RECON-01 范围；「一致（条件式）」的条件子句对 #42 仅约束「合并且条文文本不变」，不依赖本席对其行号的测量）。
3. #47 三轮复审（作者侧）本席**零使用**，未作为任何判定依据。
4. 「39 = 35 + 4」为 `CAT:99` 表内逐枚枚举自洽核验；35 个契约操作已对照 CAT 全表枚举（无漏），无第三方独立枚举。
5. DESIGNS 加注所引 `g1/` 文件行号（ADJ L49/53-58/59-60/62/84/86、UNIFIED L84-96/309-335/536-542/577、RL L312/638-745、CS L177-196/365-431、EA L197-250、FACET L503）均为本席在 f3c060a 工作树实测；`g1/` 为仓内文件（非 #47 head），无 head 漂移问题。
6. 「一致（条件式）」不含 #47 合并后条文变更的情形（条文文本一变须重对账）——条件式固有边界，非本席遗漏。
7. `RECON01-RESULT.md` 与本文件同处工作树根（`.scratch/wt-recon/`），随 worktree 弃置，不入主仓。

## 8. GH 命令日志（10 条，全部 exit 0）

| # | 命令 | exit |
|---|---|---|
| 1 | `gh pr view 47 --json headRefOid,state,title` | 0 |
| 2 | `gh api repos/ArmourPiercer1/dsh-research-control/contents/docs/architecture/H_S_R_SCHEMA_FOUNDATIONS_DRAFT.md?ref=37de107e… --jq .content \| base64 -d` | 0 |
| 3 | 同上（`H_S_R_OBJECT_SCHEMA_DRAFT.md`） | 0 |
| 4 | 同上（`H_S_R_REGISTRY_SCHEMA_DRAFT.md`） | 0 |
| 5 | 同上（`H_S_R_CHECK_SCHEMA_DRAFT.md`） | 0 |
| 6 | 同上（`H_S_R_SCHEMA_DECISIONS_DRAFT.md`） | 0 |
| 7 | 同上（`H_S_R_INTERFACE_FOUNDATIONS_DRAFT.md`） | 0 |
| 8 | 同上（`H_S_R_INTERFACE_CATALOG_DRAFT.md`） | 0 |
| 9 | 同上（`docs/README.md`） | 0 |
| 10 | 同上（`docs/architecture/README.md`） | 0 |

## 9. DESIGNS 加注位清单（11 处，统一标记「【2026-11-01 对账席加注（G1-RECON-01 执行；父席授权）：…】」）

| 现行号 | 位置 | 内容 |
|---|---|---|
| L17-23 | 引证纪律文件头 | #47 引文基准升级为 head 文件:行号直引；条件式口径；原文「只到仓内可定位引文位」保留不删 |
| L122 | A.7 关系表末行（原 L115） | 一致（条件式）+ SD:23/SF:156 直引 |
| L235 | B.6 关系行（原 L228） | 一致（条件式）+ SD:123/SD:154 直引（第七轮更正标记保留） |
| L367 | C.6 关系行（原 L360） | 一致（条件式）+ IF:12/SD:23/SD:17 直引（第七轮更正标记保留） |
| L450 | 附二 item1 SpaceContext（原末行 L442 后） | 一致（条件式）+ ①②③ |
| L455 | 附二 item2 时间截点（原末行 L446 后） | 一致（条件式）+ ①②③ |
| L459 | 附二 item3 检查报告（原末行 L449 后） | 一致（条件式）+ ①②③ |
| L463 | 附二 item4 存量版本（原末行 L452 后） | 一致（条件式）+ ①②③ + D6 勘误登记 |
| L467 | 附二 item5 迁移合同（原末行 L455 后） | 一致（条件式）+ ①②③ + D4 勘误登记 |
| L477 | 附三 F-1 块内（原 L464 后） | 族名补文件:行号直引 + D5 压缩转述修正 + SF §12/§8 负命题核验 |
| L485 | 附三 F-2 块内（原 L471 后） | SI-02/ICX-06/39 等式直引 + 零条文负命题核验 |

**保留件核验**：登记纪律句（现 L468-469：「……引用本清单任何锚点时不得写成『#47 已裁定』——#47 全库状态为 Proposed（各文件头自标 `DRAFT-PROPOSAL`）」）原文未动；全部原句未删；文件 477 → 491 行（+14 = 头注 7 + 主题 5 + F-1 1 + F-2 1）。

## 10. 结论

1. #47 head 核验：`37de107ed5297e91ba122976eac734a8f2ce38db` 与登记一致、state=OPEN，**无漂移，停止条件未触发**。
2. 取文 9/9（gh api，全部 exit 0）；注册锚点抽查全部落地，8 项 minor 漂移登记在案（无一推翻台账判定）。
3. 附二五主题项：**一致（条件式）5 / 需澄清 0 / 冲突 0**（C6 已由 ADJ D3-b 层界裁定撤销，其余冲突候选均已按 ADJ 采认/让位处置，见 UNIFIED §6 L534）。
4. 三行「#47 需澄清」间接引文行（原 L115/L228/L360）已原位加注升级为文件:行号直引（原文保留）。
5. 本席唯一改动文件 = `experiments/v3-code-architecture-poc/G1-CONTRACT-DESIGNS.md`（491 行）；新增文件 = 本 RESULT；`.scratch-fetched/` 缓存不提交；零 git 状态变更。
