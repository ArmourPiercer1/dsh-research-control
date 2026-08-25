# SNAPSHOT.md — 发布期快照清单（SI-001；生成物，勿编辑）

> 生成时间：2026-08-25T09:19:07.470Z
> 源根（开发期正本，唯一）：`/home/armourpiercer/projects/dsh-plugins/research-control-plane`
> 政策：`docs/execution/spec-issues/SI-001.md`（`resolved-compatibly`）+ ARCHITECTURE §2.1「目录结构（冻结目标）」。

**只读声明**：本包内 `schema/**` 与 8 份根文档是工作区根冻结产物的**内容一致只读快照**
（逐文件 sha256 核验，见下表）——它们**不是**契约正本；正本唯一留在源根，冻结变更只走
解冻-修改-重冻结流程（计划书 §40）。快照文件权限 0444/0555；重新生成 = `pnpm run build`
（`scripts/snapshot-release.mjs` 幂等重写）。

共 31 个文件（8 文档 + 23 schema）。

| 文件（包内相对路径） | sha256 | 字节 |
|---|---|---|
| `ARCHITECTURE.md` | `b4ee4a221baeebcbcfe579ed0be94067a5838e9fe284cc357d6c6cf51a0aa9da` | 26130 |
| `DOMAIN_SCHEMA.md` | `e015444da17e901fbe6132eae5e585e31fc0f595417867284f7e4a5137b1232a` | 34545 |
| `DSH_ADAPTER.md` | `6be9c1cbf218b2a6b49cc08785856169923517ab351d245dcdf63010586431e5` | 31639 |
| `GIT_INTEGRATION.md` | `266f3198a5a4de524d89aab16e20cde162c652fe660789ea56c0f861106aa35b` | 12145 |
| `HISTORY_EVENT_CATALOG.md` | `5c0212e2edbffa126aeceeef80ac20b4a92010bcd8abc445619eba00f595de61` | 14388 |
| `PLAN_FORK_SPEC.md` | `4e38cbc099a7f3b30fbd0205da3d3eb40601976625c6e55c002a18618e651c1a` | 11746 |
| `SUBAGENT_ROUTING.md` | `4b1f3f5f403157d2db0514efb4e6b61949a8623660d4ea3c51aed6bcc239e975` | 3086 |
| `TEST_MATRIX.md` | `17cfd2df5675ff43cd7b4c15e324000700d26477640a6cba22f1a611c16e841a` | 18338 |
| `schema/common.schema.json` | `42bfedf45836aeafa2d03bfa18432b1d184a68830e03cf6c105766e28ea91d64` | 4268 |
| `schema/declarative/agent-plan-fork-policy.schema.json` | `7b1756592fd291d9ca57795422a0fed99c716dbceb9b36a8e6a92fa36b941534` | 1331 |
| `schema/declarative/gate.schema.json` | `a2345ae05dc96c17ff8b0ffc7c1b2d06034eb558e7170ab252e57c14b2706859` | 860 |
| `schema/declarative/milestone.schema.json` | `365006f7a4d30585d46b03b472e7759c1a31de9fca7a4610849cb05158fc79e8` | 797 |
| `schema/declarative/objectives.schema.json` | `bf093efe592256a8f700951f4dd6d96880d7f0584f74269dd59f92b3bec7571b` | 1653 |
| `schema/declarative/plan.schema.json` | `47c7af09e5c33ad4be5c8e8b34d82a4b7aca9a978ce994de523a853ef1b0d8de` | 658 |
| `schema/declarative/project.schema.json` | `31bbd81720ed7dd08f15b259c91b4a73bb8b2b891442cde478e4bba110184ca4` | 960 |
| `schema/declarative/task.schema.json` | `08e3e154f64a5be504a1d08c8be62a16f0f2d83fb63476cb3e53673a476612c9` | 1212 |
| `schema/declarative/topic.schema.json` | `0c83bc6ad3a5a5711d0a6ce1ef763dbb08ad576a74eceb24c94c6a49995738a1` | 944 |
| `schema/declarative/topology.schema.json` | `58b1fa0d3515e1a21948e5e4c6e30d7487418fee2389c7cd798d5ce9e2a367f3` | 1651 |
| `schema/declarative/workspace.schema.json` | `380d7baec9cca9bb1f08e59ed10f69a35715ef89a8551cb72e149598919f997d` | 1488 |
| `schema/declarative/workstream.schema.json` | `870c63a11bf24dc128598158e57e73570727cf45e57d6dbc3fc83eaea2514fcf` | 860 |
| `schema/history/history-event-envelope.schema.json` | `e60232881e6810b766c2e624b886504aae215873b076e022d238c8987ca3a634` | 1177 |
| `schema/history/history-events.schema.json` | `2e605ff054905f0984d34bc69f25664fdb73aca5528e26a4fb01976c34977328` | 14853 |
| `schema/operational/attention.schema.json` | `1fa9e083fe67e93f74fc6804c37412b79c596e3aee4debc5c51af0f70c1bd29b` | 3932 |
| `schema/operational/inbox.schema.json` | `0795063a1c2283a5dcb9434f5e9bd273a9d18dd2e63005fac49e72515b89bbb5` | 1180 |
| `schema/operational/plan-fork.schema.json` | `9c1ef2047090e89115a885b58fc3e6ccd23428ca1c5b62e3456b5c003a45049e` | 4646 |
| `schema/operational/provenance.schema.json` | `7eba4c81d025cf23e252f8f913c37c1ead79699e5eef2f27664b64ce72d3feba` | 2317 |
| `schema/operational/relation.schema.json` | `42a982e915d1b1fced1cd1a8845f177dce762f4bc4f91053c1928537790a3334` | 1306 |
| `schema/operational/reporting.schema.json` | `d837a2e699f9b401039f4e9b17409d7f1e48e56b7cb3f10aa7345d3c5b03b88d` | 3545 |
| `schema/operational/run.schema.json` | `fbc42af6fa2dda9fbe6957fa84658e2c94fe480c5797fbbd6989a89338592c46` | 2023 |
| `schema/operational/semantic-labels.schema.json` | `e16cf0cf1b1ed06193081a7c9dc673355fb6932fd5f74869bc0d2846f7bc7dce` | 2811 |
| `schema/README.md` | `4081c7045c04f2234c11ad0895c9de47efe12780b9b58032da4a73d00a0c476b` | 3418 |
