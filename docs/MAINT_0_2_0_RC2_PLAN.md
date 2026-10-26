# MAINT_0_2_0_RC2_PLAN.md — dsh-research-control 升级 DSH 0.2.0-rc.2 实施计划

> 状态：maintenance 分支执行计划（非 Frozen 文档）。
> Base：`origin/main` @ `c590e25`（G5 收口 + EB1/EB2 工程基线 + P2 语义侧车之后）。
> Worktree：`.scratch/wt-migrate`，branch `maint/train-0.2.0-rc.2`。
> Reference/test DSH checkout：`tests/deepseek-harness`（AGENTS §2 唯一测试实例；
> clone 自 `https://github.com/ArmourPiercer1/deepseek-harness.git`，checkout
> `c1b47e41fc` = `release(dsh): 0.2.0-rc.2`，root package.json 版本核验一致；
> 按 §2 train 切换纪律 `pnpm run clean` → `pnpm run build`）。
> 宿主 core patch budget = 0（不改测试实例任何文件）。
> 前身：本计划的初版由旧草稿 PR #8（本地分支 `pr8-inspect`，base `8b91051`）制定，
> 其「四个必须处理的破坏面 F1–F4」结论在新基线上逐条复核后照用；本文件记录其在
> `main=c590e25` 上的重新落地。

## 已核验的 base 实测（升级前）

- `pnpm run check:types`（main 基点）：tsc-gate 报 21 条已知债务基线精确复现
  （`dev/engineering/tsc-debt.ids` 归一化身份比对）。
- 0.2.0-rc.2 发布面核验（release 提交 `c1b47e41fc` + npm registry 双向核对）：
  train 全家族（dsh-home-paths / dsh-llm / dsh-tools / dsh-typert-protocol /
  dsh-scope / dsh-session-projection / dsh-typert-loader / dsh-typert-registry /
  dsh-agent-preset-registry + overrides 九包）均发布 `0.2.0-rc.2`；vendored
  cordis = `4.0.4`、cordis-plugin-group/include/loader = `1.0.4/1.0.9/1.0.5`、
  schemastery = `3.18.4`。`@deepseek-ai/dsh-code-runtime` **未发布** 0.2 train
  （registry max 0.1.5-rc.3、0.2 monorepo 无此包、0.2 依赖闭包无消费者）——
  overrides 该条删除而非重钉。

## 四个必须处理的破坏面（独立源码审查确认，不能只改 pin）

### F1 — Typert strict codec 与 manifest.schemas 需要 `create: () => schema` factory
0.2 的 `TypertCodec`（reference `packages/typert/protocol/src/types.ts:267-293`）
strict 分支以 `create: () => TypertSchema` 取代旧 `schema` 值对象；loader 的
`validateTypertManifest`（0.2 `packages/typert/loader/src/index.ts`）对
`TYPERT.schemas` 条目同样要求 factory。旧形状会被真实 loader 拒绝。

**改动**：
- `src/shared/rpc-contracts.ts`：`TypertCodecMirror` strict 分支改
  `{ mode, typeSymbol, create: () => TypertSchemaLike }`；`argsParameter()` /
  `descriptor()` / ping descriptor 构造点改为惰性 factory（闭包引用同一 zod
  实例 — 同实例，不复制）。
- `src/host/dsh-adapter/host/typert.artifact.ts`：`ALL_SCHEMAS` 97 条目
  `{ name, schema }` → `{ name, create: () => schema }`（具体字段以 0.2
  manifest 类型为准）。
- `tests/rpc-face/loader-validation.ts`：镜像逻辑同步 0.2 语义。
- **REAL-face 验证（防假绿）**：devDep 真实
  `@deepseek-ai/dsh-typert-loader@0.2.0-rc.2`（registry 已发布，旧的
  0.0.1-rc.1 陈旧问题消失），新增/改造测试：对 `REGISTERED_RESEARCH_INVOCATIONS`
  全 59 invocations + `build` 产物 `lib/typert.host.js` 的 `TYPERT` 导出直接调
  真实 `validateTypertManifest`（另含 `./remote` 贡献面），全绿才算 F1 完成；
  负例：旧 `{schema}` 值对象形状必须被真实 loader 拒绝（红→绿证据）。
- `pnpm run build` 重建 lib（生成物入 pack）。

### F2 — `Session.events` 已移除；`snapshotEvents()` 禁止新增生产调用
0.2 `Session` 无 `events` 属性；`snapshotEvents()` 带 deprecated JSDoc 且上游
禁止新增 production callers/wrappers。**机械替换成 `snapshotEvents()` = 违规。**

**改动**：`src/host/dsh-adapter/session.ts`
- `listSessions()` 的 title/blank 派生改用
  `ctx.sessionProjections.stateOf(session, 'title' | 'turnBoundary' | 'agentPreset')`
  投影面（具体 unit 键/返回形状以 reference 源码为准）；`SessionLike` 去掉
  `events` 字段。
- `session/event` 计数订阅与 lifecycle created/disposed 计数保留（事件名在 0.2
  仍为 `session/created`、`session/disposed`、`session/event` — reference 核验）。
- preset 选择变化：`header.agentPreset` 是创建事实（不是当前选择）；
  `SessionSummary.agentPreset` 改从 agentPreset 投影读当前值，header 值仅作
  fallback/创建事实记录。
- 测试：`tests/session-adapter.test.ts` 的 fake `SessionLike` 改为投影面 stub；
  新增覆盖 title 更新、turn/start 翻转 blank、preset selection 变化、disposal
  后投影缺席路径（count 语义保持）。

### F3 — Agent preset：文件 ensure → 声明式 registry 注册
0.2 `@deepseek-ai/dsh-agent-preset-registry`：preset 是普通 plugin 行
`{ id, plugins }` 的声明式注册（registry 不扫目录、不读文件、不写声明）；
旧 `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml` 落盘 ensure 不再是声明渠道。

**改动**：
- `src/host/dsh-adapter/launcher/adapter.ts`：删除 `writePresetFileIfAbsent`
  文件落盘与 `resolved.path` 回读；`resolveOrEnsure` → registry 面：
  `registry.resolve/mount(ctx, id)`，闭集校验改从 `readDocument(id).content`
  （声明内容）解析 — `parsePresetComposition` 保留为闭集只读门（输入 =
  declaration content，不是文件 path）。
- registry 缺席（`ctx.get(...)` undefined）时**不再降级启动**：用户裁定保持
  授权不放宽 — 无 roster = 无法证明闭集只读组合 ⇒ fail-loud `IVL_PRESET`
  （行为收紧，测试钉住）。
- `src/host/dsh-adapter/launcher/types.ts`：Like 面按 0.2 重写 — `AgentPreset`
  无 `path`；unknown preset = `RemoteError` code `agent-preset` /
  `not-found`、`details { agentPreset, available }`（非 top-level `presetId`）；
  `isUnknownPresetError` 按新形状判定。
- `src/host/service/investigator/preset.ts`：render/parse 保留（内容面闭集
  不变：4 只读工具 + fs-search 审计键；0.2 中 fs-search 的
  `sampleOverCapGlobResults` 键按 reference 实源复核，漂移即同步）；
  renderer 输出改为 registry `plugins` 声明所用形态（或仍产 YAML 文本由
  readDocument 对拍 — 以 reference `readDocument().content` 实际形态为准）。
- **真注册测试**（不许 roster-less fake 蒙混）：devDep
  `@deepseek-ai/dsh-agent-preset-registry@0.2.0-rc.2`（或其真实类型面），用真实
  registry 服务实例注册 `research-investigator` 声明，断言 resolve/mount/
  readDocument 与 unknown → `agent-preset`/`not-found` + `details` 契约；
  closed read-only composition 验证、7 写工具 deny、`/permission` 失败必须先于
  followup — 全部保留并有测试。

### F4 — 版本统一 0.2.0-rc.2
- `package.json` peer/dev/deps：`@deepseek-ai/dsh-{home-paths,llm,tools,
  typert-protocol}` → `0.2.0-rc.2`；cordis 版本以 0.2 monorepo 实际 vendored
  版本为准（reference 核验）；devDep 增加 `@deepseek-ai/dsh-typert-loader`、
  `@deepseek-ai/dsh-agent-preset-registry` @ `0.2.0-rc.2`。
- `pnpm-workspace.yaml` overrides 十包 train → `0.2.0-rc.2`；
  `pnpm-lock.yaml` 重解。
- `src/host/dsh-adapter/host/index.ts`：`minDshVersion` default
  `0.1.0-rc.8` → `0.2.0-rc.2`。
- `scripts/e2e-run.sh`：`EXPECTED_DSH_VERSION="0.1.0-rc.8"` → `"0.2.0-rc.2"`。
- 版本守卫限制如实记录：guard 读 plugin-local typert package.json，**单独不能
  证明 real host** — real-host 证明 = e2e 的 `dsh --version` 精确匹配 +
  reference checkout SHA/clean 记录。

## 门禁（red → minimal fix → green，逐项记录 exit/计数）

1. `pnpm run check:types`：tsc-gate 归一化身份比对 21 条债务基线（train 迁移前后
   同一身份集，无漂移即不重录 `tsc-debt.ids`）。
2. `pnpm run lint`（check-imports：INV-PERM-5）。
3. `pnpm run build`（tsdown + snapshot-release 双向 sha256：冻结面 31 文件不动）。
4. `pnpm test`（vitest 全量；对比基线计数）。
5. `pnpm run docs:check`（EB2 静态一致性 + registry 登记核对）。
6. `pnpm run pack:verify`（含新增 REAL `validateTypertManifest` 面门）。
7. live boot 冒烟（worktree 内新测试实例 + DSH_HOME 落位 + 本包 pack 装 profile：
   profile 全 train、版本门静默、settings 面 boot、HTTP 401/303——同时构成
   B-EB3-1 的正面回答）。
8. read-path 写负例与 e2e 全链复跑：迁移评审合入后按 G3 遗留动作执行
   （TC-DSH-008 世界 = train CLI，本迁移只重锚 pin，不改 TC-DSH-005/008/009 语义）。

## 隔离与资源

- 端口：live 冒烟用 3290-family 空闲端口（先查后占），绝不触碰 :3080。
- DSH_HOME / HOME / pnpm storeDir：全部落 `tests/dsh-homes/` 内（AGENTS §3 +
  docs/testing.md 配方）；起服 / 探测 / 关停写在同一个 bash 调用里。
- 进程：只启停自己启动的 server；一次一个重 build。

## 新基线落地状态（branch `maint/train-0.2.0-rc.2`，本文件随迁移提交入库）

F1–F4 + F5（settings 0.2 模型）全部落地；门禁与冒烟（2026-10，worktree
`.scratch/wt-migrate`，测试实例 = `tests/deepseek-harness` @ `c1b47e41fc`）：

- `check:types`：tsc-gate 21 条债务身份精确复现（新旧基线同一身份集，无漂移）。
- `lint`：INV-PERM-5 零违规；`build`：RC=0，SNAPSHOT 31 文件双向 sha256 绿
  （冻结面零触碰）；chunk 轮换 BAeOX3y7/CAb1T63d → BOYj4aMX/CmHDfUDF。
- `pnpm test`：351 files 绿 / 6 skipped，5033 tests 绿 / 21 skipped，0 失败。
- `pack:verify`：PASS 521 entries；REAL `validateTypertManifest` 面门在场
  （59 invocations 全 strict create() + 115 schema 工厂）。
- `docs:check`：OK（1104 tracked files）；lib 提交态与 rebuild 仅
  rcm-css 构建路径噪声（freshness 归一化绿）。
- **live boot（`tests/dsh-homes/live-maint-rc2/`，端口 3297）**：新 profile
  `plugin add` 本包 tarball → profile node_modules `@deepseek-ai/dsh-*`
  全 `0.2.0-rc.2`（cosmokit 1.8.6 / schemastery 3.18.5 = caret 范围解析）；
  boot 日志 settings-0.2 模型行 + 空平面诚实态行在场；版本门静默
  （MIN_VERSION/VERSION_UNREACHABLE 0 命中）；HTTP：无 token `GET /` → 401、
  带 token → 303、`POST /api/researchControl/ping` 无 token → 401；
  `--dump-config` 含 `- id: research-control` 行；停服端口释放。
  **B-EB3-1 正面回答：0.2.0-rc.2 世界可 boot**（rc.8 的 HMR 起服崩溃不在
  本 train；e2e CLI pin 已重锚，TC-DSH-008 全链复跑留待评审合入后）。

## 客户端半环收口（R5：settings-card → configForms，branch `maint/settings-card-configforms`）

迁移报告点名的遗留「浏览器侧设置卡片交互待后续 PR——host 面 F5 已完整」已
收口（分支 `maint/settings-card-configforms`，评审合入前不碰 main）：

- 席位：卡片注册到 0.2 的 KEYED `plugins.row.config`（bundle 配置席位），
  键 `dsh-research-control#research-control`（config-ledger `rowConfigKey`，
  按 `options.key` 路由——上游 DRAFT PR #8 草稿态误用 `id`，本迁移按一手
  ledger 源码修正）；GUI 路径 插件管理 → Installed → dsh-research-control →
  research-control。
- 写面：一次原子 `form.mutate([set projectTreeDir, set hubDir],
  expectedRevision)`（0.2 契约：全部 op 共享一条 revision 栅栏 + Host 校验 +
  持久化裁决 + recovery read）；`false`＝未写入任何内容（不回退、不 rescan、
  write-error）；失联补偿＝fenced 回退（fence＝我方被接受写产生的
  revision，迟到写者不被踩踏）+ 恢复态 rescan；第二故障 `restoreFault`
  随 outcome 上报并由卡片渲染。行页 owner `form` 为优先写路径（自定义
  owning entry id 保身份），`configForms.get('research-control')` 为
  fallback；两者皆无＝诚实「未就绪」拒绝（warn-once）。
- 配对：entry id 单源入 `src/shared/research-settings.ts`
  （`RESEARCH_SETTINGS_ENTRY_ID`，host 读面 re-export）；卡片注册无条件——
  迟到服务经每次 face 构建到达（settingsScope 时代的 re-probe 定时器不再
  需要，fix 分支的迟到注册负例在新形态下以更强断言保留：fake-timer 守卫 +
  无服务注册 + 诚实拒绝三例）。
- 门禁（本分支实测）：tsc-gate 21→20（清偿 settings-card TS2352 一条并同
  提交重录基线）；lint OK；build RC=0（SNAPSHOT 31 双向绿，冻结面零触碰）；
  `pnpm test` 352 files / 5062 tests 绿 / 21 skipped（settings 族 80→109，
  其中新 `tests/views-settings/settings-card-adapter.test.ts` 17 例）；
  pack:verify PASS；docs:check OK。
- 遗留（如实）：GUI 浏览器走查（Installed 导航往返、`false` 拒绝路径、
  unload/reload）——无头环境不可跑，列为评审后首台批次；live boot 未动用
  （类型面一手核验 + 单测闭环，预算 ≤1 次用 0 次）。

## 遗留缺口收编状态（2026-10-27，只追加）
- **settings-card→configForms**：✅ PR #34（tsc 债 21→20 清偿一并入库）；
  其遗留 = GUI 浏览器走查（读写往返/拒绝路径/unload-reload 重现）。
- **load/unload/reload 泄漏环**：✅ 无头层入库（tests/lifecycle/ 4 环 7 例：
  3 轮装载回基线/preset 效应回收+Duplicate 竞态/fake-timers 归零/客户端
  apply 环；harness=真 cordis Context+真 Entry.update，与 plugin-manager
  GUI 同一 API 对）。live 层未烧（0/1）：0.2 无重启重复装卸的唯一控制面是
  GUI/HTTP，其底层即无头层锁定的同一 API——并入 GUI 走查批次。
- **0.2 无头 GUI 探针**（2026-10-27，main=0c91fae，`.scratch/gui-probe-02-notes.md`）：
  t63/t61 皆红但**零 (B) 真回归**——插件在 0.2 世界渲染/写入/重扫工作；卡片真实
  形态 = 插件管理 → research-control **行配置页**（`[data-testid=settings-card]`），
  写面 form→`cordis.patch.yml`，服务端同刻 `rescan-completed`——settings-card
  读写往返已无头覆盖。红的归因（全 (A) 类）：0.2 首屏模态更名 Preview Notice/
  预览版说明（helpers 锚旧名且 en-only）；0.2 设置对话框无「插件」nav（旧路径
  整层不存在）；settings.yaml 载体退役迁 profile 补丁；0.2 BrowserAuth 令
  `/api` 需 cookie。
- **e2e spec 族 0.2 适配**（由探针派生，另包进行中）：helpers 关窗双语选择器、
  t61 导航重写走插件管理页、node 侧 RPC 带 cookie、t63 会话种子 v4+zstd。
- **e2e 0.2 适配包**（PR #39）：t61 导航重写（行配置席位双语锚）+ cookie 上行 +
  t63 生产后端会话种子 + helpers 双语关窗；**t61 全绿过程中抓出并修复一个真 (B)
  回归**：0.2 行配置席位交的是渲染期 state 值拷贝（train PluginManagerPage.tsx:1258），
  卡片回退 fence 读到陈旧 revision 必自冲突（盘留未验证值）——修复为快照未推进时
  委托宿主自身镜像 revision 作 fence（新回归测试 + t61 CASE2 端到端复验）。
- **GUI 走查批次清单（再更新）**：~~t61 读写往返/拒绝路径/失联回退~~ ✅无头全绿；
  ~~双主题~~ ✅t63 截图覆盖；仍待人眼：已保存瞬态观感、插件管理页 unload-reload
  重现、真 enable/disable 泄漏环、investigator 一键调查。
- **investigator 一键调查 GUI 走查**：待浏览器批次（与上同批）。
