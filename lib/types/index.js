/**
 * Model-facing Microsoft Word (.docx) tools: `docx_read` (docx → Markdown or
 * structured JSON blocks), `docx_create` (Markdown → new docx), and
 * `docx_edit` (round-trip Markdown replacement preserving document
 * properties). Reading uses the bounded `ctx.fs.readBytes` primitive (part of
 * the published filesystem contract since rc.7); creating and editing use a
 * binary writer resolved at call time — the plugin's `fsBinary` service
 * (`dsh-tool-docx/fs-binary-sandbox-plugin` / `fs-binary-local-plugin`) or a
 * host `ctx.fs` that natively provides `writeBytes` — so the sandbox fence and
 * observation policy apply to docx mutations exactly as they do to text
 * writes, without ever replacing the host's own `ctx.fs`.
 * @module dsh-tool-docx
 */
import z from '@deepseek-ai/schemastery';
import { applyReadTool } from "./tools/read.js";
import { applyCreateTool } from "./tools/create.js";
import { applyEditTool } from "./tools/edit.js";
import { DocxSandboxController } from "./sandbox.js";
import { assertPositiveInteger } from "./tool-utils.js";
/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-docx';
/** Services required by the docx tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt'];
const DEFAULT_MAX_DOCX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_MARKDOWN_CHARS = 1_000_000;
const DEFAULT_MAX_READ_CHARS = 200_000;
export const Config = z.object({
    maxDocxBytes: z.number().default(DEFAULT_MAX_DOCX_BYTES),
    maxMarkdownChars: z.number().default(DEFAULT_MAX_MARKDOWN_CHARS),
    maxReadChars: z.number().default(DEFAULT_MAX_READ_CHARS),
});
/** Register the full `docx_read`/`docx_create`/`docx_edit` tool suite. */
export function apply(ctx, config) {
    const resolved = config;
    assertPositiveInteger('maxDocxBytes', resolved.maxDocxBytes);
    assertPositiveInteger('maxMarkdownChars', resolved.maxMarkdownChars);
    assertPositiveInteger('maxReadChars', resolved.maxReadChars);
    const sandbox = new DocxSandboxController(ctx);
    applyReadTool(ctx, resolved);
    applyCreateTool(ctx, resolved, sandbox);
    applyEditTool(ctx, resolved, sandbox);
}
//# sourceMappingURL=index.js.map