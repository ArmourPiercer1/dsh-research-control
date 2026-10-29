# 独立审查（基线 `da113bcd`）的复现与处置

审查判 PoC 作为实现放行证据 = **ITERATE**。我逐条自己复现（`.scratch/probe-review.mjs`，夹具逐字取自当时的测试文件），**七条全部成立**，其中两条比审查描述更严重。核心已按规则原文重写；本文件是"哪条规则、原文怎么说、桩件当时怎么做、现在怎么钉住"的反查表。**第二轮审查（四项）的复现与处置在文末同名小节。**

| # | 审查条目 | 复现 | 规则原文依据 | 修法与钉住方式 |
| --- | --- | --- | --- | --- |
| 1 | `UNRESOLVED` 键集写成 `{@st, reason}` | ✅ 两种编码都被接受 | `SF-17`：`UNRESOLVED → {@st, ref}` | `core.KEYS` 改正；**P1-2 矩阵**对每个状态各有正反例；**P1-10** 断言 `core.KEYS` 与逐字抄自 `SF-17` 的表完全相等 |
| 2 | `UNKNOWN` 带多余 `v` 被接受 | ✅ 接受且无 finding | `SF-17`：**出现集合外的键即形态非法（写入被拒）**；`SF-04` ⑤ 引用 `SF-17` | 新增 `keysOutOfRange()`，在 `ingest` 里作为拒写项（不只是 finding）；矩阵行 `UNKNOWN+reason+v → STATE_KEYS_OUT_OF_RANGE` |
| 3 | 摘要排除集混用（我把 `SCR-54` 的两项当成摘要排除集） | ✅ | `SCR-06`：摘要排除集 = **恰 `{report_digest}` 一项**；`SCR-54`：同形判定排除集 = **恰 `{report_id, checked_at}`** | 拆成 `DIGEST_EXCLUSION` / `SHAPE_EXCLUSION` 两个常量并各断言其**封闭长度**（P3-4/P3-5）；第三个面 `SCR-57` 比较面另计 |
| 4 | `reduceLevel([])` → `ACHIEVED` | ✅ | `SCR-77`：该层无规则适用 → `INDETERMINATE(RULE_UNREGISTERED)`，**不得**为 PASS | 改为 `INDETERMINATE`；P3-2 保留 naive 版作反向锚点 |
| 5 | 父槽位可冒充子路径 | ✅ | `SS-15a`：三处必须**同一形态**（引用位粒度） | 删除前缀容忍 `samePos`，改**精确同名**；`reg.identitySlots` 全部改用契约点名的 `world_membership.individual_ref` |
| 6 | 首次登记 `NONE_DECLARED + CLOSED_DRAFT` 不产 finding | ✅ findings=`[]` | `AR-ID-6`/§4.1：该声明**产生时**须 `SUBMITTED`；`AR-ID-4` 只豁免后续生命周期修订 | 豁免条件收紧为"上一版已声明 `NONE_DECLARED`"；正反例一对（首次登记必违规 / 撤回修订不新增） |
| 7 | PoC-1 夹具不是合法对象：`o1`、`schema_version:"1.0"`、写入信封带 `boundary` | ✅ 整数 `1` 被拒、字符串 `"1.0"` 被接受；缺 `object_id`/`space_id` 被接受 | `SF-04` ②（信封必填结构，`schema_version` 整数见文档两处）+ ④（**引用 pattern 不匹配**，`SF-22` 文法）；`SS-15a` 第③类仅响应 | 夹具全换 `HENT-…` 文法标识 + 整数版本 + 无回显键；新增 `ENVELOPE_REQUIRED_MISSING`/`_SCHEMA_VERSION_TYPE`/`_OBJECT_ID_GRAMMAR`/`_ECHO_KEY_ON_WRITE` 四个拒写码（P1-7/P1-8） |

## 比审查描述更严重的地方

**P3 的分页 `exhausted` 不只是"返回反了"，而是测试跟着断言了错误语义**。文档给的锚点是"可见 200 条、页长 100 ⇒ 第 1 页 `exhausted=false`、第 2 页 `true`"，而当时的 `page()` 返回 `offset + requested < items.length`（这是"还有下一页"，不是"已耗尽"），P3-6 就照着断言了 `p1.exhausted === true` 并注释"最后一页必须报告无后续"。**一条绿的测试在锁死错误行为**——这比漏测更糟，因为它会说服后来者。现 P3-8 用文档原锚点数字，P3-9 把反向实现作为变异锚点断言其必分歧。

## 我自己在这轮新引入的两个错误（审查没抓到，是我复现时撞上的）

1. **给 `registrant_ref` 套了对象引用文法** → 所有写入被 `REF_PATTERN_MISMATCH` 拒。`registrant_ref` 是宿主注入的 V1 主体（`SD-19`/`RD-35`），不适用 `SF-22`。教训：修一条判据时新写的校验同样需要正反例，否则"修好一个 bug"会伪装成"另一个 bug 消失了"。
2. **引用文法全局扫字符串** → `aliases` 里的 `p:1@1`、邮箱都会被当非法引用。`SF-04` ④ 只作用于**契约声明为引用的槽位**（`SF-26/SF-28` 是引用位的规则）。现由 `reg.refPaths` 声明引用位，并在 P1-8 用自由文本正例反向钉住。

## 新暴露的文档缺口（已回文档）

- **`T-GAP-09`**：`space_id` 全层无文法，而 `SF-04` ② 要求"不可解析即拒写"——validator 判不了。留给 B 与 V1 命名空间一并定。
- **`SS-15a` 补**：第③类回显键**只出现在读响应**；出现在写入信封 = `SF-04` ② 非法。
- **`T-GAP-07` / `T-GAP-08` 已裁决**（PR #47 `e1488910`）：其中 T-GAP-08 我原先写"无合法字段可写"是**没查既有机制**——`CO-V-5` 早已规定后继关系由带来源的 Association 记录承载，不是字段。

## 仍未覆盖（承认，不假装）

审查指出 PoC-3 未覆盖缓存 / 日志 / Agent 上下文的泄漏出口，以及完整 CheckReport 脱敏结构——**属实**。这些需要真实呈现层与宿主上下文，属 B（底层架构）会合后的范围；本 PoC 只覆盖纯函数层的呈现等价。幂等部分现已用 `Idempotency` 覆盖跨"重启"（序列化/恢复）、请求体摘要冲突、前置不匹配不占键，但**没有**真实持久化与事务。PoC 分支也没有 GitHub check run：38→42 项通过只是本地报告，不是 CI 证据。

## 结论

审查的判断我接受：**发现了问题，但还没验证规则可同时成立**——因为当时的一部分绿灯是桩件与测试一起错在同一个方向上。现在的差别是每条判据都有正反例 + 变异锚点，错误实现会红，而不是"看起来对"。

## 第二轮审查（四项）的复现与处置

复现脚本 `.scratch/probe-review2.mjs`（夹具照抄测试文件，只跑桩件），**四项全部成立**：

| 优先 | 审查条目 | 我复现到的实际行为 | 规则原文依据 | 修法与"错误实现必红"负例 |
| --- | --- | --- | --- | --- |
| P0 | 部分可见报告脱敏：隐藏 finding 不同仍可用 `verdict` 区分两个世界 | 世界 A（存储 `INDETERMINATE(WITHHELD_REFERENCE)`）呈现 `verdict=INDETERMINATE`，世界 B（存储 `FAIL(REF_UNRESOLVED)`）呈现 `NOT_ACHIEVED`，`canonical` 不等 | `SCR-51`（两条 finding 合并为**恰一条** `UNVERIFIABLE_REFERENCE`；受影响层 `verdict → UNVERIFIABLE_TO_YOU`）、`SCR-53`（条数 / 原 `rule_id` / 字段名不出现）、`SCR-54`（XC-25 两世界逐字节同形）、`SCR-55`（差异只允许 A/S 这一条边界） | `sanitize()` 重写：`AUDIT` 与 `MASKED` 两档授权类；被屏蔽项按层级合并成一条、层级只剩 `{level, verdict}`；**发生过脱敏 ⇒ 报告级 verdict 不再由可见子集归约**。P3-7 / P3-7b / P3-7c 四个变异体分别对应"保留存储 verdict / 不实现合并 / 每条各产一条 / 保留原 field_path"，逐个断言必分歧 |
| P1 | 合法 `rec:` 来源被拒 | `source_refs: ['rec:HREC-7']` → `REF_PATTERN_MISMATCH`（即合法形态被拒写） | `SF-24`（`rec:${record_id}` 是合法引用形态）、`SS-34`（**来源允许 `rec:`，端点不允许**）、`SS-05` | 引入引用位**类型域** `object / record / either`，逐位取槽位表原文；`carrier_refs=[ref|rec:]`、`availability_checks=[rec:]`、`source=ref?` 三条真实槽位进夹具。P1-8b 三类各有正反例，并把"一条共享文法必在两个方向同时出错"写成反向锚点 |
| P1 | 空集合严重度：规范 `VIOLATION`，桩件 `DEFICIENCY` | `EMPTY_NOT_PERMITTED/DEFICIENCY` | `SF-14`：`FAIL(EMPTY_NOT_PERMITTED, **VIOLATION**)`，但记录照常保存 | 改 `VIOLATION`，并在 P1-3 与**逐字抄自文档的严重度登记表**比对（不是与我的输出比对）；顺带把两个自造码名换成 `SCR-76` 注册的 `NOT_APPLICABLE_UNDECLARED` / `NOT_APPLICABLE_SCOPE_MISMATCH`，补 P1-3b 正反例 |
| P1 | 根世界单例：同 ObjectID 的新修订被判成第二个根世界 | `HENT-w1@r2` → `SINGLETON_SUBTYPE_DUPLICATE/VIOLATION` | 用户 2026-10-29 裁决：单位是同一 ResearchSpace 内的**不同 ObjectID**；同 id 修订不产生第二个单例；撤回/退役不自动释放名额；纠正走显式身份纠正 | `checkSingleton` 改为"排除自身 ObjectID 后统计不同 ObjectID"；P2-02 覆盖 r1→r2→r3 合法、异 id 判重、撤回后仍占位、异 space 无关，并把"按记录条数计数"写成反向锚点（**只有修订那一格能分辨它**） |

### 比审查描述更严重的地方（第二轮）

1. **上一轮的 P3-7 在它声称要验的那条判据上分辨力为零**。它构造的两个世界的**存储 verdict 恰好相同**（都是 `ACHIEVED`），所以"保留存储 verdict"这个缺陷在它面前必然隐身——绿灯覆盖的是另一件事（可见 finding 的过滤），不是同形性。修法不是加断言强度，而是把两世界的存储 verdict 故意构造成不同（`INDETERMINATE` vs `NOT_ACHIEVED`）。
2. **修 `rec:` 时撞出第二个缺陷：嵌套引用位从来没被检查过**。`refViolations` 的旧下钻只在末段处理数组，`v[*].carrier_ref` 取到 `[undefined]`，再被"只检查字符串"的过滤器丢掉 ⇒ 这条判据一条都没执行过，却从未报红。P1-8b 现在把这个空转形态本身写成断言：**"没有 finding"不等于"检查通过"**。

### 我自己新引入 / 遗留的错误（本轮）

- 上面第 2 条是**第一轮重写时我写下的**walker 缺陷，本轮才被抓到，不是审查方指出的。
- 写 P3-8b 时我第一版把"先分页再过滤"的差值写成了自比较（`a !== a + 0`），跑出来才发现是无意义断言；现改成真正可分辨的形式（世界 A 未过滤时 `exhausted=false`、世界 B `=true`）。

## 第二轮新增的文档缺口

- **`T-GAP-10`**：`SF-24` 写 `"rec:${record_id}"`，但 `record_id` 在契约层与本层**都没有文法**（实测 `grep record_id` 只有这一处提及）。因此桩件只能检查"前缀在场 + 后半非空且无空白/斜杠"；自行发明 ID 文法会把合法来源判死，正是本轮 P1 那个方向。留给 B 与 `space_id`（`T-GAP-09`）一并定。
- **`SCR-51` 补一句**：原文只写"若该层级曾受其影响，`verdict → UNVERIFIABLE_TO_YOU`"，没写**报告级** verdict。它其实由 `SCR-54/55` 可推出（两世界必须同形 ⇒ 只能是呈现层取值），但不写明就会让人像我一样保留存储归约值。已在 Check Schema 的 `SCR-51` 内补成显式判据（未新增编号，避免规则面扩面）。

## 仍未覆盖（承认，不假装）

审查指出 PoC-3 未覆盖缓存 / 日志 / Agent 上下文的泄漏出口，以及完整 CheckReport 脱敏结构——**属实**。本轮把呈现层脱敏做到了**判据级**（同形、合并、占位、条数不出现、授权两档），但：

- 没有真实呈现层，所以**缓存键、日志行、Agent 上下文摘要**这三条出口一个都没验；
- 报告结构只到 `{operation, level_results, findings, verdict, boundary}`，`SCR-01…SCR-14` 的完整字段（`target`、`checker`、`env_ref`、`declared_gaps`、逐层 `reason` 封闭集）不在面内；
- **未受影响层级的其它键**本轮不脱敏（例如某层自带的计数类键）。XC-25 的那一对世界里它们取值相同，所以不影响同形判定，但这不等于它们永远不会泄漏——正式实现需要一条"层级键白名单"；**（第三轮更新：这条已被更严的实现消解——`MASKED` 档现在把所有层级一律降为 `{level, verdict}`，计数类键整键不再出现。）**
- **遮蔽发生在不同层级**时呈现会差在"哪一层被遮蔽"上。这是 `SCR-53` 逐层占位设计的直接后果，`SCR-54` 声明的那对世界不含这种情形，我没有把它说成已排除；**（第三轮更新：恒定遮蔽后该差异不存在了——所有层级都降级、都各发一条占位。代价从"泄漏"换成了"信息量"，转记为 `T-GAP-15` 的待裁取舍。）**
- 幂等只到跨序列化/反序列化，**没有**真实持久化与事务；PoC 分支也没有 GitHub check run——下面的绿灯数全是本地报告。

## 验证记录（不写结论只写观测）

| 命令 | 结果 |
| --- | --- |
| `node --test poc/hsr-form/*.poc.mjs` | **47 passed / 0 failed** |
| `pnpm run docs:check` | OK（1192 tracked files） |
| `docs:probe --fail-on-blocking` | exit 0 |
| `pnpm run check:types` | 精确复现 19 条已知债务（身份匹配，非计数匹配） |
| `pnpm run lint` | OK |
| `npx vitest run` × 3 | **2 failed / 0 failed / 1 failed** |
| `npx vitest run tests/git/tc-git-016.test.ts` | 1 passed（隔离通过） |

vitest 三次结果不一致，第 3 次点名的 `tc-git-016` 是**超时 kill 的 mock 用例**（依赖计时），隔离通过。本轮改动只有 `docs/` 3 个文件 + `poc/` 9 个文件，对 `src`/`tests`/`schema`/`scripts`/`package.json` 的改动数是 **0**，因此这些偶发与本轮无因果关系；但我没跑足够多轮把它们的成因定位掉——**记为"未定位的既有计时偶发"，不说成已排除**。

**后补（第二轮定位到的机制，供交叉核对）**：本轮我一度把 `vitest run` 跑出 **46 failed files / 1164 files**，原因是我自己在工作区里 `.scratch/wt42`、`.scratch/wt47` 建了两份 git worktree（完整 checkout），而 `vitest.config.ts` 的 exclude 不含 `.scratch/**`，两份 checkout 的 `tests/**` 全被收编且无 `node_modules`。删掉 worktree 后同一条命令得到 **358 files / 5083 tests、0 failed**（与基线一致）。这只证明"**嵌套 checkout 会污染测试收集面**（缺 `node_modules` 时整片报红）"这一机制成立；上一轮那三次 2/0/1 我没有留下文件数记录，因此**不能断言同一成因**——旧记录仍按原样保留，只标注存在一个已证实的同类污染源。给 B 的一条建议：`.scratch/**` 应进 vitest 与 tsconfig 的 exclude（本 PoC 不改仓内配置）。

## 第二轮验证记录（本轮，不写结论只写观测）

| 命令 | 结果 |
| --- | --- |
| `node --test poc/hsr-form/*.poc.mjs` | **53 passed / 0 failed**（poc1 12、poc2 25、poc3 16） |
| `pnpm run docs:check` | OK（1201 tracked files） |
| `docs:probe --fail-on-blocking` | exit 0（advisory `DOC_IMPACT_UNOWNED`：`poc/*.md` 未登记进 `dev/engineering/doc-ownership.yaml`，该文件人工维护、`docs:sync` 不写） |
| `pnpm run check:types` | 精确复现 19 条已知债务（身份匹配，非计数匹配） |
| `pnpm run lint` | OK |
| 第三轮 `npx vitest run` × 2（收集面正常，364 文件） | 第一次 **3 failed / 5080 passed**；第二次 **1 failed / 5082 passed**；失败点见文末第三轮小节，隔离复跑全部通过 ⇒ 记为不稳定的既有用例，未定位成因 |
| `npx vitest run`（清理后） | **358 files passed / 6 skipped，5083 passed / 21 skipped，0 failed** —— 与登记基线一致 |
| 规则号闭包 | 定义 251 / 被引用 251 / 无定义引用 0（`T-GAP-10` 入表后两侧同步 +1） |

### 本轮自己造出来的假红灯（一次，已定位）

第一次跑 `npx vitest run` 得到 **46 failed files / 1164 files**，`Tests` 却是 0 failed——**全是我自己造的**：
本轮用 `git worktree add .scratch/wt42`、`.scratch/wt47` 在仓库内部建了两份完整 checkout 来避免分支串台，
而 `vitest.config.ts` 的 `exclude` 只排除 `references/**`、`tests/deepseek-harness/**`、`tests/dsh-homes/**`，
**不排除 `.scratch/**`**，于是两份 checkout 的 `tests/**` 全被收编，且它们没有 `node_modules` 而整片报红。
`git worktree remove` 两个目录后重跑即得基线数字。

- 对上一轮"未定位的计时偶发"是否同一成因：**不能确认**。上一轮三次跑报的是 364 文件面下的**测试级**失败（2/0/1 条），
  这次是**文件收集级**（46 个文件），签名不同；只登记机制已被证实，不把解释硬套到旧记录上。
- 可复用结论：**任何嵌套 checkout 放进本仓工作区都会污染测试收集面**（`AGENTS.md` §2 为 DSH checkout 立这条排除，
  同一条约束对 `.scratch/` 下的临时 worktree 同样成立）。本轮之后 worktree 一律建在仓库外，或建前先确认收集面。

---

## 第三轮（联合审查内联的两项读码反例）的复现与处置

审查口径：可以进入详细代码设计；PoC 足以支持设计，但**不能作为完整 Validator 的验收**，也不能作为脱敏实现的安全认证。
两项反例我照抄其构造复现（`.scratch/probe-review3.mjs`），**两项全部成立**：

| 优先 | 条目 | 我复现到的实际行为 | 依据 | 修法与负例 |
| --- | --- | --- | --- | --- |
| P1 | `MASKED` 档呈现仍有存在性差异：可见集相同、隐藏 0 条 vs 1 条 | 世界 A（无额外隐藏项）呈现 `verdict=ACHIEVED`、findings 1 条；世界 B（多 1 条隐藏）呈现 `UNVERIFIABLE_TO_YOU`、findings 2 条 ⇒ 字节不同 | `SCR-55` 字面禁止"按被遮蔽项数量改变数组长度"；与 `SCR-51/53` 的逐层合并冲突已登记 `T-GAP-15` | `sanitize()` 的 `MASKED` 档改为**只依赖授权类 + 报告自身层级结构**：层级 verdict 恒 `UNVERIFIABLE_TO_YOU`、每层恒发一条固定占位、报告级 verdict 恒定。`P3-7d` 断言 **0 / 1 / ≥2 三态逐字节同形**，并把第二轮的实现写成反向锚点——它在"1 vs 2"同形、在"0 vs 1"分歧，正好证明旧用例给不了这条分辨力 |
| P1 | 信封第②类状态槽位不做封闭键集校验 | 审查夹具 `{@st:'UNKNOWN', reason:'NOT_SURVEYED', v:['secret']}` 放行进信封且零 finding；**同一形态放进载荷被拒写** `STATE_KEYS_OUT_OF_RANGE`。附带三格同样漏：`ABSENT` 带 `reason`、标签越界 `PENDING`、`UNKNOWN` 缺 `reason` | `SF-17` 的键集封闭 + `SF-04` ⑤（判据不区分位置） | `ingest` 对 `CLASS2` 逐个跑与载荷**同一套**判据（标签越界 → `STATE_TAG_OUT_OF_RANGE`，键集越界 → `STATE_KEYS_OUT_OF_RANGE`）。`P1-8c` 断言：审查夹具拒写、**同一形态在信封与载荷得到同一个码**、六种漏法各自钉住、五种合法形态不得误杀，并把"只查 `@st` 在场"的旧实现写成反向锚点 |

### 这两条为什么从我的绿灯里漏过去（机制层面的原因，不是运气）

1. **边界格没进配对**。第二条 P0 我修的是"隐藏条数泄漏"，配对的构造是"隐藏 1 vs 隐藏 2"——两条**都发生了遮蔽**，所以"是否发生遮蔽"这个变量被配对的构造方式固定住了。审查把 0 条放进来才暴露：**判据的边界在 0，我把配对放在了 1 和 2**。同类错误我在同一份文件里已经记过一次（上一轮的 P3-7 两个世界存储 verdict 恰好相同），两轮的形式不同、成因相同：**用相邻的两个非边界取值配对，然后把绿灯读成判据已被覆盖**。
2. **机制按位置逐个接入，检查却按"机制已实现"记账**。`STATE_KEYS_OUT_OF_RANGE` 早在载荷侧就跑着，我在记录里把它当成"SF-17 已实现"，于是信封侧的漏接在文档、测试、报告三处都不存在。**一条判据的实现状态应当按"它在哪些位置生效"记录，而不是按"这个机制有没有写"**——这也是本轮把它登记成"跨位置完备性"准入测试的原因。

### 本轮新增/改动的文档（都在 #47）

- `T-GAP-15`：`SCR-55`（禁止被遮蔽数量影响数组长度）与 `SCR-51`/`SCR-53`（按被屏蔽层级替换占位）在"隐藏 0 vs 1"上要求不同；桩件取**不泄漏的一侧**（过脱敏），待裁是否允许"未受影响层级保留 verdict"。
- `SI-16a` + 三处原"由 `object_id` 导出"的改写：修订类调用的空间由**可信调用上下文**确定，只在该空间内解析 `object_id`，禁止全空间扫描、禁止全局 `object_id→space` 路由索引、解析不到时与"不存在"完全同形（`SI-22a`/`SI-33`）。够用性写进条文：`SI-10` 已禁止跨空间目标引用。
- `T-GAP-11`～`T-GAP-14`：修订类签名冻结的前置条件、候选载荷的检查目标身份、`epoch_ms → CommitSequence` 映射、V1×V3 历史权威过渡的顺序。
- §5.2 新增两条**准入测试**（本轮两个反例的正式去向）：呈现面"隐藏 0/1/≥2 三态同形"、五态封闭键集"跨位置完备性"。

### 仍未覆盖（第三轮口径）

- **过脱敏的代价没被度量**：`MASKED` 档现在连未受影响的层级也不给 verdict。不泄漏，但呈现更有信息量的方案（`T-GAP-15` 的另一侧）我没证明它可实现，也没证明它必要。
- 缓存 / 日志 / Agent 上下文三条出口、完整 `CheckReport` 字段、真实持久化与事务：仍未验（审查判定这些属 B 会合后的范围，本 PoC 不预做）。
- 信封侧我只补齐了**第②类**槽位的五态判据；第①类（结构类）各键的**类型**判据仍是逐键手写的四条检查，不是由 §5.2 那张"机器可读必填表"驱动——正式实现必须由表驱动，否则新增信封键又会漏。
- PoC 分支仍无 GitHub check run；下面所有绿灯都是本地报告。

### 第三轮验证记录（只写观测）

| 命令 | 结果 |
| --- | --- |
| `node --test poc/hsr-form/*.poc.mjs` | **55 passed / 0 failed**（poc1 13、poc2 25、poc3 17） |
| `pnpm run docs:check` / `docs:probe --fail-on-blocking` | OK（1201 tracked files）/ exit 0 |
| `pnpm run check:types` / `pnpm run lint` | 精确复现 19 条已知债务 / OK |
| 规则号闭包 | 定义 257 / 被引用 257 / 无定义引用 0（`SI-16a` + `T-GAP-11…15`） |
| 环境纪律 | 本轮试把 worktree 建在 `/tmp` 下，**被沙箱回收**（跨命令不持久），故改用主工作区单分支切换；跑门禁前 `git worktree list` 确认只剩主工作区，vitest 收集面 364 文件未变 |

**vitest 两条观察（不作排除性断言）**：第一次全量 3 条失败——`tests/current-focus/rpc-face.test.ts`（注入时钟下限：store stamp 早于 service clock floor）、`tests/g5-real-registry/workflow.test.ts` step 12（`history_query` 回放序列）、`tests/rpc-plane/hub-overview.test.ts`（`expected 29147 to be less than 10000` 的耗时上界）；第二次全量只剩 g5 那一条。单独复跑：g5 15/15 通过；把第一次那三个文件一起跑时，前两条通过、同文件内**另一条**失败 ⇒ **失败集合本身不稳定**。本轮改动面是 `docs/architecture` 2 文件 + `poc/` 5 文件，与这三个模块零交集；但**我没跑够轮次定位成因，因此只记观测、不说已排除**。
