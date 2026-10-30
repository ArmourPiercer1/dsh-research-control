# RE-REVIEW-G3-A —— d674f14 独立复验（包 3：N1 / D-25 / N3）第三轮攻击席报告

- **审查席**：G3-A（独立攻击席，非作者）
- **被审提交**：`d674f145c598b5df055e296d7e1b483041838140`（`poc/v3-code-architecture-poc`，包 3）
- **方法**：`git worktree`（`.scratch/wt-g3a`，审毕已删）上跑 `tsc` / 作者套件 / `g0-gate` 三基线，
  再落审查方攻击文件 `attacks/review/g3a-*.test.ts` 实测；全程未改作者面
  （`src/**`、`tests/**`、`g0-gate.mjs`、作者/审查方既有 attacks 文件）。
- **基线实测（先跑再攻）**：`tsc` 0 错；作者套件 **155 例全绿**（与提交题述一致）；
  `g0-gate` 原样 **PASS**（32 条已知红与基线完全相等）。
- **纪律声明**：本报告所有「成立」都是**实测**（附测试名与断言），不是推理；
  所有攻击文件源码全文内嵌 §附录，worktree 销毁后仍可逐字复跑。

---

## ① 结论行（逐项裁定 + 定级）

| 项 | 裁定 | 定级 | 一句话依据（细节见 §②③） |
|---|---|---|---|
| **N1 原攻击类**（载荷自称 `authorization:'AUTHORIZED'` 翻转 ADOPTED） | **已修** | — | 权威通道见证由机制生成、入参无此字段；载荷夹带被无视（A2-4 复绿）；未持轴主体新写不计入、撤销历史不重解释（A5-1 复钉绿） |
| **N1 残留：授权轴名自声明**（①，父席入账为「N1 部分修·残留」） | **残留成立** | **P1**（按作者自家威胁模型——它自己把清单当攻击者输入：n1 测试的 `evilManifest`+`ACTIVATION_IMPOSSIBLE` 兜底即证据；同尺只验「缺轴」未验「轴值」） | 恶意清单 `requiresAuthority:'space-write'` ⇒ 只有写权的主体取证**平凡通过**，见证 `{axis:'space-write',authorized:true}` 落库（A1-1/A1-3 绿）；注册判据（kernel.ts L98-112）对轴值**零判据** |
| **D-25 单进程** | **已修** | — | 既有 face/writer 实例在停用后被拒——判据在调用时查 registry，不在构造时（C-1 绿）；停用窗口 `eventsOf` 读面仍开放=观察项（判据只承诺写面） |
| **D-25 跨进程/文档相符性** | **不符** | **P2（文档与机制不符）** | 进程 B 停用 `CAP_RECORDS` 后，先启动的进程 A（同文件）**仍能签发**（实测 `NO_REFUSAL`），A `restart()` 后才 `CAPABILITY_INACTIVE`。机制真实行为=查**本进程内存 registry**；CONTRACTS「查 capability_route 生效路由」表述超前（父席已认领自改该句） |
| **N3 门 1（源码级）** | **未修（门被打穿）** | **P2**（既有代码零命中属实，但「结构性防复发」承诺不成立） | `constructor(tag = ")", private readonly face)`——默认值字符串里未配对右括号把括号配对扫描截断，修饰符在截断点之后 ⇒ 合法 TS、运行时泄漏、门 1 漏检（N3b 绿） |
| **N3 门 2（运行时级）** | **未修（门被打穿）** | **P2** | getter 访问器（descriptor 无 `value` 被 `'value' in d` 过滤跳过）、一层包装对象 `{bundle:{face}}`（`callableSurface` 不下钻）均失明；Symbol 键能抓住（N3e/N3f/N3d 绿） |
| **N4（tx 原型残留）** | **未修未恶化** | **P2**（沿上席） | `reassignRouteInternal` 仍在 `UnitOfWorkImpl.prototype`（N4-1 绿）；方法体判据兜底有效 |
| **N5（文件级崩溃吸收）** | **未修** | **P2**（沿 G2-A） | `g0-gate.mjs` 不在本包改动文件内（`git show --name-only` 证实）；吸收形态本席在 d674f14 **实测重放**：1 条已登记红 + `afterAll` 抛错 ⇒ 门禁仍 PASS、失败集一字不变（§③-GT 复现） |
| **GT-2（红条断言可掏空）** | **仍开** | **P2** | 本席实测重放：canary 红断言换成恒假式（名字不动），同基线复检「完全一致」PASS |
| **GT-3（自洽重算洗绿）** | **仍开** | **P2** | 本席实测重放：含全部 g3a 攻击文件的自洽重算基线（167 总/36 红/131 绿）⇒ 门禁 PASS——攻击者改完 attacks 跑一条重算即绿 |
| **GT-4（作者测试静默缩水）** | **仍开** | **P2** | `AUTHOR_MIN_PASSED=90` vs 实际 155 ⇒ **65 例（≈42%）可静默蒸发**；g0-gate.mjs L34 注释仍写「当前 95 例」（陈旧锚点）；门文件未动 |
| **新增 N6：授权判据表原型链查表（完整性）** | **新洞** | **P1** | 见 §③-N6，插件可达 |
| **新增 N7：`'__proto__'` 毒行永久崩读者（可用性）** | **新洞** | **P1** | 见 §③-N7，插件可达（需持轴签发或无见证历史行） |
| **新增 N9：`INSERT OR REPLACE` 绕触发器改写历史行** | **新发现（运维/纵深）** | **P3** | SQLite 语义：REPLACE 的隐式删除只在 `recursive_triggers=ON` 时触发 DELETE 触发器（默认 OFF）；端口未开 ⇒ 同 seq 整行静默替换。可达面=装配裸面/运维（插件句柄拿不到 raw），非越权；一行 `PRAGMA recursive_triggers=ON` 即封（§③-N9） |

**总判**：包 3 对 N1 原攻击类与 D-25 单进程判据是**真修**（独立复钉绿，不是 pin 修好形状）；
但它**新引入**了两个插件可达的 P1（N6/N7——都在新增的授权判据表 `FACT_STANDING_RULES` 裸下标查表上），
① 的轴值残留按作者自家尺子记 P1，N3 两道门均被打穿（按未修记），门侧四项（N5/GT-2/3/4）
经实测确认**一字未动**。

---

## ② 攻击矩阵（逐条：尝试 / 预期 / 实测 / 成立 / 证据）

> 「成立」=攻击假设被实测证实。测试名可在 §附录源码逐字对上；复跑命令 §③-R。
> 证据路径省略前缀 `experiments/v3-code-architecture-poc/`。

| # | 尝试 | 若洞在应看到 | 实测 | 成立 | 证据 |
|---|---|---|---|---|---|
| A1-1 | 恶意清单把 `requiresAuthority` 声明为 `space-write`，无业务轴主体经正当通道签发 | 见证 `authorized:true`（写权=授权） | `[{authorized:'true',axis:'space-write',cap:'cap.g3a.evil'}]`；对照正当域同主体 `false` | **成立** | `g3a-attacks.test.ts` A1-1；kernel.ts L98-112（无轴值判据）、L865-874（evidence.axis=清单声明值） |
| A1-2 | 重复登记同型事件换轴 / 空白轴字符串 | AMBIGUOUS / 登记面兜底 | 重复=`AMBIGUOUS_AUTHORITY`；轴=`' '` 通过登记（取证恒 false，fail-closed 方向可接受） | 成立（登记面「值」零判据的边界证明） | A1-2；kernel.ts L100 |
| A1-3 | 轴声明为 `capability-admin`，只有运维轴的主体签发 | 见证 true | `[{authorized:'true',axis:'capability-admin',…}]` | **成立** | A1-3 |
| A2-1 | 装配裸面插**形状合法的伪造见证**（capability 张冠李戴）+ v3 载荷 | 读投影不核对 ⇒ ADOPTED | `ADOPTED` | 成立（读侧不核 axis/capability 一致性；可达面=裸面/运维） | A2-1；kernel.ts L955-967（parseAuthorityBasis 只验形状） |
| A2-2 | 裸面 v3 行 + 见证 `{authorized:true, capability:'cap.some.other'}` | 计入 | 计入 | 成立（同上——**语义**伪造被全信） | A2-2 |
| A2-3 | `'constructor'` 判据键（当时经裸面） | rule=Object ⇒ 真值 | `ADOPTED`（无 designationSchema 也计入） | 成立 → 升级为 N6 | A2-2/A2-3；插件可达版 Q2-1 |
| A2-4 | 插件通道入参夹带 `authority_basis` 字段 / 通用通道写正式型 | 机制无视/拒 | 见证仍 `false`；通用通道 `EVENT_AUTHORITY_REQUIRED` | 反例（N1 通道判据真） | A2-4 |
| A2-5 | UPDATE / DELETE / UPSERT-DO-UPDATE / **INSERT OR REPLACE** 打历史行 | 全拦 | 前三条 `HISTORY_IMMUTABLE`；**REPLACE 静默改写整行 ⇒ 投影翻 ADOPTED** | 成立 → N9 | A2-5；sqlite-port.ts L35-38（只有 upd/del 触发器）、无 `recursive_triggers` PRAGMA |
| A5-1 | 撤销×历史双方向独立复钉 | 历史计入；新写不计入 | 两向复绿；附带钉死「撤销后连撤回都撤不动」单向门 | 复钉成立（作者主张真） | A5-1 |
| A5-2 | 撤销 × v2 历史伪造行 | 永久计入 | 永久计入；机制内救济需重新授予轴 | 复钉成立（已登记对称代价） | A5-2 |
| C-1 | unload 前构造的 writer/face 实例，unload 后复用 | 动态拒 | 旧事务句柄 `TX_CLOSED` 先兜住；新事务用既有 face ⇒ `CAPABILITY_INACTIVE`；`readOwn` 拒；**`eventsOf` 不拒** | 判据真（构造时≠调用时）；读面=观察项 | C-1；kernel.ts L499-528（eventsOf 闭包不查激活） |
| C-2 | unload→load 后再签发，比对停用前后见证 | 轴/能力一致 | 两行见证一字不差 | 复钉成立 | C-2 |
| C-3 | transferRoute 后轴归属 | 轴不随清单变 | 新旧见证 axis 均 `domain-admission` | 复钉成立（A.4 组合关闭） | C-3；kernel.ts L161（formalEvents 账本） |
| D25-MP | 双世界同文件：B 停用后 A 的签发 | 拒（若真查持久路由） | **`NO_REFUSAL`**；A.restart() 后才 `CAPABILITY_INACTIVE` | **成立**（文档不符） | `g3a-d25-mp.test.ts`；kernel.ts L280-305/L380-405（内存视图判据；enabled 只在停用进程+新进程生效） |
| N4-1 | `reassignRouteInternal` 原型可见性 | 仍在但被兜底 | `AUTHORITY_REQUIRED` 拒，方法仍在原型 | 未修未恶化 | N4-1；kernel.ts L1274 |
| Q2-1 | **插件可达面**落 `policyVersion:'constructor'`（无 designationSchema） | 落库+ADOPTED | `STORED` + **`ADOPTED`**（v3 全部形状判据被 rule=Object 跳过，issuer 字段被无视） | **成立 → N6 (P1)** | `g3a-q2-prototype.test.ts` Q2-1；test-records.ts L357（裸下标查表） |
| Q2-2 | 未持轴主体同载荷 | ？ | 落库成功但见证 false，**见证优先闸先拦** ⇒ 不计入也不崩 | 反例（「①⇒未授权ADOPTED」组合链**不成立**——父席预测被实测推翻，见 §③-N6 注） | Q2-2；test-records.ts L349-357 |
| Q2-3 | 插件可达落 `'__proto__'` 毒行（持轴签发） | standingAt 崩 | `TypeError` 直冲读者；**再写正当 v3 WITHDRAWN 仍崩**；`eventsOf` 幸存 | **成立 → N7 (P1)** | Q2-3 |
| Q2-4 | `'toString'` 键（可调用+真值串） | 计入 | `ADOPTED` | 成立（N6 同族第三键） | Q2-4 |
| Q2-5 | 尾随空格/大小写/非串键变体 | miss fail-closed | 三条全 `NOT_ADOPTED` | 反例（攻击面=那一把裸下标本身） | Q2-5 |
| N3b | 门 1 扫描器喂 `constructor(tag = ")", private readonly face)` 等三形态 | 应抓 | **三形态全漏**（字符串未配对右括号截断参数表） | **成立**（门 1 打穿） | `g3a-n3-gate-attacks.test.ts` N3b（判据逻辑逐行复制自 tests/n3-parameter-property-gate.test.ts L41-83） |
| N3c | 门 1 对 `Object.defineProperty` 注入形态 | 天然失明（由门 2 兜） | 失明（门 2 也漏，见 N3e） | 成立 | N3c |
| N3e | 门 2 `runtimeLeaks` 对 getter 访问器 | 应抓（运行时 `.face` 可走） | `[]`（`'value' in d` 过滤跳过 accessor），运行时 `inst.face === face` | **成立**（门 2 打穿） | N3e；tests/n3-parameter-property-gate.test.ts L159 |
| N3f | 门 2 对 `{bundle:{face}}` 一层包装 | 应抓 | `[]`，`inst.bundle.face` 可走 | **成立** | N3f；callableSurface 只查值本身+直接原型（L144-151） |
| N3d/g | Symbol 键泄漏 / Proxy ownKeys | 抓 / 理论上限 | Symbol **抓到**；Proxy 失明（记理论形态） | 混合 | N3d/N3g |
| GT-2 | canary 红断言掏空成恒假式，同基线复检 | 若只比名字 ⇒ 一致 | 「与基线完全一致（36 条）」PASS | **成立**（重放） | §③-GT |
| GT-3 | 含 g3a 攻击文件的自洽重算基线 | 洗绿 | `167/36/131` 重算 ⇒ 门禁 PASS | **成立**（重放） | §③-GT |
| N5 | 1 条已登记红 + `afterAll` 抛错的吸收形态 | 门禁仍绿 | 失败集一字不变，门禁 PASS | **成立**（在 d674f14 重放） | §③-GT |
| GT-4 | floor 静默窗口 | — | 90 vs 155 = 65 例（≈42%）静默窗口；L34 注释停在「95 例」 | 成立（算术+文件未动） | g0-gate.mjs L34 |

---

## ③ 新发现（含最小 repro）与复现

### N6（P1·完整性）授权判据表原型链查表——插件可达面把任意畸形行写成权威采纳

**机制**：`test-records.ts` L357 `const rule = FACT_STANDING_RULES[p.policyVersion];`——
`FACT_STANDING_RULES` 是 `Object.freeze({...})` 的普通对象字面量（L328），**`Object.freeze` 不封原型链**。
`policyVersion` 在 **payload** 里，payload 由插件经 `appendAuthoritativeEvent` 原样写。于是：

- `policyVersion:'constructor'` ⇒ `rule === Object`（真值、可调用）⇒ `rule(p,…)` 返回真值对象 ⇒
  **designationSchema 校验、policyVersion 字面相等、issuer===actor 三道 v3 形状判据整体被跳过**；
- `'toString'` 同族（返回 `"[object Undefined]"` 真值串）；
- 落库通道 = 插件可达（`faceFor(CAP_RECORDS)→writerFor→appendAuthoritativeEvent`），**无需任何装配面**；
- **前提修正（重要）**：它放过的不是「未授权者」——未持轴主体的行被**见证优先闸**（L349-357，先于查表）
  以 `authorized:false` 拦下（Q2-2 实测，不计入也不崩）；①的平凡轴也套不进来（轴按 eventType 绑在
  formalEvents 账本，同型事件重复登记被 `AMBIGUOUS` 拒）。**父席上一轮预告的组合链
  「③ 会因 ① 一并满足 ⇒ 未授权 ADOPTED」被本席实测推翻**，如实入档。真实危害 =
  **授权主体（含日后泄露的一个合法主体）可把任意畸形行铸成权威结论，v3 的形状锁对其完全失效**。

**最小 repro**（全文在附录 `g3a-q2-prototype.test.ts`）：
```ts
pluginIssue(w, ADM, { stance:'ACCEPTED', issuer:'q2adm', policyVersion:'constructor' }, oid); // STORED
expect(standingOrThrow(w, oid)).toBe('ADOPTED'); // 实测绿——连 designationSchema 都没有
```

**修法（父席已认领实施，本席给出验收探针）**：查表前 `Object.prototype.hasOwnProperty.call(FACT_STANDING_RULES, p.policyVersion)`，
命中值再形状校验（`typeof rule === 'function'` + 登记时形状），**禁 `in`、禁裸下标真值**。
验收用附录 FIXPROBE-1/2/3（现状 3 红）+ FIXPROBE-4（对照组恒绿，防修法误伤）：**落地前必红、落地后转绿**。

### N7（P1·可用性）`'__proto__'` 毒行 = 读者永久崩，无机制内自愈

`FACT_STANDING_RULES['__proto__'] === Object.prototype`（真值、**不是函数**）⇒ L358 `rule(p,…)` 直接
`TypeError` 直冲读者。插件可达（持轴签发，或历史无见证裸行）；**standingAt 扫到毒行即崩**，
再写正当 v3 WITHDRAWN 也救不回（毒行仍在扫描路径上），账本触发器不可删改 ⇒ **对该对象永久 DoS**。
爆炸半径缩小（实测）：`eventsOf` 只解析 `authority_basis` 列不查判据表 ⇒ **插件读面幸存**；
崩的是 standing 消费面（应用层 standing 用例/装配读面）。未持轴主体写毒行被见证优先闸拦（不崩）。
修法等 N6（hasOwnProperty 后 `__proto__` 自然 miss ⇒ fail-closed 不计入），FIXPROBE-2 为验收探针。

### N9（P3·运维/纵深）`INSERT OR REPLACE` 绕过触发器静默改写历史行

SQLite 官方语义：**REPLACE 冲突消解的隐式行删除，仅当 `recursive_triggers=ON` 才触发 DELETE 触发器**
（默认 OFF；`sqlite-port.ts` L217-219 只开 wal/busy_timeout/foreign_keys）。实测（A2-5 + 最小复现）：

```sql
-- 经装配裸面（w.raw.run，普通 SQL 路径）：
update/delete …                          ⇒ HISTORY_IMMUTABLE（拦）
insert … on conflict(seq) do update …    ⇒ HISTORY_IMMUTABLE（拦，UPDATE 语义）
insert or replace into ledger(seq,…) …   ⇒ **成功**，整行静默替换，投影随即翻 ADOPTED
```

可达面=装配裸面/运维（插件句柄拿不到 raw），不构成越权；但「触发器保证行不可改」这一**存储层支点**
在一条普通 SQL 形态下失效。一行修：开库处 `pragma recursive_triggers = on;`（实测拦下 REPLACE）。
建议同时在 guard 面把 `insert or replace`/`on conflict do update` 登记为关注形态（guard 现状只禁 DDL/PRAGMA/ATTACH，不禁这类 DML）。

### ①-残留（P1）轴值零判据的注册面（父席入账「N1 部分修·残留」）

证据与 repro：A1-1/A1-3（§②）。修法：注册判据补 `e.requiresAuthority !== 'space-write' && e.requiresAuthority !== 'capability-admin'`
（Kernel 已持有 `MechanismResource` 字面量，零业务知识可实现）。**注意本席对 ① 与 N6 组合链的实测否证**（§③-N6）。

### D-25 跨进程（P2·文档与机制不符）

```
[D25-MP verdict] stale-process append => NO_REFUSAL; after-restart => CAPABILITY_INACTIVE
```
机制真实行为：写路径判据查 `registry.caps`（进程内存）；持久列 `capability_route.enabled` 只在
「执行停用/启用的进程」+「之后新启动的进程」生效。CONTRACTS「查 capability_route 生效路由」应改写为该真话
（父席已认领）。PoC 支持面内（单进程）判据自洽成立。

### 观察项（不另定级）

- 停用窗口 `eventsOf` 读面仍开放（C-1）：D-25 判据只承诺写面，记录为设计边界；
- 撤销后「撤销自己旧声明」的不可能态（A5-1）：ADOPTED 成单向门直到重授轴，运维含义已在 CONTRACTS 语境，钉为已知；
- `sqlite-port.ts` L172/L214 参数属性在门 1 扫描面（`src/domains`+`src/app`）之外——storage 装配层，
  不可达插件面，但若日后扩面会现形（N3 附带记录）。

### GT / N5 最小复现（命令原样可贴；未新写框架）

```bash
# 前置：干净 worktree @d674f14 + 装好依赖。以下在 worktree 根。
mkdir -p .scratch-g3a

# GT-3（自洽重算洗绿）：跑 attacks 收集 JSON，按门禁同款逻辑重算基线（含审查方自己的新文件）
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks --reporter=json > .scratch-g3a/attacks.json 2>/dev/null
node -e '/* 用 g0-gate 的取集逻辑重算 failures/passes/total，写 .scratch-g3a/baseline-before-gut.json，
           generated_from_commit 填 d674f14…（完整脚本见本文 §附录 GT 注） */'
node experiments/v3-code-architecture-poc/g0-gate.mjs --baseline .scratch-g3a/baseline-before-gut.json
#   → [3/3] OK —— 与基线完全一致（36 条已知红）⇒ 含攻击者自加文件的基线照样绿（GT-3）

# GT-2（掏空红断言仍匹配）：把 g3a-gt-probe.test.ts 里红断言换成恒假式（名字不动）再跑同基线
#   → 仍「与基线完全一致」PASS（本席实测）

# N5（吸收形态重放）：在已含 1 条登记红的文件尾加 afterAll(() => { throw … })
#   → 失败集一字不变（36/36），门禁 PASS ⇒ 清理期崩溃被已知红吸收（g0-gate L61-67 判据的 reds===0 盲区）

# GT-4（静默窗口算术）：
grep -n "AUTHOR_MIN_PASSED" experiments/v3-code-architecture-poc/g0-gate.mjs
#   → L34: 90（注释仍「当前 95 例」）vs 实测作者通过 155 ⇒ 65 例 ≈42% 静默蒸发窗口
```

### `git diff --numstat` 两态证明（生产面确有改动，非「测试追认」）

```
$ git show d674f14 --numstat   （节选）
72  17  CONTRACTS.md            4  4   READINESS.md
16  8   src/app/intake-use-case.ts    12 5 src/app/standing-use-case.ts
26  3   src/contracts/index.ts        8  5 src/domains/test-facet.ts
68  23  src/domains/test-records.ts   109 20 src/kernel/kernel.ts
10  1   src/storage-sqlite/sqlite-port.ts
303 0   tests/n1-authorization-evidence.test.ts   225 0 tests/n3-parameter-property-gate.test.ts
```
生产源 249 增 / 60 删；**`g0-gate.mjs` 与 `attacks/BASELINE.json` 不在改动列表**（门侧四项未动，`git show --name-only` 复核）。

---

## ④ 逐 hunk 裁定（40 hunks 分组）

| 文件（hunks） | 裁定 | 理由/链接 |
|---|---|---|
| `src/kernel/kernel.ts` 10 hunks：imports/registry 注释/register 判据（L98-112）/formalEventAuthority(L161)/faceFor+eventsOf(L456-528)/PluginFace 注释/principalCan(L569)/writer 判据②③（L824-891）/insert 见证（L881-891）/parseAuthorityBasis+TX 终结（L946-977） | **收下** | N1 通道与 D-25 动态判据实现与契约一致（§② A2-4/C-1/C-3 实测复钉）。两处带注：① 轴值零判据（→N1 残留 P1）；② parseAuthorityBasis 只验形状不核 axis/capability 一致性（裸面语义伪造不可辨——已按对称代价登记）；③ eventsOf 不查激活（观察项） |
| `src/contracts/index.ts` 2 hunks（AuthorityEvidence 新类型 + ownsEventTypes.requiresAuthority） | **收下** | 形状正确；注释「只有机制能写」实测为真（A2-4） |
| `src/domains/test-records.ts` 6 hunks（manifest 轴登记/判据表 L328-346/见证优先闸 L349-357/命令 Port v3 化/standingAt/载荷注释） | **收下（带 N6/N7 挂账）** | 见证优先闸与 fail-closed 语义都是真实现（A2-4/A5 实测）；但 L357 裸下标查表 = N6/N7 两个 P1 的宿主行 |
| `src/app/intake-use-case.ts` 4 + `standing-use-case.ts` 1 + `test-facet.ts` 2 hunks（参数属性→`#` 私有字段 + 委托） | **收下** | 四次同课教训的生产侧落实；门 2 实例级实测无泄漏（n3 门运行时流绿 + 本席 N3d 对照）。注：门自身可被打穿不否定这些改动本身 |
| `src/storage-sqlite/sqlite-port.ts` 2 hunks（authority_basis 列 + SCHEMA_VERSION 5） | **收下（带 N9 挂账）** | 列/版本/无隐式迁移纪律对；「触发器保证行不可改」在 REPLACE 形态下不成立（N9，一行 PRAGMA 修） |
| `tests/n1-authorization-evidence.test.ts`（+303 新） | **收下** | 非 pin 修好形状：A5/C-2/C-3 独立 fixture 复钉同语义；伪造见证探针只测了 v99 形状——v3 形状语义伪造（本席 A2-1/A2-2）是其盲区，不构成假绿（方向仍 fail-closed 时绿），但登记 |
| `tests/n3-parameter-property-gate.test.ts`（+225 新） | **部分收下** | 既有代码扫描零命中属实、变异锚点有效；但两门自身均可打穿（N3b/N3e/N3f），「结构性防复发」表述超前 ⇒ N3 按未修记 |
| `tests/formal-event-authority.test.ts` 2 hunks | **收下** | 与包 2 判据改动一致（本席 C 系列独立复绿） |
| `tests/use-case-write-path.test.ts` 1 hunk | **收下** | 构造签名跟进 |
| `CONTRACTS.md` 3 hunks（§16.2 判据 ③/见证列/投影信任模型/v2 残留在登记） | **收下（带两处认领改）** | v2 伪造遗留的登记诚实；两处与机制不符：「查 capability_route 生效路由」（D-25 跨进程，父席认领）与触发器支点表述（N9 语境），建议一并改 |
| `READINESS.md` 1+1 hunks | **收下** | 计数与实测一致（155） |
| `KERNEL_SURFACE.sha256` 1 hunk | **收下** | 哈希更新随 principalCan 新导出；面清单展开核对列入 §⑤ |

---

## ⑤ 未能验证清单（边界如实）

1. **真·双 OS 进程**并发（常驻 + WAL 写者竞争时序）——D25-MP 用双 `World.open` 同文件代理，进程边界
   的调度/重启时序未穷尽；
2. **装配裸面的更深层**：`PRAGMA writable_schema`、ATTACH 外库、sqlite3 CLI 直改文件——超出「正常 SQL
   路径」约定面，本席只证明到普通 SQL 形态（含 REPLACE，N9）；
3. **KERNEL_SURFACE.sha256 的面清单逐项**是否已把 `principalCan` 列入——只核对了哈希行变更，未展开清单
   （sha 值变更本身与 `git show` 一致）；
4. **v4→v5 真实升级库**行为——PoC 纪律是空库才建表 + `SCHEMA_UPGRADE_REQUIRED` fail-loud，作者测试有
   覆盖声明，本席未在真实 v4 文件上复跑升级器路径；
5. **GT-4 的整批删除演示**（G2-A 已实测 47 例删除门仍绿）——本席只做了「文件未动 + 90/155 算术窗口」，
   未再删副本重放；
6. **`eventsOf` 停用窗口读面**是否构成对某类部署的信息泄露——判据只承诺写面，未定义读面语义，未定级；
7. 多 Space（跨空间同库）形态下的轴/账本隔离——本轮攻击面未触及（无既有主张）。

---

## 附录：攻击文件全文（worktree 销毁后逐字复跑）

**复现总命令**（主仓根）：

```bash
git worktree add .scratch/wt-g3a d674f14
cd .scratch/wt-g3a && pnpm install && mkdir -p experiments/v3-code-architecture-poc/.tmp
# 把下面 4 个文件原样写入 experiments/v3-code-architecture-poc/attacks/review/ 后：
npx vitest run --config experiments/v3-code-architecture-poc/vitest.config.ts \
  experiments/v3-code-architecture-poc/attacks/review/
# 预期：g3a-attacks 14 绿；g3a-q2-prototype 6 绿 3 红（红=FIXPROBE-1/2/3，修法落地转 4 绿）；
#      g3a-n3-gate-attacks 8 绿；g3a-d25-mp 1 绿（verdict 行打印 NO_REFUSAL）。
# 审毕清理：git worktree remove --force .scratch/wt-g3a
```

**FIXPROBE 移植说明（父席指定验收）**：把附录文件 `g3a-q2-prototype.test.ts` 中
`describe('FIXPROBE …')` 四条整体移植进 `tests/`（import 路径 `../../src/…` 改 `../src/…`）——
**修法前应 3 红 1 绿（FIXPROBE-4 对照组恒绿），修法落地后 4 绿**。这是对 N6/N7 修法的严格前后对照锚。

### GT 重算脚本原文（§③-GT 省略处）

```js
const fs = require("fs");
const out = fs.readFileSync(".scratch-g3a/attacks.json", "utf8");
const j = JSON.parse(out.slice(out.indexOf("{")));
const REPO = process.cwd();
const failures = [], passes = [];
for (const f of j.testResults ?? []) {
  const name = f.name.replace(REPO + "/", "");
  for (const a of f.assertionResults ?? []) {
    if (a.status === "failed") failures.push(name + " > " + a.fullName);
    else if (a.status === "passed") passes.push(name + " > " + a.fullName);
  }
}
failures.sort(); passes.sort();
fs.writeFileSync(".scratch-g3a/baseline-before-gut.json", JSON.stringify({
  generated_from_commit: "d674f145c598b5df055e296d7e1b483041838140",
  total: j.numTotalTests, note: "G3-A 自洽重算基线（GT-2/GT-3/N5 演示用）",
  failures, passes }, null, 2));
```

### 文件 `g3a-attacks.test.ts`（路径：`experiments/v3-code-architecture-poc/attacks/review/g3a-attacks.test.ts`）

```ts
/**
 * G3-A 独立复验攻击套件（d674f14，包 3：N1/D-25/N3）
 * 本文件是审查方攻击面，不进作者基线；红/绿逐条即裁决。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import {
  CAP_RECORDS, TEST_RECORDS,
  FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
} from '../../src/domains/test-records.ts';
import type { PluginManifest } from '../../src/contracts/index.ts';
import { asOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('g3adm');       // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('g3nobody'); // 只有 space-write
const BOB = PRINCIPAL('g3bob');       // space-write + domain-admission
const GRANTS = {
  g3adm: ['space-write', 'capability-admin', 'domain-admission'],
  g3nobody: ['space-write'],
  g3bob: ['space-write', 'domain-admission'],
};

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g3a-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string, plugins?: readonly PluginManifest[]): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-G3A', grants: GRANTS,
    plugins: plugins ?? [TEST_OBJECT_MODEL, TEST_RECORDS] });

const code = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    // node:sqlite 把 raise(abort,'TEXT') 放进 message，code 是 ERR_SQLITE_ERROR——触发器判定要看 message
    const c = typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
    return c;
  }
};

const v3Shaped = (issuer: string, policyVersion = FACT_STANDING_POLICY_VERSION): Record<string, unknown> => ({
  designationSchema: FACT_DESIGNATION_SCHEMA, stance: 'ACCEPTED',
  issuer, authorization: 'AUTHORIZED', policyVersion,
});

const directIssue = (w: World, actor: typeof NOBODY, payload: Record<string, unknown>, cap: string = CAP_RECORDS,
                     eventType: string = FACT_DESIGNATION_EVENT, oid?: string): void => {
  w.uow(actor, (tx) => w.kernel.faceFor(cap as never).writerFor(tx).appendAuthoritativeEvent({
    eventType, objectId: asOid(oid ?? 'OBJ-SP-G3A-1'), revision: 1, payload,
  }));
};
const standing = (w: World, oid: string = 'OBJ-SP-G3A-1') =>
  w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state;
const witnesses = (w: World, eventType: string = FACT_DESIGNATION_EVENT) =>
  w.raw.all<{ authorized: number | null; axis: string | null; cap: string | null }>(
    `select json_extract(authority_basis,'$.authorized') authorized,
            json_extract(authority_basis,'$.axis') axis,
            json_extract(authority_basis,'$.capability') cap
       from ledger where event_type=? order by seq`, eventType)
    .map((r) => ({ authorized: r.authorized === 1 ? 'true' : r.authorized === 0 ? 'false' : null, axis: r.axis, cap: r.cap }));

// ═══════════════════════════════════════════════════════════════════════════
// A1 —— 授权轴由清单自声明：机制只证「主体持有这根轴」，不证「这根轴是业务轴」
// ═══════════════════════════════════════════════════════════════════════════
describe('A1 授权轴自声明面（SP-09 写权/业务授权分轴无机制护栏）', () => {
  // 恶意但形状合法的插件清单：把自己的正式事件轴声明成**人人持有的写权轴**。
  const EVIL_CAP = 'cap.g3a.evil';
  const EVIL_EVENT = 'g3a:evil-designation';
  const evilManifest: PluginManifest = {
    pluginId: 'g3a.evil', codeVersion: '0', provides: [{ capability: EVIL_CAP, contractVersion: 'v1' }],
    requires: [], storageNamespace: 'dom_g3a_evil', eventAuthority: 'none',
    // 形状完全合法——没有任何运行时判据说 requiresAuthority 不得是机制轴
    ownsEventTypes: [{ eventType: EVIL_EVENT, capability: EVIL_CAP, requiresAuthority: 'space-write' }],
  };

  test('A1-1 恶意清单把授权轴声明为 space-write ⇒ 只有写权的主体取证**平凡通过**（authorized:true 见证落库）', () => {
    const w = open('a1-evil-axis', [TEST_OBJECT_MODEL, TEST_RECORDS, evilManifest]);
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // g3nobody 没有任何业务授权轴；它持有的恰是「事件清单自己声明的那根轴」。
      expect(code(() => directIssue(w, NOBODY, v3Shaped('g3nobody'), EVIL_CAP, EVIL_EVENT, oid))).toBe('NO_REFUSAL');
      const rows = witnesses(w, EVIL_EVENT);
      // 攻击成立：机制证据真实（不是载荷自称），但轴名是插件自己挑的——
      // 「授权结论由机制证据支撑」在此坍缩为「写权即授权」，正是 SP-09 明令禁止的混同。
      expect(rows).toEqual([{ authorized: 'true', axis: 'space-write', cap: EVIL_CAP }]);
      // 对照：同一主体对**正当清单**（轴=domain-admission）签发 ⇒ 见证 false。
      const oid2 = oid;
      expect(code(() => directIssue(w, NOBODY, v3Shaped('g3nobody'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid2))).toBe('NO_REFUSAL');
      expect(witnesses(w, FACT_DESIGNATION_EVENT)).toEqual([{ authorized: 'false', axis: 'domain-admission', cap: CAP_RECORDS }]);
      // 机制投影只认 authorized，不核对轴语义 ⇒ 恶意域内「未授权主体=全体写主体」。
      expect(standing(w, oid)).toBe('NOT_ADOPTED'); // 正当域仍守住了（事件类型不同，互不相干）
    } finally { w.close(); }
  });

  test('A1-2 轴值不可被运行期改写（重复登记 AMBIGUOUS）；缺轴/空串/非串都有兜底——只有「值=机制轴」没有兜底', () => {
    const dupAxis: PluginManifest = {
      pluginId: 'g3a.dup', codeVersion: '0', provides: [{ capability: 'cap.g3a.dup', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_g3a_dup', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: FACT_DESIGNATION_EVENT, capability: 'cap.g3a.dup', requiresAuthority: 'domain-admission' }],
    };
    expect(code(() => open('a1-dup', [TEST_OBJECT_MODEL, TEST_RECORDS, dupAxis]))).toBe('AMBIGUOUS_AUTHORITY');
    // 空白字符串轴：typeof string 且非空 ⇒ 通过登记判据；取证据时没人持有 ⇒ 恒 false（fail-closed 方向，可接受）
    const spaceAxis: PluginManifest = {
      pluginId: 'g3a.blank', codeVersion: '0', provides: [{ capability: 'cap.g3a.blank', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_g3a_blank', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: 'g3a:blank', capability: 'cap.g3a.blank', requiresAuthority: ' ' }],
    };
    expect(code(() => open('a1-blank', [TEST_OBJECT_MODEL, spaceAxis]))).toBe('NO_REFUSAL');
    // 结论：登记面对「缺失」有 ACTIVATION_IMPOSSIBLE 兜底，对「值」毫无判据——
    // 恶意插件可把轴挑成自己 Principal 已持有的任何轴（含机制轴），机制照单全收。
  });

  test('A1-3 capability-admin 也是可挑的轴：只有 capability-admin 的主体（无业务轴）拿到 authorized:true', () => {
    const evil2: PluginManifest = {
      pluginId: 'g3a.evil2', codeVersion: '0', provides: [{ capability: 'cap.g3a.evil2', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_g3a_evil2', eventAuthority: 'none',
      ownsEventTypes: [{ eventType: 'g3a:opsevent', capability: 'cap.g3a.evil2', requiresAuthority: 'capability-admin' }],
    };
    const w = open('a1-admin-axis', [TEST_OBJECT_MODEL, TEST_RECORDS, evil2]);
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      const ops = PRINCIPAL('g3ops'); // 只有 capability-admin，没有 space-write 也没有 domain-admission
      w.grant('g3ops', 'capability-admin', 'space-write'); // 装配期授予（合法授权面）
      expect(code(() => directIssue(w, ops, v3Shaped('g3ops'), 'cap.g3a.evil2', 'g3a:opsevent', oid))).toBe('NO_REFUSAL');
      expect(witnesses(w, 'g3a:opsevent')).toEqual([{ authorized: 'true', axis: 'capability-admin', cap: 'cap.g3a.evil2' }]);
    } finally { w.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2 —— 见证读面：形状合法的伪造 JSON 被 v3 判据全信（读侧不核对轴/能力一致性）
// ═══════════════════════════════════════════════════════════════════════════
describe('A2 语义伪造的见证列值（装配裸面）', () => {
  test('A2-1 伪造但形状合法的 authority_basis（capability 张冠李戴）⇒ v3 判据采信 ⇒ ADOPTED', () => {
    const w = open('a2-forged-witness');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // 装配裸面插行：actor=issuer=g3nobody（它从没持有过 domain-admission），
      // 见证是**语义伪造**：axis 拼对了、authorized:true、capability 是别人的。
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(910,'SP-G3A',?, 'g3nobody', ?, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT,
        JSON.stringify({ axis: 'domain-admission', capability: 'cap.some.other', authorized: true }),
        oid, JSON.stringify(v3Shaped('g3nobody')));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 910);
      // 「坏形状 fail-closed」≠「任意形状 fail-closed」：这条**语义伪造**被投影全信。
      expect(standing(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });

  test('A2-2 冻结判据表是原型链查表：policyVersion="constructor" 时 rule=Object ⇒ 返回真值 ⇒ 无 schema 字段也计入', () => {
    const w = open('a2-proto-lookup');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // FACT_STANDING_RULES[p.policyVersion] 查的是普通对象字面量（Object.freeze 不挡原型链）。
      // policyVersion='constructor' ⇒ rule === Object ⇒ Object(p) 返回真值 ⇒ 判据形同虚设：
      // 载荷连 designationSchema 都没有，issuer===actor + 见证 true 即计入。
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(911,'SP-G3A',?, 'g3adm', ?, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT,
        JSON.stringify({ axis: 'domain-admission', capability: CAP_RECORDS, authorized: true }),
        oid, JSON.stringify({ stance: 'ACCEPTED', issuer: 'g3adm', policyVersion: 'constructor' }));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 911);
      expect(standing(w, oid)).toBe('ADOPTED'); // ← 「未知版本 fail-closed」对原型链键不成立
    } finally { w.close(); }
  });

  test('A2-3 policyVersion="__proto__" ⇒ 无见证裸面行读投影直接 TypeError（fail-closed 崩成可用性洞）', () => {
    const w = open('a2-proto-crash');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(912,'SP-G3A',?, 'g3adm', null, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT, oid,
        JSON.stringify({ stance: 'ACCEPTED', issuer: 'g3adm', policyVersion: '__proto__' }));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 912);
      // rule=Object.prototype 为真值但不是函数 ⇒ rule(...) TypeError 直冲读者，而不是「不计入」。
      let outcome = 'NO_THROW';
      try { standing(w, oid); } catch (e) { outcome = e instanceof TypeError ? 'TypeError' : `OTHER:${String(e)}`; }
      expect(outcome).toBe('TypeError');
    } finally { w.close(); }
  });

  test('A2-4 插件可达面确认：五条通道里只有权威入口能写见证列，且列值由机制生成——越权面=装配裸面（运维面）', () => {
    const w = open('a2-channel-map');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // 通道判据复核（不新造洞，钉住「A2-1 只在裸面成立」的边界）：
      expect(code(() => w.uow(ADM, (tx) => tx.appendLedger({ eventType: FACT_DESIGNATION_EVENT, payload: {} }))))
        .toBe('EVENT_AUTHORITY_REQUIRED');
      // 权威通道写的见证是**机制生成**的：入参里没有 authority_basis，伪造不了（载荷里塞也没用）。
      w.uow(NOBODY, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1,
        payload: { ...v3Shaped('g3nobody'), authority_basis: { axis: 'domain-admission', authorized: true } },
      }));
      expect(witnesses(w)).toEqual([{ authorized: 'false', axis: 'domain-admission', cap: CAP_RECORDS }]);
      expect(standing(w, oid)).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('A2-5 触发器矩阵：UPDATE/DELETE/UPSERT-DO-UPDATE 被 abort；但 INSERT OR REPLACE **绕过触发器静默改写历史行**（SQLite 语义：REPLACE 的隐式删除只在 recursive_triggers=ON 时触发 DELETE 触发器，默认 OFF）', () => {
    const w = open('a2-trigger-matrix');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      // 先签一条**未授权**声明（见证 false ⇒ 不计入）
      directIssue(w, NOBODY, v3Shaped('g3nobody'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid);
      const seq = w.raw.get<{ m: number }>(`select max(seq) m from ledger`)!.m;
      expect(standing(w, oid)).toBe('NOT_ADOPTED');
      // UPDATE / DELETE / UPSERT DO UPDATE 三条路都被触发器 abort
      expect(code(() => w.raw.run(`update ledger set authority_basis='{"axis":"x","capability":"y","authorized":true}' where seq=?`, seq)))
        .toContain('HISTORY_IMMUTABLE');
      expect(code(() => w.raw.run(`delete from ledger where seq=?`, seq))).toContain('HISTORY_IMMUTABLE');
      expect(code(() => w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(?,'SP-G3A',?,?,?,?,1,'{}',1) on conflict(seq) do update set authority_basis='{"axis":"a","capability":"b","authorized":true}'`,
        seq, FACT_DESIGNATION_EVENT, 'g3adm', JSON.stringify({ axis: 'a', capability: 'b', authorized: true }), oid)))
        .toContain('HISTORY_IMMUTABLE');
      // ↑ UPSERT 的 do update 走 UPDATE 语义 ⇒ before-update 触发器 abort。但 **INSERT OR REPLACE**：
      // SQLite 官方语义——REPLACE 冲突消解的隐式行删除**只在 recursive_triggers=ON 时触发 DELETE 触发器**；
      // 默认 OFF ⇒ 触发器形同虚设，整行（含 actor/见证/payload）被静默替换，且不留旧行痕迹。
      expect(code(() => w.raw.run(
        `insert or replace into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(?,'SP-G3A',?,'g3adm','{"axis":"domain-admission","capability":"cap.test.records","authorized":true}',?,1,?,1)`,
        seq, FACT_DESIGNATION_EVENT, oid, JSON.stringify(v3Shaped('g3adm'))))).toBe('NO_REFUSAL');
      // 历史被改写：同一条 seq 从「未授权 g3nobody 的声明」变成「授权 g3adm 的声明」⇒ 投影翻 ADOPTED
      expect(standing(w, oid)).toBe('ADOPTED');
      const row = w.raw.get<{ actor: string; auth: number }>(
        `select actor, json_extract(authority_basis,'$.authorized') auth from ledger where seq=?`, seq)!;
      expect([row.actor, row.auth]).toEqual(['g3adm', 1]);
      // 边界：可达面=装配裸面/运维（port.raw 无守卫），插件句柄拿不到 raw；guard 过的 tx 句柄禁 DDL 但
      // **不禁 insert or replace**——真正的护栏只有触发器，而触发器在这一条 SQL 形态下失效。
    } finally { w.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A5 / 撤销 × 历史 双方向独立再钉 + 冻结点复核
// ═══════════════════════════════════════════════════════════════════════════
describe('A5 撤销 × 历史（独立复钉，两个方向）', () => {
  test('A5-1 方向①：撤销后历史仍计入；方向②：撤销后新写不计入；且新写 WITHDRAWN 也不计 ⇒ ADOPTED 成为单向门（运维含义）', () => {
    const w = open('a5-revoke');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      const uc = w.standingUseCase();
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'ACCEPTED' }); });
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');
      w.revoke('g3bob', 'domain-admission');
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');          // 方向①：历史不重解释
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); });
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('ADOPTED');          // 方向②：撤销后连撤回都撤不动
      expect(witnesses(w).map((r) => r.authorized)).toEqual(['true', 'false']);
      // 再授权后重新声明才救得回来——但历史那行见证永远 false，不追溯（正确方向）。
      w.grant('g3bob', 'domain-admission');
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); });
      expect(uc.standingAt(oid, w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('A5-2 撤销 × v2 历史行：v2 伪造行（无见证+自称 AUTHORIZED）在撤销/重授予后仍永久计入（已知对称代价，独立确认）', () => {
    const w = open('a5-v2-legacy');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      w.raw.run(
        `insert into ledger(seq, space, event_type, actor, authority_basis, object_id, revision, payload_json, recorded_at)
         values(920,'SP-G3A',?, 'g3bob', null, ?, 1, ?, 1)`,
        FACT_DESIGNATION_EVENT, oid, JSON.stringify(v3Shaped('g3bob', 'fact-standing/v2')));
      w.raw.run(`update meta set value=? where key='ledger_seq'`, 920);
      expect(standing(w, oid)).toBe('ADOPTED');
      w.revoke('g3bob', 'domain-admission');           // 撤销
      expect(standing(w, oid)).toBe('ADOPTED');        // 仍然计入——**没有撤销路径**（除非新写 v3 WITHDRAWN 且持轴）
      // 处置面确认：唯一机制内救济 = 有轴主体经命令 Port 新写 WITHDRAWN。
      const uc = w.standingUseCase();
      expect(code(() => w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); }))).toBe('NO_REFUSAL');
      expect(standing(w, oid)).toBe('ADOPTED');        // 撤销中的主体连机制救济都用不了
      w.grant('g3bob', 'domain-admission');
      w.uow(BOB, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); });
      expect(standing(w, oid)).toBe('NOT_ADOPTED');    // 重新授予后才可救济
    } finally { w.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C —— D-25：停用后**既有实例**、恢复后旧实例、停用窗口的读面
// ═══════════════════════════════════════════════════════════════════════════
describe('C D-25 停用 × 既有实例 / 恢复 / 读面', () => {
  test('C-1 unload 前抓到的 face+writer 实例在 unload 后被拒（判据在调用时查 registry，不在构造时）', () => {
    const w = open('c1-stale-instance');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      const face = w.kernel.faceFor(CAP_RECORDS);
      let heldWriter: ReturnType<typeof face.writerFor> | null = null;
      w.uow(ADM, (tx) => { heldWriter = face.writerFor(tx); }); // 构造于 unload 之前
      w.unloadCapability(CAP_RECORDS, ADM);
      // 既有 writer 实例再 append：判据在 appendAuthoritativeEvent 内查 registry.capability ⇒ 动态生效
      expect(code(() => w.uow(ADM, (tx) => {
        (heldWriter as NonNullable<typeof heldWriter>).appendAuthoritativeEvent({
          eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload: v3Shaped('g3adm'),
        });
      }))).toBe('TX_CLOSED'); // 既有 writer 绑的旧事务句柄先死（D-23 终结账先兜住）
      // 用既有 face 现造 writer（新事务）⇒ 走 registry 判据
      expect(code(() => w.uow(ADM, (tx) => face.writerFor(tx).appendAuthoritativeEvent({
        eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload: v3Shaped('g3adm'),
      })))).toBe('CAPABILITY_INACTIVE');
      // readOwn 也被拒；但 face.eventsOf **不查激活**——停用窗口的读面仍开放（观察项，非写洞）
      expect(code(() => face.readOwn(asOid(oid)))).toBe('CAPABILITY_INACTIVE');
      let eventsOutcome = 'NO_REFUSAL';
      try { face.eventsOf(asOid(oid), FACT_DESIGNATION_EVENT, w.ledgerHead()); }
      catch (e) { eventsOutcome = (e as { code?: string }).code ?? 'OTHER'; }
      expect(eventsOutcome).toBe('NO_REFUSAL'); // 停用后仍能经既有 face 读事件流（读面未纳入 D-25 判据）
    } finally { w.close(); }
  });

  test('C-2 unload → load 后正当签发恢复；authority_basis 轴/能力与停用前一致（不因重装清单漂移）', () => {
    const w = open('c2-reload-consistency');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, ADM, v3Shaped('g3adm'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid);
      w.unloadCapability(CAP_RECORDS, ADM);
      w.loadCapability(CAP_RECORDS, ADM);
      directIssue(w, ADM, v3Shaped('g3adm'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid);
      const rows = witnesses(w);
      expect(rows.length).toBe(2);
      expect(rows[0]).toEqual(rows[1]); // 轴与能力跨停用窗口一字不差
    } finally { w.close(); }
  });

  test('C-3 transferRoute 后轴仍归原登记：新归属能力签发同一事件仍按 domain-admission 取证（A.4 组合）', () => {
    const w = open('c3-transfer');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      directIssue(w, BOB, v3Shaped('g3bob'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid); // 真授权行
      const newOwner: PluginManifest = { ...TEST_RECORDS, pluginId: 'test.records.v2' };
      w.transferCapability(CAP_RECORDS, newOwner, ADM);
      // 旧见证不受移交影响；未授权主体对新 owner 签发仍 false（轴跟着 formalEvents 账本走，不随清单变）
      expect(code(() => directIssue(w, NOBODY, v3Shaped('g3nobody'), CAP_RECORDS, FACT_DESIGNATION_EVENT, oid))).toBe('NO_REFUSAL');
      expect(witnesses(w).map((r) => r.authorized)).toEqual(['true', 'false']);
      expect(witnesses(w).map((r) => r.axis)).toEqual(['domain-admission', 'domain-admission']);
    } finally { w.close(); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// N4 复核：tx 原型面残留（上席 P2 观察项是否恶化/修复）
// ═══════════════════════════════════════════════════════════════════════════
describe('N4 复核', () => {
  test('N4-1 UnitOfWorkImpl.prototype 上 reassignRouteInternal 仍在（未修未恶化）；方法体兜底仍有效', () => {
    const w = open('n4-1');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      let protoNames: string[] = [];
      w.uow(NOBODY, (tx) => { protoNames = Object.getOwnPropertyNames(Object.getPrototypeOf(tx)); });
      expect(protoNames).toContain('reassignRouteInternal');
      expect(code(() => w.uow(NOBODY, (tx) => {
        (tx as unknown as { reassignRouteInternal: (c: string, p: string, ns: string, v?: string) => void })
          .reassignRouteInternal(CAP_RECORDS, 'attacker', 'dom_attacker');
      }))).toBe('AUTHORITY_REQUIRED');
      expect(oid).toBeTruthy();
    } finally { w.close(); }
  });
});
```

### 文件 `g3a-q2-prototype.test.ts`（路径：`experiments/v3-code-architecture-poc/attacks/review/g3a-q2-prototype.test.ts`）

```ts
/**
 * G3-A ② 精确通路测试（父席三问）：
 *  插件可达面（faceFor→writerFor→appendAuthoritativeEvent，不碰 port.raw）签发
 *  policyVersion='constructor' / '__proto__' 的正式事件 ⇒ 能不能落库？读者看到什么？
 * 以及「修法落地前必红」探针两条（父席指定的修法：hasOwnProperty + 形状校验 + 字面相等）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import {
  CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT, FACT_DESIGNATION_SCHEMA, FACT_STANDING_POLICY_VERSION,
} from '../../src/domains/test-records.ts';
import { asOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('q2adm');   // space-write + capability-admin + domain-admission
const NOBODY = PRINCIPAL('q2nobody'); // 只有 space-write
const GRANTS = {
  q2adm: ['space-write', 'capability-admin', 'domain-admission'],
  q2nobody: ['space-write'],
};
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g3a-q2-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-Q2', grants: GRANTS,
    plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });

const pluginIssue = (w: World, actor: typeof ADM, payload: Record<string, unknown>, oid: string): string => {
  try {
    w.uow(actor, (tx) => w.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
      eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload,
    }));
    return 'STORED';
  } catch (e) { return (e as { code?: string }).code ?? `OTHER:${String(e)}`; }
};
const standingOrThrow = (w: World, oid: string): string => {
  try { return w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state; }
  catch (e) { return e instanceof TypeError ? `TypeError(${e.message.slice(0, 60)})` : `OTHER:${String(e)}`; }
};

describe('Q2 插件可达面 × 原型链查表', () => {
  test('Q2-1 持轴主体(ADM)经插件可达通道落 policyVersion:"constructor"（无 designationSchema）⇒ 落库成功且读者见 ADOPTED（v3 全部形状判据被跳过）', () => {
    const w = open('q2-1');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'constructor' }, oid)).toBe('STORED');
      // 机制取证（判据③）对持轴主体本来就过（witness authorized:true）——但**形状判据**
      // （designationSchema/policyVersion 字面相等/issuer===actor）全部被 rule=Object 跳过。
      expect(standingOrThrow(w, oid)).toBe('ADOPTED');
      // 对照：同样载荷但 policyVersion 未知字面 ⇒ 冻结表 miss ⇒ fail-closed（判据本意）。
      const oid2 = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'fact-standing/v99' }, oid2)).toBe('STORED');
      expect(standingOrThrow(w, oid2)).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('Q2-2 未持轴主体(NOBODY)同载荷 ⇒ 落库成功但**见证 false 被见证优先闸先拦**⇒ 不计入也不崩（原型查表在闸后）', () => {
    const w = open('q2-2');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, NOBODY, { stance: 'ACCEPTED', issuer: 'q2nobody', policyVersion: 'constructor' }, oid)).toBe('STORED');
      expect(standingOrThrow(w, oid)).toBe('NOT_ADOPTED'); // 见证优先闸先判 authorized:false ⇒ 查表根本没发生
      // 即：①（轴平凡可得）**不能**套到记录域的事件类型上——轴按 eventType 绑定在 formalEvents，
      // 恶意清单重复登记同型事件被 AMBIGUOUS 拒（g3a-attacks A1-2）。未授权⇒ADOPTED 的组合链不成立。
    } finally { w.close(); }
  });

  test('Q2-3 持轴主体落 policyVersion:"__proto__" ⇒ **读者永久崩**（TypeError 直冲 standingAt；账本不可删改 ⇒ 无自愈）', () => {
    const w = open('q2-3');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: '__proto__' }, oid)).toBe('STORED');
      const r = standingOrThrow(w, oid);
      expect(r.startsWith('TypeError')).toBe(true);
      // 永久性与影响面：
      //  a) 再写正当 v3 WITHDRAWN 也救不回读面——standingAt 扫到毒行仍先崩；
      const uc = w.standingUseCase();
      w.uow(ADM, (tx) => { uc.declare(tx, { oid, revision: 1, stance: 'WITHDRAWN' }); });
      expect(standingOrThrow(w, oid).startsWith('TypeError')).toBe(true);
      //  b) declare（写面）不受影响（不读判据表）——只有 standingAt 类读者崩；
      //  c) 插件 face.eventsOf 不查表不崩（只解析 authority_basis 列）。
      expect(() => w.kernel.faceFor(CAP_RECORDS).eventsOf(asOid(oid), FACT_DESIGNATION_EVENT, w.ledgerHead())).not.toThrow();
      // d) 未持轴主体写 __proto__ 行不崩（Q2-2 同闸）——毒化需要**见证 true 或无见证历史行**。
      const oid2 = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, NOBODY, { stance: 'ACCEPTED', issuer: 'q2nobody', policyVersion: '__proto__' }, oid2)).toBe('STORED');
      expect(standingOrThrow(w, oid2)).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('Q2-4 同类第三键 "toString"：rule=Object.prototype.toString 真值且可调用 ⇒ 返回 "[object Undefined]" 真值 ⇒ 同样计入', () => {
    const w = open('q2-4');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      expect(pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'toString' }, oid)).toBe('STORED');
      expect(standingOrThrow(w, oid)).toBe('ADOPTED');
    } finally { w.close(); }
  });

  test('Q2-5 payload 其余键的注入面探测：policyVersion 在顶层被读；嵌套/大小写/空白变体全部 miss ⇒ fail-closed（攻击面就是这一把裸下标）', () => {
    const w = open('q2-5');
    try {
      const mk = () => w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      const oidA = mk(); const oidB = mk(); const oidC = mk();
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'fact-standing/v3 ',
        designationSchema: FACT_DESIGNATION_SCHEMA }, oidA);            // 尾随空格
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'Fact-Standing/V3',
        designationSchema: FACT_DESIGNATION_SCHEMA }, oidB);            // 大小写
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm',
        policyVersion: { toString: () => 'fact-standing/v3' }, designationSchema: FACT_DESIGNATION_SCHEMA }, oidC); // 非串键
      expect([standingOrThrow(w, oidA), standingOrThrow(w, oidB), standingOrThrow(w, oidC)]).toEqual(['NOT_ADOPTED', 'NOT_ADOPTED', 'NOT_ADOPTED']);
      // （oidC：对象键被 JS 转成源码串 "[object Object]" 后查表演 ⇒ miss；不抛 ⇒ 无第二崩溃面。）
    } finally { w.close(); }
  });
});

// ── 修法落地前必红探针（父席指定修法：hasOwnProperty + 形状校验 + policyVersion 字面相等）──
describe('FIXPROBE 修法落地前必红（落地后转绿）', () => {
  test('FIXPROBE-1（必红）"constructor" 行即便见证 true 也**不得**计入——判据表查表必须先 hasOwnProperty', () => {
    const w = open('fix-1');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'constructor' }, oid);
      // 期望的正确行为（修法落地后此行绿）：原型链键 ⇒ 不计入。
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('FIXPROBE-2（必红）"__proto__" 行不得让读者崩——未知/原型键 ⇒ fail-closed 不计入，standingAt 必须正常返回', () => {
    const w = open('fix-2');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: '__proto__' }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED'); // 现在先 TypeError
    } finally { w.close(); }
  });

  test('FIXPROBE-3（必红）命中的规则必须过形状校验：policyVersion 字面相等 + designationSchema 匹配 + 值必须是登记过的函数——"toString" 同拦', () => {
    const w = open('fix-3');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: 'toString' }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('NOT_ADOPTED');
    } finally { w.close(); }
  });

  test('FIXPROBE-4（对照组恒绿）正当 v3 声明在修法前后都必须 ADOPTED——修法不得伤及正例', () => {
    const w = open('fix-4');
    try {
      const oid = w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
      pluginIssue(w, ADM, { stance: 'ACCEPTED', issuer: 'q2adm', policyVersion: FACT_STANDING_POLICY_VERSION,
        designationSchema: FACT_DESIGNATION_SCHEMA }, oid);
      expect(w.standingUseCase().standingAt(asOid(oid), w.ledgerHead()).state).toBe('ADOPTED');
    } finally { w.close(); }
  });
});
```

### 文件 `g3a-n3-gate-attacks.test.ts`（路径：`experiments/v3-code-architecture-poc/attacks/review/g3a-n3-gate-attacks.test.ts`）

```ts
/**
 * G3-A 对包 3 N3 门禁**自身**的攻击（作者与审查方文件不可改，故门禁判据逻辑逐行复制到本文件，
 * 与 tests/n3-parameter-property-gate.test.ts 的 41-83 行/门 2 的 callableSurface/runtimeLeaks
 * 保持一字不差；被攻击对象是**判据逻辑本身**，不是文件的绿）。
 */
import { describe, expect, test } from 'vitest';

// ── 门 1 逻辑（复制自 n3-parameter-property-gate.test.ts:41-83，一字未改）────────────
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

function constructorParams(file: string, src: string): { file: string; params: string }[] {
  const code = stripComments(src);
  const out: { file: string; params: string }[] = [];
  const re = /\bconstructor\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let i = re.lastIndex - 1;
    let depth = 0;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    out.push({ file, params: code.slice(m.index, i) });
  }
  return out;
}
const MODIFIER_TOKEN = /[(,]\s*(private|protected|public|readonly)\s+[\w$]/;
const isParamProperty = (params: string): boolean =>
  MODIFIER_TOKEN.test(`(${params.replace(/\bconstructor\s*\(/, '')}`);
const paramPropertyHits = (files: { file: string; src: string }[]): string[] =>
  files.flatMap((f) => constructorParams(f.file, f.src).filter((e) => isParamProperty(e.params))
    .map((e) => `${f.file}: 构造参数属性`));
const hit = (src: string): boolean => paramPropertyHits([{ file: 'X', src }]).length > 0;

describe('G3A-N3 门 1（源码级扫描）自身可被打穿', () => {
  test('G3A-N3a 真实四形态都被抓住（门的既有承诺成立）', () => {
    expect(hit(`class A { constructor(private readonly face: F) {} }`)).toBe(true);
    expect(hit(`class A { constructor(\n  public\n  a: number,\n) {} }`)).toBe(true);
    expect(hit(`const C = class { constructor(private x: unknown) {} };`)).toBe(true);
    expect(hit(`class A { constructor( /*)*/ private x: unknown) {} }`)).toBe(true);
    expect(hit(`class A { constructor(cb = (x: unknown) => x, private p?: unknown) {} }`)).toBe(true);
  });

  test('G3A-N3b 绕过：默认值字符串里的**未配对右括号**截断参数表——修饰符在截断点之后 ⇒ 漏检（真实参数属性，tsc 可编译）', () => {
    // `constructor(tag = ")", private x)` 是完全合法的 TS：参数属性照样生成运行时自有可枚举属性。
    // 括号配对循环把字符串里的 ")" 当成闭合点，参数表被截到修饰符之前 ⇒ MODIFIER_TOKEN 看不见。
    const bypasses = [
      `class A { constructor(tag = ")", private readonly face: unknown) {} }`,
      'class A { constructor(t = `)`, private x = 1) {} }',
      `class A { constructor(tag = "))", public y = 1, private z = 2) {} }`,
    ];
    for (const src of bypasses) expect(hit(src), src).toBe(false);
    // 且这不是纸面形态：同形的**运行时泄漏**在门 2 清单之外（新类不在 make() 清单，镜像测试只
    // 要求文件进门 2 清单，不要求每个类实例都在）——见 g3a-attacks.test.ts 与报告 §③。
  });

  test('G3A-N3c 门 1 对非参数属性形态的泄漏天然失明：Object.defineProperty 注入可调用成员', () => {
    const src = `class A {
      constructor(f: unknown) { Object.defineProperty(this, 'face', { value: f, enumerable: true }); }
    }`;
    expect(hit(src)).toBe(false); // 无修饰符 ⇒ 门 1 结构性不可见（这可以接受——但门 2 必须兜住，见下）
  });
});

// ── 门 2 逻辑（复制自 n3-parameter-property-gate.test.ts 的 callableSurface/runtimeLeaks）──
function callableSurface(v: unknown): boolean {
  if (typeof v === 'function') return true;
  if (v === null || typeof v !== 'object') return false;
  for (const o of [v, Object.getPrototypeOf(v)]) {
    if (!o || o === Object.prototype || o === Array.prototype) continue;
    for (const k of [...Object.getOwnPropertyNames(o), ...Object.getOwnPropertySymbols(o)]) {
      if (k === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (d && 'value' in d && typeof d.value === 'function') return true;
    }
  }
  return false;
}
const runtimeLeaks = (label: string, inst: object): string[] =>
  Reflect.ownKeys(inst).filter((k) => {
    const d = Object.getOwnPropertyDescriptor(inst, k);
    return d && 'value' in d && callableSurface(d.value);
  }).map((k) => `${label}.${String(k)}`);

describe('G3A-N3 门 2（运行时自有面）自身可被打穿', () => {
  const face = { writerFor() { return null; } };

  test('G3A-N3d 直接泄漏与 Symbol 键泄漏都能抓住（Reflect.ownKeys 覆盖 Symbol，此项承诺成立）', () => {
    expect(runtimeLeaks('p', Object.assign({}, { face }))).toEqual(['p.face']);
    expect(runtimeLeaks('s', { [Symbol.for('face')]: face })).toEqual(['s.Symbol(face)']);
  });

  test('G3A-N3e 绕过①：getter 访问器持有协作对象 ⇒ descriptor 无 value ⇒ 门 2 结构性失明（运行时 .face 照样可走）', () => {
    class GetterLeak {
      #f: unknown;
      constructor(f: unknown) { this.#f = f; Object.defineProperty(this, 'face', { get: () => this.#f, enumerable: true }); }
    }
    const inst = new GetterLeak(face);
    expect(runtimeLeaks('g', inst)).toEqual([]);           // 门 2：绿
    expect((inst as unknown as { face: unknown }).face).toBe(face); // 运行时：插件顺着 .face 就走回来了
  });

  test('G3A-N3f 绕过②：一层包装对象 { bundle: { face } } ⇒ callableSurface 不下钻第二层自有属性 ⇒ 失明', () => {
    class BundleLeak { bundle: unknown; constructor(f: unknown) { this.bundle = { face: f }; } }
    const inst = new BundleLeak(face);
    expect(runtimeLeaks('b', inst)).toEqual([]);
    expect(((inst.bundle as { face: unknown }).face)).toBe(face);
  });

  test('G3A-N3g 绕过③：Proxy ownKeys 返回空 ⇒ Reflect.ownKeys 被 trap 欺骗（理论形态，列出以完整）', () => {
    const inst = new Proxy({}, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined });
    expect(runtimeLeaks('x', inst)).toEqual([]);
  });

  test('G3A-N3h 变异锚点复核：门 1 的「已知违规样本必须报警」只覆盖干净形态（N3b 形态不在其样本集内）', () => {
    // 作者门的自测样本 = `constructor(private readonly face)` 两形态——都能红（N3a 已证）；
    // 但其样本集不含任何"截断点先于修饰符"的形态，所以这条**变异锚**对 N3b 是盲区。
    const authorSamples = [
      `class A { constructor(private readonly face: unknown) {} }`,
      `class B { constructor(face: unknown, private readonly authority: unknown) {} }`,
    ];
    expect(authorSamples.every(hit)).toBe(true);
  });
});
```

### 文件 `g3a-d25-mp.test.ts`（路径：`experiments/v3-code-architecture-poc/attacks/review/g3a-d25-mp.test.ts`）

```ts
/** G3-A：D-25 多进程/多世界探针——世界 B 停用能力，世界 A（同文件、先启动）还在签发吗？ */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { CAP_RECORDS, TEST_RECORDS, FACT_DESIGNATION_EVENT } from '../../src/domains/test-records.ts';
import { asOid } from '../../src/contracts/index.ts';

const ADM = PRINCIPAL('mpadm');
const GRANTS = { mpadm: ['space-write', 'capability-admin', 'domain-admission'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g3a-mp-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

test('D25-MP：进程 B 停用后，进程 A 的内存视图仍在——A 的 appendAuthoritativeEvent 是否还能写？', () => {
  const file = join(dir, 'mp.db');
  const A: World = openWorld({ file, space: 'SP-MP', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
  const B: World = openWorld({ file, space: 'SP-MP', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_RECORDS] });
  try {
    const oid = A.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { core: true } }));
    // B 停用 CAP_RECORDS：持久路由 enabled=0，B 自己的内存视图也掉。
    B.unloadCapability(CAP_RECORDS, ADM);
    // B 视角：正当签发被拒（对照组）
    let bCode = 'NO_REFUSAL';
    try { B.uow(ADM, (tx) => B.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
      eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload: { policyVersion: 'fact-standing/v3' },
    })); } catch (e) { bCode = (e as { code?: string }).code ?? 'OTHER'; }
    expect(bCode).toBe('CAPABILITY_INACTIVE');
    // 持久面确认：路由行确实 enabled=0
    expect(B.raw.get<{ e: number }>(`select enabled e from capability_route where capability=?`, CAP_RECORDS)!.e).toBe(0);
    // A 视角（**先启动、内存视图陈旧**）：签发还能成功吗？
    let aCode = 'NO_REFUSAL';
    try { A.uow(ADM, (tx) => A.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
      eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload: { policyVersion: 'fact-standing/v3' },
    })); } catch (e) { aCode = (e as { code?: string }).code ?? 'OTHER'; }
    // 裁决：NO_REFUSAL ⇒ 停用只在**执行停用的进程**生效；跨进程不一致直到 A 重启。
    // CAPABILITY_INACTIVE ⇒ D-25 判据每次都查持久路由（真·生效路由）。
    // A 重启后必须拒：
    let a2Code = 'NO_REFUSAL';
    const A2 = A.restart(); // 若 restart 签名不同会编译红——即为本探针的一部分
    try { A2.uow(ADM, (tx) => A2.kernel.faceFor(CAP_RECORDS).writerFor(tx).appendAuthoritativeEvent({
      eventType: FACT_DESIGNATION_EVENT, objectId: asOid(oid), revision: 1, payload: { policyVersion: 'fact-standing/v3' },
    })); } catch (e) { a2Code = (e as { code?: string }).code ?? 'OTHER'; }
    expect(a2Code).toBe('CAPABILITY_INACTIVE');
    // 记录探针裁决（不断言 aCode——报告里按实测写）
    console.log(`[D25-MP verdict] stale-process append => ${aCode}; after-restart => ${a2Code}`);
  } finally { B.close(); }
});
```

### 文件 `g3a-gt-probe.test.ts`（路径：`experiments/v3-code-architecture-poc/attacks/review/g3a-gt-probe.test.ts`）

```ts
/** G3-A GT 探针（审查方自造文件，专用于演示基线门的 GT-2/GT-3/N5 缺口；可弃）。 */
import { afterAll, describe, expect, test } from 'vitest';
describe('GT2-PROBE', () => {
  test('canary 红条（内容可变，名字不改）', () => {
    // GT-2 掏空演示：原断言换成与产品毫无关系的恒假式——名字与红状态一字不变。
    expect('洞还开着').toBe('洞关上了');
  });
  test('canary 绿条', () => {
    expect(1).toBe(1);
  });
});
// N5 吸收形态探针：本文件已有 1 条**已登记红**（reds>0），afterAll 再抛 ⇒ loadErrors 判据
// （`f.status==='failed' && reds===0`）不触发 ⇒ 清理期崩溃被"已知红"吸收，门禁仍 PASS。
afterAll(() => {
  throw new Error('N5-PROBE: 清理期崩溃（文件级），若门禁仍绿=红条吸收了它');
});
```

