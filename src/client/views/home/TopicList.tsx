/**
 * Topic overview cards (WP-4.2, §27.1 — the 项目/主题概览 tier under the
 * project card).
 *
 * Pure props, zero store/DSH imports. Each topic card is the drill-down
 * entry into the topic view (the navigation callback arrives from the
 * container, which receives it from the slot wiring).
 */
import type { ReactElement } from 'react'

import type { TopicCardDto } from '../../../shared/rpc-contracts.js'

import styles from './home.module.css'

export interface TopicListProps {
  readonly topics: readonly TopicCardDto[]
  /** Drill-down: open the topic view for one topic id. */
  readonly onOpenTopic: (topicId: string) => void
}

/**
 * Render the topic overview section (one card per topic; each card
 * carries its workstream count and opens the topic view on click).
 * @param props - topic cards + navigation callback.
 * @returns the section element.
 */
export function TopicList({ topics, onOpenTopic }: TopicListProps): ReactElement {
  return (
    <section className={styles.topics}>
      <h3 className={styles.sectionTitle}>主题概览</h3>
      {topics.length === 0 ? (
        <p className={styles.empty}>暂无主题</p>
      ) : (
        <ul className={styles.topicList}>
          {topics.map(topic => (
            <li key={topic.id} className={styles.topicCard}>
              <button
                type="button"
                className={styles.topicButton}
                onClick={() => onOpenTopic(topic.id)}
              >
                <span className={styles.topicTitle}>{topic.title}</span>
                <span className={styles.topicCount}>{topic.workstreamCount} 个工作流</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
