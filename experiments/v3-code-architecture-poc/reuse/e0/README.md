# E0 有界薄片——「复用优先」能复用到什么程度（可运行证据）

- 分支 `g1/contracts-20261031`，2026-11-01。前置实测：`../E0-HOST-CAPABILITIES.md`、`../E0-OVERLAP-MAP.md`（本文不重做调研）。
- 性质：`experiments/` 侧车薄片。**只新建本目录 + `.scratch/`（可弃，已 gitignore）**；未改任何既有文件、零 git 写、未触碰 `references/**` 与冻结面（`src/**`、`schema/**`、8 根文档）。
- 怎么跑（`node` 直跑，退出码即结论）：

  ```bash
  node experiments/v3-code-architecture-poc/reuse/e0/run.mjs           # 47 条断言；0=跑通
  node experiments/v3-code-architecture-poc/reuse/e0/reuse-metrics.mjs # 复用率+锚点核真；0=无坏锚
  ```

- 本机实测（真实观测值）：`run.mjs` **exit 0**（47/47 绿；模式 `real-host-session`）、`reuse-metrics.mjs` **exit 0**（锚点 36/36 真）；既有门禁前后各一遍全绿且逐字一致（见 §6）。

## 1. 冲突标注（必须先说的）：E0 第①步与冻结面冲突

复审给的 E0 第①步「沿用生产 `history/` 只增事件类型」**与冻结面直接冲突**，本薄片机验如下（`run.mjs` P0，绿）：

- 生产事件名 = **20 个冻结具名**（`src/host/history/registry/types.ts:363-388`，`HistoryEventMap`；`schema/history/history-events.schema.json` 机读镜像同数）。
- `schema/**` 属 Current 冻结面（AGENTS §5，AD-EB-01）；加第 21 个事件名 = 走冻结变更流程（改契约 → `snapshot:update` → 评审），**本薄片禁改**。
- 而 E0 要写的 `assertion.recorded / evidence.linked / assessment.appended / standing.changed` 四名**都不在这 20 名里**——「沿用只增」字面即「改冻结面」。

**结论：E0 真源不能落在生产 `history/` 的写面上。** 本薄片对 `history/` 只读复用（触发器 DDL 形、双时序信封、校验 fail-closed 形、V1 事件词汇只读 crosswalk 输入），新增四名走宿主 `SessionEventMap` declare-module 插件侧扩展（宿主实测 E0-HOST-CAPABILITIES §2），零触冻结面。

## 2. 真源选择：两案对照与本选

| 维度 | 案 A：宿主 Session 事件面 | 案 B：生产 `history/` 只读复用 |
|---|---|---|
| 能做什么 | 机制强制 append-only（private log + deepFreeze + 无变异 API + jsonl 追加持久，宿主源码实测）；seq/`sourceEventSeqs` 因果/fork 前缀截点原生；`declare module` 扩事件零触冻结面（goal/tool-todo/command-feedback 先例）；订阅 `session/event` | 20 冻结事件的既有账本**读**（replay/query/rebuild 570 行逻辑形状）；触发器级 append-only 实战件（`schema.ts:131-138`）；双时序 `occurredAt/recordedAt` 与九字段强校验经验（validate.ts 630 行） |
| 不能做什么 | 真源**绑定单会话**——跨会话/跨 Space 查询必须自建投影/索引层（宿主自己示范：session-projection + projection-cache 建在 storageDomain 上）；`storageDomain` 无事务/可覆写/不跨键原子 ⇒ 不能当事件真源；无 Space/租户概念 | **写不进新事件类型**（20 冻结名 ⇒ §1 冲突）；真源在生产 DB（research.sqlite，DSH_HOME 内），侧车实验禁写生产 DB；单库单「空间」，无 Space 维度 |
| append-only 由谁保证 | 宿主机制（对象面 + 持久面双层），插件不可绕过 | 存储层触发器（`RAISE(ABORT)`）——硬，但绑在生产 schema 上 |
| 跨会话/跨 Space 需要什么 | 自建投影层（本薄片的 jsonl+sqlite 投影即最小示范）+ 手工分区（profile/DSH_HOME/storageDomain routes——宿主无现成租户隔离） | 同样自建，且新事件根本进不去 |

**本选：案 A 为真源机制形，案 B 为只读复用件。** 理由：①唯一能在不触冻结面的前提下写四事件；②append-only 是宿主机制而非纪律；③跨会话投影无论选哪案都要自建，选 B 还要额外付冻结流程。**落地形态**（本薄片实测）：宿主 `Session` 对象 = 写侧真源；E0 jsonl（digest 链）= 可重放持久真源；sqlite 投影库 = 派生读面（生产触发器 DDL 形复用）。跨会话/跨 Space 的真持久仍归投影层——这是案 A 的诚实税。

## 3. 四事件薄片（`run.mjs`，47 断言 exit 0）

- **模式 = `real-host-session`**：真源面直接 import `tests/deepseek-harness/packages/core/session/lib/`（0.2.0-rc.2 构建产物，只读）——**append/deepFreeze/seq/fork/无变异面全为宿主代码执行**，不是模型形。宿主构建产物不在位时自动退化为 `lib/eventlog.mjs` 模型形复刻（同一政策/投影/断言跑两形）。
- 链路：12 条场景事件 append（P1）→ jsonl digest 链全量重放（P3）→ 投影重折叠 = 内存面投影逐字节等（P4）→ 时点窗读回 + 冻结（P7）→ fork 前缀截点（P9）。
- **纪律一：三通道不混存（混存必拒）**——channel 单值封闭枚举（数组/组合串拒，N1/N2）、SOURCE 键名命中 `/inference|suggestion|llm_/` 拒（N3）、INFERENCE/SUGGESTION 缺/悬空 `basedOn` 拒（N4/N5）、缺通道不默认（N6）；变异锚点 N16 证明红点确实产生于纪律本体。**全部负例红 = 绿。**
- **纪律二：缺字段恒 `UNKNOWN` 禁补全（补全必红）**——缺 stance 的评估读回恒 `UNKNOWN`（N14）；`_defaulted` 族键/null 伪装缺省在写侧拒（N12/N13）；变异锚点 N15：故意补全的投影被探针抓住、正式投影 0 违规——探针非空转。
- **`standing.changed` 表达「接纳可撤回」而不把 FactStanding 做成对象（P6 显式断言）**：撤回 = 追加一条 `RETRACTED` 事件（ACCEPTED→RETRACTED→CANDIDATE→ACCEPTED 全程只 append，P6(b)）；sqlite schema **不存在 standing 表**（P5 机验）；抽掉全部 `standing.changed` 后 standing 恒 `UNKNOWN`——standing 唯一来源是事件折叠，不是对象行（P6(c)）。「接纳可撤回」= 折叠态可再变，无需对象生命周期。
- 防篡改实测：sqlite 触发器拒 UPDATE/DELETE（P8，生产 INV-HIST-1 DDL 形搬运）；jsonl 历史行改写 → 链断必红（N17）；撕裂尾读不返 + 写前截断（N18，宿主 session-persistence 语义复刻）。
- 实测发现（模型形未预见）：宿主 fork 注入 `session/end-seed` 标记且占一个 seq（P9，`types.ts:427`）——复刻面会漏掉此细节，**跑真宿主面白捡了这一课**。

## 4. 出口实测：只读 Investigator 式出口（E1–E6 绿，档位=模型形）

- 做到的：per-agent scope 工具可见性（只读面不注册写工具，E1）+ `tools/pre-execute` deny（`PreToolDecision` 判别联合逐字段对齐宿主 `tools/src/index.ts:607-612`，E2/E3）+ `systemPrompt.section` 注册/disposer（E4）+ slot 只读面板形状（**client 面**槽位，E5）。**全程零 Principal/Space/权轴参与**（E6 源码扫描机验）——「读能力出口」用宿主既有 `read-only` 形状 + scope 掩码即可成立。
- **止于模型形，如实标注**：`defineTool`/ToolRuntime 需 Cordis Scoped ctx——实测直 import 构建产物裸调抛错（记录于 `lib/exit.mjs` 头注）。起真宿主还需要：①在 `tests/deepseek-harness/` 构建并起服（AGENTS §2，含 `pnpm install` + `pnpm run clean && pnpm run build`）；②`DSH_HOME` 落 `tests/dsh-homes/<用途>`（AGENTS §3——**与本薄片「只允许新建 `reuse/e0/**`+`.scratch/`」的文件白名单冲突**，起了就越界）；③profile/cordis.patch 挂载薄片插件；④slots 需 GUI client 上下文（headless 无）。事件真源面则已是真宿主（§3），不受此限。

## 5. 复用面实测与复用率（`reuse-metrics.mjs`，exit 0）

口径：分母=薄片自写代码行（845，剔空行/纯注释）；`@e0-reuse host|own|new <锚点>` 标注按块覆盖，**档位是能力归属不是键盘归属**——host 行落地时整体删掉换成宿主调用，own 行应替换为既有件重构搬运；36 个锚点（路径:行）全部机验为真，未标注保守计新写。

| 档位 | 行数 | 占比 | 代表锚点 |
|---|---|---|---|
| 宿主直用 | 261 | 30.9% | `session/src/index.ts:722/:447/:744/:649/:681/:663/:507`（append/private/deepFreeze/窗读/seq/fork）、`tools/src/index.ts:153/:607`、`system-prompt/src/index.ts:454`、`ui-renderer/.../registry.ts:120` |
| 自家重构复用 | 255 | 30.2% | `store/schema.ts:131`（INV-HIST-1 触发器 DDL 逐字形）、`registry/types.ts:110`（双时序）、`replay/state-map.ts`（折叠投影形）、`V3_IMPLEMENTATION_CONTRACT-DRAFT.md:55/:74/:91`（三通道/UNKNOWN/standing 词汇）、`read-context.ts`（时点读两步） |
| 确需新写（含未标注） | 329 | 38.9% | digest 链防篡改、standing 折叠转移门、复用统计脚本、测试夹具本体（run.mjs 未标注 149 行多为夹具/断言脚手架） |

**真实数字：复用率 61.1%（516/845，脚本自报；机制件口径——剔除 run.mjs 夹具与统计脚本后 406/507 ≈ 80.1%）。** 这与 OVERLAP-MAP 对 V3 机制层「直接可复用 22–28%」的粗估不矛盾：E0 刻意只做 append/投影/出口三格——正是自家+宿主重叠最密的三格；V3 的核心创新格（capability 装配、授权见证、截点语义）E0 根本没碰。**复用率高是选题偏置的结果，不是 V3 也该这么低的证据。**

## 6. 门禁账（真实退出码）

| 命令 | 开工时 | 收工后 |
|---|---|---|
| `node .../g1-checklist-validate.mjs` | exit 0（绿） | exit 0（逐字一致） |
| `node .../g0-gate.mjs` | exit 0（PASS：tsc OK / 225 全绿 / 33 条已知红与基线逐等） | exit 0（同上逐字一致） |
| `node .../reuse/e0/run.mjs` | —（新薄片） | exit 0（47/47，`real-host-session`） |
| `node .../reuse/e0/reuse-metrics.mjs` | —（新薄片） | exit 0（锚 36/36） |
| `git status --porcelain` | 仅 `?? .../reuse/` | 仅新增本目录文件（`reuse/e0/**`）——零修改零删除既有文件 |

## 7. E0 路线不如 V3 的点（不许只报好消息）

1. **无 UnitOfWork/跨命名空间单提交**：E0 的「log 提交 + jsonl 镜像 + sqlite 镜像」是 post-commit 三步，中途崩溃靠 digest 链检出但**不可回滚**；V3 Kernel 的 UoW+Change Journal 是单提交原子面——E0 形状直接长大必补这一课。
2. **无 capability/装配层**：E0 的「政策绑 log」是硬接线；V3 的 Capability 注册/激活/ownsKinds 裁决是 E0 完全没有的维度，多插件共写账本时 E0 无任何装配防御。
3. **无对象/修订模型**：standing 折叠证明「不是对象也能活」，但对象目录、修订链（rev+1/based_on）、facet、重定位全缺——E0 只有事件与投影两层，读面表达力远低于 V3 read-context 的两步过滤。
4. **无 Space/隔离**：E0 单「空间」跑通不等于多 Space；跨 Space 引用、归属裁决、越权拒绝（V3 F-21 的顺序契约）在 E0 面上是真空。
5. **时点读是前缀折叠玩具**：E0 的 `viewAt` 是 O(n) 全折叠；V3 投影的游标+基线+缺口三态才是可持续读面。
6. **fork 因果检查有短路**：政策 `hasSeq` 闭包绑父日志，子的因果引用理论上可指到父独有 seq（P9 场景未触发）——真装配里这是洞，V3 的内核边界检查是结构性的。
7. **fork 的 end-seed 标记（§3）说明复刻面会漏细节**：凡是能跑真宿主的面都必须跑真的，模型形复用率里的 host 档行数在落地时会「变化」而非直接「删除」。

## 8. 文件清单

| 文件 | 作用 |
|---|---|
| `run.mjs` | 主跑手：47 断言，exit 0 = 跑通 |
| `lib/eventlog.mjs` | 宿主 Session 机制形复刻（宿主不在位时的退化面） |
| `lib/hostsession.mjs` | 真宿主适配：import `tests/deepseek-harness` 构建产物（只读） |
| `lib/validate.mjs` | 四事件政策 + 两纪律写侧 |
| `lib/projection.mjs` | 折叠投影 + UNKNOWN 纪律读侧 + 变异锚点 |
| `lib/jsonl.mjs` | digest 链 jsonl 落盘/重放/撕裂尾 |
| `lib/sqlite.mjs` | 生产触发器 DDL 形复用 + standing-非对象机验 |
| `lib/exit.mjs` | 只读出口（模型形，档位声明+起真宿主条件） |
| `reuse-metrics.mjs` | 复用率统计 + 36 锚点机验 |
