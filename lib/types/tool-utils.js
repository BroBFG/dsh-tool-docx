/**
 * Shared helpers for the docx tools: path/extension validation, session-cwd
 * resolution, observed-state emission, and common argument validation.
 * @module dsh-tool-docx/tool-utils
 */
import { DocxError } from "./error.js";
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
/**
 * Reject `.doc` with the legacy hint; everything else is parsed by content.
 * @param path - the file path to check.
 */
export function assertSupportedExtension(path) {
    if (/\.doc$/i.test(path.trim())) {
        throw new DocxError('legacy .doc format is not supported вЂ” convert the document to .docx first', 'DOCX_LEGACY_DOC');
    }
}
/**
 * Validate a non-empty file path; whitespace-only paths are rejected like the fs tool suite.
 * @param path - the raw tool argument.
 * @returns the same path, confirmed non-blank.
 */
export function requirePath(path) {
    if (path.trim().length === 0)
        throw new Error('file_path must be a non-empty string');
    return path;
}
/**
 * The calling agent's session cwd, or undefined for a non-agent caller.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the agent's session workspace cwd, or undefined.
 */
export function sessionCwd(exec) {
    const cwd = exec.agent?.session.header.cwd;
    if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd)))
        return cwd;
    return cwd;
}
/**
 * Resolution options for the current call: session cwd + cancellation.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @returns provider resolution options for the current tool call.
 */
export function resolveOptions(exec) {
    const cwd = sessionCwd(exec);
    return {
        ...cwd !== undefined ? { cwd } : {},
        signal: exec.signal,
    };
}
/**
 * Record an authoritative positive observation (no-op when no policy listens).
 * @param ctx - the Cordis context the event is emitted on.
 * @param target - the observed target.
 * @param version - the observed file version.
 * @param exec - the tool-execution context, carried as the event actor.
 */
export function emitObserved(ctx, target, version, exec) {
    ctx.emit('fs/observed', target, { kind: 'present', version }, exec);
}
/**
 * Record a confirmed-absent observation (no-op when no policy listens).
 * @param ctx - the Cordis context the event is emitted on.
 * @param target - the observed (absent) target.
 * @param exec - the tool-execution context, carried as the event actor.
 */
export function emitAbsent(ctx, target, exec) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec);
}
/**
 * Validate a positive-integer cap from config.
 * @param name - the config field name, for the error message.
 * @param value - the configured value to validate.
 */
export function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`tool-docx: ${name} must be a positive integer`);
    }
}
//# sourceMappingURL=tool-utils.js.map