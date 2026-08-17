import { FsError } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { chmod, link, mkdir, open, rename, rm } from "node:fs/promises";
//#region lib/types/fsio-bytes.js
/**
* Minimal atomic binary write for the plugin's local filesystem provider.
* Mirrors the deepseek-harness `fs-local` `writeFileAtomic` semantics — a
* private owner-only staging directory, an exclusive temp file, fsync, then an
* atomic publish; a `createIfAbsent` publish uses a hard-link no-replace
* primitive so a concurrent creator wins (`FS_NOT_OBSERVED`) — for a
* `Uint8Array` payload. The Win32 DACL-preservation ceremony of the harness
* original is intentionally omitted in this first version (a replacement
* inherits the temp file's owner-only ACL).
* @module dsh-tool-docx/fsio-bytes
*/
function throwIfAborted(signal, verb) {
	if (signal?.aborted) throw new FsError(`${verb} aborted`, "FS_ABORTED");
}
function isAbortError(error) {
	return error instanceof Error && error.name === "AbortError";
}
function isEEXIST(error) {
	return error instanceof Error && error.code === "EEXIST";
}
function isENOENT(error) {
	return error instanceof Error && error.code === "ENOENT";
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Atomically write raw bytes to `absolutePath`: stage an owner-only temp file
* in a private sibling directory, fsync, then publish. With `createIfAbsent`,
* publish uses a hard link that fails if the target appeared concurrently
* (`FS_NOT_OBSERVED`); otherwise the temp is renamed over the target.
* @param absolutePath - destination path (typically a target key); missing
* parent directories are created.
* @param data - the raw bytes to write.
* @param signal - cancellation checked before and during the write.
* @param createIfAbsent - when provided, publish with the no-replace primitive
* and reject a concurrent creator with `FS_NOT_OBSERVED`.
*/
async function writeFileAtomicBytes(absolutePath, data, signal, createIfAbsent) {
	throwIfAborted(signal, "write");
	const directory = dirname(absolutePath);
	await mkdir(directory, { recursive: true });
	throwIfAborted(signal, "write");
	const stagingDir = join(directory, `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmpdir`);
	const tempPath = join(stagingDir, `${basename(absolutePath)}.tmp`);
	let handle;
	let stagingCreated = false;
	try {
		await mkdir(stagingDir, { mode: 448 });
		stagingCreated = true;
		await chmod(stagingDir, 448);
		handle = await open(tempPath, "wx", 384);
		await handle.chmod(384);
		await handle.writeFile(Buffer.from(data), { ...signal ? { signal } : {} });
		await handle.sync();
		await handle.close();
		handle = void 0;
		throwIfAborted(signal, "write");
		if (createIfAbsent !== void 0) try {
			await link(tempPath, absolutePath);
		} catch (error) {
			if (isEEXIST(error) || isENOENT(error)) throw new FsError(`cannot overwrite existing "${createIfAbsent.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
			throw error;
		}
		else await rename(tempPath, absolutePath);
		try {
			await rm(stagingDir, {
				recursive: true,
				force: true
			});
		} catch (_cleanupFailure) {}
	} catch (error) {
		let failure = isAbortError(error) ? new FsError("write aborted", "FS_ABORTED") : error;
		if (handle) try {
			await handle.close();
		} catch (closeError) {
			failure = new FsError(`write failed (${errorMessage(failure)}) and temp close failed (${errorMessage(closeError)})`, "FS_NOT_FOUND", { cause: failure });
		}
		if (!stagingCreated) throw failure;
		try {
			await rm(stagingDir, {
				recursive: true,
				force: true
			});
		} catch {}
		throw failure;
	}
}
//#endregion
//#region lib/types/fs-binary-local.js
/**
* The plugin's own distribution of the harness's binary filesystem seam: a
* local `ctx.fs` provider that adds the `writeBytes` primitive to the
* published `@deepseek-ai/dsh-fs-local` backend. Mount this plugin as `ctx.fs`
* (in place of `dsh-fs-local`) on a host whose filesystem seam lacks
* `writeBytes`; the docx tools then run unchanged, with the same
* probe → intent-guard → atomic-publish flow the harness seam provides.
*
* For a sandboxed host (a `SandboxedFileSystem` mounted as `ctx.fs`), mount
* `dsh-tool-docx/fs-binary-sandbox` instead — it preserves the policy fence.
* @module dsh-tool-docx/fs-binary-local
*/
/**
* The probe → intent-guard → atomic-publish body shared by the plugin's binary
* fs providers: stat the target, enforce the version/absence intent
* (`FS_STALE_VERSION` / `FS_NOT_OBSERVED`), publish atomically, and report the
* fresh version.
* @param provider - the filesystem whose `stat` observes the target (the
* provider itself, after any sandbox fence has run).
* @param target - the (possibly fence-checked) target to write.
* @param data - the raw bytes to write.
* @param expected - the write intent guarding the write; omit for unconditional.
* @param signal - cancellation.
* @returns the create/update outcome with the fresh version.
*/
async function performByteWrite(provider, target, data, expected, signal) {
	const existing = await provider.stat(target, signal);
	if (existing !== void 0 && existing.type !== "file") throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
	if (expected?.kind === "replaceIfVersion") {
		if (existing === void 0 || existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
	} else if (expected?.kind === "createIfAbsent" && existing !== void 0) throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
	await writeFileAtomicBytes(String(target.targetKey), data, signal, expected?.kind === "createIfAbsent" ? { displayPath: target.displayPath } : void 0);
	const fresh = await provider.stat(target, signal);
	if (fresh === void 0) throw new FsError(`cannot stat "${target.displayPath}" after write`, "FS_IO_ERROR");
	return {
		operation: existing === void 0 ? "create" : "update",
		version: fresh.version
	};
}
/**
* The local filesystem backend with the binary write primitive. Inherits the
* full published `LocalFileSystem` contract (text reads/writes, `readBytes`,
* intent handling) and adds `writeBytes`. Per-targetKey operations are
* serialized with a tail promise, mirroring the backend's own lock discipline.
*/
var DocxBinaryFileSystem = class extends LocalFileSystem {
	byteLocks = /* @__PURE__ */ new Map();
	withByteLock(key, op) {
		const next = (this.byteLocks.get(key) ?? Promise.resolve()).then(op, op);
		this.byteLocks.set(key, next.then(() => void 0, () => void 0));
		return next;
	}
	/** Write raw bytes with an optional version/absence guard. */
	async writeBytes(target, data, expected, signal) {
		return this.withByteLock(String(target.targetKey), () => performByteWrite(this, target, data, expected, signal));
	}
};
//#endregion
export { performByteWrite as n, DocxBinaryFileSystem as t };
