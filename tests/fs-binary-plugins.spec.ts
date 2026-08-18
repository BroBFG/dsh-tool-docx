/**
 * Consumer tests for the `fsBinary` service plugins (`fs-binary-sandbox-plugin`
 * and `fs-binary-local-plugin`): each registers the binary write primitive as
 * the SEPARATE `fsBinary` service over the host's own `ctx.fs` — the host
 * filesystem is never replaced. The sandboxed plugin fences writes by the
 * per-call policy (in-workspace succeeds, outside is denied); the local plugin
 * writes unfenced. The docx tools resolve the writer from `fsBinary` and report
 * `DOCX_HOST_FS_UNSUPPORTED` when no binary writer exists.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import * as FsBinarySandboxPlugin from '../src/fs-binary-sandbox-plugin.ts'
import * as FsBinaryLocalPlugin from '../src/fs-binary-local-plugin.ts'
import { FS_BINARY_SERVICE } from '../src/fs-binary.ts'
import * as ToolDocx from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setupFs(root: string): Promise<{ ctx: Context; fs: LocalFileSystem }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  return { ctx, fs: ctx.fs as LocalFileSystem }
}

function setupSandbox(root: string, mode: SandboxMode): Promise<{ ctx: Context; fs: LocalFileSystem }> {
  return setupFs(root).then(async ({ ctx, fs }) => {
    await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: root })
    await ctx.plugin(FsBinarySandboxPlugin)
    return { ctx, fs }
  })
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

describe('fsBinary service plugins', () => {
  const roots: string[] = []
  function root(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-docx-plugin-'))
    roots.push(dir)
    return dir
  }
  function outsideRoot(): string {
    const dir = join(homedir(), `dsh-tool-docx-outside-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
    roots.push(dir)
    return dir
  }
  afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  it('fs-binary-sandbox-plugin registers fsBinary and leaves ctx.fs untouched', async () => {
    const dir = root()
    const { ctx, fs } = await setupSandbox(dir, 'workspace-write')
    // ctx.fs is the stock local backend — no writeBytes was added to it.
    expect(fs).toBeInstanceOf(LocalFileSystem)
    expect((fs as { writeBytes?: unknown }).writeBytes).toBeUndefined()
    const fsBinary = ctx.get(FS_BINARY_SERVICE) as { writeBytes?: unknown }
    expect(typeof fsBinary?.writeBytes).toBe('function')
  })

  it('fs-binary-sandbox-plugin fences writes inside the workspace and denies outside', async () => {
    const dir = root()
    const { ctx } = await setupSandbox(dir, 'workspace-write')
    const fsBinary = ctx.get(FS_BINARY_SERVICE) as {
      writeBytes(target: unknown, data: Uint8Array): Promise<{ operation: string }>
    }
    const inside = await ctx.fs.resolve(join(dir, 'inside.docx'))
    const outcome = await fsBinary.writeBytes(inside, new Uint8Array([0x50, 0x4b, 1]))
    expect(outcome.operation).toBe('create')
    const outside = await ctx.fs.resolve(join(outsideRoot(), 'evil.docx'))
    await expect(fsBinary.writeBytes(outside, new Uint8Array([1]))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  })

  it('fs-binary-local-plugin registers fsBinary unfenced', async () => {
    const dir = root()
    const { ctx } = await setupFs(dir)
    await ctx.plugin(FsBinaryLocalPlugin)
    const fsBinary = ctx.get(FS_BINARY_SERVICE) as {
      writeBytes(target: unknown, data: Uint8Array): Promise<{ operation: string }>
    }
    const outside = await ctx.fs.resolve(join(outsideRoot(), 'doc.docx'))
    const outcome = await fsBinary.writeBytes(outside, new Uint8Array([0x50, 0x4b, 1]))
    expect(outcome.operation).toBe('create')
  })

  it('docx tools write through fsBinary and deny outside the workspace at the tool layer', async () => {
    const dir = root()
    const { ctx } = await setupSandbox(dir, 'workspace-write')
    await ctx.plugin(ToolDocx)
    const created = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: '# Внутри\n\nАбзац.' })
    expect(created.isError).toBe(false)
    const read = await call(ctx, 'docx_read', { file_path: 'doc.docx' })
    expect(read.isError).toBe(false)
    expect(text(read)).toContain('# Внутри')

    const denied = await call(ctx, 'docx_create', { file_path: join(outsideRoot(), 'evil.docx'), markdown: 'x' })
    expect(denied.isError).toBe(true)
    expect(errorCode(denied)).toBe('DOCX_SANDBOX_DENIED')
    expect(text(denied)).toContain('[sandbox:')
  })

  it('docx_create reports DOCX_HOST_FS_UNSUPPORTED when no binary writer is mounted', async () => {
    const dir = root()
    const { ctx } = await setupFs(dir)
    await ctx.plugin(ToolDocx)
    const created = await call(ctx, 'docx_create', { file_path: 'doc.docx', markdown: 'x' })
    expect(created.isError).toBe(true)
    expect(errorCode(created)).toBe('DOCX_HOST_FS_UNSUPPORTED')
    expect(text(created)).toContain('writeBytes')
  })
})
