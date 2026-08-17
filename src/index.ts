/**
 * Model-facing Microsoft Word (.docx) tools: `docx_read` (docx → Markdown or
 * structured JSON blocks), `docx_create` (Markdown → new docx), and
 * `docx_edit` (round-trip Markdown replacement preserving document
 * properties). Reading uses the bounded `ctx.fs.readBytes` primitive; creating
 * and editing use the new binary-safe `ctx.fs.writeBytes` primitive, so the
 * sandbox fence and observation policy apply to docx mutations exactly as they
 * do to text writes.
 * @module @deepseek-ai/dsh-tool-docx
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { applyReadTool } from './tools/read.ts'
import { applyCreateTool } from './tools/create.ts'
import { applyEditTool } from './tools/edit.ts'
import { DocxSandboxController } from './sandbox.ts'
import { assertPositiveInteger } from './tool-utils.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-docx'

/** Services required by the docx tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Inclusive byte cap on a whole `.docx` file (read + ZIP expansion). */
  maxDocxBytes?: number
  /** Inclusive character cap on the markdown input to create/edit. */
  maxMarkdownChars?: number
  /** Inclusive character cap on the markdown returned by `docx_read`. */
  maxReadChars?: number
}

const DEFAULT_MAX_DOCX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_MARKDOWN_CHARS = 1_000_000
const DEFAULT_MAX_READ_CHARS = 200_000

export const Config: z<Config> = z.object({
  maxDocxBytes: z.number().default(DEFAULT_MAX_DOCX_BYTES),
  maxMarkdownChars: z.number().default(DEFAULT_MAX_MARKDOWN_CHARS),
  maxReadChars: z.number().default(DEFAULT_MAX_READ_CHARS),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Register the full `docx_read`/`docx_create`/`docx_edit` tool suite. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxDocxBytes', resolved.maxDocxBytes)
  assertPositiveInteger('maxMarkdownChars', resolved.maxMarkdownChars)
  assertPositiveInteger('maxReadChars', resolved.maxReadChars)
  const sandbox = new DocxSandboxController(ctx)
  applyReadTool(ctx, resolved)
  applyCreateTool(ctx, resolved, sandbox)
  applyEditTool(ctx, resolved, sandbox)
}
