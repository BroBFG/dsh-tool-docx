/**
 * Model-facing `docx_create`: generate a new `.docx` file from Markdown.
 * Guarded with `createIfAbsent` by default so an existing file is never
 * blindly overwritten (the observation-policy waterfall may supply its own
 * intent).
 * @module dsh-tool-docx/tools/create
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { generateDocx } from '../docx/generate.ts'
import { parseMarkdown } from '../markdown.ts'
import { DocxError, mapFsError } from '../error.ts'
import type { DocxWriteValue } from '../types.ts'
import type { DocxToolCaps } from '../caps.ts'
import { DocxSandboxController } from '../sandbox.ts'
import { assertSupportedExtension, emitObserved, requirePath, resolveOptions } from '../tool-utils.ts'
import { requireWriteBytes } from '../fs-binary.ts'

interface CreateArgs {
  file_path: string
  markdown: string
  title?: string
  author?: string
  sandbox_permissions?: string
  justification?: string
}

function parseCreateArgs(
  args: CreateArgs,
  maxMarkdownChars: number,
): { filePath: string; markdown: string; title: string | undefined; author: string | undefined } {
  const filePath = requirePath(args.file_path)
  if (args.markdown.length > maxMarkdownChars) {
    throw new DocxError(`markdown exceeds the ${maxMarkdownChars}-character limit`, 'DOCX_INPUT_TOO_LARGE')
  }
  return {
    filePath,
    markdown: args.markdown,
    title: args.title !== undefined && args.title.trim().length > 0 ? args.title : undefined,
    author: args.author !== undefined && args.author.trim().length > 0 ? args.author : undefined,
  }
}

/**
 * Register the `docx_create` tool.
 * @param ctx - the plugin context; execution uses its `fs` service for
 * resolution/reads and the `fsBinary` binary writer for the mutation.
 * @param caps - the deployment's resolved caps.
 * @param sandbox - the shared sandbox-escalation API.
 */
export function applyCreateTool(ctx: Context, caps: DocxToolCaps, sandbox: DocxSandboxController): void {
  ctx.tools.register(defineTool({
    name: 'docx_create',
    description: 'Create a new Microsoft Word .docx file from Markdown. Refuses to overwrite an existing file (read it first, then use docx_edit).',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path of the new .docx file, resolved by the filesystem backend.' },
      markdown: { type: 'string', required: true, description: 'Markdown content: headings, paragraphs, bold/italic/code, nested lists, and pipe tables.' },
      title: { type: 'string', description: 'Optional document title property.' },
      author: { type: 'string', description: 'Optional document author (creator) property.' },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
          bytes: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value: DocxWriteValue) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>docx</type>\n<content>\nCreated ${value.bytes}-byte .docx document\n</content>`,
      }],
    },
    async execute(args: CreateArgs, exec) {
      const input = parseCreateArgs(args, caps.maxMarkdownChars)
      assertSupportedExtension(input.filePath)
      const fs = ctx.fs
      const writeBytes = requireWriteBytes(ctx)
      const sandboxPolicy = await sandbox.resolvePolicy('docx_create', args, exec)
      const warnings: string[] = []
      const blocks = parseMarkdown(input.markdown, warnings)
      const buffer = await generateDocx(blocks, {
        title: input.title ?? null,
        author: input.author ?? null,
        created: null,
      })
      const target = await fs.resolve(input.filePath, resolveOptions(exec))
      // A create must never blind-overwrite: the policy waterfall may supply an
      // intent (createIfAbsent after a confirmed absent observation), and the
      // bare default is createIfAbsent too.
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => ({ kind: 'createIfAbsent' as const }))
      let outcome
      try {
        outcome = await writeBytes(target, buffer, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        throw mapFsError(sandbox.mapError(error, sandboxPolicy))
      }
      emitObserved(ctx, target, outcome.version, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        bytes: buffer.byteLength,
        warnings,
      } satisfies DocxWriteValue
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Create ${args.file_path}`, kind: 'edit', locations: [{ path: args.file_path }] }
    },
    presentResult(args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return { card: 'generic', title: `Create ${args.file_path}` }
    },
  }))
}
