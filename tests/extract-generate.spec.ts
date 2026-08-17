/**
 * Unit tests for the docx conversion pipeline: markdown → blocks → docx →
 * markdown round trips, extraction error taxonomy, and markdown parsing
 * degradation warnings.
 */

import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Buffer } from 'node:buffer'
import { generateDocx } from '../src/docx/generate.ts'
import { extractDocx } from '../src/docx/extract.ts'
import { parseMarkdown, parseInline } from '../src/markdown.ts'
import { DocxError } from '../src/error.ts'

const NO_PROPS = { title: null, author: null, created: null }

async function extract(markdown: string): Promise<{ text: string; warnings: string[]; images: number }> {
  const warnings: string[] = []
  const blocks = parseMarkdown(markdown, warnings)
  const buffer = await generateDocx(blocks, NO_PROPS)
  const extracted = await extractDocx(buffer, 64 * 1024 * 1024)
  return { text: extracted.markdown, warnings: extracted.warnings, images: extracted.images }
}

describe('markdown → docx → markdown round trip', () => {
  it('preserves headings, paragraphs, and inline formatting', async () => {
    const source = [
      '# Заголовок',
      '',
      'Обычный абзац с **жирным**, *курсивом* и `кодом`.',
      '',
      '## Подзаголовок',
      '',
      'Строка с ~~зачёркнутым~~ текстом.',
    ].join('\n')
    const { text, warnings } = await extract(source)
    expect(text).toContain('# Заголовок')
    expect(text).toContain('## Подзаголовок')
    expect(text).toContain('**жирным**')
    expect(text).toContain('*курсивом*')
    expect(text).toContain('`кодом`')
    expect(text).toContain('~~зачёркнутым~~')
    expect(warnings).toEqual([])
  })

  it('preserves nested lists and distinguishes ordered from bullet', async () => {
    const source = [
      '- первый',
      '  - вложенный',
      '- второй',
      '',
      '1. один',
      '1. два',
    ].join('\n')
    const { text, warnings } = await extract(source)
    expect(text).toContain('- первый')
    expect(text).toContain('- вложенный')
    expect(text).toContain('- второй')
    expect(text).toContain('1. один')
    expect(text).toContain('1. два')
    expect(warnings).toEqual([])
  })

  it('preserves pipe tables', async () => {
    const source = [
      '| Имя | Возраст |',
      '| --- | --- |',
      '| Анна | 30 |',
      '| Боб | 25 |',
    ].join('\n')
    const { text, warnings } = await extract(source)
    expect(text).toContain('| Анна | 30 |')
    expect(text).toContain('| Боб | 25 |')
    expect(warnings).toEqual([])
  })

  it('preserves document properties through an edit-style round trip', async () => {
    const blocks = parseMarkdown('# Заголовок\n\nТекст.', [])
    const props = { title: 'Документ', author: 'Автор', created: '2024-01-02T03:04:05Z' }
    const buffer = await generateDocx(blocks, props)
    const extracted = await extractDocx(buffer, 64 * 1024 * 1024)
    expect(extracted.props).toEqual(props)
    expect(extracted.markdown).toContain('# Заголовок')
  })
})

describe('extractDocx failure taxonomy', () => {
  it('rejects a non-zip payload with DOCX_NOT_DOCX', async () => {
    const error = await extractDocx(Buffer.from('this is not a zip'), 1024).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DocxError)
    expect((error as DocxError).code).toBe('DOCX_NOT_DOCX')
  })

  it('rejects a zip without [Content_Types].xml with DOCX_NOT_DOCX', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', '<w:document/>')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const error = await extractDocx(buffer, 1024).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DocxError)
    expect((error as DocxError).code).toBe('DOCX_NOT_DOCX')
  })

  it('rejects an encrypted package with DOCX_ENCRYPTED', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override ContentType="EncryptionInfo"/></Types>')
    zip.file('EncryptionInfo', 'binary')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const error = await extractDocx(buffer, 1024).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DocxError)
    expect((error as DocxError).code).toBe('DOCX_ENCRYPTED')
  })

  it('binds the ZIP expansion to the configured cap', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('word/document.xml', 'x'.repeat(5000))
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const error = await extractDocx(buffer, 1000).catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DocxError)
    expect((error as DocxError).code).toBe('DOCX_NOT_DOCX')
    expect((error as DocxError).message).toContain('exceeds')
  })
})

describe('parseMarkdown degradation', () => {
  it('warns once about images and keeps the alt text', () => {
    const warnings: string[] = []
    const blocks = parseMarkdown('![картинка](x.png)\n\n![вторая](y.png)', warnings)
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'картинка' },
      { kind: 'paragraph', text: 'вторая' },
    ])
    expect(warnings).toEqual(['images are not supported when generating; only the alt text is kept'])
  })

  it('warns once about fenced code and emits code-styled paragraphs', () => {
    const warnings: string[] = []
    const blocks = parseMarkdown('```js\nconst x = 1\n```', warnings)
    expect(blocks).toEqual([{ kind: 'paragraph', text: 'const x = 1' }])
    expect(warnings).toEqual(['code blocks become paragraphs with code styling'])
  })

  it('parses inline links, code, and bold', () => {
    expect(parseInline('a **b** c `d` [e](https://x.y)')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' c ' },
      { text: 'd', code: true },
      { text: ' ' },
      { text: 'e', link: 'https://x.y' },
    ])
  })
})
