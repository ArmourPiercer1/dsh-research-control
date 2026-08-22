/**
 * src/host/service/fs — public surface (WP-2.6 rider 2, G1 观察③).
 *
 * The production real-fs implementations of the domain-layer I/O ports
 * (the fs-backed service layer the port docs reserved for "a later WP"):
 *
 *   - `FsPlanFileWriter`  — the domain `PlanFileWriter` (plan/types.ts):
 *     `writeAtomic(path, content)` = tmp+rename (atomic on POSIX);
 *   - `FsTopologyFileIo`  — the domain `TopologyFileIo` (topology/types.ts):
 *     `readFile`/`writeFile`/`rename`/`unlink` — the primitives the
 *     topology store composes into its atomic-write protocol.
 *
 * Both use the domain's own `TMP_FILE_SUFFIX` (`.dshrc-tmp`) for temp files
 * — the same constant the WP-2.6 startup tmp sweep removes — so a crash
 * residue from EITHER write path is swept by the same startup defense
 * (G1 round-1 重点 6).
 */

export { FsPlanFileWriter } from './fs-plan-writer.js'
export { FsTopologyFileIo } from './fs-topology-io.js'
