# RESULT-E5 — 通用对账谓词能在真实资产上捞到多少真实修正

**实验**：8 个通用 claim↔artifact 对账谓词（P1–P8，无事件特定规则）跑在 3 个真实研究包上，
对照 e4a 的 9 个真实修正事件（+2 条表外 U 记录）。

**结果标签：读时检出下界 4/9（可测子集 4/6）。** 9 个事件全部可在写时被「登记义务 + 机验」拦住（可）。
这是两个独立答案：① 遗留材料读时下界 = 4/9；② 写时可拦 = 9/9 → 需要的是登记义务，不是检索机制。

---

## 1. 协议与冻结纪律

- **阶段一（未读 e4a/FINDINGS.jsonl）**：只实现 8 个预注册谓词（P1 清单覆盖度 / P2 自述路径不符 /
  P3 声称的担保不存在 / P4 登记定义与实现不一致 / P5 同名多口径 / P6 run 终态与参数未登记 /
  P7 影子副本分歧 / P8 工件无出处），跑 3 个包，单次运行产出 `findings.jsonl`（111 行），
  随即冻结：`FROZEN.txt`（`sha256sum` + `date -u`，2026-11-01 21:05:52 UTC）。
  冻结哈希：`findings.jsonl` = `4fabca284c…7f942d`；`reconcile.mjs` = `0acf555d5218…8c3d6e`。
- **阶段二**：开 `e4a/FINDINGS.jsonl`（11 行 = 9 事件 + U-EGUN/U-RHODOTRON3D 两条表外记录，
  表外记录不计入分母），做命中映射。**冻结后零规则改动；miss 保持 miss。**
- 测试包（只读，未向 /mnt/* 写入）：`rhodotron_nonlinear_v2`（13 文件）、
  `20261014_Beijing_field_sanity_v2`（73 文件）、`EGUN_Simulation_Files`（303 文件，≈511 MB）。
  AIEO_DEV 不在测试集 → E-A1/A2/A3 记「不适用」。

### 冻结前通用修正（9 项，全部为通用解析/语义修正，零事件特定引用，均在 FROZEN.txt 之前）

| # | 谓词 | 修正 | 触发（均与 9 事件无关） |
|---|---|---|---|
| 1 | P4 | 三级收紧：文件级引用+stem 同文件配对 → **仅行级共指**；direct token 须 ≥8 字符且含数字；method 证据须公式语境（`X(`/`sorted s[`/`round(`/分位标记），散文化 "interpolation/插值" 不再计数 | 33→5→2 命中（字段/网格插值词、文件名常见英文词 "independent" 误配） |
| 2 | P3/P4 | ext 测试改正点号（`f.ext` 存无点形式，三处测试误带点）→ 全部 .py 被静默跳过 | 解析 bug（P3 恒 0 的根因） |
| 3 | P3 | `P3_SCRIPTNAME` 尾 `\b`：`.js` 不得部分匹配 `.json` | 两个诊断索引行经 `…-v1.js` 误指 |
| 4 | P3 | `P3_CONSTRUCT` += `self.assert\w+\s*\(`（unittest 惯用法即断言构造） | test_cells.py 15 条 FP |
| 5 | P5 | `P5_STRUCT_KEY` 停用表（sources/refs/provenance/notes/description/… 为结构键，非口径标签） | Beijing "sources" 键 FP |
| 6 | P6 | URL 区间排除：参考文献 URL 内 PII/DOI 不是 run id | THEORY_v2_zh.md L127 PII |
| 7 | P6 | 低熵 token 排除（uniq/len<0.35 或 maxRun≥8）：ASCII 绘图/重复数据列不是 run id | EGUN charplot.dat 9 条 FP |
| 8 | P8 | stem 匹配加词边界；短 stem(<6) 须紧跟 `.`（文件名语境）。裸子串 includes 不再把 "…CONVERGENCE TEST…BY 0.1" 巧合行当出处 | 全包仅 EGUN TEST.OUT 一例被错误豁免；rhodotron/Beijing 豁免数 0，不受影响 |
| 9 | P6 | detail 键 `id`→`run_id`（避免覆盖行 id 序列） | 行 id 格式一致性 |

## 2. 实测（阶段一冻结产物，未改动）

| 包 | 文件 | 文本文件 | 命中 | 耗时(实测) | 分谓词 |
|---|---|---|---|---|---|
| rhodotron_nonlinear_v2 | 13 | 9 | 7 | 7 ms | P1:1, P2:1, P8:5 |
| 20261014_Beijing_field_sanity_v2 | 73 | 56 | 74 | 103 ms | P2:1, P3:3, P4:2, P5:21, P6:3, P8:44 |
| EGUN_Simulation_Files | 303 | 203 | 30 | 2118 ms | P2:10, P7:13, P8:7 |
| **合计** | **409** | **268** | **111** | **4743 ms** | P1:1, P2:12, P3:3, P4:2, P5:21, P6:3, P7:13, P8:56 |

**成本**：谓词代码 `reconcile.mjs` **759 行**（零依赖 node ESM，只读）；三包单次运行实测 **4743 ms**
（EGUN 占比 2118 ms，主要为 303 文件含多 MB 级 .OUT/.exe 的 sha256）。

## 3. 9 事件 × 8 谓词矩阵（命中 / 漏检 / 不适用）

命中数 = 冻结 findings 中映射到该事件的行数（映射依据见 §5 与附录）。

| 事件 | 档位 | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | 命中数 | 状态 | 该事件在写时可否被义务+机验拦住 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E-R1 RF 角色前提更换 | T4 | — | — | — | — | — | — | — | — | 0 | 漏检 | 可（前提依赖+版本指纹按 run 登记；拦住的是「未登记的前提变更」，新前提的物理正确性仍须人判） |
| E-R2 D 与能区口径变更 | T2 | — | — | — | — | — | — | — | — | 0 | 漏检 | 可（量口径登记表：同一命名量的构造/定义登记；需跨版本累积登记——v1/v2 是独立包） |
| E-R3 run 位置自述+清单覆盖 | T4 | **1** (P1-001) | **1** (P2-002) | — | — | — | — | — | — | 2 | **命中** | 可（清单覆盖+位置记录，全机械 T0 型：`sha256sum -c`、声明路径存在性） |
| E-A1 LEDRO 种子继承 | T3 | N/A | | | | | | | （包未测试） | — | 不适用 | 可（实验设计登记受控因子：起点是否受控 + 汇总断言对原始记录核对） |
| E-A2 中途快照引为最终 | T1 | N/A | | | | | | | （包未测试） | — | 不适用 | 可（引用须 join 到已登记终态；等值/区间比对，机械） |
| E-A3 取斑口径 10µm→1µm | T2 | N/A | | | | | | | （包未测试） | — | 不适用 | 可（口径登记：网格/束腰定义 + 输入指纹 deck screen 行） |
| E-B1 v1 宽度统计撤回 | T2 | — | — | — | **2** (P4-012/013) | — | — | — | — | 2 | **命中** | 可（冻结公式登记+统计脚本/表与登记公式一致性——本包已有 32 冻结定义，v1 脚本违之，写时机验即可拦） |
| E-B2 HEADLINE 混群体口径 | T2 | — | — | — | — | **21** (P5-014…034) | — | — | — | 21 | **命中** | 可（群体定义登记 + headline 数↔表行 join；0.34 pp 差可由两行 CSV 直接算出） |
| E-B3 E4(d) assert 不存在 | T4 | — | — | **3** (P3-009…011) | — | — | — | — | — | 3 | **命中** | 可（担保须指向真实存在可执行构造；脚本内容指纹，grep 级机验即足） |

命中事件共 **4**（R3、B1、B2、B3）；漏检 **2**（R1、R2）；不适用 **3**（A1/A2/A3，包未测试）。

## 4. 读时检出下界（问题①）

**读时检出下界 = 4/9**（可测子集 4/6；预注册假设 ~6/9 → 实测 4/9，低于假设）。

两个漏检的结构原因（均为通用谓词的固有边界，非实现缺陷）：
- **E-R1（T4）**：RF 角色/前提整体更换是跨 v1/v2 包的**语义前提**变更；v1 包（echo_theory_v1.zip）
  不在测试集内。8 个谓词全部是包内结构对账（清单/路径/担保/登记/口径/终态/副本/出处），
  无法比较两个版本中同一量的**语义**（b=0.02144539 的 RF 像差处理 → J_KK≈0.999 的纵向镜片）。
- **E-R2（T2）**：D 与能区的口径变更（η 参数化→hard-edge 几何；独立能区→A/B 对）在 v2 包内
  **无自相矛盾**（v2 只有新口径，无 v1 口径残留供对账）；包内不存在 P4 可配对的「登记 vs 实现」双侧。
  其可检性依赖**跨版本累积登记**（量口径登记表），即写时义务。

注：「下界」另含实现层面的保守性——P4 只认行级共指、P8 只认「文本记录行」等通用约束可能漏掉
更弱的证据形态；但 R1/R2 的漏检由谓词类别边界决定（见上），与保守性无关。

## 5. 写时可拦（问题②）

**9/9 事件均可在写时被「登记义务 + 机验」拦住**（矩阵末列，逐事件依据 = e4a 各自
`detection_capability` 字段 + 机验形态）：

| 事件 | 义务（写时登记） | 机验形态 |
|---|---|---|
| E-R1 | 前提依赖+版本指纹按 run 登记 | run 间前提登记 diff；未声明前提变更即失败（拦住未登记变更，非物理正确性） |
| E-R2 | 量口径登记表（同一命名量的构造/定义） | 跨版本定义 diff；同名量新构造未入登记即失败 |
| E-R3 | 完整性清单+环境/位置记录 | `sha256sum -c` 全覆盖；声明路径存在性（T0 型全机械） |
| E-A1 | 实验设计受控因子登记（起点是否受控） | 各 arm 登记锚点 vs 实际消耗输入指纹；汇总断言↔原始记录 join |
| E-A2 | 引用须指向已登记终态 | 引用 run 的终态记录存在性 + 等值/区间比对 |
| E-A3 | 量口径登记（网格/束腰）+ 输入指纹 | deck screen 行指纹 vs 登记口径 |
| E-B1 | 命名量→统计公式登记（冻结定义） | 统计脚本/表与登记公式一致性（本包 32 冻结定义即该机制；v1 违之会被拦） |
| E-B2 | 群体定义登记 + headline↔表行 join | headline 数必须能 join 到唯一表行；两口径 0.34 pp 直接可算 |
| E-B3 | 担保须指向真实存在可执行构造 | 脚本内容指纹：声称 abort/assert 的行 ↔ 代码构造存在性（grep 级） |

**结论（两个独立问题，分开回答）**：
① 遗留材料读时检出下界：**4/9**（可测子集 4/6；A 事件因包未测试记不适用）。
② 写时可拦：**9 个事件全部可被登记义务+机验拦住**——包括两个读时漏检（E-R1/E-R2）：
它们 e4a 的 `detection_capability` 字段本身就是「前提依赖+版本指纹登记 / 量口径登记表」，
即登记义务。→ **需要的是登记义务，不是检索机制。**

## 6. FP 会计：(a) 匹配 9 事件 / (b) 9 事件外的真实问题 / (c) 噪声

- **(a) = 28 行**：P1-001、P2-002（E-R3）；P3-009/010/011（E-B3）；P4-012/013（E-B1）；P5-014…034（E-B2）。
  - P3-009 边界说明（判断）：该命中在 §8 澄清行上触发，选中目标为该行提及的
    `mirror_symmetry_v1.py`（其确无可执行 assert——即 E4(d) 本体）；而该行正面断言的主语
    `extract_axis_1053_v1.py` 确有 assert（L30）。按目标判读计入 (a)E-B3；若按主语判读改判 (b)，
    (a)=27，**事件级矩阵不受影响**（E-B3 仍由 P3-010/011 命中）。
- **(b) = 83 行**，**(c) = 0 行**。**(c) 占比 = 0/83 = 0%**（以非-(a) 行为分母）。
- **判断边界披露**：83 行 (b) 中 **66 行**位于判断边界——P8×56（规则严格：要求逐工件
  「工具名+版本」文本记录行；但包内有全局环境版本行，Beijing README「numpy 2.3.5 / pandas 2.2.3 /
  matplotlib 3.10.8」，EGUN 工件头自述版本如 `EGI…Version=3.533`）与 EGUN P2×10（`SET PATH = Z:\…`
  为环境变量声明，非严格意义的输出声明，但声明路径确实不存在/与包不同位）。
  若全部按最严读法重判为噪声 → **(c) 上界 = 66/111 = 59.5%**（非-(a) 内 66/83 = 79.5%）。
  其余 17 行（Beijing P2×1 输出路径、Beijing P6×3 未登记 job id、EGUN P7×13 影子副本）无边界争议。
- 逐行 (b)/(c) 清单（**判断，非机器输出**）见 §8 附录。
- EGUN 一致性旁证（不计入 9 事件分母）：EGUN 30 命中与 e4a 表外记录 U-EGUN
  （「同名输入多版本影子副本+0 字节 notebook+死路径，参数变更从未登记」）方向一致。

## 7. 不能声称什么

1. **n=9**，且其中 3 个（E-A1/A2/A3）因 AIEO_DEV 包不在测试集而**不适用**（非漏检）：
   4/9 的分母含 3 个结构性不可检事件；可测子集口径为 4/6。
2. **单一研究者**：9 事件出自同一研究者的 3 条项目线（+EGUN 为同人仿真文件），无跨研究者外推。
3. **选择偏差**：3 个测试包均因「事后已证有问题」而被选入 → P1（清单）与 P7（影子副本）
   结构性占优（有问题的包更可能有清单/副本残留）。4/9 下界**不可外推到任意包**，
   也不能用于对任何机制（读时/写时/混合）做总体优劣判断。
4. **9 事件不是精确率基准**：83 行 (b) 命中表明真实包内 9 事件之外的出处/路径/副本/终态问题
   远多于 9 事件本身——ground truth 严重欠采样真实问题空间。
5. **(b)/(c) 分类是人的判断**（逐行标注），不是机器输出；66 行边界行的读法不同会改变 (c) 占比
   （0% ↔ 59.5% 上界）。
6. **4 个档位复审点未决**，本报告不重裁：E-R3/E-B3（T0↔T4）、E-R1（T3↔T4）、E-A3（数值来源：
   347/263 nm 出自结论文档，修正前主要工件现不在库）。
7. **命中聚合**：E-B1 = 2 行（1 个 ddof 矛盾 × 2 个登记文件，证据重复）；E-B2 = 21 行
   （1 个事件 × 21 处同标签两口径并存点）；不应读作 23 个独立问题。

## 8. 附录：逐行 (b)/(c) 清单（83 行；判定=判断）

| id | 包 | 文件 | 判定 | 理由（判断，非机器输出） |
|---|---|---|---|---|
| P8-003 | Rhodotron | dispersion_decomposition.png | (b) | 结果工件无"工具名+版本"文本记录行（包内仅全局环境版本行 / 工件头自述版本，无逐工件记录） |
| P8-004 | Rhodotron | finite_cavity_response.png | (b) | 同上 |
| P8-005 | Rhodotron | quadratic_isochronous_double.png | (b) | 同上 |
| P8-006 | Rhodotron | results_v2.json | (b) | 同上 |
| P8-007 | Rhodotron | rf_curvature_second_harmonic.png | (b) | 同上 |
| P2-008 | Beijing | source_data/fieldsanity-onoff_ref2_frozen32_v2.py | (b) | 声明输出路径 /srv/…/offrun 不存在且与包不同位 |
| P6-035 | Beijing | source_data/fieldsanity-DIAGNOSTIC-INDEX-v1.txt | (b) | job id 01M4PE1N3GP42M7F8QNHDH8A3P 被引用，包内无终态/参数登记 |
| P6-036 | Beijing | source_data/ref2topo-G1-PAIRED-FROZEN32-v1.json | (b) | job id 01M4TKZ3NTAVXBDZK96D4854AA 同上 |
| P6-037 | Beijing | source_data/ref2topo-G1-PAIRED-FROZEN32-v1.json | (b) | job id 01M4P251BDZJ2JS8980J1ZENG4 同上 |
| P8-038…P8-081 | Beijing | field_sanity_plots/*.png×16、*.csv×9、*.json×6、source_data/fieldsanity-*.csv/json/gdf×13（共 44 件工件） | (b) | 结果工件无"工具名+版本"文本记录行（README 有全局环境版本行，无逐工件记录）【边界：66 行边界集成员】 |
| P2-082 | EGUN | Projects/GridedGun/EGUN_RUNNER.txt | (b) | 声明路径 Z:\Projects\GridedGun\Program 不存在（SET PATH 环境变量声明）【边界】 |
| P2-083…P2-091 | EGUN | Projects/*/0_EGUN_RUNNER.BAT ×4、Learning/EGUN_RUNNER.txt、References/EGUN/e/p.bat、z.bat、References/xqxEGUN/EGUN/e/p.bat、z.bat（共 9 行） | (b) | 声明路径 Z:\…/D:\desktop\e\{c,5} 不存在（SET PATH 环境变量声明）【边界】 |
| P7-092…P7-104 | EGUN | polygon.exe×11、0_egun_runner.bat×4、buffer.dat×11、emission.cpl/egn/out×3、emission.txt×2、input.dat×11、plot.cpl×11、polydiag.nos×10、charplot.dat×11、egunbond.dat×11、gtx.txt×3（共 13 组） | (b) | 同名影子副本多份、内容分歧、无变更记录（与 e4a 表外记录 U-EGUN 一致） |
| P8-105 | EGUN | Projects/GridedGun/PIERCE_TYPE/EMISSION.OUT | (b) | 工件头自述 EGN2C Version=3.533，但包内无"工件名+工具+版本"文本记录行【边界】 |
| P8-106 | EGUN | Projects/GridedGun/Program/EMISSION.OUT | (b) | 同上【边界】 |
| P8-107 | EGUN | Projects/Learning/Program/EMISSION.OUT | (b) | 同上【边界】 |
| P8-108 | EGUN | Projects/Learning/Program/TEST.OUT | (b) | 同上【边界】 |
| P8-109 | EGUN | References/EGUN/INPUT_TE.OUT | (b) | 工件孤立（包内无提及）且无出处记录行【边界】 |
| P8-110 | EGUN | References/usable/LOCAL3.OUT | (b) | 有文本提及但无"工具名+版本"记录行【边界】 |
| P8-111 | EGUN | References/xqxEGUN/EGUN/d/D1/XQX1.OUT | (b) | 工件孤立（11.4 MB，包内无提及）且无出处记录行【边界】 |

（完整 83 行机器可读版 = `findings.jsonl` 中非 (a) 集的行，(a) 集 =
{P1-001, P2-002, P3-009…011, P4-012/013, P5-014…034}。）

## 9. 与 E0 的对照

- **E0（PoC）**：7 个**植入**缺口，flat linter（单层规则列表，无 claim↔artifact 配对）→ **7/7**，全 T0/T1。
- **E5（真实材料）**：8 个通用 claim↔artifact 谓词 → **4/9**；两个漏检恰为 T2/T4 口径/前提类，
  其 e4a `detection_capability` 字段本身即登记义务。
- 读法：两者不矛盾——机械层在真实材料上仍稳定抓住机械类（R3/B1/B2/B3 的命中全部是机械对账：
  清单计数、路径存在性、定义↔实现 diff、同标签多值、担保↔构造）；而口径/前提类（R1/R2）
  不是任何包内读时检索可及的形态，其 CAPABILITY 即写时登记。E0 的 7/7 是植入与规则匹配的人工产物
  （缺口被放得恰好可 lint），E5 的 4/9 是材料自然分布下的实测下界。

---

### 产物清单
`reconcile.mjs`（759 行谓词实现）· `findings.jsonl`（111 行冻结）· `FROZEN.txt`（sha256+UTC 时间戳）·
`run-summary.json`（实测分包统计）· 本报告。scratch 文件已全部删除。
