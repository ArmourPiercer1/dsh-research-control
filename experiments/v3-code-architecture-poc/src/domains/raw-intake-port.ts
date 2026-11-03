import type {
  DeclareRawIntakeCommand, RawIntakeCommandPort, RawIntakeEnvelope, RawIntakeReceipt,
} from '../contracts/index.ts';

/**
 * 记录域 `RawIntakeCommandPort` 的唯一实现（R-9 / DC-5 / DC-11，方案 2 最小形态）。
 *
 * Application 的公开具名入口，但**不签发事件**：只把命令剥成数据转调机制签发点
 * `Kernel.declareRawIntake`。`raw-record-declared` 是机制事件——领域不得经
 * `appendAuthoritativeEvent` 签发，也不得由清单认领。
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
