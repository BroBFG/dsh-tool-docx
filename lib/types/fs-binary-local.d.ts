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
import type { FsInfo, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs';
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local';
import type { FsBytesWriteOutcome } from './fs-binary.ts';
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
export declare function performByteWrite(provider: {
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
}, target: FsTarget, data: Uint8Array, expected: FsWriteIntent | undefined, signal: AbortSignal | undefined): Promise<FsBytesWriteOutcome>;
/**
 * The local filesystem backend with the binary write primitive. Inherits the
 * full published `LocalFileSystem` contract (text reads/writes, `readBytes`,
 * intent handling) and adds `writeBytes`. Per-targetKey operations are
 * serialized with a tail promise, mirroring the backend's own lock discipline.
 */
export declare class DocxBinaryFileSystem extends LocalFileSystem {
    private readonly byteLocks;
    private withByteLock;
    /** Write raw bytes with an optional version/absence guard. */
    writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsBytesWriteOutcome>;
}
export default DocxBinaryFileSystem;
//# sourceMappingURL=fs-binary-local.d.ts.map