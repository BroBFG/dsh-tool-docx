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
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { chmod, link, mkdir, open, rename, rm } from 'node:fs/promises';
import { FsError } from '@deepseek-ai/dsh-fs';
function throwIfAborted(signal, verb) {
    if (signal?.aborted)
        throw new FsError(`${verb} aborted`, 'FS_ABORTED');
}
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
function isEEXIST(error) {
    return error instanceof Error && error.code === 'EEXIST';
}
function isENOENT(error) {
    return error instanceof Error && error.code === 'ENOENT';
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
export async function writeFileAtomicBytes(absolutePath, data, signal, createIfAbsent) {
    throwIfAborted(signal, 'write');
    const directory = dirname(absolutePath);
    await mkdir(directory, { recursive: true });
    throwIfAborted(signal, 'write');
    const stagingDir = join(directory, `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmpdir`);
    const tempPath = join(stagingDir, `${basename(absolutePath)}.tmp`);
    let handle;
    let stagingCreated = false;
    try {
        await mkdir(stagingDir, { mode: 0o700 });
        stagingCreated = true;
        await chmod(stagingDir, 0o700);
        handle = await open(tempPath, 'wx', 0o600);
        await handle.chmod(0o600);
        await handle.writeFile(Buffer.from(data), { ...signal ? { signal } : {} });
        await handle.sync();
        await handle.close();
        handle = undefined;
        throwIfAborted(signal, 'write');
        if (createIfAbsent !== undefined) {
            try {
                await link(tempPath, absolutePath);
            }
            catch (error) {
                // EEXIST: a concurrent creator won the no-replace race. ENOENT: a
                // parent directory vanished mid-staging; the target is still absent.
                if (isEEXIST(error) || isENOENT(error)) {
                    throw new FsError(`cannot overwrite existing "${createIfAbsent.displayPath}" without reading it first`, 'FS_NOT_OBSERVED');
                }
                throw error;
            }
        }
        else {
            await rename(tempPath, absolutePath);
        }
        try {
            await rm(stagingDir, { recursive: true, force: true });
        }
        catch (_cleanupFailure) {
            // The target is committed; owner-only staging residue cannot turn the write into a failure.
        }
    }
    catch (error) {
        let failure = isAbortError(error) ? new FsError('write aborted', 'FS_ABORTED') : error;
        if (handle) {
            try {
                await handle.close();
            }
            catch (closeError) {
                failure = new FsError(`write failed (${errorMessage(failure)}) and temp close failed (${errorMessage(closeError)})`, 'FS_NOT_FOUND', { cause: failure });
            }
        }
        if (!stagingCreated)
            throw failure;
        try {
            await rm(stagingDir, { recursive: true, force: true });
        }
        catch {
            // Best-effort cleanup of staging residue on the failure path.
        }
        throw failure;
    }
}
//# sourceMappingURL=fsio-bytes.js.map