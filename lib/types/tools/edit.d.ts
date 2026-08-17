/**
 * Model-facing `docx_edit`: replace a `.docx` document's content from
 * Markdown, preserving its title/author/created properties. Reads the current
 * file (validating it is a docx), regenerates the body, and writes back with a
 * version guard so a concurrent change reports `DOCX_STALE`.
 * @module dsh-tool-docx/tools/edit
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DocxToolCaps } from '../caps.ts';
import { DocxSandboxController } from '../sandbox.ts';
/**
 * Register the `docx_edit` tool.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved caps.
 * @param sandbox - the shared sandbox-escalation API.
 */
export declare function applyEditTool(ctx: Context, caps: DocxToolCaps, sandbox: DocxSandboxController): void;
//# sourceMappingURL=edit.d.ts.map