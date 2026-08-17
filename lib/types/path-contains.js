/**
 * Path-containment mechanics for the plugin's sandboxed filesystem provider —
 * ported from the deepseek-harness `fs-sandbox` package (MIT, see LICENSE):
 * the lexical fast path handles canonical spellings, and filesystem identity
 * supplies the conservative fallback for alias-equivalent roots (Windows 8.3
 * names, casing).
 * @module dsh-tool-docx/path-contains
 */
import { stat } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);
function isMissing(error) {
    const code = error.code;
    return MISSING_CODES.has(code);
}
function comparablePath(path, caseSensitive) {
    return caseSensitive ? path : path.toLowerCase();
}
function isLexicallyUnder(path, root, caseSensitive) {
    const comparableTarget = comparablePath(path, caseSensitive);
    const comparableRoot = comparablePath(root, caseSensitive);
    if (comparableTarget === comparableRoot)
        return true;
    const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    return comparableTarget.startsWith(prefix);
}
async function statIfPresent(path) {
    try {
        return await stat(path, { bigint: true });
    }
    catch (error) {
        if (isMissing(error))
            return undefined;
        throw error;
    }
}
function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
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
export async function isPathUnder(path, root, caseSensitive = process.platform !== 'win32') {
    if (isLexicallyUnder(path, root, caseSensitive))
        return true;
    const rootInfo = await statIfPresent(root);
    if (!rootInfo)
        return false;
    let ancestor = path;
    while (true) {
        const ancestorInfo = await statIfPresent(ancestor);
        if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo))
            return true;
        const parent = dirname(ancestor);
        if (parent === ancestor)
            return false;
        ancestor = parent;
    }
}
//# sourceMappingURL=path-contains.js.map