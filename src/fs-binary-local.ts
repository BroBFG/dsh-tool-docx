/**
 * The plugin's own distribution of the harness's binary filesystem seam: a
 * local `ctx.fs` provider that adds the `writeBytes` primitive to the
 * published `@deepseek-ai/dsh-fs-local` backend. Mount this plugin as `ctx.fs`
 * (in place of `dsh-fs-local`) on a host whose filesystem seam lacks
 * `writeBytes`; the docx tools then run unchanged, with the same
 * probe → intent-guard → atomic-publish flow the harness seam provides.
 *
 * For a sandboxed host (a `SandboxedFileSystem` mounted as `ctx.fs`), mount
 * `dsh-tool-docx/fs-binary-sandbox` instead — it preserves the policy fence.
 * @module dsh-tool-docx/fs-binary-local
 */

import type { FsInfo, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { FsError } from '@deepseek-ai/dsh-fs'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FsBytesWriteOutcome } from './fs-binary.ts'
import { writeFileAtomicBytes } from './fsio-bytes.ts'

/**
 * The probe → intent-guard → atomic-publish body shared by the plugin's binary
 * fs providers: stat the target, enforce the version/absence intent
 * (`FS_STALE_VERSION` / `FS_NOT_OBSERVED`), publish atomically, and report the
 * fresh version.
 * @param provider - the filesystem whose `stat` observes the target (the
 * provider itself, after any sandbox fence has run).
 * @param target - the (possibly fence-checked) target to write.
 * @param data - the raw bytes to write.
 * @param expected - the write intent guarding the write; omit for unconditional.
 * @param signal - cancellation.
 * @returns the create/update outcome with the fresh version.
 */
export async function performByteWrite(
  provider: { stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> },
  target: FsTarget,
  data: Uint8Array,
  expected: FsWriteIntent | undefined,
  signal: AbortSignal | undefined,
): Promise<FsBytesWriteOutcome> {
  const existing = await provider.stat(target, signal)
  if (existing !== undefined && existing.type !== 'file') {
    throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  if (expected?.kind === 'replaceIfVersion') {
    if (existing === undefined || existing.version !== expected.version) {
      throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    }
  } else if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
    throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
  }
  await writeFileAtomicBytes(
    String(target.targetKey),
    data,
    signal,
    expected?.kind === 'createIfAbsent' ? { displayPath: target.displayPath } : undefined,
  )
  const fresh = await provider.stat(target, signal)
  if (fresh === undefined) {
    throw new FsError(`cannot stat "${target.displayPath}" after write`, 'FS_IO_ERROR')
  }
  return {
    operation: existing === undefined ? 'create' : 'update',
    version: fresh.version as FsVersion,
  }
}

/**
 * The local filesystem backend with the binary write primitive. Inherits the
 * full published `LocalFileSystem` contract (text reads/writes, `readBytes`,
 * intent handling) and adds `writeBytes`. Per-targetKey operations are
 * serialized with a tail promise, mirroring the backend's own lock discipline.
 */
export class DocxBinaryFileSystem extends LocalFileSystem {
  private readonly byteLocks = new Map<string, Promise<unknown>>()

  private withByteLock<T>(key: string, op: () => Promise<T>): Promise<T> {
    const previous = this.byteLocks.get(key) ?? Promise.resolve()
    const next = previous.then(op, op)
    // Keep the tail for the next call, swallowing the error so the map entry
    // never holds a rejected promise.
    this.byteLocks.set(key, next.then(() => undefined, () => undefined))
    return next
  }

  /** Write raw bytes with an optional version/absence guard. */
  async writeBytes(
    target: FsTarget,
    data: Uint8Array,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsBytesWriteOutcome> {
    return this.withByteLock(String(target.targetKey), () => performByteWrite(this, target, data, expected, signal))
  }
}

export default DocxBinaryFileSystem
