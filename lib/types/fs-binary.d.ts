/**
 * The binary filesystem contract the docx tools require.
 *
 * The plugin reads whole `.docx` packages through `readBytes` and writes them
 * through `writeBytes`. `readBytes` is part of the published `@deepseek-ai/dsh-fs`
 * contract since `0.1.0-rc.7`, so every conforming host provides it on `ctx.fs`.
 * `writeBytes` is NOT part of any published `dsh-fs` release yet, so the plugin
 * ships its own binary providers (`dsh-tool-docx/fs-binary-sandbox-plugin` for
 * sandboxed hosts, `dsh-tool-docx/fs-binary-local-plugin` for minimal hosts)
 * that register a SEPARATE `fsBinary` service — the host's `ctx.fs` is never
 * replaced or modified. A host that natively gained `writeBytes` is used
 * directly. This module declares the extended contract and resolves the writer
 * at call time, so a host without any binary writer fails with a clear typed
 * error instead of a cryptic `fs.writeBytes is not a function`.
 * @module dsh-tool-docx/fs-binary
 */
import type { Context } from '@deepseek-ai/cordis';
import { FileSystem, type FsTarget, type FsVersion, type FsWriteIntent } from '@deepseek-ai/dsh-fs';
/** The outcome of a binary write, mirroring the host seam's `FsBytesWriteOutcome`. */
export interface FsBytesWriteOutcome {
    /** Whether the write created a new file or updated an existing one. */
    operation: 'create' | 'update';
    /** The new file version after the write. */
    version: FsVersion;
}
/** The binary write surface the docx tools need, wherever it comes from. */
export type FsBytesWriter = (target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown) => Promise<FsBytesWriteOutcome>;
/** A host filesystem that additionally provides the binary read/write primitives. */
export declare abstract class BinaryFileSystem extends FileSystem {
    /** Read the whole file as bytes, bounded by `maxBytes`. */
    abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /** Write raw bytes with an optional version/intent guard. */
    abstract writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: unknown): Promise<FsBytesWriteOutcome>;
}
/** The service name the plugin's binary providers register under. */
export declare const FS_BINARY_SERVICE = "fsBinary";
/**
 * Resolve the binary writer for this context: the plugin's `fsBinary` service
 * when mounted, else a host `ctx.fs` that natively provides `writeBytes`.
 * @param ctx - the plugin context; `fsBinary` is resolved optionally.
 * @returns the bound writer, or `undefined` when no binary writer is mounted.
 */
export declare function resolveWriteBytes(ctx: Context): FsBytesWriter | undefined;
/**
 * Resolve the binary writer or fail with the typed host-requirement error.
 * @param ctx - the plugin context.
 * @returns the bound writer.
 * @throws `DOCX_HOST_FS_UNSUPPORTED` when neither the `fsBinary` service nor a
 *   native `ctx.fs.writeBytes` is available.
 */
export declare function requireWriteBytes(ctx: Context): FsBytesWriter;
//# sourceMappingURL=fs-binary.d.ts.map