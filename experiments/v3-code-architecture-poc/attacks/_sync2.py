import pathlib
R = pathlib.Path('experiments/v3-code-architecture-poc/REVIEW.md'); t = R.read_text(encoding='utf-8')
def rep(old, new, n=1):
    global t
    assert t.count(old) == n, f'台账锚点 {t.count(old)} 次: {old[:60]!r}'
    t = t.replace(old, new, n)

rep("## 3. 攻击未得手项（同样有信息量）",
"""### 2.1 第 2 轮：独立复审与长期演化轴的再打穿

| 编号 | 级别 | 被违反的契约 | 位置 | 复现 | 根因 | 最小修法 | 回归 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-14′ | **P0**（由 P1 改判） | 存储层不可变性是边界（C11/RV-03/DF-06/IC-S2） | `sqlite-port.ts` SQL 守卫 | `attacks/review/reviewer-boundary.test.ts`：`/* disguise */ DROP TRIGGER IF EXISTS ledger_no_update` 未被拒 | 守卫用 `^\\s*(drop|…)` 锚定关键字，**前导注释即可绕过**；且未拒绝多语句 | 判定前归一化（剥空白/块注释/行注释/多余分号，循环到不动点）+ 拒绝 `;` 后仍有内容 | 复审攻击例转绿（三种句柄方法 × 注释前缀） | 已修 |
| F-17 | P1 | RF-02/RD-05 精确引用 | `checkRequiredRefs` 只验目标端 | `attacks/review/`：`from(oid, revision=999)` 的必需边提交成功 | 第 1 轮 F-12 修得不完整：源端修订未验 | 必需边**两端**都验到 `domain_state(oid, revision)` | 复审攻击例转绿 | 已修 |
| F-15 | P1 | 模式演进不得在打开时静默迁移 | `sqlite-port.ts` 构造期 `exec(SCHEMA)` | `attacks/evolution/`：手造缺 `records` 的旧库 → 打开后被静默补表，旧 `record-ref` 判成缺失 | DDL 挂在每次打开路径 ⇒ 读操作携带写语义；且无版本标记可判定"是否迁过" | 空库才建表；已有库先过 `meta.schema_version` + 表集 + 触发器集校验，通过后**不再执行 DDL**；分歧 `SCHEMA_UPGRADE_REQUIRED`，detail 给迁移输入 | 演化攻击例 + 新库可正常打开的反差锚点 | 已修 |
| F-18 | P1 | 派生面滞后 ≠ 缺口；Journal 与 Ledger 的 epoch 对应 | `reassignRouteInternal` / `setRouteEnabled` | 移交一次 ⇒ `Projection.status().gap === true` ⇒ 永久 `FULL_REBUILD_REQUIRED` | 路由变更写了 `ledger` 却没写 `journal` epoch；缺口检测按"每个登记 epoch 都该有 journal 行"判定 | 机制级事件统一写 journal epoch（`Kernel.journalEpoch`） | 移交后 `gap === false` 且可增量续跑 | 已修 |

**级别改判（不做降级掩盖）**：F-14 第 1 轮我按"插件是已授权但会犯错的参与者"判 P1，并声明该判断
交独立复审判定。复审用可运行攻击证明**主动攻击路径同样成立**（守卫可被绕过），因此按预告口径
改判 **P0**。这不是新增缺陷，而是同一缺陷的定级纠正。

**"上一轮说已修、本轮被打穿"的事实**：F-12 与 F-14 在第 1 轮被记为"已修，待复审"，复审结论是
**修得不完整**（F-17、F-14′）。这条往返保留在台账里，作为"作者自称修好不算证据"的实例。

## 3. 攻击未得手项（同样有信息量）""")
R.write_text(t, encoding='utf-8')
print('REVIEW 第 2 轮已写')

C = pathlib.Path('experiments/v3-code-architecture-poc/CONTRACTS.md'); c = C.read_text(encoding='utf-8')
anchor = "| F-14 | **P1**（安全口径可判 P0"
i = c.index(anchor); j = c.index('\n', c.index('\n', i) + 1)
c = c[:j+1] + """| F-14′ | **P0**（由 P1 改判，复审实证） | SQL 守卫被前导注释绕过 ⇒ 不可变性仍可被领域拆除 | 判定前归一化 + 拒绝多语句 |
| F-15 | P1 | DDL 挂在每次打开路径 ⇒ 读操作携带写语义，旧库被静默"半迁移" | `meta.schema_version` + 表集 + 触发器集校验；已有库不再执行 DDL；`SCHEMA_UPGRADE_REQUIRED` |
| F-17 | P1 | 必需引用只验目标端修订 ⇒ 不存在的源修订在主张约束力 | 必需边两端都验到 `domain_state(oid, revision)` |
| F-18 | P1 | 机制级事件缺 journal epoch ⇒ 缺口检测误判，派生面永久拒绝续跑 | `Kernel.journalEpoch` 统一登记（报告、路由变更、装卸） |
""" + c[j+1:]
c = c.replace("""| 登记序 | 事务内计数器 | `AUTOINCREMENT` 序列 | 见 F-04 | 中：需为截点查询引入"空洞即不可判定"语义 |""",
"""| 登记序 | 事务内计数器 | `AUTOINCREMENT` 序列 | 见 F-04 | 中：需为截点查询引入"空洞即不可判定"语义 |
| 模式演进 | 版本标记 + 打开只校验不写 + 显式迁移器 | 每次打开跑 `create table if not exists` | 见 F-15：读操作携带写语义，旧库被静默半迁移 | 高：需为每个历史版本写迁移脚本与版本链 |""")
C.write_text(c, encoding='utf-8')

E = pathlib.Path('experiments/v3-code-architecture-poc/EVIDENCE.md'); e = E.read_text(encoding='utf-8')
e = e.replace("结果（阶段 D 修复后）：**Test Files 7 passed (7) / Tests 58 passed (58)** = 49 例作者测试\n+ 9 例审查员攻击测试",
              "结果（阶段 D 两轮修复后）：**Test Files 8 passed (8) / Tests 62 passed (62)** = 49 例作者测试\n+ 13 例审查员攻击测试")
e = e.replace("| `attacks/invariant/*.test.ts`、`attacks/host/*.test.ts` | 9 |",
              "| `attacks/{invariant,host,review,evolution}/*.test.ts` | 13 |")
e = e.replace("| 修复后（当前） | 绿 | `Test Files 7 passed / Tests 58 passed`，`tsc` 0 诊断 |",
              "| 第 2 轮复审/演化轴打穿后 | **红** | `4 failed`：守卫被前导注释绕过、源端修订未验、Kernel 面基线未重生成 |\n| 两轮修复后（当前） | 绿 | `Test Files 8 passed / Tests 62 passed`，`tsc` 0 诊断 |")
E.write_text(e, encoding='utf-8')

A = pathlib.Path('experiments/v3-code-architecture-poc/ASSESSMENT.md'); a = A.read_text(encoding='utf-8')
old = "四个审查席位（模型与作者均不同、上下文独立）合计产出 **5 条 P1**，全部确认成立、全部已修，\n每条配有比攻击断言更强的回归（`REVIEW.md` §2）。修复后 `pnpm run test:poc:arch` 58/58 绿。\n另有 1 条级别判断（F-14 是否应判 P0）**待独立复审裁决**；`REVIEW.md` §7 记录裁决结果。"
new = """五个审查席位（模型与作者均不同、上下文独立）第 1 轮产出 **5 条 P1**；对这批修复再做独立复审
与长期演化攻击，第 2 轮又打穿 **4 条**——其中 **F-14 由 P1 改判 P0**（上一轮的 SQL 守卫被前导注释
绕过，等于"已封死"是错判），另含模式演进缺陷 F-15、引用源端漏验 F-17、派生面自锁 F-18。
两轮修复后 `pnpm run test:poc:arch` **62/62 绿**。这条往返本身是本轮最有价值的证据之一：
**作者自称修好不算证据**，复审确实推翻了它（`REVIEW.md` §2、§2.1）。"""
assert a.count(old) == 1
a = a.replace(old, new)
a = a.replace("| 集成与宿主边界 | `qiyuan-inter/glm-5.3` | `qiyuan-inter/gpt-6-astra` | 同第一行 |",
              "| 集成与宿主边界 | `qiyuan-inter/glm-5.3` | `qiyuan-inter/gpt-6-astra` | 同第一行 |\n| P1 修复独立复审 | （策略未列） | `qiyuan-inter/gpt-6-astra` | 复审必须与作者及第 1 轮审查者不同上下文 |\n| 长期演化轴 | （策略未列） | `qiyuan-self/qwen3.8-27b` | 第 1 轮漏配该轴，第 2 轮补位 |")
A.write_text(a, encoding='utf-8')

D = pathlib.Path('experiments/v3-code-architecture-poc/READINESS.md'); d = D.read_text(encoding='utf-8')
d = d.replace("58 例断言全绿", "62 例断言全绿（含 13 例攻击）")
d = d.replace("| D-4 | F-14 级别：P1（PoC 威胁模型）还是 P0（主动攻击者口径） | 决定是否必须在实施前再做一轮红队 |",
              "| D-4 | ~~F-14 级别~~ **已裁决**：独立复审实证守卫可被绕过 ⇒ 按预告口径改判 **P0**，已修 | 无需再裁决；但实施期须把 SQL 守卫列入红队常驻攻击面 |")
D.write_text(d, encoding='utf-8')
print('四份文档已同步第 2 轮')
