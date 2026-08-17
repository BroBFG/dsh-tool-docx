/**
 * Consumer tests for the docx tools over a fake `ctx.fs` provider: schemas
 * execute end-to-end (create → read → edit), the intent guards map to the
 * docx error vocabulary, and legacy/oversized inputs fail with typed codes.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsInfo, FsPathInfo, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import { BinaryFileSystem } from '../src/fs-binary.ts'
import * as ToolDocx from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** In-memory fake provider storing raw bytes; enforces write intents like the local backend. */
class FakeFs extends BinaryFileSystem {
  files = new Map<string, Uint8Array>()

  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(`key:${path}`), displayPath: `/abs/${path}` }
  }
  override processPath(target: FsTarget): string { return String(target.targetKey) }
  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }
  override async stat(target: FsTarget): Promise<FsInfo | undefined> {
    const data = this.files.get(target.targetKey)
    if (data === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: data.byteLength }
  }
  override async lstat(): Promise<FsPathInfo | undefined> { return undefined }
  override async readText(): Promise<string> { throw new Error('not used in docx tests') }
  override async streamText(): Promise<AsyncIterable<string>> { throw new Error('not used in docx tests') }
  override async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const data = this.files.get(target.targetKey)
    if (data === undefined) throw new FsError(`not found: ${target.displayPath}`, 'FS_NOT_FOUND')
    if (data.byteLength > maxBytes) throw new FsError(`too large: ${target.displayPath}`, 'FS_TOO_LARGE')
    return data
  }
  override async listDir(): Promise<FsDirEntry[]> { return [] }
  override async writeText(): Promise<never> { throw new Error('not used in docx tests') }
  override async writeBytes(target: FsTarget, data: Uint8Array, expected?: FsWriteIntent): Promise<{ operation: 'create' | 'update'; version: FsVersion }> {
    const existing = this.files.get(target.targetKey)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion' && (existing === undefined || expected.version !== 'v1')) {
      throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    }
    this.files.set(target.targetKey, new Uint8Array(data))
    return { operation: existing !== undefined ? 'update' : 'create', version: FsVersion('v2') }
  }
  override async editText(): Promise<never> { throw new Error('not used in docx tests') }
}

async function setup(config?: Partial<ToolDocx.Config>): Promise<{ ctx: Context; fs: FakeFs }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeFs)
  await ctx.plugin(ToolDocx, config)
  return { ctx, fs: ctx.fs as FakeFs }
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

type ToolResult<T> = { isError: boolean; value: T; error?: { info?: { code?: string } } }

describe('docx tools over a fake filesystem', () => {
  it('registers docx_read, docx_create, and docx_edit', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().map(s => s.name).sort()).toEqual(['docx_create', 'docx_edit', 'docx_read'])
  })

  it('registers the docx guidance prompt section', async () => {
    const { ctx } = await setup()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('MS Word .docx files are binary')
    expect(prompt).toContain('Use docx_read')
  })

  it('docx_create writes a valid document and docx_read extracts it', async () => {
    const { ctx } = await setup()
    const created = await call(ctx, 'docx_create', {
      file_path: 'doc.docx',
      markdown: '# Отчёт\n\nАбзац с **жирным** текстом.',
      title: 'Отчёт',
    })
    expect(created.isError).toBe(false)
    expect((created as ToolResult<{ path: string; operation: string; bytes: number }>).value)
      .toMatchObject({ path: '/abs/doc.docx', operation: 'create' })
    expect((created as ToolResult<{ bytes: number }>).value.bytes).toBeGreaterThan(0)

    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(read.isError).toBe(false)
    const markdown = text(read)
    expect(markdown).toContain('# Отчёт')
    expect(markdown).toContain('**жирным**')
  })

  it('docx_read supports structured JSON blocks', async () => {
    const { ctx } = await setup()
    await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: '# H\n\nПараграф.' })
    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx', format: 'json' })
    expect(read.isError).toBe(false)
    const value = (read as ToolResult<{ format: string; blocks: unknown[] }>).value
    expect(value.format).toBe('json')
    expect(value.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'H' },
      { kind: 'paragraph', text: 'Параграф.' },
    ])
  })

  it('docx_edit replaces content and preserves properties', async () => {
    const { ctx } = await setup()
    await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'Старый текст.', title: 'Заголовок' })
    const edited = await call(ctx, 'docx_edit', { file_path: 'doc.docx', markdown: '# Новый\n\nНовый текст.' })
    expect(edited.isError).toBe(false)
    const editedValue = edited as ToolResult<{
      path: string
      operation: string
      docProps: { title: string; author: string | null; created: string | null }
    }>
    expect(editedValue.value)
      .toMatchObject({
        path: '/abs/doc.docx',
        operation: 'update',
        docProps: { title: 'Заголовок', author: null, created: null },
      })
    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(text(read)).toContain('# Новый')
    expect(text(read)).not.toContain('Старый текст')
  })

  it('docx_create refuses to overwrite an existing file with DOCX_EXISTS', async () => {
    const { ctx } = await setup()
    await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'Первый.' })
    const second = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'Второй.' })
    expect(second.isError).toBe(true)
    expect(errorCode(second)).toBe('DOCX_EXISTS')
  })

  it('docx_read rejects legacy .doc with DOCX_LEGACY_DOC', async () => {
    const { ctx } = await setup()
    const read = await call(ctx, 'docx_read', { file_path: 'old.doc' })
    expect(read.isError).toBe(true)
    expect(errorCode(read)).toBe('DOCX_LEGACY_DOC')
  })

  it('docx_read reports a missing file as DOCX_NOT_FOUND', async () => {
    const { ctx } = await setup()
    const read = await call(ctx, 'docx_read', { file_path: 'missing.docx' })
    expect(read.isError).toBe(true)
    expect(errorCode(read)).toBe('DOCX_NOT_FOUND')
  })

  it('docx_read maps an oversized file to DOCX_TOO_LARGE', async () => {
    const { ctx, fs } = await setup({ maxDocxBytes: 10 })
    fs.files.set('key:big.docx', new Uint8Array(64))
    const read = await call(ctx, 'docx_read', { file_path: 'big.docx' })
    expect(read.isError).toBe(true)
    expect(errorCode(read)).toBe('DOCX_TOO_LARGE')
  })

  it('docx_read rejects a non-docx payload with DOCX_NOT_DOCX', async () => {
    const { ctx, fs } = await setup()
    fs.files.set('key:fake.docx', new TextEncoder().encode('not a zip at all'))
    const read = await call(ctx, 'docx_read', { file_path: 'fake.docx' })
    expect(read.isError).toBe(true)
    expect(errorCode(read)).toBe('DOCX_NOT_DOCX')
  })

  it('rejects blank file_path with a plain argument error', async () => {
    const { ctx } = await setup()
    const read = await call(ctx, 'docx_read', { file_path: '   ' })
    expect(read.isError).toBe(true)
    expect(text(read)).toContain('file_path must be a non-empty string')
  })
})
