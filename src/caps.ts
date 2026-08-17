/**
 * Resolved docx tool caps — plugin config after defaulting (see `Config` in
 * index.ts), shared by all three tools.
 * @module @deepseek-ai/dsh-tool-docx/caps
 */

export interface DocxToolCaps {
  /** Inclusive byte cap on a whole `.docx` file (read + ZIP expansion). */
  maxDocxBytes: number
  /** Inclusive character cap on the markdown input to create/edit. */
  maxMarkdownChars: number
  /** Inclusive character cap on the markdown returned by `docx_read`. */
  maxReadChars: number
}
