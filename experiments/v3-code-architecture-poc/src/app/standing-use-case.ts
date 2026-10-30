/**
 * **派生业务视图（采纳/撤回）的 Application Use-case**（D-19c，外部复审第三轮；D-20 收口于包 2）。
 *
 * 分工与 `IntakeUseCase` 同构：
 *   · 领域（`FactStandingPolicy`）判"这条声明算不算已获授权、载荷写什么"——业务规则；
 *   · 领域命令 Port（`FactDesignationCommandPort`）**落笔**——正式事件类型的唯一写入口
 *     （机制侧 = `NamespaceWriter.appendAuthoritativeEvent`，CONTRACTS.md §16.2）；
 *   · 本类只负责把两者接到**调用方交来的同一条事务**里——协调权，没有改写授权的口子。
 *
 * 读侧（`standingAt`）仍直接由领域策略承担（它是纯读，经窄面 `face.eventsOf`），
 * 这里只是转发给调用方，让"声明 + 回读"对测试呈现为同一个入口，不构成第二份判据。
 *
 * D-20 收口说明（替换修前的"未覆盖的形态"一节）：`synth:fact-designation` 已登记为记录域的
 * 正式事件类型。机制侧对通用 `appendLedger` 写正式事件一律 `EVENT_AUTHORITY_REQUIRED`
 * （一切作用域，含 assembly）——**本用例现在也不得不走命令 Port**，授权把关从"领域自愿"
 * 升为机制强制：席位 A-6 那种"无关能力从旁边绕过去伪造 AUTHORIZED"在通道上就不成立。
 */
import type { UnitOfWork } from '../kernel/kernel.ts';
import type { CommitSequence, ObjectOid } from '../contracts/index.ts';
import type { FactDesignationCommandPort, FactStandingPolicy } from '../domains/test-records.ts';

export class StandingUseCase {
  // N3（同一条教训第四次收口）：构造参数一律 `#` 私有字段——参数属性在运行时是自有可枚举
  // 属性，`commands`/`policy` 都会成为运行时可达面。双门禁见 `tests/n3-parameter-property-gate.test.ts`。
  readonly #policy: FactStandingPolicy;
  readonly #commands: FactDesignationCommandPort;
  constructor(
    policy: FactStandingPolicy,
    commands: FactDesignationCommandPort,
  ) {
    this.#policy = policy;
    this.#commands = commands;
  }

  /** 声明一条事实（授权状态由领域判完交来，用例无权改写；写入只剩命令 Port 一条通道）。 */
  declare(tx: UnitOfWork, a: { oid: ObjectOid; revision: number; stance: 'ACCEPTED' | 'WITHDRAWN' }): CommitSequence {
    return this.#commands.declare(tx, a);
  }

  standingAt(oid: ObjectOid, cutoff: CommitSequence): { state: 'ADOPTED' | 'NOT_ADOPTED'; watermark: CommitSequence } {
    return this.#policy.standingAt(oid, cutoff);
  }
}
