/**
 * Shared vocabulary for the docx tool suite: the structured block model a
 * document is extracted into and regenerated from, the preserved document
 * properties, and the full extraction result.
 * @module dsh-tool-docx/types
 */
/** One structured content block. `image` blocks appear in read output only; the generator emits a warning instead of embedding bytes. */
export type DocxBlock = {
    kind: 'heading';
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
} | {
    kind: 'paragraph';
    text: string;
} | {
    kind: 'list';
    ordered: boolean;
    items: Array<{
        level: number;
        text: string;
    }>;
} | {
    kind: 'table';
    header: string[] | null;
    rows: string[][];
} | {
    kind: 'image';
    alt: string;
};
/** Document properties preserved across a round-trip edit (from `docProps/core.xml`). */
export interface DocxProps {
    /** `dc:title`, or null when absent. */
    title: string | null;
    /** `dc:creator`, or null when absent. */
    author: string | null;
    /** `dcterms:created` (ISO-8601), or null when absent. */
    created: string | null;
}
/** The full result of extracting one `.docx` buffer. */
export interface ExtractedDocx {
    props: DocxProps;
    /** Markdown rendering of the document body. */
    markdown: string;
    /** Structured block rendering of the document body. */
    blocks: DocxBlock[];
    /** Number of embedded images encountered (emitted as placeholders). */
    images: number;
    /** Human-readable notes about approximations and unsupported constructs. */
    warnings: string[];
}
/** DocProps + warnings, what the edit tool needs from the existing file. */
export interface ExtractedEditBasis {
    props: DocxProps;
    warnings: string[];
}
/** Canonical tool output for `docx_read`. */
export interface DocxReadValue {
    path: string;
    format: 'markdown' | 'json';
    docProps: DocxProps;
    charCount: number;
    images: number;
    warnings: string[];
    markdown: string | null;
    blocks: DocxBlock[] | null;
}
/** Canonical tool output for `docx_create` / `docx_edit`. */
export interface DocxWriteValue {
    path: string;
    operation: 'create' | 'update';
    /** Byte size of the generated document. */
    bytes: number;
    warnings: string[];
    /** Present only for an edit (the preserved properties). */
    docProps?: DocxProps;
}
//# sourceMappingURL=types.d.ts.map