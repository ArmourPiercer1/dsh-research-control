# BASELINE_TSC_BASELINE.md — tsc known-failing snapshot（非 Frozen 证据文件）

> **定位**：本文件是 Stage-0 基线调查（2026-10-02）在 SHA `0fa2b1a1391889752ea12538071811832d2155bd` 上的 **known failing
> snapshot**——tsc 门禁真实失败的逐行证据。**不是**已通过的基线，也不声称与作者历史
> 「ZERO DIFF（40 行基线）」内容等同（历史逐行基准不存在于版本树，等同性未证）。

## 运行元数据（真实记录）

| 项 | 值 |
|---|---|
| source SHA | `0fa2b1a1391889752ea12538071811832d2155bd`（= origin/main，branch `baseline/stage0-docs-gates` 切出点） |
| 命令 | `npx tsc -p tsconfig.json`（tsconfig `noEmit: true`；include: src, tests, tsdown.config.ts） |
| 真实 exit code | **1** |
| 诊断规模 | 21 条 `error TS` / 输出正文恰 40 行 |
| 运行环境 | node v24.21.0，pnpm 11.7.0，typescript 7.0.2（`pnpm install --frozen-lockfile` 后），linux x64 |
| 运行日期 | 2026-10-02T05:41Z（UTC） |
| 完整原始日志 | 运行机 `.baseline-logs/tsc.log`（不入库；本文件为入库的逐行证据副本） |

## no-new-errors 判定规则（供后续门禁/CI 使用）

**逐行比较内容，不比较计数。** 判定方法：在相同 SHA/等价源码状态下重跑上述命令，
将输出正文与下方 `--- BEGIN/END` 之间的 40 行做**逐行 diff**：

- diff 为空 = 无新增错误（允许继续）；
- 新增行 = 回归（拒绝）；
- 减少行 = 债务清偿（记录后可更新本文件并同步修订说明）。

计数巧合（如「又是 40 行/21 条」）**不构成**通过依据。

## 诊断正文（40 行，SHA `0fa2b1a13918`，逐字副本）

```
--- BEGIN tsc output (40 lines) ---
src/client/dsh-adapter/settings-card.tsx(177,60): error TS2352: Conversion of type 'ResearchSettingsSection' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'ResearchSettingsSection'.
src/client/views/shell/investigator-page.tsx(55,8): error TS2307: Cannot find module '../../shared/analysis-command.js' or its corresponding type declarations.
tests/discovery/host-commands-reinit.test.ts(141,21): error TS2345: Argument of type '{ readonly name: string; readonly description: string; readonly input?: { readonly hint: string; readonly images?: boolean | undefined; } | undefined; readonly recordInput?: boolean | undefined; readonly handler: (invocation: { ...; }) => Promise<...> | CommandOutcome; }' is not assignable to parameter of type 'RegisteredCommand'.
  The types returned by 'handler(...)' are incompatible between these types.
    Type 'Promise<CommandOutcome> | CommandOutcome' is not assignable to type 'Promise<CommandOutcome>'.
      Type '{ readonly kind: "success"; readonly text?: string | undefined; }' is missing the following properties from type 'Promise<CommandOutcome>': then, catch, [Symbol.toStringTag], finally
tests/rpc-face/rpc-face.test.ts(81,9): error TS2740: Type '{ getDashboard(): Promise<DashboardSnapshot>; getProject(): ProjectSnapshot; getTopic(a: GetTopicArgs): TopicSnapshot; ... 21 more ...; restoreDeclarativeFile(a: RestoreDeclarativeFileArgs): Promise<...>; }' is missing the following properties from type 'ResearchRpcServices': setCurrentFocus, getCurrentFocus, createTopic, createWorkstream, and 4 more.
tests/views-shell/investigator-page.test.tsx(152,12): error TS18047: 'container' is possibly 'null'.
tests/views-shell/missing-modal.test.tsx(138,8): error TS2739: Type '{ sessionId: string; loadPlaneState: () => Promise<GetResearchPlaneStateResult>; loadHubOverview: Mock<() => Promise<HubOverviewResult>>; ... 8 more ...; ackMissingReminder: (args: AckMissingReminderArgs) => Promise<...>; }' is missing the following properties from type 'ResearchShellProps': readInvestigatorTransient, loadAnalysisRecords, saveAnalysisRecord
tests/views-shell/onboarding.test.tsx(218,8): error TS2739: Type '{ sessionId: string | undefined; loadPlaneState: () => Promise<GetResearchPlaneStateResult>; loadHubOverview: Mock<() => Promise<HubOverviewResult>>; ... 10 more ...; inspectProjectDirectory?: ((args: InspectProjectDirectoryArgs) => Promise<...>) | undefined; }' is missing the following properties from type 'ResearchShellProps': readInvestigatorTransient, loadAnalysisRecords, saveAnalysisRecord
tests/views-shell/settings-page.test.tsx(89,5): error TS2322: Type '(args: RescanArgs) => Promise<PlaneStateSummary>' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '(args: RescanArgs) => Promise<PlaneStateSummary>' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
    Type '(args: RescanArgs) => Promise<PlaneStateSummary>' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(90,5): error TS2322: Type '(args: BindProjectArgs) => Promise<BindProjectResult>' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '(args: BindProjectArgs) => Promise<BindProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
    Type '(args: BindProjectArgs) => Promise<BindProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(91,5): error TS2322: Type '(args: SetHubArgs) => Promise<SetHubResult>' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '(args: SetHubArgs) => Promise<SetHubResult>' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
    Type '(args: SetHubArgs) => Promise<SetHubResult>' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(92,5): error TS2322: Type '(args: UnbindProjectArgs) => Promise<UnbindProjectResult>' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '(args: UnbindProjectArgs) => Promise<UnbindProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
    Type '(args: UnbindProjectArgs) => Promise<UnbindProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(93,5): error TS2322: Type '(args: RestoreProjectArgs) => Promise<RestoreProjectResult>' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '(args: RestoreProjectArgs) => Promise<RestoreProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
    Type '(args: RestoreProjectArgs) => Promise<RestoreProjectResult>' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(94,5): error TS2322: Type '(() => void) | (MockInstance<Constructable | Procedure> & (new (...args: any[]) => any) & {})' is not assignable to type 'Mock<Constructable | Procedure>'.
  Type '() => void' is not assignable to type 'Mock<Constructable | Procedure>'.
    Type '() => void' is not assignable to type 'MockInstance<Constructable | Procedure> & { (...args: any[]): any; new (...args: any[]): any; } & {}'.
      Type '() => void' is not assignable to type 'MockInstance<Constructable | Procedure>'.
tests/views-shell/settings-page.test.tsx(116,9): error TS2322: Type 'Mock<Constructable | Procedure>' is not assignable to type '() => void'.
  Type 'MockInstance<Constructable | Procedure> & (new (...args: any[]) => any) & {}' is not assignable to type '() => void'.
    Type 'MockInstance<Constructable | Procedure> & (new (...args: any[]) => any) & {}' provides no match for the signature '(): void'.
tests/views-shell/settings-page.test.tsx(298,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(361,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(362,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(412,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(523,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(558,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
tests/views-shell/settings-page.test.tsx(566,19): error TS2740: Type 'Element' is missing the following properties from type 'HTMLElement': accessKey, accessKeyLabel, autocapitalize, autocorrect, and 131 more.
--- END tsc output ---
```
