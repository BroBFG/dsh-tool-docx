/**
 * `fs-binary-local-plugin` — the mount for minimal hosts without a sandbox
 * policy: a namespace plugin that registers the binary write primitive as the
 * SEPARATE `fsBinary` service, unfenced, over the host's own `ctx.fs`. The
 * host filesystem is left untouched. Sandboxed hosts should mount
 * `fs-binary-sandbox-plugin` instead, which applies the policy fence.
 * @module dsh-tool-docx/fs-binary-local-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { FsBytesWriteOutcome } from './fs-binary.ts'
import { FS_BINARY_SERVICE } from './fs-binary.ts'
import { performByteWrite } from './fs-binary-local.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-binary-local'

/** Services required: the host filesystem (reads/stat/resolve and the write body). */
export const inject = ['fs']

/**
 * Register the `fsBinary` service: unfenced binary writes over `ctx.fs`.
 * @param ctx - the plugin context; execution uses its `fs` service.
 */
export function apply(ctx: Context): void {
  ctx.provide(FS_BINARY_SERVICE, {
    writeBytes: (
      target: FsTarget,
      data: Uint8Array,
      expected?: FsWriteIntent,
      signal?: AbortSignal,
    ): Promise<FsBytesWriteOutcome> => performByteWrite(ctx.fs, target, data, expected, signal),
  })
}
