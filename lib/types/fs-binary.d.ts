/**
 * The binary filesystem contract the docx tools require.
 *
 * The plugin reads whole `.docx` packages through `readBytes` and writes them
 * through `writeBytes`. `readBytes` is published in `@deepseek-ai/dsh-fs` since
 * `0.1.0-rc.7`; `writeBytes` is part of the current deepseek-harness filesystem
 * seam but is not yet in any published `dsh-fs` release. This module declares
 * the extended contract locally and guards it at runtime, so a host without
 * the primitives fails with a clear typed error instead of a cryptic
 * `fs.readBytes is not a function`.
 * @module dsh-tool-docx/fs-binary
 */
import { FileSystem, type FsTarget, type FsVersion, type FsWriteIntent } from '@deepseek-ai/dsh-fs';
/** The outcome of a binary write, mirroring the host seam's `FsBytesWriteOutcome`. */
export interface FsBytesWriteOutcome {
    /** Whether the write created a new file or updated an existing one. */
    operation: 'create' | 'update';
    /** The new file version after the write. */
    version: FsVersion;
}
/** A host filesystem that additionally provides the binary read/write primitives. */
export declare abstract class BinaryFileSystem extends FileSystem {
    /** Read the whole file as bytes, bounded by `maxBytes`. */
    abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /** Write raw bytes with an optional version/intent guard. */
    abstract writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsBytesWriteOutcome>;
}
/**
 * Narrow the host `fs` service to the binary contract, or fail with a typed
 * error explaining the host requirement.
 * @param fs - the host's `fs` service.
 * @returns the same service, narrowed to {@link BinaryFileSystem}.
 */
export declare function assertBinaryFs(fs: FileSystem): BinaryFileSystem;
//# sourceMappingURL=fs-binary.d.ts.map