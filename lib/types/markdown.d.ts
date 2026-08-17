/**
 * Markdown в†’ block parsing for the docx generator: headings, paragraphs,
 * nested lists, pipe tables, and inline formatting (`**bold**`, `*italic*`,
 * `` `code` ``, `~~strike~~`, `[text](url)`). The supported subset is
 * deliberately small and matches what {@link extractDocx} emits, so a
 * read в†’ edit в†’ write round trip is stable. Unsupported constructs degrade to
 * paragraphs with a warning instead of failing.
 * @module dsh-tool-docx/markdown
 */
import type { DocxBlock } from './types.ts';
/** One inline segment of a paragraph/heading/cell. */
export interface InlineSegment {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strike?: boolean;
    /** External link target when the segment came from `[text](url)`. */
    link?: string;
}
/**
 * Split inline text into styled segments. Bare asterisks, unterminated
 * markers, and stray brackets stay literal text.
 * @param text - inline markdown text (escapes from extraction are unescaped).
 * @returns ordered segments; adjacent plain text is not merged.
 */
export declare function parseInline(text: string): InlineSegment[];
/**
 * Parse a markdown document into structured blocks.
 * @param markdown - the markdown source (must fit the caller's input cap).
 * @param warnings - receives human-readable notes about unsupported constructs.
 * @returns the blocks the generator renders; an empty document yields `[]`.
 */
export declare function parseMarkdown(markdown: string, warnings: string[]): DocxBlock[];
//# sourceMappingURL=markdown.d.ts.map