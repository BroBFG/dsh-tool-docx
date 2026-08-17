/**
 * Generate a `.docx` package buffer from structured blocks using the `docx`
 * library: headings, paragraphs with inline styling, nested bullet/numbered
 * lists, pipe tables, and external hyperlinks. Document properties come from
 * the caller (extracted from the previous version on an edit).
 * @module dsh-tool-docx/docx/generate
 */

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx'
import JSZip from 'jszip'
import type { Buffer } from 'node:buffer'
import { parseInline, type InlineSegment } from '../markdown.ts'
import type { DocxBlock, DocxProps } from '../types.ts'
import { DocxError } from '../error.ts'

const NUMBER_REFERENCE = 'dsh-ordered'
const BULLET_REFERENCE = 'dsh-bullet'

/** Indent (twips) per numbering level: 0.5" step, hanging first line. */
function levelStyle(level: number): { paragraph: { indent: { left: number; hanging: number } } } {
  return { paragraph: { indent: { left: 720 + level * 720, hanging: 360 } } }
}

type LevelFormatValue = (typeof LevelFormat)[keyof typeof LevelFormat]

function numberingLevels(format: LevelFormatValue, text: (level: number) => string): Array<{
  level: number
  format: LevelFormatValue
  text: string
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType]
  style: ReturnType<typeof levelStyle>
}> {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format,
    text: text(level),
    alignment: AlignmentType.LEFT,
    style: levelStyle(level),
  }))
}

const NUMBERING = {
  config: [
    {
      reference: NUMBER_REFERENCE,
      levels: numberingLevels(LevelFormat.DECIMAL, level => `%${level + 1}.`),
    },
    {
      reference: BULLET_REFERENCE,
      levels: numberingLevels(LevelFormat.BULLET, () => '\u2022'),
    },
  ],
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
}

/** Convert inline segments into docx run elements (tabs become `Tab` elements). */
function inlineToRuns(segments: InlineSegment[]): Array<TextRun | ExternalHyperlink | Tab> {
  const runs: Array<TextRun | ExternalHyperlink | Tab> = []
  for (const segment of segments) {
    if (segment.text.length === 0) continue
    if (segment.link !== undefined) {
      runs.push(new ExternalHyperlink({
        children: [new TextRun({ text: segment.text })],
        link: segment.link,
      }))
      continue
    }
    const parts = segment.text.split('\t')
    parts.forEach((part, index) => {
      if (index > 0) runs.push(new Tab())
      if (part.length === 0) return
      runs.push(new TextRun({
        text: part,
        ...(segment.bold ? { bold: true } : {}),
        ...(segment.italic ? { italics: true } : {}),
        ...(segment.strike ? { strike: true } : {}),
        ...(segment.code ? { font: { name: 'Consolas' }, color: '1F3864' } : {}),
      }))
    })
  }
  return runs
}

/** One paragraph element from inline-markdown text. */
function paragraphFromText(text: string): Paragraph {
  return new Paragraph({ children: inlineToRuns(parseInline(text)) })
}

/** Render blocks into docx section children (paragraphs + tables). */
function renderBlocks(blocks: DocxBlock[]): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const level = HEADING_LEVELS[block.level] ?? HeadingLevel.HEADING_1
        children.push(new Paragraph({ heading: level, children: inlineToRuns(parseInline(block.text)) }))
        break
      }
      case 'paragraph':
        children.push(paragraphFromText(block.text))
        break
      case 'list': {
        for (const item of block.items) {
          const level = Math.min(8, Math.max(0, item.level - 1))
          children.push(new Paragraph({
            numbering: { reference: block.ordered ? NUMBER_REFERENCE : BULLET_REFERENCE, level },
            children: inlineToRuns(parseInline(item.text)),
          }))
        }
        break
      }
      case 'table': {
        const row = (cells: string[]): TableRow => new TableRow({
          children: cells.map(cell => new TableCell({
            children: cell.split('\n').map(line => paragraphFromText(line)),
          })),
        })
        const rows: TableRow[] = []
        if (block.header) rows.push(row(block.header))
        for (const bodyRow of block.rows) rows.push(row(bodyRow))
        children.push(new Table({ rows }))
        break
      }
      case 'image':
        // The parser never emits image blocks; guard for direct callers.
        break
    }
  }
  return children
}

/** Escape XML text content for core-properties elements. */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * The `docx` library stamps default core properties (current time as
 * `dcterms:created`, `Un-named` as `dc:creator`); patch the packed package's
 * `docProps/core.xml` so an edit round trip keeps the document's exact
 * title/author/created вЂ” and removes the elements when the value is null.
 * @param packed - the freshly packed `.docx` bytes.
 * @param props - the document properties to stamp.
 * @returns the repacked bytes with the patched core-properties document.
 */
async function patchCoreProps(packed: Buffer, props: DocxProps): Promise<Buffer> {
  const zip = await JSZip.loadAsync(packed)
  const corePath = 'docProps/core.xml'
  const file = zip.file(corePath)
  if (file === null) return packed
  let core = await file.async('string')

  const setOrRemove = (xml: string, tag: string, value: string | null): string => {
    const pattern = new RegExp(`<${tag}[^>]*>.*?</${tag}>`)
    const match = pattern.exec(xml)
    if (value === null) {
      return match !== null ? xml.replace(match[0], '') : xml
    }
    const element = `<${tag}>${escapeXml(value)}</${tag}>`
    return match !== null ? xml.replace(match[0], element) : xml
  }

  core = setOrRemove(core, 'dc:title', props.title)
  core = setOrRemove(core, 'dc:creator', props.author)
  core = setOrRemove(core, 'dcterms:created', props.created)
  zip.file(corePath, core)
  return await zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * Generate a `.docx` package buffer from blocks.
 * @param blocks - the structured content to render.
 * @param props - document properties to stamp (title/creator/created).
 * @returns the packed `.docx` bytes.
 */
export async function generateDocx(blocks: DocxBlock[], props: DocxProps): Promise<Buffer> {
  const children = renderBlocks(blocks)
  const document = new Document({
    ...(props.title !== null ? { title: props.title } : {}),
    ...(props.author !== null ? { creator: props.author } : {}),
    numbering: NUMBERING,
    sections: [{ properties: {}, children }],
  })
  try {
    const packed = await Packer.toBuffer(document)
    return await patchCoreProps(packed, props)
  } catch (error: unknown) {
    throw new DocxError(`failed to assemble the .docx document: ${error instanceof Error ? error.message : String(error)}`, 'DOCX_WRITE_ERROR', { cause: error })
  }
}
