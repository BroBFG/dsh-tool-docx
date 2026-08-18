/**
 * Model-facing `docx_create`: generate a new `.docx` file from Markdown.
 * Guarded with `createIfAbsent` by default so an existing file is never
 * blindly overwritten (the observation-policy waterfall may supply its own
 * intent).
 * @module dsh-tool-docx/tools/create
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DocxToolCaps } from '../caps.ts';
import { DocxSandboxController } from '../sandbox.ts';
/**
 * Register the `docx_create` tool.
 * @param ctx - the plugin context; execution uses its `fs` service for
 * resolution/reads and the `fsBinary` binary writer for the mutation.
 * @param caps - the deployment's resolved caps.
 * @param sandbox - the shared sandbox-escalation API.
 */
export declare function applyCreateTool(ctx: Context, caps: DocxToolCaps, sandbox: DocxSandboxController): void;
//# sourceMappingURL=create.d.ts.map