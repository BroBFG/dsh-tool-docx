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
import { FileSystem } from '@deepseek-ai/dsh-fs';
import { DocxError } from "./error.js";
/** A host filesystem that additionally provides the binary read/write primitives. */
export class BinaryFileSystem extends FileSystem {
}
/** The service name the plugin's binary providers register under. */
export const FS_BINARY_SERVICE = 'fsBinary';
/**
 * Resolve the binary writer for this context: the plugin's `fsBinary` service
 * when mounted, else a host `ctx.fs` that natively provides `writeBytes`.
 * @param ctx - the plugin context; `fsBinary` is resolved optionally.
 * @returns the bound writer, or `undefined` when no binary writer is mounted.
 */
export function resolveWriteBytes(ctx) {
    const fsBinary = ctx.get(FS_BINARY_SERVICE);
    if (fsBinary?.writeBytes !== undefined)
        return fsBinary.writeBytes.bind(fsBinary);
    const fs = ctx.fs;
    if (typeof fs.writeBytes === 'function')
        return fs.writeBytes.bind(fs);
    return undefined;
}
/**
 * Resolve the binary writer or fail with the typed host-requirement error.
 * @param ctx - the plugin context.
 * @returns the bound writer.
 * @throws `DOCX_HOST_FS_UNSUPPORTED` when neither the `fsBinary` service nor a
 *   native `ctx.fs.writeBytes` is available.
 */
export function requireWriteBytes(ctx) {
    const writeBytes = resolveWriteBytes(ctx);
    if (writeBytes === undefined) {
        throw new DocxError('the host filesystem seam lacks the binary writeBytes primitive — install the dsh-tool-docx bundle'
            + ` (dsh plugin --profile web add dsh-tool-docx), which mounts the ${FS_BINARY_SERVICE} provider,`
            + ' or use a deepseek-harness build that includes fs.writeBytes natively', 'DOCX_HOST_FS_UNSUPPORTED');
    }
    return writeBytes;
}
//# sourceMappingURL=fs-binary.js.map