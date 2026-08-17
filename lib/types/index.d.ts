/**
 * Model-facing Microsoft Word (.docx) tools: `docx_read` (docx в†’ Markdown or
 * structured JSON blocks), `docx_create` (Markdown в†’ new docx), and
 * `docx_edit` (round-trip Markdown replacement preserving document
 * properties). Reading uses the bounded `ctx.fs.readBytes` primitive; creating
 * and editing use the new binary-safe `ctx.fs.writeBytes` primitive, so the
 * sandbox fence and observation policy apply to docx mutations exactly as they
 * do to text writes.
 * @module dsh-tool-docx
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-docx";
/** Services required by the docx tool suite. */
export declare const inject: string[];
/** Plugin config (all optional вЂ” `Config` supplies the defaults). */
export interface Config {
    /** Inclusive byte cap on a whole `.docx` file (read + ZIP expansion). */
    maxDocxBytes?: number;
    /** Inclusive character cap on the markdown input to create/edit. */
    maxMarkdownChars?: number;
    /** Inclusive character cap on the markdown returned by `docx_read`. */
    maxReadChars?: number;
}
export declare const Config: z<Config>;
/** Register the full `docx_read`/`docx_create`/`docx_edit` tool suite. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map