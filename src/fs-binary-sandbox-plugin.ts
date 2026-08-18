/**
 * `fs-binary-sandbox-plugin` — the recommended mount for sandboxed hosts: a
 * namespace plugin that registers the binary write primitive as the SEPARATE
 * `fsBinary` service, fenced by the same per-call policy as the harness's
 * `fs-sandbox` mutations. The host's own `ctx.fs` (and its `fs-sandbox` row)
 * is left untouched, so this plugin can never break the host filesystem — at
 * worst the docx write tools report `DOCX_HOST_FS_UNSUPPORTED` when it is not
 * mounted.
 * @module dsh-tool-docx/fs-binary-sandbox-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { FsBytesWriteOutcome } from './fs-binary.ts'
import { FS_BINARY_SERVICE } from './fs-binary.ts'
import { performByteWrite } from './fs-binary-local.ts'
import { checkWriteTarget } from './fs-binary-sandbox.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-binary-sandbox'

/** Services required: the host filesystem (reads/stat/resolve) and the policy. */
export const inject = ['fs', 'sandboxPolicy']

/**
 * Register the `fsBinary` service: fenced binary writes through the same
 * containment the sandbox applies to every mutation.
 * @param ctx - the plugin context; execution uses its `fs` and `sandboxPolicy`.
 */
export function apply(ctx: Context): void {
  ctx.provide(FS_BINARY_SERVICE, {
    writeBytes: (
      target: FsTarget,
      data: Uint8Array,
      expected?: FsWriteIntent,
      signal?: AbortSignal,
      sandboxPolicy?: SandboxExecutionPolicy,
    ): Promise<FsBytesWriteOutcome> => {
      const policy = sandboxPolicy ?? ctx.sandboxPolicy.resolve()
      return checkWriteTarget(path => ctx.fs.resolve(path), policy, target)
        .then(checked => performByteWrite(ctx.fs, checked, data, expected, signal))
    },
  })
}
