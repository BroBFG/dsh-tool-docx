/**
 * Model-facing `docx_read`: extract a `.docx` file as Markdown or structured
 * JSON blocks. Bounded by the configured byte cap (whole file), the ZIP
 * expansion cap, and the returned-markdown character cap.
 * @module dsh-tool-docx/tools/read
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DocxToolCaps } from '../caps.ts';
/**
 * Register the `docx_read` tool and its system-prompt guidance.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved caps.
 */
export declare function applyReadTool(ctx: Context, caps: DocxToolCaps): void;
//# sourceMappingURL=read.d.ts.map