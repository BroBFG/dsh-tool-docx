/**
 * Markdown в†’ block parsing for the docx generator: headings, paragraphs,
 * nested lists, pipe tables, and inline formatting (`**bold**`, `*italic*`,
 * `` `code` ``, `~~strike~~`, `[text](url)`). The supported subset is
 * deliberately small and matches what {@link extractDocx} emits, so a
 * read в†’ edit в†’ write round trip is stable. Unsupported constructs degrade to
 * paragraphs with a warning instead of failing.
 * @module dsh-tool-docx/markdown
 */
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;
/** Unescape the markdown-significant escapes produced by extraction. */
function unescapeMarkdown(text) {
    return text.replace(/\\([\\*_`[\]|])/g, '$1');
}
/**
 * Split inline text into styled segments. Bare asterisks, unterminated
 * markers, and stray brackets stay literal text.
 * @param text - inline markdown text (escapes from extraction are unescaped).
 * @returns ordered segments; adjacent plain text is not merged.
 */
export function parseInline(text) {
    const segments = [];
    let cursor = 0;
    for (const match of text.matchAll(INLINE_PATTERN)) {
        const index = match.index;
        if (index > cursor) {
            segments.push({ text: unescapeMarkdown(text.slice(cursor, index)) });
        }
        const token = match[0];
        cursor = index + token.length;
        if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
            segments.push({ text: unescapeMarkdown(token.slice(2, -2)), bold: true });
        }
        else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
            segments.push({ text: unescapeMarkdown(token.slice(1, -1)), italic: true });
        }
        else if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
            segments.push({ text: unescapeMarkdown(token.slice(2, -2)), strike: true });
        }
        else if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
            segments.push({ text: token.slice(1, -1), code: true });
        }
        else {
            const link = /^\[([^\]\n]+)\]\(([^)\n]+)\)$/.exec(token);
            const text = link?.[1];
            const url = link?.[2];
            if (text !== undefined && url !== undefined) {
                segments.push({ text: unescapeMarkdown(text), link: url });
            }
            else {
                segments.push({ text: unescapeMarkdown(token) });
            }
        }
    }
    if (cursor < text.length) {
        segments.push({ text: unescapeMarkdown(text.slice(cursor)) });
    }
    return segments;
}
/** One parsed table row (raw cell strings, trimmed, unescaped). */
function splitTableRow(line) {
    const trimmed = line.trim();
    const body = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const end = body.endsWith('|') ? body.slice(0, -1) : body;
    return end.split('|').map(cell => unescapeMarkdown(cell.trim()));
}
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/**
 * Parse a markdown document into structured blocks.
 * @param markdown - the markdown source (must fit the caller's input cap).
 * @param warnings - receives human-readable notes about unsupported constructs.
 * @returns the blocks the generator renders; an empty document yields `[]`.
 */
export function parseMarkdown(markdown, warnings) {
    const lines = markdown.replaceAll('\r\n', '\n').split('\n');
    const blocks = [];
    let codeWarning = false;
    let imageWarning = false;
    const flushParagraph = (buffer) => {
        const text = buffer.join('\n').trimEnd();
        if (text.length > 0)
            blocks.push({ kind: 'paragraph', text });
    };
    let paragraph = [];
    let list = null;
    let inCodeFence = null;
    let codeBuffer = [];
    const flushList = () => {
        if (list) {
            blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
            list = null;
        }
    };
    const emitParagraph = () => {
        flushList();
        if (paragraph.length > 0) {
            flushParagraph(paragraph);
            paragraph = [];
        }
    };
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line === undefined)
            break;
        // Fenced code blocks degrade to paragraphs with inline code styling.
        if (inCodeFence !== null) {
            if (line.trim().startsWith(inCodeFence)) {
                inCodeFence = null;
                if (codeBuffer.length > 0) {
                    emitParagraph();
                    blocks.push({ kind: 'paragraph', text: codeBuffer.join('\n') });
                    codeBuffer = [];
                }
                index += 1;
                continue;
            }
            codeBuffer.push(line);
            index += 1;
            continue;
        }
        const fence = /^```|^~~~/.exec(line.trim());
        if (fence) {
            emitParagraph();
            if (!codeWarning) {
                warnings.push('code blocks become paragraphs with code styling');
                codeWarning = true;
            }
            inCodeFence = fence[0];
            codeBuffer = [];
            index += 1;
            continue;
        }
        if (line.trim().length === 0) {
            emitParagraph();
            index += 1;
            continue;
        }
        // Pipe table: header row + separator row.
        const next = lines[index + 1];
        if (line.trim().startsWith('|') && next !== undefined && TABLE_SEPARATOR.test(next.trim())) {
            emitParagraph();
            const header = splitTableRow(line);
            index += 2;
            const rows = [];
            while (index < lines.length) {
                const rowLine = lines[index];
                if (rowLine === undefined || !rowLine.trim().startsWith('|'))
                    break;
                rows.push(splitTableRow(rowLine));
                index += 1;
            }
            blocks.push({ kind: 'table', header, rows });
            continue;
        }
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        if (heading) {
            emitParagraph();
            const hashes = heading[1];
            const text = heading[2];
            if (hashes !== undefined && text !== undefined) {
                blocks.push({ kind: 'heading', level: hashes.length, text: text.trim() });
            }
            index += 1;
            continue;
        }
        const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (item) {
            const indent = item[1];
            const marker = item[2];
            const rest = item[3];
            if (indent !== undefined && marker !== undefined && rest !== undefined
                && !(marker === '-' && rest.trim().length === 0)) {
                emitParagraph();
                const level = Math.max(1, Math.floor(indent.length / 2));
                const ordered = /^\d/.test(marker);
                if (!list || list.ordered !== ordered) {
                    flushList();
                    list = { ordered, items: [] };
                }
                const image = /^!\[([^\]\n]*)\]\([^)\n]+\)$/.exec(rest.trim());
                const alt = image?.[1];
                if (image) {
                    if (!imageWarning) {
                        warnings.push('images are not supported when generating; only the alt text is kept');
                        imageWarning = true;
                    }
                    const altText = alt ?? '';
                    list.items.push({ level, text: altText.length > 0 ? altText : 'image' });
                }
                else {
                    list.items.push({ level, text: rest.trim() });
                }
            }
            index += 1;
            continue;
        }
        const image = /^!\[([^\]\n]*)\]\([^)\n]+\)$/.exec(line.trim());
        if (image) {
            emitParagraph();
            if (!imageWarning) {
                warnings.push('images are not supported when generating; only the alt text is kept');
                imageWarning = true;
            }
            const alt = image[1] ?? '';
            blocks.push({ kind: 'paragraph', text: alt.length > 0 ? alt : 'image' });
            index += 1;
            continue;
        }
        paragraph.push(line.replace(/^>\s?/, ''));
        index += 1;
    }
    emitParagraph();
    if (inCodeFence !== null && codeBuffer.length > 0) {
        blocks.push({ kind: 'paragraph', text: codeBuffer.join('\n') });
    }
    return blocks;
}
//# sourceMappingURL=markdown.js.map