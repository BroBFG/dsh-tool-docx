/**
 * Minimal bounded ZIP reader over `yauzl`: extracts every entry of a docx
 * package into a name в†’ bytes map. The uncompressed total is capped so a
 * compressed bomb inside an already-bounded file cannot expand without limit.
 * @module dsh-tool-docx/zip
 */
import { Buffer } from 'node:buffer';
import { fromBuffer } from 'yauzl';
/**
 * Read every file entry of a ZIP buffer into memory.
 * @param data - the whole archive bytes (already bounded by the caller's read cap).
 * @param maxUncompressedBytes - inclusive cap on the total uncompressed content.
 * @returns archive-name в†’ content, directory entries omitted.
 */
export function readZip(data, maxUncompressedBytes) {
    return new Promise((resolve, reject) => {
        fromBuffer(Buffer.from(data), { lazyEntries: true, decodeStrings: true }, (error, zipfile) => {
            if (error) {
                reject(error);
                return;
            }
            const entries = new Map();
            let total = 0;
            let failed = false;
            const fail = (cause) => {
                if (failed)
                    return;
                failed = true;
                reject(cause);
            };
            zipfile.on('error', fail);
            zipfile.on('end', () => {
                if (!failed)
                    resolve(entries);
            });
            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                if (failed)
                    return;
                if (/\/$/.test(entry.fileName)) {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (streamError, stream) => {
                    if (streamError) {
                        fail(streamError);
                        return;
                    }
                    const chunks = [];
                    let size = 0;
                    stream.on('data', (chunk) => {
                        size += chunk.length;
                        if (size > maxUncompressedBytes) {
                            fail(new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.on('end', () => {
                        if (failed)
                            return;
                        total += size;
                        if (total > maxUncompressedBytes) {
                            fail(new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`));
                            return;
                        }
                        entries.set(entry.fileName, Buffer.concat(chunks, size));
                        zipfile.readEntry();
                    });
                    stream.on('error', fail);
                });
            });
        });
    });
}
//# sourceMappingURL=zip.js.map