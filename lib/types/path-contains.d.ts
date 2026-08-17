/**
 * Path-containment mechanics for the plugin's sandboxed filesystem provider —
 * ported from the deepseek-harness `fs-sandbox` package (MIT, see LICENSE):
 * the lexical fast path handles canonical spellings, and filesystem identity
 * supplies the conservative fallback for alias-equivalent roots (Windows 8.3
 * names, casing).
 * @module dsh-tool-docx/path-contains
 */
/**
 * Determine whether a canonical target is a writable root or lies beneath it.
 * The lexical fast path handles normal canonical spellings; when spellings
 * differ, walk the target's existing ancestors and compare filesystem identity
 * with the root.
 * @param path - canonical target key, which may end in a missing suffix.
 * @param root - canonical writable root.
 * @param caseSensitive - whether lexical comparison preserves case; defaults
 * to the host filesystem convention used by supported platforms.
 * @returns whether the target is the root or a descendant of it.
 */
export declare function isPathUnder(path: string, root: string, caseSensitive?: boolean): Promise<boolean>;
//# sourceMappingURL=path-contains.d.ts.map