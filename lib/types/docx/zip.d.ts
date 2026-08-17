/**
 * Minimal bounded ZIP reader over `yauzl`: extracts every entry of a docx
 * package into a name в†’ bytes map. The uncompressed total is capped so a
 * compressed bomb inside an already-bounded file cannot expand without limit.
 * @module dsh-tool-docx/zip
 */
import { Buffer } from 'node:buffer';
/** All entries of one ZIP archive, keyed by their archive names. */
export type ZipEntries = Map<string, Buffer>;
/**
 * Read every file entry of a ZIP buffer into memory.
 * @param data - the whole archive bytes (already bounded by the caller's read cap).
 * @param maxUncompressedBytes - inclusive cap on the total uncompressed content.
 * @returns archive-name в†’ content, directory entries omitted.
 */
export declare function readZip(data: Uint8Array, maxUncompressedBytes: number): Promise<ZipEntries>;
//# sourceMappingURL=zip.d.ts.map