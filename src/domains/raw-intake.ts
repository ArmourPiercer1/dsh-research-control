import type {
  CommandReceipt, DeclareRawIntakeCommand, RawIntakeCommandPort, RawIntakeTransaction,
} from '../contracts';
import { RAW_RECORD_DECLARED } from '../kernel/kernel';

/**
 * 记录域 `RawIntakeCommandPort` 的唯一实现（R-9 / DC-5 / DC-11）。
 *
 * 三件事这里都不做，且都是刻意的：
 * · 不建对象、不改对象：声明原始记录不产生对象面变更，只产生一条权威事件行；
 * · 不解释 `text`：机制零语义（领域自己判可否接纳），这里只把它原样放进载荷；
 * · 不把 `unparseable` 当拒绝理由（DC-11）：解析失败是**数据事实**，载荷里带着走。
 *
 * 入口内部走**拥有者自己的** `appendAuthoritativeEvent`——不是通用 `appendLedger`。
 * 后者对 `raw-record-declared` 已在预留集外但属于正式事件类型，会被 `EVENT_AUTHORITY_REQUIRED` 拒写；
 * 这正是「唯一入口」的机验形态，不是约定。
 */
export function createRawIntakeCommandPort(): RawIntakeCommandPort {
  return {
    declare(tx: RawIntakeTransaction, cmd: DeclareRawIntakeCommand): CommandReceipt {
      const seq = tx.appendAuthoritativeEvent({
        eventType: RAW_RECORD_DECLARED,
        objectId: cmd.recordId as never,
        payload: {
          recordId: cmd.recordId,
          text: cmd.text,
          sourceRef: cmd.sourceRef,
          ...(cmd.unparseable === undefined ? {} : { unparseable: cmd.unparseable }),
        },
      });
      // 回执只回机制在入口内签发的登记序（DC-7）；不返回信封、不回授权证据。
      return { oid: cmd.recordId as never, revision: 1, witnessSeq: seq };
    },
  };
}
