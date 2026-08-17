/**
 * Generate a `.docx` package buffer from structured blocks using the `docx`
 * library: headings, paragraphs with inline styling, nested bullet/numbered
 * lists, pipe tables, and external hyperlinks. Document properties come from
 * the caller (extracted from the previous version on an edit).
 * @module dsh-tool-docx/docx/generate
 */
import type { Buffer } from 'node:buffer';
import type { DocxBlock, DocxProps } from '../types.ts';
/**
 * Generate a `.docx` package buffer from blocks.
 * @param blocks - the structured content to render.
 * @param props - document properties to stamp (title/creator/created).
 * @returns the packed `.docx` bytes.
 */
export declare function generateDocx(blocks: DocxBlock[], props: DocxProps): Promise<Buffer>;
//# sourceMappingURL=generate.d.ts.map