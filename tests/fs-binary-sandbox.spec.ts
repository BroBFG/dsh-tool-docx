/**
 * Consumer tests for the sandbox-preserving binary fs provider
 * (`fs-binary-sandbox`): `DocxSandboxedFileSystem` gives the docx tools
 * `writeBytes` through the same policy fence as the harness's `fs-sandbox`
 * mount — writes inside the workspace succeed, writes outside are denied with
 * `FS_SANDBOX_DENIED` (mapped to `DOCX_SANDBOX_DENIED` at the tool layer),
 * `read-only` denies everything, and `danger-full-access` passes unfenced.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import DocxSandboxedFileSystem from '../src/fs-binary-sandbox.ts'
import * as ToolDocx from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setup(
  root: string,
  mode: SandboxMode,
): Promise<{ ctx: Context; fs: DocxSandboxedFileSystem }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: root })
  await ctx.plugin(DocxSandboxedFileSystem, { cwd: root })
  await ctx.plugin(ToolDocx)
  return { ctx, fs: ctx.fs as DocxSandboxedFileSystem }
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

describe('DocxSandboxedFileSystem provider', () => {
  const roots: string[] = []
  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-docx-sandbox-'))
    roots.push(dir)
    return dir
  }
  function outsideRoot(): string {
    // A writable-looking path that is neither the workspace root nor a
    // platform temp area, so the workspace-write fence must refuse it.
    const dir = join(homedir(), `dsh-tool-docx-outside-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    roots.push(dir)
    return dir
  }
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  it('docx tools work end-to-end inside the workspace under workspace-write', async () => {
    const dir = root()
    const { ctx } = await setup(dir, 'workspace-write')
    const created = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: '# Внутри\n\nАбзац.' })
    expect(created.isError).toBe(false)
    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(read.isError).toBe(false)
    expect(text(read)).toContain('# Внутри')
    const edited = await call(ctx, 'docx_edit', { file_path: 'doc.docx', markdown: '# Изменено' })
    expect(edited.isError).toBe(false)
  })

  it('denies a write outside the workspace with FS_SANDBOX_DENIED', async () => {
    const { fs } = await setup(root(), 'workspace-write')
    const target = await fs.resolve(join(outsideRoot(), 'evil.docx'))
    await expect(fs.writeBytes(target, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  })

  it('maps a sandbox denial to DOCX_SANDBOX_DENIED at the tool layer', async () => {
    const { ctx } = await setup(root(), 'workspace-write')
    const denied = await call(ctx, 'docx_create', { file_path: join(outsideRoot(), 'evil.docx'), markdown: 'x' })
    expect(denied.isError).toBe(true)
    expect(errorCode(denied)).toBe('DOCX_SANDBOX_DENIED')
    expect(text(denied)).toContain('[sandbox:')
  })

  it('read-only mode denies every mutation, even inside the workspace', async () => {
    const dir = root()
    const { ctx } = await setup(dir, 'read-only')
    const created = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'x' })
    expect(created.isError).toBe(true)
    expect(errorCode(created)).toBe('DOCX_SANDBOX_DENIED')
  })

  it('danger-full-access passes the fence unfenced', async () => {
    const dir = root()
    const { fs } = await setup(dir, 'danger-full-access')
    const outside = outsideRoot()
    const target = await fs.resolve(join(outside, 'doc.docx'))
    const outcome = await fs.writeBytes(target, new Uint8Array([0x50, 0x4b, 1]))
    expect(outcome.operation).toBe('create')
  })
})
