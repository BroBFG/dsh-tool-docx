/**
 * Typed error vocabulary for the docx tools: a stable machine-routable code
 * distinct from the human-readable message, plus the mapping from the
 * filesystem seam's `FsError` codes.
 * @module dsh-tool-docx/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { FsError } from '@deepseek-ai/dsh-fs'

/** Stable, machine-routable failure classes raised by the docx tool suite. */
export type DocxErrorCode =
  | 'DOCX_NOT_FOUND'
  | 'DOCX_NOT_REGULAR_FILE'
  | 'DOCX_TOO_LARGE'
  | 'DOCX_INPUT_TOO_LARGE'
  | 'DOCX_LEGACY_DOC'
  | 'DOCX_NOT_DOCX'
  | 'DOCX_ENCRYPTED'
  | 'DOCX_PARSE_ERROR'
  | 'DOCX_EXISTS'
  | 'DOCX_STALE'
  | 'DOCX_SANDBOX_DENIED'
  | 'DOCX_WRITE_ERROR'
  | 'DOCX_HOST_FS_UNSUPPORTED'

/** Typed docx failure. Extends {@link HarnessError} for a stable code and `cause` chaining. */
export class DocxError extends HarnessError {
  override readonly code: DocxErrorCode

  constructor(message: string, code: DocxErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** Map a filesystem-seam failure to the docx vocabulary; other errors pass through.
 * @param error - the thrown filesystem error (or any other value).
 * @returns the mapped `DocxError`, or the original value when it is not an `FsError`.
 */
export function mapFsError(error: unknown): unknown {
  if (!(error instanceof FsError)) return error
  switch (error.code) {
    case 'FS_NOT_FOUND':
      return new DocxError(error.message, 'DOCX_NOT_FOUND', { cause: error })
    case 'FS_NOT_REGULAR_FILE':
      return new DocxError(error.message, 'DOCX_NOT_REGULAR_FILE', { cause: error })
    case 'FS_TOO_LARGE':
      return new DocxError(error.message, 'DOCX_TOO_LARGE', { cause: error })
    case 'FS_NOT_OBSERVED':
      return new DocxError(error.message, 'DOCX_EXISTS', { cause: error })
    case 'FS_STALE_VERSION':
      return new DocxError(error.message, 'DOCX_STALE', { cause: error })
    case 'FS_ABORTED':
      return error
    default:
      return new DocxError(error.message, 'DOCX_WRITE_ERROR', { cause: error })
  }
}
