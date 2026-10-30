/**
 * **Raw Intake / Domain Admission 的 Application Use-case**（D-19c，外部复审第三轮）。
 *
 * 形状（复审者给的验收形状，逐字对应）：
 *
 * ```
 * IntakeUseCase（持有协调权，不持有业务规则豁免权）
 *     └── 共享同一条事务 SpaceTransaction
 *           ├── 记录域的自有端口写自己拥有的东西（本 PoC 里记录域不拥有任何 kind，见下）
 *           └── 对象模型域的命令端口创建 test.claim / test.subject（归属不变）
 * ```
 *
 * 与修前的差别不在"谁能写"，而在**经谁的端口写**：
 * 修前 `IntakeService.admit()` 用通用事务面 `tx.createObject({kind:'test.claim'})` 直接造
 * 对象模型拥有的对象——通用面属装配根，落在领域代码里就是"绕过对象拥有者的公开命令端口"。
 * 现在跨归属的那一笔必须经 `writerOwningKind('test.claim', tx)` 取回**对象模型能力的
 * 作用域端口**再落笔；端口写不了别的能力的 kind，所以用例也写不了（一步都不多走）。
 *
 * 原子性（Q40）没有为此打折：本类的每个方法都在**调用方交来的那一条**事务里完成，
 * 自己不 `uow()`、不自开第二条事务。
 *
 * ⚠️ 业务判据一条都不在这里：能不能接纳、载荷长什么样、边角色叫什么、必填与否，
 * 全部来自 `IntakePolicy`（`src/domains/test-records.ts`）。本文件只是把话写下来。
 */
import type { UnitOfWork } from '../kernel/kernel.ts';
import { Refusal, type CommitSequence, type ObjectKindLabel, type ObjectOid } from '../contracts/index.ts';
import { IntakePolicy, type AdmissionDecision } from '../domains/test-records.ts';
import type { UseCaseDelegation } from './delegation.ts';

/** 接纳结果：`admitted` 给出对象，`refused` 给出拒绝码——没有"静默不写"这第三种。 */
export type AdmitOutcome = { readonly oid: ObjectOid } | { readonly refused: string };

export class IntakeUseCase {
  constructor(private readonly policy: IntakePolicy, private readonly delegation: UseCaseDelegation) {}

  /**
   * 原始材料登记：解析失败也要留下来源（IC-H3 / #44 §7.2）。不产生对象（ID-08）。
   *
   * 这一笔走 `appendLedger` 而不是任何能力的作用域端口，理由是**机制事实**：
   * 它写的是 `records`（H 记录身份）与 `ledger`，两者不归任何 capability 拥有，
   * 记录域的清单也没有 `ownsKinds`——"用自有端口写自己的 kind"在这里没有对象可写。
   * 因此这是**协调层的机制级写入**，与 `recordReport` 同类；门禁要求此行带标记留痕。
   */
  intake(tx: UnitOfWork, a: { recordId: string; text: string; sourceRef: string; unparseable?: boolean }): CommitSequence {
    return tx.appendLedger(this.policy.rawIntakeEvent(a)); // D-19c-ALLOWED: appendLedger 写 records/ledger（机制级 H 记录声明，无归属 kind 可走端口）
  }

  /** 领域接纳判定：不接纳时**只拒绝**，绝不触碰已登记的原始输入（#44 §7.2）。 */
  tryAdmit(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel; text: string }): AdmitOutcome {
    const d = this.policy.decide(a);
    if ('refused' in d) return d;
    return { oid: this.#writeAdmitted(tx, a, d) };
  }

  /** 同 `tryAdmit`，但拒绝以 `Refusal` 抛出（调用方按"必须接纳成功"处理时用这条）。 */
  admit(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel; text: string }): ObjectOid {
    const d = this.policy.decide(a);
    if ('refused' in d) throw new Refusal(d.refused, { recordId: a.recordId });
    return this.#writeAdmitted(tx, a, d);
  }

  /**
   * 对象化路径（RF-06）：记录本身不能当端点，承载记录的个体可以。
   * kind 由领域给（`policy.carrierKind`），**归属由注册表查**，两者都不写死在这里。
   */
  objectifyRecord(tx: UnitOfWork, a: { recordId: string }): ObjectOid {
    const kind = this.policy.carrierKind;
    return this.#writeOwned(tx, kind, this.policy.carrierPayload(a.recordId), a.recordId, true);
  }

  /**
   * 一条事务里做完"原始登记 + 接纳"（用例层的存在理由：这两步必须同生共死）。
   * 接纳被拒时**不抛**，但原始登记仍随同一事务提交——拒绝不得销毁输入（#44 §7.2）。
   */
  intakeAndAdmit(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel; text: string; sourceRef: string }):
    { seq: CommitSequence } & AdmitOutcome {
    const seq = this.intake(tx, { recordId: a.recordId, text: a.text, sourceRef: a.sourceRef });
    const outcome = this.tryAdmit(tx, { recordId: a.recordId, kind: a.kind, text: a.text });
    return { seq, ...outcome };
  }

  #writeAdmitted(tx: UnitOfWork, a: { recordId: string; kind: ObjectKindLabel }, d: Extract<AdmissionDecision, { admitted: true }>): ObjectOid {
    return this.#writeOwned(tx, a.kind, d.payload, a.recordId, false);
  }

  /**
   * 跨归属写的那**一笔**：先查归属，再经拥有者的作用域端口落笔。
   * 这里没有任何 `tx.createObject/linkRef`——那正是本收口要消灭的形态（D-19c 门禁的红线）。
   */
  #writeOwned(tx: UnitOfWork, kind: ObjectKindLabel, payload: Record<string, unknown>, recordId: string, required: boolean): ObjectOid {
    const owner = this.delegation.writerOwningKind(kind, tx);
    const oid = owner.createOwned({ kind, payload });
    owner.linkOwned(this.policy.derivedFromEdge(oid, recordId, required));
    return oid;
  }
}
