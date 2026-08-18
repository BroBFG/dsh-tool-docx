/**
 * `fs-binary-local-plugin` — the mount for minimal hosts without a sandbox
 * policy: a namespace plugin that registers the binary write primitive as the
 * SEPARATE `fsBinary` service, unfenced, over the host's own `ctx.fs`. The
 * host filesystem is left untouched. Sandboxed hosts should mount
 * `fs-binary-sandbox-plugin` instead, which applies the policy fence.
 * @module dsh-tool-docx/fs-binary-local-plugin
 */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "fs-binary-local";
/** Services required: the host filesystem (reads/stat/resolve and the write body). */
export declare const inject: string[];
/**
 * Register the `fsBinary` service: unfenced binary writes over `ctx.fs`.
 * @param ctx - the plugin context; execution uses its `fs` service.
 */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=fs-binary-local-plugin.d.ts.map