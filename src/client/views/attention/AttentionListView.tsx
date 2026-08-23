/**
 * Attention 排序清单 — 展示层（WP-5.4; PURE PROPS: 零 store import、
 * 零 DSH import、零 ctx — 同 WP-4.2 HomeDashboardView 两层纪律）。
 *
 * 任务目标 4（统一入口视图）: 各对象类型混排（Intervention / NextAction /
 * Blocker / ScheduledEvent）+ 类型徽标 + 耗时标签展示 + why-now 解释。
 * 不变量的展示面表达:
 *   - INV-ATTN-1（只排序不隐藏）: 数据给什么渲染什么 — 本组件没有任何
 *     过滤/折叠分支（CLOSED 等终态不进入数据, 是组装面契约, 不是隐藏）;
 *   - INV-ATTN-2（耗时仅标签）: `estimatedDurationMs` 只渲染成虚线标签,
 *     顺序完全由 data 的 rank 决定（组件从不按耗时重排）;
 *   - INV-ATTN-4（awareness 仅高价值对象）: 有 awareness 记录才渲染
 *     状态标签（UNSEEN 不渲染 — 默认态不占视觉）。
 */
import type { ReactElement } from 'react'

import type {
  AttentionItemKind,
  AttentionRankedItem,
  AttentionRanking,
  AwarenessState,
} from '../../../host/service/attention/scorer.js'

import styles from './attention.module.css'

/** 切片状态（视图消费面 — 容器映射, 视图不见 store 模型类型）。 */
export type AttentionViewStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AttentionListViewProps {
  /** 排序结果（null = 尚无数据）。 */
  readonly data: AttentionRanking | null
  readonly status: AttentionViewStatus
  /** 最后失败信息（status 'error'）。 */
  readonly error: string | null
  /** 页面级刷新（store 刷新循环 / 首载失败重试）。 */
  readonly onRefresh: () => void
}

/** 类型徽标文案（中文; 顺序 = 混排清单的类型全集）。 */
const KIND_LABEL: Readonly<Record<AttentionItemKind, string>> = {
  INTERVENTION: 'Intervention',
  BLOCKER: 'Blocker',
  SCHEDULED_EVENT: '计划事件',
  NEXT_ACTION: '下一步',
}

/** 类型徽标 class（每类型一个视觉档）。 */
const KIND_BADGE_CLASS: Readonly<Record<AttentionItemKind, string>> = {
  INTERVENTION: styles.badgeIntervention,
  BLOCKER: styles.badgeBlocker,
  SCHEDULED_EVENT: styles.badgeEvent,
  NEXT_ACTION: styles.badgeAction,
}

/** awareness 状态标签（UNSEEN = 默认态, 不渲染 — INV-ATTN-4 口径）。 */
const AWARENESS_LABEL: Readonly<Record<AwarenessState, string | null>> = {
  UNSEEN: null,
  SEEN: '已见',
  REVIEWED: '已审阅',
  ASSESSED: '已评估',
}

/**
 * 预计耗时标签文案（INV-ATTN-2: 展示面 — 分钟/小时/天, 不精确到秒;
 * 零值/负值 = 无标签）。纯函数 — 测试直接断言。
 */
export function formatDurationLabel(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return null
  if (ms < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(ms / (60 * 1000)))
    return `预计耗时 ≈ ${minutes} 分钟`
  }
  if (ms < 24 * 60 * 60 * 1000) {
    const hours = Math.round(ms / (60 * 60 * 1000))
    return `预计耗时 ≈ ${hours} 小时`
  }
  const days = Math.round(ms / (24 * 60 * 60 * 1000))
  return `预计耗时 ≈ ${days} 天`
}

/** 一行排序项（纯 props）。 */
function RankedRow({ item }: { readonly item: AttentionRankedItem }): ReactElement {
  const durationLabel = formatDurationLabel(item.estimatedDurationMs)
  const awarenessState = item.awarenessState
  const awarenessLabel = awarenessState !== undefined && awarenessState !== null ? AWARENESS_LABEL[awarenessState] : null
  return (
    <li className={styles.row}>
      <span className={styles.rank}>{item.rank}</span>
      <div className={styles.body}>
        <div className={styles.line1}>
          <span className={`${styles.badge} ${KIND_BADGE_CLASS[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
          <span className={styles.rowTitle}>{item.title}</span>
          {item.workstreamId !== null && <span className={styles.wsChip}>{item.workstreamId}</span>}
        </div>
        {(durationLabel !== null || awarenessLabel !== null) && (
          <div className={styles.tags}>
            {durationLabel !== null && <span className={styles.durationTag}>{durationLabel}</span>}
            {awarenessLabel !== null && <span className={styles.tag}>{awarenessLabel}</span>}
          </div>
        )}
        {item.reasons.length > 0 && (
          <p className={styles.reasons}>
            {item.reasons.join(' · ')}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * 渲染注意力排序清单（统一入口视图）。
 * @param props - data（排序结果）+ status/error 面 + 刷新回调。
 * @returns 视图元素。
 */
export function AttentionListView({ data, status, error, onRefresh }: AttentionListViewProps): ReactElement {
  return (
    <div className={styles.attention}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>注意力清单</h1>
          <p className={styles.subtitle}>Attention Manager 推荐顺序 — 只排序、不隐藏（INV-ATTN-1）；耗时仅作标签（INV-ATTN-2）</p>
        </div>
        <button type="button" className={styles.refresh} onClick={onRefresh}>
          刷新
        </button>
      </header>

      {data === null ? (
        status === 'error' ? (
          <div className={styles.failed}>
            <p role="alert">加载失败：{error ?? '未知错误'}</p>
            <button type="button" className={styles.refresh} onClick={onRefresh}>
              重试
            </button>
          </div>
        ) : (
          <p className={styles.loading} role="status">
            加载中…
          </p>
        )
      ) : (
        <>
          {/* stale-while-revalidate: 刷新失败保留最后好的清单 + 错误条 */}
          {status === 'error' && (
            <p className={styles.errorBanner} role="alert">
              刷新失败：{error ?? '未知错误'}
            </p>
          )}
          {status === 'loading' && (
            <p role="status" className={styles.loading} style={{ margin: '0 0 8px' }}>
              正在刷新…
            </p>
          )}
          {data.items.length === 0 ? (
            <p className={styles.empty}>暂无需要关注的事项（空队列 = 无候选, 不是被隐藏）</p>
          ) : (
            <ol className={styles.list}>
              {data.items.map((item) => (
                <RankedRow key={`${item.kind}:${item.id}`} item={item} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
