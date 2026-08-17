/**
 * Consumer tests for the plugin's binary fs provider (`fs-binary-local`):
 * mounting `DocxBinaryFileSystem` as `ctx.fs` gives the docx tools the
 * `writeBytes` primitive they need, with the same intent/version guards as the
 * harness seam. Covers the provider contract directly and the tools
 * end-to-end over a real temporary directory.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import DocxBinaryFileSystem from '../src/fs-binary-local.ts'
import { DocxError, mapFsError } from '../src/error.ts'
import * as ToolDocx from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setup(root: string): Promise<{ ctx: Context; fs: DocxBinaryFileSystem }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(DocxBinaryFileSystem, { cwd: root })
  await ctx.plugin(ToolDocx)
  return { ctx, fs: ctx.fs as DocxBinaryFileSystem }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function errorCode(result: { isError: boolean; error?: { info?: { code?: string } } }): string | undefined {
  return result.error?.info?.code
}

describe('DocxBinaryFileSystem provider', () => {
  const roots: string[] = []
  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-docx-provider-'))
    roots.push(dir)
    return dir
  }
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  it('writes and reads raw bytes round-trip', async () => {
    const { fs } = await setup(root())
    const target = await fs.resolve('bin.dat')
    const payload = new Uint8Array([0, 1, 2, 3, 0xff, 0xfe])
    const outcome = await fs.writeBytes(target, payload)
    expect(outcome.operation).toBe('create')
    expect(Array.from(await fs.readBytes(target, undefined, 64))).toEqual(Array.from(payload))
  })

  it('reports update for an existing file and rejects createIfAbsent on it', async () => {
    const { fs } = await setup(root())
    const target = await fs.resolve('a.bin')
    await fs.writeBytes(target, new Uint8Array([1]))
    const updated = await fs.writeBytes(target, new Uint8Array([2]))
    expect(updated.operation).toBe('update')
    await expect(
      fs.writeBytes(target, new Uint8Array([3]), { kind: 'createIfAbsent' }),
    ).rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
  })

  it('enforces replaceIfVersion staleness', async () => {
    const { fs } = await setup(root())
    const target = await fs.resolve('b.bin')
    const created = await fs.writeBytes(target, new Uint8Array([1]))
    expect(created.version.length).toBeGreaterThan(0)
    await expect(
      fs.writeBytes(target, new Uint8Array([2]), { kind: 'replaceIfVersion', version: FsVersion('stale') }),
    ).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    // The matching version succeeds.
    const ok = await fs.writeBytes(target, new Uint8Array([2]), { kind: 'replaceIfVersion', version: created.version })
    expect(ok.operation).toBe('update')
  })

  it('rejects writing into a directory', async () => {
    const dir = root()
    const { fs } = await setup(dir)
    mkdirSync(join(dir, 'adir'))
    const target = await fs.resolve('adir')
    await expect(fs.writeBytes(target, new Uint8Array([1]))).rejects.toMatchObject({ code: 'FS_NOT_REGULAR_FILE' })
  })

  it('docx tools work end-to-end over the provider', async () => {
    const dir = root()
    const { ctx } = await setup(dir)
    const created = await call(ctx, 'docx_create', {
      file_path: 'doc.docx',
      markdown: '# Отчёт\n\nАбзац с **жирным** текстом.',
      title: 'Отчёт',
    })
    expect(created.isError).toBe(false)
    // The produced file is a real binary ZIP (PK magic) on disk.
    const raw = readFileSync(join(dir, 'doc.docx'))
    expect(raw.length).toBeGreaterThan(100)
    expect(raw[0]).toBe(0x50) // 'P'
    expect(raw[1]).toBe(0x4b) // 'K'

    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(read.isError).toBe(false)
    const markdown = text(read)
    expect(markdown).toContain('# Отчёт')
    expect(markdown).toContain('**жирным**')

    const edited = await call(ctx, 'docx_edit', { file_path: 'doc.docx', markdown: '# Новый\n\nНовый текст.' })
    expect(edited.isError).toBe(false)
    const read2 = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(text(read2)).toContain('# Новый')
    expect(text(read2)).not.toContain('Старый')
  })

  it('docx_create refuses to overwrite an existing file with DOCX_EXISTS', async () => {
    const { ctx } = await setup(root())
    await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'Первый.' })
    const second = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'Второй.' })
    expect(second.isError).toBe(true)
    expect(errorCode(second)).toBe('DOCX_EXISTS')
  })

  it('maps the provider FS_STALE_VERSION to the DOCX_STALE tool code', () => {
    const mapped = mapFsError(new FsError('file changed since it was read', 'FS_STALE_VERSION'))
    expect(mapped).toBeInstanceOf(DocxError)
    expect((mapped as DocxError).code).toBe('DOCX_STALE')
  })

  it('rejects editing a missing file with DOCX_NOT_FOUND', async () => {
    const { ctx } = await setup(root())
    const edit = await call(ctx, 'docx_edit', { file_path: 'nope.docx', markdown: 'x' })
    expect(edit.isError).toBe(true)
    expect(errorCode(edit)).toBe('DOCX_NOT_FOUND')
  })
})
