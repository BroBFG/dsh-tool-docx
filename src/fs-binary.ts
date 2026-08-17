/**
 * The binary filesystem contract the docx tools require.
 *
 * The plugin reads whole `.docx` packages through `readBytes` and writes them
 * through `writeBytes`. Both primitives are part of the current
 * deepseek-harness filesystem seam but are not yet present in the published
 * `@deepseek-ai/dsh-fs` release (the npm `FileSystem` type ships text-only
 * operations). This module declares the extended contract locally and guards it
 * at runtime, so an older host fails with a clear typed error instead of a
 * cryptic `fs.readBytes is not a function`.
 * @module @deepseek-ai/dsh-tool-docx/fs-binary
 */

import { FileSystem, type FsTarget, type FsVersion, type FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { DocxError } from './error.ts'

/** The outcome of a binary write, mirroring the host seam's `FsBytesWriteOutcome`. */
export interface FsBytesWriteOutcome {
  /** Whether the write created a new file or updated an existing one. */
  operation: 'create' | 'update'
  /** The new file version after the write. */
  version: FsVersion
}

/** A host filesystem that additionally provides the binary read/write primitives. */
export abstract class BinaryFileSystem extends FileSystem {
  /** Read the whole file as bytes, bounded by `maxBytes`. */
  abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  /** Write raw bytes with an optional version/intent guard. */
  abstract writeBytes(
    target: FsTarget,
    data: Uint8Array,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: unknown,
  ): Promise<FsBytesWriteOutcome>
}

/**
 * Narrow the host `fs` service to the binary contract, or fail with a typed
 * error explaining the host requirement.
 * @param fs - the host's `fs` service.
 * @returns the same service, narrowed to {@link BinaryFileSystem}.
 */
export function assertBinaryFs(fs: FileSystem): BinaryFileSystem {
  const binary = fs as Partial<BinaryFileSystem>
  if (typeof binary.readBytes !== 'function' || typeof binary.writeBytes !== 'function') {
    throw new DocxError(
      'the host filesystem seam lacks the binary readBytes/writeBytes primitives — this plugin requires a deepseek-harness build that includes fs.readBytes/fs.writeBytes',
      'DOCX_HOST_FS_UNSUPPORTED',
    )
  }
  return binary as BinaryFileSystem
}
