import { HarnessError } from "@deepseek-ai/dsh-llm";
import { FsError } from "@deepseek-ai/dsh-fs";
//#region lib/types/error.js
/**
* Typed error vocabulary for the docx tools: a stable machine-routable code
* distinct from the human-readable message, plus the mapping from the
* filesystem seam's `FsError` codes.
* @module dsh-tool-docx/error
*/
/** Typed docx failure. Extends {@link HarnessError} for a stable code and `cause` chaining. */
var DocxError = class extends HarnessError {
	code;
	constructor(message, code, options) {
		super(message, code, options);
		this.code = code;
	}
};
/** Map a filesystem-seam failure to the docx vocabulary; other errors pass through.
* @param error - the thrown filesystem error (or any other value).
* @returns the mapped `DocxError`, or the original value when it is not an `FsError`.
*/
function mapFsError(error) {
	if (!(error instanceof FsError)) return error;
	switch (error.code) {
		case "FS_NOT_FOUND": return new DocxError(error.message, "DOCX_NOT_FOUND", { cause: error });
		case "FS_NOT_REGULAR_FILE": return new DocxError(error.message, "DOCX_NOT_REGULAR_FILE", { cause: error });
		case "FS_TOO_LARGE": return new DocxError(error.message, "DOCX_TOO_LARGE", { cause: error });
		case "FS_NOT_OBSERVED": return new DocxError(error.message, "DOCX_EXISTS", { cause: error });
		case "FS_STALE_VERSION": return new DocxError(error.message, "DOCX_STALE", { cause: error });
		case "FS_ABORTED": return error;
		default: return new DocxError(error.message, "DOCX_WRITE_ERROR", { cause: error });
	}
}
//#endregion
//#region lib/types/fs-binary.js
/** The service name the plugin's binary providers register under. */
const FS_BINARY_SERVICE = "fsBinary";
/**
* Resolve the binary writer for this context: the plugin's `fsBinary` service
* when mounted, else a host `ctx.fs` that natively provides `writeBytes`.
* @param ctx - the plugin context; `fsBinary` is resolved optionally.
* @returns the bound writer, or `undefined` when no binary writer is mounted.
*/
function resolveWriteBytes(ctx) {
	const fsBinary = ctx.get(FS_BINARY_SERVICE);
	if (fsBinary?.writeBytes !== void 0) return fsBinary.writeBytes.bind(fsBinary);
	const fs = ctx.fs;
	if (typeof fs.writeBytes === "function") return fs.writeBytes.bind(fs);
}
/**
* Resolve the binary writer or fail with the typed host-requirement error.
* @param ctx - the plugin context.
* @returns the bound writer.
* @throws `DOCX_HOST_FS_UNSUPPORTED` when neither the `fsBinary` service nor a
*   native `ctx.fs.writeBytes` is available.
*/
function requireWriteBytes(ctx) {
	const writeBytes = resolveWriteBytes(ctx);
	if (writeBytes === void 0) throw new DocxError(`the host filesystem seam lacks the binary writeBytes primitive — install the dsh-tool-docx bundle (dsh plugin --profile web add dsh-tool-docx), which mounts the ${FS_BINARY_SERVICE} provider, or use a deepseek-harness build that includes fs.writeBytes natively`, "DOCX_HOST_FS_UNSUPPORTED");
	return writeBytes;
}
//#endregion
export { mapFsError as i, requireWriteBytes as n, DocxError as r, FS_BINARY_SERVICE as t };
