/**
 * Application Use-case 层的**委派面**（D-19c，外部复审第三轮，2026-10-30）。
 *
 * ## 这一层是什么，凭什么进写面白名单
 *
 * 三层写面的分工（`tests/domain-write-face.test.ts` 逐目录强制）：
 *
 * | 目录 | 角色 | 允许的写面 |
 * | --- | --- | --- |
 * | `src/kernel/**`、`src/contracts/**` | 机制本身（写面的实现处与契约） | 不受本门禁扫描 |
 * | `src/app/**`（本目录） | **Application Use-case**：跨领域协调 | 同一条事务内经**对象拥有者的作用域端口**落笔；机制级 H 写入（`appendLedger`）需带 `D-19c-ALLOWED` 标记 |
 * | `src/harness/**` | **装配根**（测试世界的组合根，对应 #44 §4 `product/`）：构造 Kernel、授予委派、构造用例 | 同上（当前 0 处直接写；要加必须先在此登记理由） |
 * | `src/domains/**` | 领域插件 | **零**通用写面；只能经 `PluginFace.writerFor(tx)` 的自有端口 |
 *
 * 谁能进：只有**由装配根构造、且只被装配根注入委派**的用例类。判据不是"文件名看着像"，
 * 而是下面两条都被门禁钉住：① 本目录不得出现 `createObject/revise/linkRef/declareRecord`；
 * ② 出现 `appendLedger` 的每一行必须带 `D-19c-ALLOWED` 标记，门禁把全部命中行**列出来**
 * 供人复核（白名单不是一条豁免，是一份要逐条签字的清单）。
 *
 * ## 为什么协调权不等于豁免权
 *
 * 用例拿到的不是通用事务句柄，而是**某个拥有者的作用域端口**（`NamespaceWriter`）：
 * 它能写的 kind 与那个领域自己拿到的端口**完全相同**，一步都多走不了
 * （归属不符照样 `CAPABILITY_SCOPE_ESCAPE`，见 `tests/use-case-write-path.test.ts`）。
 * 因此"经装配根委派"不会产生第二个权威——它只是把**领域自己的权威**在一条事务里请出来。
 * 业务规则也不在这里：用例只消费领域产出的草稿（`LedgerEventDraft` / `RefEdgeDraft`）。
 */
import type { NamespaceWriter, UnitOfWork } from '../kernel/kernel.ts';
import type { CapabilityId, ObjectKindLabel } from '../contracts/index.ts';

/**
 * 装配根注入给用例的**唯一**跨能力入口。
 * 故意不给 `uow()` / `port` / `raw`：用例只在**别人交给它的**事务里落笔，
 * 它既不能自开事务（那会把原子性切成几段却声称原子），也不能绕过端口直接写。
 */
export interface UseCaseDelegation {
  /**
   * 取「注册表判定拥有该 kind 的能力」的作用域写端口。
   * 归属**查出来**而不是写死：路由移交（`transferRoute`）后用例自动跟随，
   * 用例里也就不会出现任何具体 capability 常量。无人拥有该 kind ⇒ `CAPABILITY_INACTIVE`。
   */
  writerOwningKind(kind: ObjectKindLabel, tx: UnitOfWork): NamespaceWriter;
  /** 取指定能力的作用域写端口（同样只能写那个能力拥有的对象）。 */
  writerOf(capability: CapabilityId, tx: UnitOfWork): NamespaceWriter;
}
