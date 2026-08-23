/**
 * WP-5.1 — Intervention 分组视图（**容器层**: 唯一的 store 绑定面在此
 * — 经 binding-hooks 的 useInterventionGroups 拿切片 + 分组投影, 纯
 * 数据向下传给 InterventionGroupsList; 操作面（状态迁移按钮）的回调
 * 在此持有本地 UI 态（备注 / busy / fault）并调用 store 的
 * `updateInterventionState` mutation）。
 *
 * 操作语义（与 WP-4.6 InterventionBoard 同款纪律 — 状态机 §13 / INV-PERM-4）:
 *  - 仅用户可改状态（本视图即用户面 — Agent 侧无对应工具, 冻结 11 工具
 *    面无状态迁移工具）;
 *  - 迁移按钮 = 冻结 §13 迁移表（OPEN → 待处理/关闭; PENDING → 重新打开/
 *    关闭; CLOSED 无按钮）;
 *  - 关闭必填备注（「关闭时用户填写」, §9.2）— 缺备注 = fault + 零调用;
 *  - mutation 后**不本地打补丁**: 失效规则（WP-4.1b 注册表:
 *    updateInterventionState → dashboard）触发切片 refetch, 重渲染来自
 *    host 重读（host 是唯一真源 — stale-while-revalidate）;
 *  - INV-ATTN-1: OPEN/PENDING 两组全量渲染（数据完整 = host 侧
 *    InterventionService 查询面无隐藏过滤器 + 本视图零过滤）。
 *
 * WP-7.4 / G7 S1b — 一键调查（「调查此事项」）: 容器持有每行调查问题
 * 输入 + 调查 busy/fault 态; 点击回调 `onInvestigate`（cockpit 注入 —
 * 默认走 DSH 内置 `commands/execute` 网关域, 零新增 RPC, 见
 * `dsh-adapter/remote/investigate.ts`）. 语义:
 *  - 调查**不改** Intervention 状态（§13 迁移表不动 — 调查与迁移是
 *    两个独立操作面, 可并行, 各持各的 busy）;
 *  - 问题空白 = fault + 零调用（同关闭备注必填纪律）;
 *  - 成功 → 状态行显示命令返回的文本（含新调查会话 id — transient
 *    输出口径: 落库 AnalysisRecord 需用户在调查页显式保存, G8 数据面
 *    解冻后直读）; 失败 → fault 行（命令错误 / 载包契约偏离均透出）;
 *  - 权限: 点击 = 用户启动（§6 矩阵 启动 U ✅ / P ❌ — 插件永不
 *    自启, 宿主命令注册表只收 user 来源指令）。
 *
 * 组件不见 ctx（DSH_ADAPTER §6）: `store` 由挂载层（cockpit 每 tab 一个
 * 工厂结果）以 prop 传入 — 同 InterventionBoard / cockpit 先例。
 */

import { useState, type ReactElement } from 'react'

import type { InterventionDto } from '../../../shared/rpc-contracts.js'
import { useInterventionGroups } from './binding-hooks.js'
import type { ResearchStore } from '../../stores/index.js'
import { InterventionGroupsList } from './InterventionGroupsList.js'
import styles from './intervention.module.css'

export interface InterventionGroupsViewProps {
  readonly store: ResearchStore
  /** 钻取: 打开所属 Workstream（可选 — 独立挂载时可不接导航）。 */
  readonly onOpenWorkstream?: (workstreamId: string) => void
  /**
   * WP-7.4 一键调查回调（cockpit 注入 — 默认通道 = DSH 内置
   * `commands/execute` 网关域）。省略时入口不渲染（独立挂载的测试面
   * 保持原样; 生产 cockpit 永远注入）. 抛错 = 失败（fault 面）。
   */
  readonly onInvestigate?: (item: InterventionDto, question: string) => Promise<string>
}

/**
 * Intervention 分组视图（容器）。
 * @param props - store 句柄（挂载层每 tab 一个工厂结果）+ 可选 WS 导航
 *  + 可选一键调查通道。
 * @returns 分组视图元素。
 */
export function InterventionGroupsView({
  store,
  onOpenWorkstream,
  onInvestigate,
}: InterventionGroupsViewProps): ReactElement {
  const { slice, grouping } = useInterventionGroups(store)
  const [notes, setNotes] = useState<ReadonlyMap<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  // WP-7.4 一键调查本地 UI 态（与迁移 busy/fault 独立 — 调查不改状态）。
  const [questions, setQuestions] = useState<ReadonlyMap<string, string>>(new Map())
  const [invBusy, setInvBusy] = useState(false)
  const [invFault, setInvFault] = useState<string | null>(null)
  const [invLaunched, setInvLaunched] = useState<string | null>(null)

  function handleTransition(item: InterventionDto, status: 'OPEN' | 'PENDING' | 'CLOSED'): void {
    if (busy) return
    if (status === 'CLOSED' && (notes.get(item.id) ?? '').trim() === '') {
      setFault(`${item.id}：关闭需要填写备注（「关闭时用户填写」）`)
      return
    }
    setFault(null)
    setBusy(true)
    void store
      .updateInterventionState({
        interventionId: item.id,
        status,
        ...(status === 'CLOSED' ? { resolutionNote: notes.get(item.id)!.trim() } : {}),
      })
      .then(
        () => {
          setBusy(false)
        },
        (err: unknown) => {
          setBusy(false)
          setFault(err instanceof Error ? err.message : String(err))
        },
      )
  }

  // WP-7.4 一键调查（调查不改 Intervention 状态 — 独立的 busy/fault 面）。
  function handleInvestigate(item: InterventionDto, question: string): void {
    if (invBusy) return
    const channel = onInvestigate
    if (channel === undefined) return
    if (question.trim() === '') {
      setInvFault(`${item.id}：调查需要填写调查问题（Investigator 将只读调查此问题）`)
      return
    }
    setInvFault(null)
    setInvLaunched(null)
    setInvBusy(true)
    void channel(item, question.trim())
      .then(
        (message: string) => {
          setInvBusy(false)
          setInvLaunched(`${item.id}：${message}`)
        },
        (err: unknown) => {
          setInvBusy(false)
          setInvFault(`${item.id}：${err instanceof Error ? err.message : String(err)}`)
        },
      )
  }

  const loading = slice.status === 'idle' || (slice.status === 'loading' && slice.data === null)

  return (
    <section className={styles.view} aria-label="Intervention 分组视图（来源 × 状态, 仅用户可改状态）">
      <h2 className={styles.viewTitle}>Intervention 分组（机械触发 / 用户创建 × 状态）</h2>
      {slice.status === 'error' && slice.error !== null && (
        <p className={styles.errorBanner} role="alert">
          切片加载失败（展示最后成功数据）：{slice.error}
        </p>
      )}
      {fault !== null && (
        <p className={styles.faultNote} role="alert">
          {fault}
        </p>
      )}
      {invFault !== null && (
        <p className={styles.faultNote} role="alert" data-iv-inv-fault>
          一键调查失败：{invFault}
        </p>
      )}
      {invLaunched !== null && (
        <p className={styles.faultNote} role="status" data-iv-inv-launched>
          {invLaunched}
        </p>
      )}
      {loading ? (
        <p className={styles.empty}>加载中…</p>
      ) : grouping.total === 0 ? (
        <p className={styles.empty}>当前无 OPEN / PENDING Intervention</p>
      ) : (
        <InterventionGroupsList
          groups={grouping.groups}
          total={grouping.total}
          notes={notes}
          questions={questions}
          busy={busy}
          investigateBusy={invBusy}
          onTransition={handleTransition}
          onNote={(id, value) => setNotes((prev) => new Map(prev).set(id, value))}
          onQuestion={(id, value) => setQuestions((prev) => new Map(prev).set(id, value))}
          onInvestigate={handleInvestigate}
          onOpenWorkstream={onOpenWorkstream}
        />
      )}
    </section>
  )
}
