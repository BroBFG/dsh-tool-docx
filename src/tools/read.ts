/**
 * Model-facing `docx_read`: extract a `.docx` file as Markdown or structured
 * JSON blocks. Bounded by the configured byte cap (whole file), the ZIP
 * expansion cap, and the returned-markdown character cap.
 * @module dsh-tool-docx/tools/read
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { extractDocx } from '../docx/extract.ts'
import { DocxError, mapFsError } from '../error.ts'
import type { DocxReadValue } from '../types.ts'
import type { DocxToolCaps } from '../caps.ts'
import { assertSupportedExtension, emitAbsent, emitObserved, requirePath, resolveOptions } from '../tool-utils.ts'
import { assertBinaryFs } from '../fs-binary.ts'

interface ReadArgs {
  file_path: string
  format?: 'markdown' | 'json'
  max_chars?: number
}

function parseReadArgs(args: ReadArgs): { filePath: string; format: 'markdown' | 'json'; maxChars: number | undefined } {
  const filePath = requirePath(args.file_path)
  const format = args.format ?? 'markdown'
  if (args.max_chars !== undefined && (!Number.isInteger(args.max_chars) || args.max_chars < 1)) {
    throw new Error('max_chars must be a positive integer')
  }
  return { filePath, format, maxChars: args.max_chars }
}

/** Render the read value as model-facing text: markdown, or pretty JSON blocks. */
function renderReadValue(value: DocxReadValue, maxChars: number): string {
  const body = value.format === 'json' ? JSON.stringify(value.blocks, null, 2) : value.markdown ?? ''
  return body.length > maxChars ? `${body.slice(0, maxChars)}\nвЂ¦ (truncated)` : body
}

/**
 * Register the `docx_read` tool and its system-prompt guidance.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved caps.
 */
export function applyReadTool(ctx: Context, caps: DocxToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:docx-read',
    order: 110,
    text: 'MS Word .docx files are binary (ZIP+XML) and the read tool cannot read them. Use docx_read to extract a document as Markdown (default) or structured JSON blocks, docx_create to generate a new .docx from Markdown, and docx_edit to replace a document\'s content from Markdown while preserving its title/author/created properties. Legacy .doc is not supported вЂ” convert it to .docx first.',
  })

  ctx.tools.register(defineTool({
    name: 'docx_read',
    description: 'Read a Microsoft Word .docx file: extract its content as Markdown or structured JSON blocks, plus document properties.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the .docx file, resolved by the filesystem backend.' },
      format: {
        type: 'string',
        enum: ['markdown', 'json'],
        description: 'Output shape: markdown (default) or structured JSON blocks.',
      },
      max_chars: { type: 'number', description: 'Optional cap on the returned markdown/JSON length (defaults to the deployment cap).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: ['markdown', 'json'] },
          docProps: {
            required: true,
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              author: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              created: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
            },
          },
          charCount: { type: 'number', required: true },
          images: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          markdown: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          blocks: {
            required: true,
            oneOf: [
              {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
              { type: 'null' },
            ],
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReadValue(value as DocxReadValue, caps.maxReadChars) }],
    },
    async execute(args: ReadArgs, exec) {
      const input = parseReadArgs(args)
      assertSupportedExtension(input.filePath)
      const fs = assertBinaryFs(ctx.fs)
      const target = await fs.resolve(input.filePath, resolveOptions(exec))
      const info = await fs.stat(target, exec.signal)
      if (!info) {
        emitAbsent(ctx, target, exec)
        throw new DocxError(`file not found: ${target.displayPath}`, 'DOCX_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new DocxError(`cannot read "${target.displayPath}": not a regular file`, 'DOCX_NOT_REGULAR_FILE')
      }
      let data: Uint8Array
      try {
        data = await fs.readBytes(target, exec.signal, caps.maxDocxBytes)
      } catch (error: unknown) {
        throw mapFsError(error)
      }
      const extracted = await extractDocx(data, caps.maxDocxBytes)
      const cap = input.maxChars ?? caps.maxReadChars
      let markdown = extracted.markdown
      let warnings = extracted.warnings
      if (input.format === 'markdown' && markdown.length > cap) {
        markdown = markdown.slice(0, cap)
        warnings = [...warnings, `output truncated to ${cap} characters`]
      }
      emitObserved(ctx, target, info.version, exec)
      return {
        path: target.displayPath,
        format: input.format,
        docProps: extracted.props,
        charCount: markdown.length,
        images: extracted.images,
        warnings,
        markdown: input.format === 'markdown' ? markdown : null,
        blocks: input.format === 'json' ? extracted.blocks : null,
      } satisfies DocxReadValue
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Read ${args.file_path}`, kind: 'read', locations: [{ path: args.file_path }] }
    },
    presentResult(args, result: ToolResult): GenericResultView | undefined {
      if (result.isError) return undefined
      return { card: 'generic', title: `Read ${args.file_path}` }
    },
  }))
}
