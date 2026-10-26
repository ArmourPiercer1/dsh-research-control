#!/usr/bin/env node
/**
 * T6.3 session seeder — a NON-BLANK hub session fixture for the clean probe.
 *
 * Why this exists: the probe home is keyless (no LLM provider), the GUI
 * cannot SUBMIT a prompt (Send stays disabled), and the host renders the
 * view ring only for non-blank sessions. The fixture remedy (unchanged since
 * T6.2): seed ONE non-blank session whose cwd is the probe hub workspace,
 * registered in workspace.json.
 *
 * 0.2 adaptation (maint/e2e-0.2-adapt): the 0.1-era hand-written log retired
 * with the format — 0.2 persists sessions as format-v4 JSONL under per-session
 * directories, physically zstd-framed (train session-persistence-jsonl).
 * Rather than re-implement the on-disk format (header admission, generation
 * filenames, v4 row admission, checksummed frames — all private to the
 * backend), this seeder DRIVES THE HOST'S OWN BACKEND: it loads the pinned
 * train checkout's compiled `@deepseek-ai/dsh-session-persistence-jsonl`
 * behind a bare cordis `Context` (the exact mount the backend's own contract
 * suite uses), then `create → append(one full turn) → flush → close`, so the
 * artifact is written by the same production code the server reads. All
 * module identities come from ONE resolution root (the backend package
 * inside the train tree), so no double-instantiated cordis can creep in.
 *
 * The event batch mirrors the backend contract's one-turn log (user turn
 * with text, assistant answer, turn boundaries, step pair — contiguous seqs
 * from 0) PLUS one `session/title` fallback event: on 0.2 the sidebar title
 * folds from that event ONLY (no first-prompt derivation in the cold
 * listing; an untitleed session row reads "Untitled"). The appended event
 * is exactly what the host's own session-title service writes after the
 * first turn (`appendFallback`: source {kind:'fallback'}, messageSeqs
 * pointing at the user message) — with a title that equals the deterministic
 * fallback of the seeded first prompt, so the fixture is byte-identical in
 * spirit to the untitled host behavior, and the spec opens the row by that
 * title. (0.1 note: the retired projcache-carried title had the sidebar show
 * the first prompt directly; the title event makes the fixture world-proof.)
 *
 * Usage:
 *   node e2e/seed-session.mjs \
 *     --train <train checkout root>        (default: $DSH_TRAIN or
 *                                          tests/deepseek-harness)
 *     --home  <DSH_HOME root>              (sessions land in <home>/sessions)
 *     --cwd   <session workspace path>     (absolute; the probe hub)
 *     --id    <session id>                 (e.g. session-<uuid>)
 *     --title <first user message text>    (doubles as the sidebar title)
 *   [--workspace-json <path> --workspace-title <title>]
 *         also append the session id to that workspace's sessionIds
 *         (the sidebar mounts session rows under the workspace group).
 *
 * Writes nothing else. Idempotent per id: refuses to re-create an existing
 * session (loud non-zero exit) — resetting the probe home is a world-reset
 * concern (tests/dsh-homes is disposable).
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

/* ------------------------------ args ------------------------------ */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const cwdArg = process.cwd()
const TRAIN = arg('train') ?? process.env.DSH_TRAIN ?? join(cwdArg, 'tests/deepseek-harness')
const HOME = arg('home')
const CWD = arg('cwd')
const SESSION_ID = arg('id')
const TITLE = arg('title')
const WORKSPACE_JSON = arg('workspace-json')
const WORKSPACE_TITLE = arg('workspace-title')
for (const [name, value] of [['home', HOME], ['cwd', CWD], ['id', SESSION_ID], ['title', TITLE]]) {
  if (value === undefined) {
    console.error(`[seed-session] FATAL: --${name} is required`)
    process.exit(2)
  }
}
if (!existsSync(join(TRAIN, 'packages/session/session-persistence-jsonl/lib/index.js'))) {
  console.error(`[seed-session] FATAL: train checkout not built at ${TRAIN} `
    + '(need packages/session/session-persistence-jsonl/lib — pnpm install && pnpm run build inside it)')
  process.exit(2)
}

/* -------- load the backend from ONE resolution root (the train tree) ------ */
const backendEntry = join(TRAIN, 'packages/session/session-persistence-jsonl/lib/index.js')
const requireFromBackend = createRequire(backendEntry)
const { Context } = requireFromBackend('@deepseek-ai/cordis')
const { SESSION_FORMAT_VERSION } = requireFromBackend('@deepseek-ai/dsh-session')
const { MessageId } = requireFromBackend('@deepseek-ai/dsh-llm')
const jsonlModule = requireFromBackend('@deepseek-ai/dsh-session-persistence-jsonl')
const JsonlSessionPersistence = jsonlModule.default ?? jsonlModule

/* ---------------------------- one full turn ---------------------------- */
/** The one-turn contract shape (train session-persistence/tests/contract.ts
 *  `oneTurnLog`): contiguous seqs from 0, user text + assistant answer. */
function oneTurnEvents(text) {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    {
      type: 'user/message', seq: 1, time: 2, surfaceOp: 'append',
      data: {
        id: MessageId('seed-user'), role: 'user',
        content: [{ type: 'text', text }], source: { kind: 'user' },
      },
    },
    { type: 'step/start', seq: 2, time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message', seq: 3, time: 4, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: {
          id: MessageId('seed-assistant'), role: 'assistant',
          content: [{ type: 'text', text: `seeded reply: ${text}` }],
          source: { kind: 'model', provider: 'seed', model: 'seed-model' },
        },
        stream: [
          { type: 'chunk', time: 3, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
          { type: 'text-chunks', time0: 3, index: 0, dt: [], texts: ['seeded'] },
          { type: 'chunk', time: 4, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'seeded' } } },
          { type: 'chunk', time: 4, chunk: { type: 'finish', reason: { kind: 'stop' } } },
        ],
      },
    },
    { type: 'step/end', seq: 4, time: 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
    // The host's deterministic fallback title, appended after the first turn
    // exactly as session-title's appendFallback writes it (train
    // packages/session/session-title/src/index.ts:790): source fallback,
    // messageSeqs = the user message's seq. The v4 relationship validator
    // (session-format-v3-to-v4/relationships.ts titleSources) requires a
    // non-user title to reference at least one prior user/message — seq 1.
    // The text here is short enough that the word/byte caps are no-ops, so
    // the seeded title equals what the host would derive from the prompt.
    {
      type: 'session/title', seq: 6, time: 7,
      data: { title: text, messageSeqs: [1], source: { kind: 'fallback' } },
    },
  ]
}

/* ------------------------------ seed ------------------------------ */
const sessionsRoot = join(HOME, 'sessions')
const ctx = new Context()
const fiber = await ctx.plugin(JsonlSessionPersistence, { root: sessionsRoot })
try {
  const meta = {
    version: SESSION_FORMAT_VERSION,
    id: SESSION_ID,
    createdAt: Date.now(),
    cwd: CWD,
    isSeeded: false,
    delegationDepth: 0,
  }
  const handle = await ctx.sessionPersistence.create(meta)
  try {
    await handle.append(oneTurnEvents(TITLE))
    await handle.flush()
  } finally {
    await handle.close()
  }
} finally {
  await fiber.dispose()
}

/* ------------------- artifact evidence (fail loud) ------------------- */
const artifactDirs = readdirSync(sessionsRoot, { recursive: true, encoding: 'utf8' })
  .filter(name => String(name).includes(SESSION_ID))
if (artifactDirs.length === 0) {
  console.error(`[seed-session] FATAL: the backend wrote nothing under ${sessionsRoot} for ${SESSION_ID}`)
  process.exit(1)
}

/* ---------------- workspace.json registration (optional) ---------------- */
if (WORKSPACE_JSON !== undefined && WORKSPACE_TITLE !== undefined) {
  const doc = JSON.parse(await readFile(WORKSPACE_JSON, 'utf8'))
  const entry = Object.values(doc.tables?.workspaces ?? {})
    .find(ws => ws.title === WORKSPACE_TITLE)
  if (entry === undefined) {
    console.error(`[seed-session] FATAL: no workspace titled ${JSON.stringify(WORKSPACE_TITLE)} in ${WORKSPACE_JSON}`)
    process.exit(1)
  }
  if (!entry.sessionIds.includes(SESSION_ID)) entry.sessionIds.push(SESSION_ID)
  entry.updatedAt = new Date().toISOString()
  await writeFile(WORKSPACE_JSON, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

const artifactFiles = artifactDirs.filter(name => statSync(join(sessionsRoot, String(name))).isFile())
console.log('[seed-session] seeded', {
  session: SESSION_ID,
  cwd: CWD,
  title: TITLE,
  formatVersion: SESSION_FORMAT_VERSION,
  dir: sessionsRoot,
  artifacts: artifactFiles,
  registeredIn: WORKSPACE_JSON !== undefined && WORKSPACE_TITLE !== undefined
    ? `${WORKSPACE_JSON} (workspace ${WORKSPACE_TITLE})`
    : 'workspace.json NOT touched',
})
