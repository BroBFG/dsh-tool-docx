/**
 * Model-facing `docx_create`: generate a new `.docx` file from Markdown.
 * Guarded with `createIfAbsent` by default so an existing file is never
 * blindly overwritten (the observation-policy waterfall may supply its own
 * intent).
 * @module dsh-tool-docx/tools/create
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { generateDocx } from "../docx/generate.js";
import { parseMarkdown } from "../markdown.js";
import { DocxError, mapFsError } from "../error.js";
import { assertSupportedExtension, emitObserved, requirePath, resolveOptions } from "../tool-utils.js";
import { assertBinaryFs } from "../fs-binary.js";
function parseCreateArgs(args, maxMarkdownChars) {
    const filePath = requirePath(args.file_path);
    if (args.markdown.length > maxMarkdownChars) {
        throw new DocxError(`markdown exceeds the ${maxMarkdownChars}-character limit`, 'DOCX_INPUT_TOO_LARGE');
    }
    return {
        filePath,
        markdown: args.markdown,
        title: args.title !== undefined && args.title.trim().length > 0 ? args.title : undefined,
        author: args.author !== undefined && args.author.trim().length > 0 ? args.author : undefined,
    };
}
/**
 * Register the `docx_create` tool.
 * @param ctx - the plugin context; execution uses its `fs` service.
 * @param caps - the deployment's resolved caps.
 * @param sandbox - the shared sandbox-escalation API.
 */
export function applyCreateTool(ctx, caps, sandbox) {
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
            render: (_args, value) => [{
                    type: 'text',
                    text: `<path>${value.path}</path>\n<type>docx</type>\n<content>\nCreated ${value.bytes}-byte .docx document\n</content>`,
                }],
        },
        async execute(args, exec) {
            const input = parseCreateArgs(args, caps.maxMarkdownChars);
            assertSupportedExtension(input.filePath);
            const fs = assertBinaryFs(ctx.fs);
            const sandboxPolicy = await sandbox.resolvePolicy('docx_create', args, exec);
            const warnings = [];
            const blocks = parseMarkdown(input.markdown, warnings);
            const buffer = await generateDocx(blocks, {
                title: input.title ?? null,
                author: input.author ?? null,
                created: null,
            });
            const target = await fs.resolve(input.filePath, resolveOptions(exec));
            // A create must never blind-overwrite: the policy waterfall may supply an
            // intent (createIfAbsent after a confirmed absent observation), and the
            // bare default is createIfAbsent too.
            const intent = await ctx.waterfall('fs/write-intent', target, exec, () => ({ kind: 'createIfAbsent' }));
            let outcome;
            try {
                outcome = await fs.writeBytes(target, buffer, intent, exec.signal, sandboxPolicy);
            }
            catch (error) {
                throw mapFsError(sandbox.mapError(error, sandboxPolicy));
            }
            emitObserved(ctx, target, outcome.version, exec);
            return {
                path: target.displayPath,
                operation: outcome.operation,
                bytes: buffer.byteLength,
                warnings,
            };
        },
        presentCall(args) {
            return { card: 'generic', title: `Create ${args.file_path}`, kind: 'edit', locations: [{ path: args.file_path }] };
        },
        presentResult(args, result) {
            if (result.isError)
                return undefined;
            return { card: 'generic', title: `Create ${args.file_path}` };
        },
    }));
}
//# sourceMappingURL=create.js.map