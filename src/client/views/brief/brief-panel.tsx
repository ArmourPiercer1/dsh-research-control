/**
 * WP-5.5 — Living Brief 面板展示层（PURE PROPS: 零 store/DSH import）。
 *
 * 三级展开交互（任务目标 3 — 「L1 常驻、L2 展开、每条可点开 ref 详情」）:
 *  - **L1 一句话态势**: 常驻渲染（section[data-level="1"]）+ 其 ref chips
 *    （项目 + 注意力 Top 项 — 点击 = 选中 ref, 进入详情区）;
 *  - **L2 要点列表**: 默认折叠, 展开按钮切换（本地 UI 状态 — 纯展示组件
 *    允许本地交互状态, 零 store）; 每要点 = 类别徽标 + 状态徽标
 *    （数据/暂无数据/待开通）+ 陈述 + ref chips（INV-ATTN-3: DATA 要点
 *    必有 ref — 引擎钉死, 这里全渲染, 零隐藏分支）;
 *  - **ref 详情区**: 选中 ref 后渲染其 drill-down 坐标（OBJECT: kind +
 *    id; HISTORY_EVENT: owner WS + eventSeq + eventId）+ 「打开详情」
 *    跳转按钮 — 复用 WP-4.6 drilldown 视图的跳转模式（展示层纯 props,
 *    跳转渠道经 `onOpenRef` 回调 props 交容器; 容器拥有宿主导航渠道或
 *    其占位 — 组件不见渠道, 只交 ref）;
 *  - **L3 完整数据底座引用表**: 默认折叠, 展开 = 13 行平面表
 *    （AVAILABLE/EMPTY/PLACEHOLDER — Phase 6 面恒「待开通」, 不虚构）;
 *  - 状态面: loading（首载）/ error（首载失败 + 重试）/ stale（刷新失败
 *    错误条 + 陈旧 brief 仍可见 — stale-while-revalidate 展示面）。
 *
 * 断言纪律（同 WP-4.2/WP-5.4 视图测试口径）: 用户可见行为（roles/text/
 * 回调）, 绝不断言 CSS module 类名。
 */

import { useState, type ReactElement } from 'react'

import { BRIEF_DATA_PLANES, type BriefRef } from '../../../host/service/brief/types.js'
import type { LivingBrief } from '../../../host/service/brief/types.js'

import styles from './brief.module.css'

export type BriefPanelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface BriefPanelViewProps {
  /** 三级 Brief（null = 尚无数据 — loading/首载失败面）。 */
  readonly brief: LivingBrief | null
  readonly status: BriefPanelStatus
  /** Last failure message（status 'error'）。 */
  readonly error: string | null
  /** 页面级刷新（store refresh 循环 — 同 Home 口径）。 */
  readonly onRefresh: () => void
  /** 重发 dashboard 加载（首载失败面）。 */
  readonly onRetry: () => void
  /** 数据面说明文案（client 投影的诚实边界 — 容器注入; null = 不渲染）。 */
  readonly dataPlaneNote?: string | null
  /** ref 跳转渠道（容器拥有 — 宿主导航或其占位; WP-4.6 同模式）。
   *  ref 选中态是面板本地 UI 状态（「每条可点开 ref 详情」= 自包含
   *  交互, 容器只持跳转渠道 — 同 drilldown 展示层「渠道经回调 props
   *  交容器」的分工, 选中不必上提）。 */
  readonly onOpenRef: (ref: BriefRef) => void
}

/** ref 的展示文本（chip 面 — 确定性）。 */
export function refLabel(ref: BriefRef): string {
  if (ref.kind === 'OBJECT') return `${ref.objectKind}:${ref.id}`
  return `${ref.workstreamId}·seq${ref.eventSeq}`
}

/** 数据面状态 → 中文（L3 表 + 要点状态徽标共用口径）。 */
const PLANE_STATUS_LABEL: Record<'AVAILABLE' | 'EMPTY' | 'PLACEHOLDER', string> = {
  AVAILABLE: '有数据',
  EMPTY: '暂无数据',
  PLACEHOLDER: '待开通',
}

const POINT_STATUS_LABEL: Record<'DATA' | 'PLACEHOLDER' | 'GAP', string> = {
  DATA: '数据',
  PLACEHOLDER: '暂无数据',
  GAP: '待开通',
}

/** 一条 ref chip（点击 = 选中 — 三级交互的「点开 ref 详情」入口）。 */
function RefChip({
  refValue,
  selected,
  onSelect,
}: {
  refValue: BriefRef
  selected: boolean
  onSelect: (ref: BriefRef) => void
}): ReactElement {
  return (
    <button
      type="button"
      className={selected ? styles.refChipSelected : styles.refChip}
      data-ref-kind={refValue.kind}
      data-ref-id={refValue.kind === 'OBJECT' ? refValue.id : refValue.eventId}
      title="点击查看 ref 详情（drill-down 坐标）"
      onClick={() => onSelect(refValue)}
    >
      {refLabel(refValue)}
    </button>
  )
}

/** ref 详情区（选中 ref 的 drill-down 坐标 + 跳转按钮 — WP-4.6 跳转模式）。 */
function RefDetail({
  refValue,
  onOpenRef,
  onClear,
}: {
  refValue: BriefRef
  onOpenRef: (ref: BriefRef) => void
  onClear: () => void
}): ReactElement {
  return (
    <div className={styles.refDetail} data-ref-kind={refValue.kind} role="region" aria-label="ref 详情">
      <div className={styles.refDetailHead}>
        <strong>Ref 详情</strong>
        <button type="button" className={styles.refDetailClear} onClick={onClear}>
          关闭
        </button>
      </div>
      {refValue.kind === 'OBJECT' ? (
        <dl className={styles.refDetailRows}>
          <div className={styles.refDetailRow}>
            <dt>对象种类</dt>
            <dd data-object-kind={refValue.objectKind}>{refValue.objectKind}</dd>
          </div>
          <div className={styles.refDetailRow}>
            <dt>对象 id</dt>
            <dd data-object-id={refValue.id}>{refValue.id}</dd>
          </div>
        </dl>
      ) : (
        <dl className={styles.refDetailRows}>
          <div className={styles.refDetailRow}>
            <dt>Workstream</dt>
            <dd data-ws-id={refValue.workstreamId}>{refValue.workstreamId}</dd>
          </div>
          <div className={styles.refDetailRow}>
            <dt>事件 seq</dt>
            <dd data-event-seq={refValue.eventSeq}>{refValue.eventSeq}</dd>
          </div>
          <div className={styles.refDetailRow}>
            <dt>事件 id</dt>
            <dd data-event-id={refValue.eventId}>{refValue.eventId}</dd>
          </div>
        </dl>
      )}
      <button type="button" className={styles.refJump} onClick={() => onOpenRef(refValue)}>
        打开详情 ↗
      </button>
      <p className={styles.refJumpHint}>
        {refValue.kind === 'OBJECT'
          ? '跳转渠道由容器持有（cockpit 座位接线注入真实导航; 当前为占位渠道 — WP-4.6 同模式）'
          : '经该 WS 的 History 时间线可达（drill-down 入口坐标）'}
      </p>
    </div>
  )
}

/**
 * Render the three-level Living Brief panel.
 * @param props - brief, status, error, refresh/retry, data-plane note,
 *  onOpenRef 跳转渠道（WP-4.6 跳转模式: 渠道经回调 props 交容器）。
 * @returns the panel element.
 */
export function BriefPanelView({
  brief,
  status,
  error,
  onRefresh,
  onRetry,
  dataPlaneNote,
  onOpenRef,
}: BriefPanelViewProps): ReactElement {
  const [l2Open, setL2Open] = useState(false)
  const [l3Open, setL3Open] = useState(false)
  // ref 选中态 — 面板本地 UI 状态（「每条可点开 ref 详情」自包含交互）。
  const [selectedRef, setSelectedRef] = useState<BriefRef | null>(null)

  return (
    <section className={styles.brief} aria-label="Living Brief 三级投影">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Living Brief</h2>
          <p className={styles.subtitle}>三级投影 — 每条重要陈述带 ref（INV-ATTN-3: 可 drill-down）</p>
        </div>
        <button type="button" className={styles.refresh} onClick={onRefresh}>
          刷新
        </button>
      </header>

      {dataPlaneNote !== null && dataPlaneNote !== undefined && (
        <p className={styles.dataPlaneNote}>{dataPlaneNote}</p>
      )}

      {brief !== null && status === 'error' && (
        <div className={styles.errorBar} role="alert">
          刷新失败：{error ?? '未知错误'} — 以下为陈旧投影（stale-while-revalidate）
        </div>
      )}

      {brief === null ? (
        status === 'error' ? (
          <div className={styles.failed}>
            <p className={styles.errorText} role="alert">
              加载失败：{error ?? '未知错误'}
            </p>
            <button type="button" className={styles.retry} onClick={onRetry}>
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
          {/* L1 — 一句话态势（常驻） */}
          <div className={styles.l1} data-level="1">
            <h3 className={styles.levelTitle}>L1 · 一句话态势</h3>
            <p className={styles.l1Statement} data-l1-statement>
              {brief.level1.statement}
            </p>
            {brief.level1.refs.length > 0 && (
              <div className={styles.refChips}>
                {brief.level1.refs.map((ref, i) => (
                  <RefChip
                    key={`${ref.kind}-${ref.kind === 'OBJECT' ? ref.id : `${ref.workstreamId}:${ref.eventSeq}`}-${i}`}
                    refValue={ref}
                    selected={selectedRef !== null && sameRef(selectedRef, ref)}
                    onSelect={setSelectedRef}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ref 详情区（选中后渲染 — drill-down 坐标 + 跳转） */}
          {selectedRef !== null && <RefDetail refValue={selectedRef} onOpenRef={onOpenRef} onClear={() => setSelectedRef(null)} />}

          {/* L2 — 要点列表（展开交互） */}
          <div className={styles.l2} data-level="2">
            <button
              type="button"
              className={styles.expandToggle}
              aria-expanded={l2Open}
              onClick={() => setL2Open((open) => !open)}
            >
              L2 · 要点列表（{brief.level2.length} 条）{l2Open ? '▾' : '▸'}
            </button>
            {l2Open && (
              <ul className={styles.pointList}>
                {brief.level2.map((point) => (
                  <li
                    key={point.id}
                    className={styles.point}
                    data-point-id={point.id}
                    data-point-category={point.category}
                    data-point-status={point.status}
                  >
                    <div className={styles.pointHead}>
                      <span className={styles.pointCategory}>{point.category}</span>
                      <span className={styles.pointStatus}>{POINT_STATUS_LABEL[point.status]}</span>
                    </div>
                    <p className={styles.pointStatement}>{point.statement}</p>
                    {point.refs.length > 0 && (
                      <div className={styles.refChips}>
                        {point.refs.map((ref, i) => (
                          <RefChip
                            key={`${point.id}-${ref.kind}-${ref.kind === 'OBJECT' ? ref.id : `${ref.workstreamId}:${ref.eventSeq}`}-${i}`}
                            refValue={ref}
                            selected={selectedRef !== null && sameRef(selectedRef, ref)}
                            onSelect={setSelectedRef}
                          />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* L3 — 完整数据底座引用表（展开交互） */}
          <div className={styles.l3} data-level="3">
            <button
              type="button"
              className={styles.expandToggle}
              aria-expanded={l3Open}
              onClick={() => setL3Open((open) => !open)}
            >
              L3 · 完整数据底座引用表（{brief.level3.length} 面）{l3Open ? '▾' : '▸'}
            </button>
            {l3Open && (
              <table className={styles.l3Table}>
                <thead>
                  <tr>
                    <th scope="col">数据面</th>
                    <th scope="col">状态</th>
                    <th scope="col">数量</th>
                    <th scope="col">引用</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.level3.map((row) => (
                    <tr key={row.plane} data-plane={row.plane} data-plane-status={row.status}>
                      <td className={styles.l3Plane}>
                        {row.label}
                        {row.note !== null && <span className={styles.l3Note}>（{row.note}）</span>}
                      </td>
                      <td data-plane-status={row.status}>{PLANE_STATUS_LABEL[row.status]}</td>
                      <td>{row.count}</td>
                      <td>
                        {row.refs.length > 0 && (
                          <div className={styles.refChips}>
                            {row.refs.map((ref, i) => (
                              <RefChip
                                key={`${row.plane}-${ref.kind}-${ref.kind === 'OBJECT' ? ref.id : `${ref.workstreamId}:${ref.eventSeq}`}-${i}`}
                                refValue={ref}
                                selected={selectedRef !== null && sameRef(selectedRef, ref)}
                                onSelect={setSelectedRef}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** ref 全等（chip 选中态判定 — 值相等）。 */
function sameRef(a: BriefRef, b: BriefRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'OBJECT' && b.kind === 'OBJECT') return a.objectKind === b.objectKind && a.id === b.id
  if (a.kind === 'HISTORY_EVENT' && b.kind === 'HISTORY_EVENT') {
    return a.workstreamId === b.workstreamId && a.eventSeq === b.eventSeq && a.eventId === b.eventId
  }
  return false
}

/** 数据面全集引用（视图层自检: L3 行数 = V1 面全集 — 引擎已钉, 此处仅
 *  导出供容器/测试对照, 避免视图侧魔法数漂移）。 */
export const BRIEF_PLANE_COUNT = BRIEF_DATA_PLANES.length
