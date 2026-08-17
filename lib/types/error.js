/**
 * Typed error vocabulary for the docx tools: a stable machine-routable code
 * distinct from the human-readable message, plus the mapping from the
 * filesystem seam's `FsError` codes.
 * @module dsh-tool-docx/error
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
import { FsError } from '@deepseek-ai/dsh-fs';
/** Typed docx failure. Extends {@link HarnessError} for a stable code and `cause` chaining. */
export class DocxError extends HarnessError {
    code;
    constructor(message, code, options) {
        super(message, code, options);
        this.code = code;
    }
}
/** Map a filesystem-seam failure to the docx vocabulary; other errors pass through.
 * @param error - the thrown filesystem error (or any other value).
 * @returns the mapped `DocxError`, or the original value when it is not an `FsError`.
 */
export function mapFsError(error) {
    if (!(error instanceof FsError))
        return error;
    switch (error.code) {
        case 'FS_NOT_FOUND':
            return new DocxError(error.message, 'DOCX_NOT_FOUND', { cause: error });
        case 'FS_NOT_REGULAR_FILE':
            return new DocxError(error.message, 'DOCX_NOT_REGULAR_FILE', { cause: error });
        case 'FS_TOO_LARGE':
            return new DocxError(error.message, 'DOCX_TOO_LARGE', { cause: error });
        case 'FS_NOT_OBSERVED':
            return new DocxError(error.message, 'DOCX_EXISTS', { cause: error });
        case 'FS_STALE_VERSION':
            return new DocxError(error.message, 'DOCX_STALE', { cause: error });
        case 'FS_ABORTED':
            return error;
        default:
            return new DocxError(error.message, 'DOCX_WRITE_ERROR', { cause: error });
    }
}
//# sourceMappingURL=error.js.map