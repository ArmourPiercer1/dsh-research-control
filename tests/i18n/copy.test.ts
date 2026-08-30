// UI-3 D6 — copy registry contract: t() is an identity lookup into the
// frozen COPY table, the B-verbatim strings survive byte-for-byte, and
// the key set is pinned (a silently dropped key is a product regression).

import { describe, expect, it } from 'vitest'
import { COPY_TABLE, t } from '../../src/client/i18n/copy.js'
import type { CopyKey } from '../../src/client/i18n/copy.js'

describe('i18n copy (UI-3 D6)', () => {
  it('t() returns the COPY value verbatim for every key', () => {
    const keys = Object.keys(COPY_TABLE) as CopyKey[]
    for (const key of keys) {
      expect(t(key)).toBe(COPY_TABLE[key])
      expect(typeof t(key)).toBe('string')
      expect(t(key).length).toBeGreaterThan(0)
    }
  })

  it('pins the key set (count + exact list)', () => {
    const keys = Object.keys(COPY_TABLE).sort()
    expect(keys).toEqual([
      'app.title',
      'dialog.cancel',
      'dialog.createTopic',
      'dialog.createWorkstream',
      'dialog.editTopic',
      'dialog.fieldAttention',
      'dialog.fieldDescription',
      'dialog.fieldImportance',
      'dialog.fieldSummary',
      'dialog.fieldTitle',
      'dialog.save',
      'nav.needsAttention',
      'nav.portfolio',
      'nav.settings',
      'portfolio.attentionTitle',
      'portfolio.bindExistingProject',
      'portfolio.createProject',
      'portfolio.emptyBind',
      'portfolio.emptyBody',
      'portfolio.emptyCreate',
      'portfolio.emptyExplainBind',
      'portfolio.emptyExplainCreate',
      'portfolio.emptyTitle',
      'portfolio.projects',
      'portfolio.subtitle',
      'portfolio.viewAll',
      'project.attentionPlaceholder',
      'project.attentionTitle',
      'project.historyEmpty',
      'project.historyNoteFirst20',
      'project.historyTitle',
      'project.noWorkstreams',
      'project.topicAddWorkstream',
      'project.topicEdit',
      'project.topicTopology',
      'project.topicWorkstreams',
      'project.topicsHeading',
      'project.viewTopology',
      'tree.addTopic',
      'tree.addWorkstream',
      'tree.collapse',
      'tree.rail',
      'tree.reopen',
      'ws.current.actionFault',
      'ws.current.activeTasks',
      'ws.current.blockerDerived',
      'ws.current.blockerExplicit',
      'ws.current.blockerSource',
      'ws.current.blockers',
      'ws.current.clearBlocker',
      'ws.current.dismiss',
      'ws.current.emptyActiveTasks',
      'ws.current.emptyBlockers',
      'ws.current.emptyFocus',
      'ws.current.emptyInterventions',
      'ws.current.emptyNextActions',
      'ws.current.emptyObjectives',
      'ws.current.emptyPendingValidation',
      'ws.current.emptyRuns',
      'ws.current.focus',
      'ws.current.focusMarker',
      'ws.current.intent',
      'ws.current.interventions',
      'ws.current.ivSource',
      'ws.current.ivWorkstreams',
      'ws.current.lastCheckpoint',
      'ws.current.liveRuns',
      'ws.current.nextActions',
      'ws.current.noCheckpoint',
      'ws.current.objectives',
      'ws.current.pendingValidation',
      'ws.current.promoteToTask',
      'ws.current.promotedReceipt',
      'ws.current.rationale',
      'ws.current.runs',
      'ws.current.setFocus',
      'ws.current.task',
      'ws.current.title',
      'ws.current.validation',
      'ws.header.focus',
      'ws.header.objective',
      'ws.metaOpenForks',
      'ws.metaPlanItems',
      'ws.metaRunning',
    ])
  })

  it('B-verbatim strings are byte-for-byte (D §9.1 / B §4 frozen copy)', () => {
    expect(t('app.title')).toBe('Research Control')
    expect(t('nav.portfolio')).toBe('Portfolio')
    expect(t('nav.needsAttention')).toBe('Needs Attention')
    expect(t('nav.settings')).toBe('Settings')
    expect(t('portfolio.createProject')).toBe('Create Project')
    expect(t('portfolio.bindExistingProject')).toBe('Bind Existing Project')
    expect(t('portfolio.viewAll')).toBe('View all')
    expect(t('portfolio.emptyTitle')).toBe('No research projects yet')
    expect(t('portfolio.emptyBody')).toBe(
      'Start a new local research project or bind an existing project directory.'
    )
    expect(t('portfolio.emptyCreate')).toBe('Create Research Project')
    expect(t('portfolio.emptyBind')).toBe('Bind Existing Project')
    expect(t('portfolio.emptyExplainCreate')).toBe(
      'Create = 创建新的本地 Project + Git + research structure'
    )
    expect(t('portfolio.emptyExplainBind')).toBe('Bind = 接管已有目录 / Git repo')
    expect(t('project.topicEdit')).toBe('Edit')
    expect(t('project.topicAddWorkstream')).toBe('+ Workstream')
    expect(t('project.historyNoteFirst20')).toBe('showing first 20 workstreams')
    // UI-4 (B §20): the Set-as-CF button text is verbatim-frozen
    expect(t('ws.current.setFocus')).toBe('Set as Current Focus')
    // UI-4 (B §15.5): the blocker source tags are verbatim-frozen
    expect(t('ws.current.blockerExplicit')).toBe('[Explicit]')
    expect(t('ws.current.blockerDerived')).toBe('[Derived]')
  })

  it('investigator has no nav label (hidden from first level, B §2.1)', () => {
    expect('nav.investigator' in COPY_TABLE).toBe(false)
    expect(['nav.portfolio', 'nav.needsAttention', 'nav.settings']).toEqual(
      (Object.keys(COPY_TABLE) as CopyKey[]).filter((k) => k.startsWith('nav.'))
    )
  })
})
