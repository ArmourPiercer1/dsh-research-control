/**
 * **派生业务视图（采纳/撤回）的 Application Use-case**（D-19c，外部复审第三轮）。
 *
 * 分工与 `IntakeUseCase` 同构：
 *   · 领域（`FactStandingPolicy`）判"这条声明算不算已获授权、载荷写什么"——业务规则；
 *   · 本类只负责把它**落到同一条事务里**——协调权，没有改写授权的口子。
 *
 * 读侧（`standingAt`）仍直接由领域策略承担（它是纯读，经窄面 `face.eventsOf`），
 * 这里只是转发给调用方，让"声明 + 回读"对测试呈现为同一个入口，不构成第二份判据。
 *
 * **未覆盖的形态（诚实登记，不粉饰）**：`synth:fact-designation` 是记录域**关于他人对象**
 * 的事件。机制侧 `appendLedger` 目前不判 `objectId` 的归属（读侧的对称口子 `eventsOf`
 * 已有 E-01 默认拒绝）。要把它也变成"必须经拥有者端口"，就得给 `NamespaceWriter` 加一个
 * 作用域化的事件追加成员——那是**新的插件可见成员**，须先写进 `CONTRACTS.md` 再动手。
 * 见 `tests/use-case-write-path.test.ts` 的"已知残留"用例与回报。
 */
import type { UnitOfWork } from '../kernel/kernel.ts';
import type { CommitSequence, ObjectOid } from '../contracts/index.ts';
import type { FactStandingPolicy } from '../domains/test-records.ts';

export class StandingUseCase {
  constructor(private readonly policy: FactStandingPolicy) {}

  /** 声明一条事实（授权状态由领域判完交来，用例无权改写）。 */
  declare(tx: UnitOfWork, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): CommitSequence {
    return tx.appendLedger(this.policy.designationEvent(tx.principal, a)); // D-19c-ALLOWED: appendLedger 写 ledger（领域事件属机制 H，机制侧尚无作用域化事件端口，见文件头"未覆盖的形态"）
  }

  standingAt(oid: ObjectOid, cutoff: CommitSequence): { state: 'ADOPTED' | 'NOT_ADOPTED'; watermark: CommitSequence } {
    return this.policy.standingAt(oid, cutoff);
  }
}
