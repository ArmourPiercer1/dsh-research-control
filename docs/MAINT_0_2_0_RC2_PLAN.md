# MAINT_0_2_0_RC2_PLAN.md — dsh-research-control 升级 DSH 0.2.0-rc.2 实施计划

> 状态：maintenance 分支执行计划（非 Frozen 文档）。
> Base：`origin/main` @ `8b910513e188db5aac08b8840756f2f25b8028d4`（G1–G5/11-tool 已合并）。
> Worktree：`.worktrees/maint-0.2.0-rc.2`，branch `maintenance/dsh-0.2.0-rc.2`。
> Reference/test DSH checkout：`.dsh-ref/deepseek-harness`（本地 hardlink clone 自共享只读
> pristine `/srv/workspace/dsh-stable-3-0.2.0-rc.2/deepseek-harness`；其 origin 为
> `https://github.com/ArmourPiercer1/deepseek-harness.git` 的 `stable-3-0.2.0-rc.2`
> @ `639ed015397290b3745d163aafe02ffee4aa3f84`，clean，root/CLI 版本 `0.2.0-rc.2`，
> 远端同名 branch 同 SHA — `git ls-remote` 一手核验）。
> 宿主 core patch budget = 0（不改 reference checkout 任何文件）。

## 已核验的 base 实测（升级前）

- `npx tsc -p tsconfig.json`：exit 1，21 条 `error TS` / 40 行，与
  `docs/BASELINE_TSC_BASELINE.md`（0fa2b1a 快照）逐行相同 → 债务无漂移，
  见 `.maint-logs/tsc-base-8b91051.log`。no-new-errors 判定 = 对本文件所述
  base 输出逐行 diff。
- 基线 vitest：`.maint-logs/vitest-base-8b91051.log`（改动前运行）。

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

## 门禁（red → minimal fix → green，逐项记录 exit/计数/日志路径）

1. `tsc`：与 base `.maint-logs/tsc-base-8b91051.log` 逐行 diff，无新增行
   （历史 21 条债务如实保留，不宣称修好）。
2. `pnpm run lint`（check-imports：INV-PERM-5）。
3. `pnpm run build`（一次一个重 build，串行）。
4. `pnpm test`（vitest 全量；对比基线计数）。
5. `pnpm run pack:verify`。
6. REAL 11-tool registry battery（隔离 DSH_HOME + `dsh@0.2.0-rc.2` CLI）。
7. Investigator + RPC smoke（真实 host：GUI 一键 → preset → `/permission`
   先结算 → followup；read paths 零未授权写 — 负例保留）。
8. UI conversation/settings load-unload-reload（e2e-run.sh 全周期，
   E2E_PORT=3191 空闲实测后选用；端口先查后占）。
9. read-path 写负例：任何 read RPC/readDocument 前后快照目标目录，无写。

## 隔离与资源

- 端口：3180-family 归 team；本 run 用 3190-family（3190-3195 已实测空闲）。
  绝不触碰 :3080。
- DSH_HOME：全部在新 worktree 内的 `.maint-smoke/dsh-home`（e2e 的
  DSH_SMOKE_ROOT 指向 worktree 内路径）。
- 进程：只启停自己启动的 server；一次一个重 build；每个命令有 log。
