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
import { FS_BINARY_SERVICE } from "./fs-binary.js";
import { performByteWrite } from "./fs-binary-local.js";
import { checkWriteTarget } from "./fs-binary-sandbox.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'fs-binary-sandbox';
/** Services required: the host filesystem (reads/stat/resolve) and the policy. */
export const inject = ['fs', 'sandboxPolicy'];
/**
 * Register the `fsBinary` service: fenced binary writes through the same
 * containment the sandbox applies to every mutation.
 * @param ctx - the plugin context; execution uses its `fs` and `sandboxPolicy`.
 */
export function apply(ctx) {
    ctx.provide(FS_BINARY_SERVICE, {
        writeBytes: (target, data, expected, signal, sandboxPolicy) => {
            const policy = sandboxPolicy ?? ctx.sandboxPolicy.resolve();
            return checkWriteTarget(path => ctx.fs.resolve(path), policy, target)
                .then(checked => performByteWrite(ctx.fs, checked, data, expected, signal));
        },
    });
}
//# sourceMappingURL=fs-binary-sandbox-plugin.js.map