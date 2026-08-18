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
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "fs-binary-sandbox";
/** Services required: the host filesystem (reads/stat/resolve) and the policy. */
export declare const inject: string[];
/**
 * Register the `fsBinary` service: fenced binary writes through the same
 * containment the sandbox applies to every mutation.
 * @param ctx - the plugin context; execution uses its `fs` and `sandboxPolicy`.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=fs-binary-sandbox-plugin.d.ts.map