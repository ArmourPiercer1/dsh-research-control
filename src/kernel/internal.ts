/**
 * 机制内部通道（D-7 收口的落点）。
 *
 * `Kernel.port` 此前是**公开只读属性**：拿到 Kernel 就等于拿到 `StoragePort`，
 * 再 `port.raw` 就是裸 SQL 句柄——检查报告全文可被原始 `SELECT` 取走（S-5），
 * 追加式存储也可绕开机制写入。把它改成 TS `private` 没有意义：`kernel['port']`
 * 在 JS 里照样取得（`#port` 才是运行时不存在）。
 *
 * 但 Kernel 的兄弟模块（`read-context.ts` 的双时间读、`projection.ts` 的索引重建）
 * 确实需要存储句柄，且必须与可见性截点来自**同一次 read**。因此这里开一条显式内部通道：
 *
 * - 键是 **symbol**：不出现在 `Object.getOwnPropertyNames` / `for...in` / `JSON.stringify`
 *   里，插件面快照与运行时面断言都不会把它当"可见成员"；
 * - **代价如实写**：symbol 可经 `Object.getOwnPropertySymbols` 枚举，也可被 import。
 *   所以这条通道提供的是**边界显式化 + 可门禁性**，不是密码学隔离。
 *   真正的强度来自门禁：`src/domains/**` 与 `src/contracts/**` 禁止 import 本模块，
 *   由 `tests/arch-independence.test.ts` 的依赖方向扫描把守（见该文件的 INTERNAL 规则）。
 */
export const KERNEL_PORT = Symbol('KERNEL_PORT');
