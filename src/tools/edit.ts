/**
 * Model-facing `docx_edit`: replace a `.docx` document's content from
 * Markdown, preserving its title/author/created properties. Reads the current
 * file (validating it is a docx), regenerates the body, and writes back with a
 * version guard so a concurrent change reports `DOCX_STALE`.
 * @module dsh-tool-docx/tools/edit
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { extractDocx } from '../docx/extract.ts'
import { generateDocx } from '../docx/generate.ts'
import { parseMarkdown } from '../markdown.ts'
import { DocxError, mapFsError } from '../error.ts'
import type { DocxWriteValue } from '../types.ts'
import type { DocxToolCaps } from '../caps.ts'
import { DocxSandboxController } from '../sandbox.ts'
import { assertSupportedExtension, emitAbsent, emitObserved, requirePath, resolveOptions } from '../tool-utils.ts'
import { assertBinaryFs } from '../fs-binary.ts'

interface EditArgs {
  file_path: string
  markdown: string
  sandbox_permissions?: string
  justification?: string
}

function parseEditArgs(args: EditArgs, maxMarkdownChars: number): { filePath: string; markdown: string } {
  const filePath = requirePath(args.file_path)
  if (args.markdown.length > maxMarkdownChars) {
    throw new DocxError(`markdown exceeds the ${maxMarkdownChars}-character limit`, 'DOCX_INPUT_TOO_LARGE')
  }
  return { filePath, markdown: args.markdown }
}

/**
 * Register the `docx_edit` tool.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved caps.
 * @param sandbox - the shared sandbox-escalation API.
 */
export function applyEditTool(ctx: Context, caps: DocxToolCaps, sandbox: DocxSandboxController): void {
  ctx.tools.register(defineTool({
    name: 'docx_edit',
    description: 'Edit a Microsoft Word .docx file: replace its content from Markdown while preserving title/author/created. Round-trip: read with docx_read, modify the Markdown, then call docx_edit with the full new Markdown.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path of the .docx file to edit, resolved by the filesystem backend.' },
      markdown: { type: 'string', required: true, description: 'The full new Markdown content for the document (headings, paragraphs, bold/italic/code, nested lists, pipe tables).' },
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
          docProps: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              author: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              created: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
        },
      },
      render: (_args, value: DocxWriteValue) => [{
        type: 'text',
        text: `<path>${value.path}</path>\n<type>docx</type>\n<content>\nUpdated ${value.bytes}-byte .docx document\n</content>`,
      }],
    },
    async execute(args: EditArgs, exec) {
      const input = parseEditArgs(args, caps.maxMarkdownChars)
      assertSupportedExtension(input.filePath)
      const fs = assertBinaryFs(ctx.fs)
      const sandboxPolicy = await sandbox.resolvePolicy('docx_edit', args, exec)

      const target = await fs.resolve(input.filePath, resolveOptions(exec))
      const info = await fs.stat(target, exec.signal)
      if (!info) {
        emitAbsent(ctx, target, exec)
        throw new DocxError(`file not found: ${target.displayPath}`, 'DOCX_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new DocxError(`cannot edit "${target.displayPath}": not a regular file`, 'DOCX_NOT_REGULAR_FILE')
      }

      let data: Uint8Array
      try {
        data = await fs.readBytes(target, exec.signal, caps.maxDocxBytes)
      } catch (error: unknown) {
        throw mapFsError(error)
      }
      // Validate the existing file and preserve its document properties.
      const existing = await extractDocx(data, caps.maxDocxBytes)
      const warnings: string[] = [...existing.warnings]
      const blocks = parseMarkdown(input.markdown, warnings)
      const buffer = await generateDocx(blocks, existing.props)

      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => ({ kind: 'replaceIfVersion', version: info.version }))
      let outcome
      try {
        outcome = await fs.writeBytes(target, buffer, intent, exec.signal, sandboxPolicy)
      } catch (error: unknown) {
        throw mapFsError(sandbox.mapError(error, sandboxPolicy))
      }
      emitObserved(ctx, target, outcome.version, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        bytes: buffer.byteLength,
        warnings,
        docProps: existing.props,
      } satisfies DocxWriteValue
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Edit ${args.file_path}`, kind: 'edit', locations: [{ path: args.file_path }] }
    },
    presentResult(args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return { card: 'generic', title: `Edit ${args.file_path}` }
    },
  }))
}
