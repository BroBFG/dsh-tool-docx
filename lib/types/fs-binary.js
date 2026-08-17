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
import { FileSystem } from '@deepseek-ai/dsh-fs';
import { DocxError } from "./error.js";
/** A host filesystem that additionally provides the binary read/write primitives. */
export class BinaryFileSystem extends FileSystem {
}
/**
 * Narrow the host `fs` service to the binary contract, or fail with a typed
 * error explaining the host requirement.
 * @param fs - the host's `fs` service.
 * @returns the same service, narrowed to {@link BinaryFileSystem}.
 */
export function assertBinaryFs(fs) {
    const binary = fs;
    if (typeof binary.readBytes !== 'function' || typeof binary.writeBytes !== 'function') {
        throw new DocxError('the host filesystem seam lacks the binary readBytes/writeBytes primitives вЂ” this plugin requires a deepseek-harness build that includes fs.readBytes/fs.writeBytes', 'DOCX_HOST_FS_UNSUPPORTED');
    }
    return binary;
}
//# sourceMappingURL=fs-binary.js.map