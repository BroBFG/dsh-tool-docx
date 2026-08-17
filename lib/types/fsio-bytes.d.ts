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
export declare function writeFileAtomicBytes(absolutePath: string, data: Uint8Array, signal: AbortSignal | undefined, createIfAbsent?: {
    displayPath: string;
}): Promise<void>;
//# sourceMappingURL=fsio-bytes.d.ts.map