/**
 * WP-1.2 — Git wrapper: argv-array transport layer (INV-GIT-6).
 *
 * This is the ONLY place in the plugin that spawns `git` (ARCHITECTURE §2.2
 * rule 3). Guarantees:
 *  - argv 数组直传 spawn, `shell: false` — 禁 shell 拼接 (INV-GIT-6; 静态核验
 *    tests/git/inv-git-static.test.ts);
 *  - 工作目录强制 `-C <root>` (not `cwd:`);
 *  - 每调用超时 (默认 10s, 可配) → process-group kill + GitTimeoutError,
 *    不重试自动写操作 (§1.9 / §9);
 *  - stdout/stderr 字节上限 → 截断+标记 (§1.9 / §9「输出超大」);
 *  - git 可执行解析失败响亮报错 (GitMissingError, §2: 拒绝 managed mode,
 *    提示安装 Git).
 *
 * NOTE: `spawnGitProcess` / `runGit` are internal — index.ts deliberately
 * does NOT export them. Only the named whitelist operations (operations.ts)
 * reach the transport from production code. Test infrastructure
 * (tests/git/temp-repo.ts) deep-imports `spawnGitProcess` for fixture setup
 * of states the plugin must never produce on a user's repo (see that file's
 * header for the rationale).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { join } from 'node:path'
import { GitCommandError, GitMissingError, GitTimeoutError } from './errors.js'
import { assertWhitelisted } from './whitelist.js'
import {
  DEFAULT_GIT_MAX_OUTPUT_BYTES,
  DEFAULT_GIT_TIMEOUT_MS,
  type GitOptions,
  type GitRunResult,
} from './types.js'

/**
 * Resolve the path of the git executable. 响亮报错 (GitMissingError) when it
 * cannot be resolved — per §2「git 可执行缺失 -> 同样拒绝，提示安装 Git」.
 * Deliberately NOT cached: resolution happens per call so PATH changes
 * (e.g. TC-GIT-011) are observed.
 */
export function resolveGitExecutable(override?: string): string {
  if (override !== undefined) {
    if (override.length === 0) {
      throw new GitMissingError('git executable override is empty — refusing to run git (GIT_INTEGRATION §2)')
    }
    try {
      if (!statSync(override).isFile()) throw new Error(`not a file: ${override}`)
      accessSync(override, constants.X_OK)
    } catch (e) {
      throw new GitMissingError(`git executable at "${override}" is not usable (GIT_INTEGRATION §2: 提示安装 Git)`, {
        cause: e,
      })
    }
    return override
  }
  const separator = process.platform === 'win32' ? ';' : ':'
  const pathEnv = process.env.PATH ?? process.env.Path ?? ''
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : ['']
  for (const dir of pathEnv.split(separator)) {
    if (dir.length === 0) continue
    for (const ext of exts) {
      const candidate = join(dir, `git${ext.toLowerCase()}`)
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // not here — keep scanning PATH
      }
    }
  }
  throw new GitMissingError(
    'git executable not found in PATH — 拒绝进入 managed research mode; 请安装 Git (GIT_INTEGRATION §2)',
  )
}

interface SpawnSpec {
  timeoutMs: number
  maxOutputBytes: number
}

/**
 * Spawn `git -C <root> <argv…>` as a plain argv array (INV-GIT-6).
 * No whitelist check here — callers: {@link runGit} (checked) and test
 * infrastructure (fixture setup for states the plugin itself must never
 * perform; see file header).
 *
 * The child runs in its own process group (Linux) so the timeout kill also
 * reaches helper processes (e.g. a `sleep` under a test fake-git) — an
 * orphan holding the stdio pipes would otherwise hang the promise.
 */
export function spawnGitProcess(
  executable: string,
  root: string,
  argv: readonly string[],
  spec: SpawnSpec,
): Promise<GitRunResult> {
  const command = ['-C', root, ...argv]
  return new Promise<GitRunResult>((resolve, reject) => {
    let settled = false
    const child: ChildProcess = spawn(executable, command, {
      // INV-GIT-6: argv 数组直传, 禁 shell 字符串.
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })

    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    const stderrChunks: Buffer[] = []
    let stderrBytes = 0
    let truncated = false

    // 截断+标记: keep draining (so the child is never blocked) but stop
    // storing once the cap is hit.
    const pushCapped = (
      chunks: Buffer[],
      bytes: number,
      chunk: Buffer,
    ): { bytes: number; capped: boolean } => {
      const remaining = spec.maxOutputBytes - bytes
      if (remaining <= 0) return { bytes, capped: true }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining))
        return { bytes: spec.maxOutputBytes, capped: true }
      }
      chunks.push(chunk)
      return { bytes: bytes + chunk.length, capped: false }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const r = pushCapped(stdoutChunks, stdoutBytes, chunk)
      stdoutBytes = r.bytes
      if (r.capped) truncated = true
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const r = pushCapped(stderrChunks, stderrBytes, chunk)
      stderrBytes = r.bytes
      if (r.capped) truncated = true
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killProcessGroup(child)
      reject(new GitTimeoutError(command, spec.timeoutMs))
    }, spec.timeoutMs)

    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (e.code === 'ENOENT') {
        reject(
          new GitMissingError(
            `failed to spawn git at "${executable}" (ENOENT) — 请安装 Git (GIT_INTEGRATION §2)`,
            { cause: e },
          ),
        )
      } else {
        reject(
          new GitMissingError(`failed to spawn git at "${executable}": ${e.message}`, { cause: e }),
        )
      }
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === null) {
        reject(
          new GitCommandError(
            command,
            -1,
            Buffer.concat(stdoutChunks).toString('utf8'),
            `killed by signal ${signal ?? 'unknown'}`,
          ),
        )
        return
      }
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        truncated,
      })
    })
  })
}

function killProcessGroup(child: ChildProcess): void {
  try {
    if (child.pid != null && process.platform !== 'win32') {
      process.kill(-child.pid, 'SIGKILL')
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    // already exited — nothing to kill
  }
}

/**
 * The checked path: validate argv against the W1–W13 whitelist (INV-GIT-7
 * 运行时面), resolve the executable (fail loud), then spawn with the
 * §1.9 guards. Every operation in operations.ts goes through here.
 */
export async function runGit(root: string, argv: readonly string[], opts?: GitOptions): Promise<GitRunResult> {
  assertWhitelisted(argv)
  const executable = resolveGitExecutable(opts?.gitExecutable)
  const res = await spawnGitProcess(executable, root, argv, {
    timeoutMs: opts?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
    maxOutputBytes: opts?.maxOutputBytes ?? DEFAULT_GIT_MAX_OUTPUT_BYTES,
  })
  return res
}
