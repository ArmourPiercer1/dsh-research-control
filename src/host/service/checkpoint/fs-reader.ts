/**
 * WP-1.5 — checkpoint/restore/diff 服务: 基于 node:fs 的 `ResearchFileReader`。
 *
 * 领域内核 (`src/host/domain/loader`) 是纯逻辑、零 I/O (ARCHITECTURE §2.2 rule 1):
 * 所有文件访问经注入的 `ResearchFileReader`。本模块是 service 层对该接口的
 * 真实 fs 实现 —— 把 `readDir`/`readFile` 映射到 `fs.readdirSync`/`fs.readFileSync`
 * (loader/types.ts 明确预留此缝给「后续 service 层 WP」)。
 *
 * 语义与接口契约逐字对齐 (loader/types.ts):
 *  - `readDir` 路径不存在 / 非目录 → null;
 *  - `readFile` 路径不存在 / 非普通文件 → null;
 *  - 其它 I/O 失败 (权限等) → throw, 由 loader 归一为 READ load error。
 *
 * 同步: 领域内核是同步的, reader 随之同步 (与 InMemoryMetaStore 同决策)。
 * 只读: 本 reader 从不写盘 —— restore 的写盘由 git 层 W8 负责 (§6),
 * reader 只在恢复**后**读取校验, 不越权改内存态/不回滚。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { DirEntry, ResearchFileReader } from '../../domain/loader/index.js'

export class FsResearchReader implements ResearchFileReader {
  /**
   * @param researchRoot 绝对路径的 `.research/` 根 (loader 的 root 参数)。
   *   reader 只在该根下解析相对访问 (loader 传入的均为绝对拼接路径)。
   */
  constructor(readonly researchRoot: string) {}

  readDir(path: string): DirEntry[] | null {
    if (!existsSync(path) || !statSync(path).isDirectory()) return null
    return readdirSync(path, { withFileTypes: true }).map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? ('directory' as const) : ('file' as const),
    }))
  }

  readFile(path: string): string | null {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8')
  }
}
