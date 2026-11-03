import type {
  DeclareRawIntakeCommand, RawIntakeCommandPort, RawIntakeEnvelope, RawIntakeReceipt,
} from '../contracts';

/**
 * 记录域 `RawIntakeCommandPort` 的唯一实现（R-9 / DC-5 / DC-11，方案 2 最小形态）。
 *
 * 它是 **Application 的公开具名入口**，但**不签发事件**：内部只把命令剥成数据
 * （`RawIntakeEnvelope`）转调机制签发点 `Kernel.declareRawIntake`。
 * 归属判据：`raw-record-declared` 是机制自有事件——领域不得经 `appendAuthoritativeEvent`
 * 签发它，也不得由清单认领它；能做的只有"请求机制签发"。
 *
 * 三件**不做**：不建对象（原始记录不是对象面事实，回执里没有 oid/revision 可伪造）；
 * 不解释 `text`（机制零语义）；不把 `unparseable` 当拒绝理由（DC-11：解析失败是数据不是闸门）。
 */
export function createRawIntakeCommandPort(
  declare: (env: RawIntakeEnvelope) => RawIntakeReceipt,
): RawIntakeCommandPort {
  return {
    declare(cmd: DeclareRawIntakeCommand): RawIntakeReceipt {
      return declare({
        recordId: cmd.recordId,
        text: cmd.text,
        sourceRef: cmd.sourceRef,
        ...(cmd.unparseable === undefined ? {} : { unparseable: cmd.unparseable }),
      });
    },
  };
}
