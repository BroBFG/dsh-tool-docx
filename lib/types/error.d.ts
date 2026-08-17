/**
 * Typed error vocabulary for the docx tools: a stable machine-routable code
 * distinct from the human-readable message, plus the mapping from the
 * filesystem seam's `FsError` codes.
 * @module dsh-tool-docx/error
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Stable, machine-routable failure classes raised by the docx tool suite. */
export type DocxErrorCode = 'DOCX_NOT_FOUND' | 'DOCX_NOT_REGULAR_FILE' | 'DOCX_TOO_LARGE' | 'DOCX_INPUT_TOO_LARGE' | 'DOCX_LEGACY_DOC' | 'DOCX_NOT_DOCX' | 'DOCX_ENCRYPTED' | 'DOCX_PARSE_ERROR' | 'DOCX_EXISTS' | 'DOCX_STALE' | 'DOCX_SANDBOX_DENIED' | 'DOCX_WRITE_ERROR' | 'DOCX_HOST_FS_UNSUPPORTED';
/** Typed docx failure. Extends {@link HarnessError} for a stable code and `cause` chaining. */
export declare class DocxError extends HarnessError {
    readonly code: DocxErrorCode;
    constructor(message: string, code: DocxErrorCode, options?: ErrorOptions);
}
/** Map a filesystem-seam failure to the docx vocabulary; other errors pass through.
 * @param error - the thrown filesystem error (or any other value).
 * @returns the mapped `DocxError`, or the original value when it is not an `FsError`.
 */
export declare function mapFsError(error: unknown): unknown;
//# sourceMappingURL=error.d.ts.map