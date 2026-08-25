/**
 * V2-T2.4 — the database migration move (design §9 「数据生命周期」).
 *
 * > **库随项目走，一次只有一份；模式切换时搬运或重新挂接，绝不复制，绝不
 * > 静默丢弃。**
 *
 * The migration 口径 (design §9, verbatim): 「同一插件进程内的文件移动
 * （跨工作区路径），先校验目标不存在（存在即冲突、停手报错），移动后
 * 验证可读再删源」. {@link migrateDb} encodes that as a fail-loud
 * sequence over the injected {@link StorageLocationsFs} face (the
 * node:fs-backed `nodeFsStorageIo()` in production — its `move` falls
 * back to copy+verify+delete across devices; an in-memory fake in
 * tests):
 *
 *   1. target exists           → {@link MigrationConflict} (绝不覆盖 —
 *                                STOP before touching anything);
 *   2. source not a readable   → `SOURCE_UNREADABLE` (before any move —
 *      SQLite file (missing /            a bad source must never start a
 *      not a file / empty / no          half-finished migration);
 *      SQLite magic)
 *   3. move                    → `MOVE_FAILED` (the source is untouched
 *                                — nothing to roll back);
 *   4. target not readable     → ROLLBACK (move back to the source
 *      after the move             location) + `TARGET_UNREADABLE`; when
 *                                the rollback ALSO fails →
 *                                `ROLLBACK_FAILED` (the data now lives
 *                                ONLY at the target — the message says
 *                                so: never silently discard);
 *   5. source still present    → `SOURCE_REMAINS` (the one-copy
 *      after success                  invariant is broken — manual
 *                                resolution).
 *
 * PURE with respect to the filesystem: every disk fact goes through the
 * injected `io`; the log goes through the injected sink (default silent).
 * The production caller (the T3.x `bindProject` 收编 flow, design §8/§9
 * 推论 1) passes `nodeFsStorageIo()` + a console-bridging logger.
 */

import {
  DB_FILE_NAME,
  MigrationConflict,
  SQLITE_HEADER_MAGIC,
  SILENT_LOGGER,
  StorageLocationsError,
  type StorageLocationsFs,
  type StorageLocationsLogger,
} from './types.js'

/** The readability probe depth (the SQLite header is 16 bytes; a bit more for margin). */
const READ_PROBE_BYTES = 32

/**
 * Verify one side of the migration is a readable SQLite database: a
 * regular file, non-empty, and carrying the SQLite header magic
 * ("SQLite format 3\0") — the strongest "this is the project's db, and
 * it is intact" signal available without opening a connection.
 *
 * @param role - 'source' | 'target' (the error wording side).
 * @throws {StorageLocationsError} `SOURCE_UNREADABLE` (role=source) or
 *  `TARGET_UNREADABLE` (role=target) with a self-contained message.
 */
function assertReadableDb(path: string, io: StorageLocationsFs, role: 'source' | 'target'): void {
  const code = role === 'source' ? 'SOURCE_UNREADABLE' : 'TARGET_UNREADABLE'
  if (!io.isFile(path)) {
    throw new StorageLocationsError(
      code,
      `the ${role} of the database migration is not a readable file: ${path} (missing or not a regular file)`,
    )
  }
  let head: Uint8Array
  try {
    head = io.readHead(path, READ_PROBE_BYTES)
  } catch (cause) {
    throw new StorageLocationsError(
      code,
      `the ${role} of the database migration could not be read: ${path}: ` +
        (cause instanceof Error ? cause.message : String(cause)),
      { cause },
    )
  }
  if (head.length === 0) {
    throw new StorageLocationsError(
      code,
      `the ${role} of the database migration is EMPTY: ${path} — an empty file is not a usable ${DB_FILE_NAME}`,
    )
  }
  const magic = new TextDecoder('utf-8').decode(head.subarray(0, SQLITE_HEADER_MAGIC.length))
  if (magic !== SQLITE_HEADER_MAGIC) {
    throw new StorageLocationsError(
      code,
      `the ${role} of the database migration does not carry the SQLite header at ${path} ` +
        `(first 16 bytes: ${JSON.stringify(magic)}) — refusing to migrate a file that is not a database`,
    )
  }
}

/**
 * Migrate one research database from `from` to `to` (design §9).
 *
 * Postconditions on SUCCESS: the target exists and is readable; the
 * source location does NOT exist (一次只有一份). On every failure the
 * world is either untouched (conflict / source-unreadable / move-failed)
 * or restored (target-unreadable → rolled back) — the only state that
 * needs manual recovery is `ROLLBACK_FAILED` (named as such, loud).
 *
 * Precondition: the target's PARENT DIRECTORY exists (the caller owns
 * the layout — the wiring / the T3.x bind flow create the data dir
 * before calling; `rename` into a missing parent is a `MOVE_FAILED`).
 *
 * @param from - the current database file location.
 * @param to - the destination database file location.
 * @param io - the injected filesystem face (see {@link StorageLocationsFs}).
 * @param log - the injected log sink (default: silent).
 * @throws {MigrationConflict} the target already exists (绝不覆盖).
 * @throws {StorageLocationsError} `SOURCE_UNREADABLE` / `MOVE_FAILED` /
 *  `TARGET_UNREADABLE` / `ROLLBACK_FAILED` / `SOURCE_REMAINS` (see the
 *  module header for the sequence).
 */
export function migrateDb(
  from: string,
  to: string,
  io: StorageLocationsFs,
  log: StorageLocationsLogger = SILENT_LOGGER,
): void {
  if (typeof from !== 'string' || from.length === 0 || typeof to !== 'string' || to.length === 0) {
    throw new StorageLocationsError(
      'INVALID_INPUT',
      `migrateDb: from/to must be non-empty paths (from=${JSON.stringify(from ?? null)}, to=${JSON.stringify(to ?? null)})`,
    )
  }
  if (from === to) {
    throw new StorageLocationsError(
      'INVALID_INPUT',
      `migrateDb: the source and the destination are the same path (${from}) — there is nothing to migrate`,
    )
  }

  // ── 1. The target must not exist (design §9: 存在即冲突、停手报错; 绝不覆盖) ──
  if (io.exists(to)) {
    const message =
      `migration refused: the target already exists: ${to} — the project database must live exactly ` +
      'once (design §9: 绝不覆盖, 绝不复制); remove or rename the existing file first, then retry'
    log.error(message)
    throw new MigrationConflict(message)
  }

  // ── 2. The source must be a readable SQLite file BEFORE any move ──
  // (the error message is self-contained — it rides verbatim into the log)
  try {
    assertReadableDb(from, io, 'source')
  } catch (e) {
    if (e instanceof StorageLocationsError) log.error(e.message)
    throw e
  }

  log.info(
    `migrating the research database: ${from} -> ${to} (design §9: the database follows the ` +
      'project — one copy at a time)',
  )

  // ── 3. The move itself (the source is untouched when it fails) ──
  try {
    io.move(from, to)
  } catch (cause) {
    const message =
      `migration failed: the move ${from} -> ${to} failed: ` +
      (cause instanceof Error ? cause.message : String(cause)) +
      ' — the source is untouched (nothing to roll back)'
    log.error(message)
    throw new StorageLocationsError('MOVE_FAILED', message, { cause })
  }

  // ── 4. The post-move target verification (design §9: 移动后验证可读) ──
  let verifyError: StorageLocationsError | undefined
  try {
    assertReadableDb(to, io, 'target')
  } catch (e) {
    verifyError = e instanceof StorageLocationsError ? e : undefined
    if (verifyError === undefined) throw e // a non-module throw is a bug — propagate raw
  }
  if (verifyError !== undefined) {
    // Roll back: move the (bad) target back to the source location.
    try {
      io.move(to, from)
    } catch (cause) {
      const message =
        `migration failed: post-move verification of ${to} failed (${verifyError.message}) AND the ` +
        `rollback (move back to ${from}) ALSO failed: ` +
        (cause instanceof Error ? cause.message : String(cause)) +
        ` — the data now lives ONLY at ${to}; recover it manually before retrying ` +
        '(design §9: 绝不静默丢弃)'
      log.error(message)
      throw new StorageLocationsError('ROLLBACK_FAILED', message, { cause })
    }
    const message =
      `migration failed: post-move verification failed at ${to} (${verifyError.message}) — ` +
      `rolled back: ${to} -> ${from} (the source location is restored; retry after fixing the destination)`
    log.error(message)
    throw new StorageLocationsError('TARGET_UNREADABLE', message, { cause: verifyError })
  }

  // ── 5. The one-copy invariant: the source location must be GONE ──
  if (io.exists(from)) {
    const message =
      `migration anomaly: the source location still exists after a successful move: ${from} — the ` +
      'one-copy invariant is broken (design §9: 一次只有一份); the database is usable at ' +
      `${to}; remove the leftover copy by hand after verifying it is not newer`
    log.error(message)
    throw new StorageLocationsError('SOURCE_REMAINS', message)
  }

  log.info(`database migration complete: ${from} -> ${to} (the source location no longer exists)`)
}
