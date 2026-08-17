/**
 * Minimal bounded ZIP reader over `yauzl`: extracts every entry of a docx
 * package into a name → bytes map. The uncompressed total is capped so a
 * compressed bomb inside an already-bounded file cannot expand without limit.
 * @module @deepseek-ai/dsh-tool-docx/zip
 */

import { Buffer } from 'node:buffer'
import { fromBuffer, type Entry } from 'yauzl'

/** All entries of one ZIP archive, keyed by their archive names. */
export type ZipEntries = Map<string, Buffer>

/**
 * Read every file entry of a ZIP buffer into memory.
 * @param data - the whole archive bytes (already bounded by the caller's read cap).
 * @param maxUncompressedBytes - inclusive cap on the total uncompressed content.
 * @returns archive-name → content, directory entries omitted.
 */
export function readZip(data: Uint8Array, maxUncompressedBytes: number): Promise<ZipEntries> {
  return new Promise((resolve, reject) => {
    fromBuffer(Buffer.from(data), { lazyEntries: true, decodeStrings: true }, (error, zipfile) => {
      if (error) {
        reject(error)
        return
      }
      const entries = new Map<string, Buffer>()
      let total = 0
      let failed = false

      const fail = (cause: Error): void => {
        if (failed) return
        failed = true
        reject(cause)
      }

      zipfile.on('error', fail)
      zipfile.on('end', () => {
        if (!failed) resolve(entries)
      })

      zipfile.readEntry()
      zipfile.on('entry', (entry: Entry) => {
        if (failed) return
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry()
          return
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError)
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxUncompressedBytes) {
              fail(new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`))
              return
            }
            chunks.push(chunk)
          })
          stream.on('end', () => {
            if (failed) return
            total += size
            if (total > maxUncompressedBytes) {
              fail(new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`))
              return
            }
            entries.set(entry.fileName, Buffer.concat(chunks, size))
            zipfile.readEntry()
          })
          stream.on('error', fail)
        })
      })
    })
  })
}
