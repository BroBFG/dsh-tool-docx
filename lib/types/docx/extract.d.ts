/**
 * Extract a `.docx` package into Markdown and structured blocks: walks
 * `word/document.xml` (paragraphs, runs, lists, tables, hyperlinks, images),
 * resolves list numbering through `word/numbering.xml`, and reads document
 * properties from `docProps/core.xml`. Pure вЂ” no I/O; callers supply the
 * bounded package bytes.
 * @module dsh-tool-docx/docx/extract
 */
import type { ExtractedDocx } from '../types.ts';
/**
 * Extract one `.docx` package into markdown + structured blocks.
 * @param data - the whole package bytes (already bounded by the caller).
 * @param maxUncompressedBytes - cap for the ZIP expansion.
 * @returns the extraction result.
 * @throws {@link DocxError} with a stable code for invalid/encrypted packages.
 */
export declare function extractDocx(data: Uint8Array, maxUncompressedBytes: number): Promise<ExtractedDocx>;
//# sourceMappingURL=extract.d.ts.map