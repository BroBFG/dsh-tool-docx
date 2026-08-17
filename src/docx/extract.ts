/**
 * Extract a `.docx` package into Markdown and structured blocks: walks
 * `word/document.xml` (paragraphs, runs, lists, tables, hyperlinks, images),
 * resolves list numbering through `word/numbering.xml`, and reads document
 * properties from `docProps/core.xml`. Pure — no I/O; callers supply the
 * bounded package bytes.
 * @module @deepseek-ai/dsh-tool-docx/docx/extract
 */

import { XMLParser } from 'fast-xml-parser'
import type { DocxBlock, DocxProps, ExtractedDocx } from '../types.ts'
import { DocxError } from '../error.ts'
import { readZip, type ZipEntries } from './zip.ts'

const CONTENT_TYPES = '[Content_Types].xml'
const DOCUMENT_XML = 'word/document.xml'
const NUMBERING_XML = 'word/numbering.xml'
const CORE_PROPS_XML = 'docProps/core.xml'
const DOCUMENT_RELS_XML = 'word/_rels/document.xml.rels'

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
} as const

type XmlNode = Record<string, unknown>

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function attr(node: unknown, name: string): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const value = (node as XmlNode)[name]
  return typeof value === 'string' ? value : undefined
}

function textOf(node: unknown): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (typeof node === 'object') {
    const text = (node as XmlNode)['#text']
    if (typeof text === 'string') return text
  }
  return ''
}

/** Escape characters that carry Markdown meaning in body text. */
function escapeMarkdown(text: string, inCell = false): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
  return inCell ? escaped.replace(/\|/g, '\\|') : escaped
}

interface InlineRun {
  text: string
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
}

function renderInline(run: InlineRun): string {
  const body = escapeMarkdown(run.text)
  if (run.code) return `\`${body}\``
  const italic = run.italic ? `*${body}*` : body
  const bold = run.bold ? `**${italic}**` : italic
  return run.strike ? `~~${bold}~~` : bold
}

/** Walk one run (`w:r`) and collect its text plus inline styling. */
function parseRun(run: XmlNode, images: { count: number }): InlineRun {
  const rPr = run['w:rPr'] as XmlNode | undefined
  const bold = rPr !== undefined && 'w:b' in rPr
  const italic = rPr !== undefined && 'w:i' in rPr
  const strike = rPr !== undefined && 'w:strike' in rPr
  const rFonts = rPr?.['w:rFonts'] as XmlNode | undefined
  const font = attr(rFonts, '@_w:ascii') ?? attr(rFonts, '@_w:hAnsi')
  const code = font === 'Consolas'

  const parts: string[] = []
  const add = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node)
    } else if (typeof node === 'object' && node !== null) {
      const record = node as XmlNode
      if ('#text' in record) parts.push(String(record['#text']))
      if ('w:tab' in record) parts.push('\t')
      if ('w:drawing' in record || 'w:pict' in record) {
        images.count += 1
      }
    }
  }
  if ('w:t' in run) {
    const t = run['w:t']
    if (Array.isArray(t)) {
      for (const piece of t) add(piece)
    } else {
      add(t)
    }
  }
  return { text: parts.join(''), bold, italic, strike, code }
}

/** One `w:p` paragraph's meaning: optional style, list identity, and rendered inline text. */
interface ParagraphMeaning {
  style: string | undefined
  numId: string | undefined
  ilvl: number
  text: string
  pageBreaks: number
  footnoteRefs: number
  hyperlinkCount: number
}

function parseParagraph(
  p: XmlNode,
  images: { count: number },
  hyperlinks: Map<string, string>,
): ParagraphMeaning {
  const pPr = p['w:pPr'] as XmlNode | undefined
  const style = pPr !== undefined ? attr(pPr['w:pStyle'], '@_w:val') : undefined
  const numPr = pPr?.['w:numPr'] as XmlNode | undefined
  const numId = numPr !== undefined ? attr(numPr['w:numId'], '@_w:val') : undefined
  const parsedIlvl = Number.parseInt(attr(numPr?.['w:ilvl'], '@_w:val') ?? '0', 10)

  const pieces: string[] = []
  let pageBreaks = 0
  let footnoteRefs = 0
  let hyperlinkCount = 0

  const consumeRuns = (runs: unknown): void => {
    for (const runNode of asArray(runs)) {
      const run = parseRun(runNode as XmlNode, images)
      if (run.text.length > 0) pieces.push(renderInline(run))
      if ('w:br' in (runNode as XmlNode)) {
        for (const br of asArray((runNode as XmlNode)['w:br'])) {
          if (attr(br, '@_w:type') === 'page') pageBreaks += 1
        }
      }
      if ('w:footnoteReference' in (runNode as XmlNode) || 'w:endnoteReference' in (runNode as XmlNode)) {
        footnoteRefs += 1
      }
    }
  }

  consumeRuns(p['w:r'])
  for (const link of asArray(p['w:hyperlink'] as XmlNode | XmlNode[] | undefined)) {
    const linkId = attr(link, '@_r:id')
    const target = linkId !== undefined ? hyperlinks.get(linkId) : undefined
    if (target !== undefined) hyperlinkCount += 1
    const before = pieces.length
    consumeRuns(link['w:r'])
    if (target !== undefined && pieces.length > before) {
      const linkText = pieces.splice(before).join('')
      pieces.push(`[${linkText}](${target.replaceAll(')', '%29')})`)
    }
  }

  return {
    style,
    numId,
    ilvl: Number.isNaN(parsedIlvl) ? 0 : parsedIlvl,
    text: pieces.join(''),
    pageBreaks,
    footnoteRefs,
    hyperlinkCount,
  }
}

/** Resolve `numId` → ordered/unordered from `word/numbering.xml`. */
function buildNumberingMap(entries: ZipEntries): Map<string, { ordered: boolean }> {
  const result = new Map<string, { ordered: boolean }>()
  const raw = entries.get(NUMBERING_XML)
  if (raw === undefined) return result
  let root: XmlNode
  try {
    root = new XMLParser(XML_OPTIONS).parse(raw.toString('utf8')) as XmlNode
  } catch {
    return result
  }
  const numbering = root['w:numbering'] as XmlNode | undefined
  if (!numbering) return result

  const abstractFormats = new Map<string, boolean>()
  for (const abstractNum of asArray(numbering['w:abstractNum'] as XmlNode | XmlNode[] | undefined)) {
    const id = attr(abstractNum, '@_w:abstractNumId')
    if (id === undefined) continue
    let ordered = false
    for (const lvl of asArray(abstractNum['w:lvl'] as XmlNode | XmlNode[] | undefined)) {
      const ilvl = Number.parseInt(attr(lvl, '@_w:ilvl') ?? '0', 10)
      if (ilvl !== 0) continue
      const format = attr(lvl['w:numFmt'], '@_w:val') ?? 'decimal'
      ordered = format !== 'bullet'
    }
    abstractFormats.set(id, ordered)
  }
  for (const num of asArray(numbering['w:num'] as XmlNode | XmlNode[] | undefined)) {
    const numId = attr(num, '@_w:numId')
    const abstractId = attr(num['w:abstractNumId'], '@_w:val')
    if (numId === undefined || abstractId === undefined) continue
    const ordered = abstractFormats.get(abstractId)
    if (ordered !== undefined) result.set(numId, { ordered })
  }
  return result
}

/** `word/_rels/document.xml.rels` → relationship id → external target. */
function buildHyperlinkMap(entries: ZipEntries): Map<string, string> {
  const result = new Map<string, string>()
  const raw = entries.get(DOCUMENT_RELS_XML)
  if (raw === undefined) return result
  let root: XmlNode
  try {
    root = new XMLParser(XML_OPTIONS).parse(raw.toString('utf8')) as XmlNode
  } catch {
    return result
  }
  const relationships = root['Relationships'] as XmlNode | undefined
  if (!relationships) return result
  for (const relationship of asArray(relationships['Relationship'] as XmlNode | XmlNode[] | undefined)) {
    const id = attr(relationship, '@_Id')
    const type = attr(relationship, '@_Type') ?? ''
    if (id === undefined || !type.endsWith('/hyperlink')) continue
    const target = attr(relationship, '@_Target')
    if (target !== undefined) result.set(id, target)
  }
  return result
}

/** Read document properties from `docProps/core.xml`. */
function parseCoreProps(entries: ZipEntries): DocxProps {
  const props: DocxProps = { title: null, author: null, created: null }
  const raw = entries.get(CORE_PROPS_XML)
  if (raw === undefined) return props
  let root: XmlNode
  try {
    root = new XMLParser(XML_OPTIONS).parse(raw.toString('utf8')) as XmlNode
  } catch {
    return props
  }
  const core = root['cp:coreProperties'] as XmlNode | undefined
  if (!core) return props
  const title = textOf(core['dc:title'])
  const author = textOf(core['dc:creator'])
  const created = textOf(core['dcterms:created'])
  if (title.length > 0) props.title = title
  if (author.length > 0) props.author = author
  if (created.length > 0) props.created = created
  return props
}

/** Render one table (`w:tbl`) as a markdown pipe table; null when it has no rows. */
function renderTable(tbl: XmlNode, warnings: string[]): { header: string[] | null; rows: string[][]; markdown: string } | null {
  const rows: string[][] = []
  let merged = false
  for (const tr of asArray(tbl['w:tr'] as XmlNode | XmlNode[] | undefined)) {
    const cells: string[] = []
    for (const tc of asArray(tr['w:tc'] as XmlNode | XmlNode[] | undefined)) {
      const tcPr = tc['w:tcPr'] as XmlNode | undefined
      if (tcPr !== undefined && ('w:gridSpan' in tcPr || 'w:vMerge' in tcPr)) merged = true
      const paragraphs = asArray(tc['w:p'] as XmlNode | XmlNode[] | undefined)
      const lines = paragraphs.map(paragraph => parseParagraph(paragraph, { count: 0 }, new Map()).text)
      cells.push(lines.join('\n'))
    }
    rows.push(cells)
  }
  const [header, ...body] = rows
  if (header === undefined) return null
  if (merged) warnings.push('the table contains merged cells; the pipe-table rendering is approximate')
  const cell = (value: string): string => escapeMarkdown(value.replaceAll('\n', '<br>'), true)
  const line = (cells: string[]): string => `| ${cells.map(cell).join(' | ')} |`
  const separator = `| ${header.map(() => '---').join(' | ')} |`
  return {
    header: header.slice(),
    rows: body,
    markdown: [line(header), separator, ...body.map(line)].join('\n'),
  }
}

/**
 * Extract one `.docx` package into markdown + structured blocks.
 * @param data - the whole package bytes (already bounded by the caller).
 * @param maxUncompressedBytes - cap for the ZIP expansion.
 * @returns the extraction result.
 * @throws {@link DocxError} with a stable code for invalid/encrypted packages.
 */
export async function extractDocx(data: Uint8Array, maxUncompressedBytes: number): Promise<ExtractedDocx> {
  let entries: ZipEntries
  try {
    entries = await readZip(data, maxUncompressedBytes)
  } catch (error: unknown) {
    throw new DocxError(`failed to read the .docx archive: ${error instanceof Error ? error.message : String(error)}`, 'DOCX_NOT_DOCX', { cause: error })
  }
  const warnings: string[] = []

  const contentTypes = entries.get(CONTENT_TYPES)
  if (contentTypes === undefined) {
    throw new DocxError('the file is not a .docx document (missing [Content_Types].xml)', 'DOCX_NOT_DOCX')
  }
  if (contentTypes.toString('utf8').includes('EncryptionInfo')) {
    throw new DocxError('the document is encrypted (password-protected); decryption is not supported', 'DOCX_ENCRYPTED')
  }
  const documentXml = entries.get(DOCUMENT_XML)
  if (documentXml === undefined) {
    throw new DocxError('the file is not a .docx document (missing word/document.xml)', 'DOCX_NOT_DOCX')
  }

  let root: XmlNode
  try {
    root = new XMLParser(XML_OPTIONS).parse(documentXml.toString('utf8')) as XmlNode
  } catch (error: unknown) {
    throw new DocxError(`failed to parse document XML: ${error instanceof Error ? error.message : String(error)}`, 'DOCX_PARSE_ERROR', { cause: error })
  }

  const body = (root['w:document'] as XmlNode | undefined)?.['w:body'] as XmlNode | undefined
  if (!body) {
    throw new DocxError('the document has no body (word/document.xml without w:body)', 'DOCX_PARSE_ERROR')
  }

  const numbering = buildNumberingMap(entries)
  const hyperlinks = buildHyperlinkMap(entries)
  const props = parseCoreProps(entries)
  const images = { count: 0 }

  const blocks: DocxBlock[] = []
  const lines: string[] = []
  let pageBreaks = 0
  let footnoteRefs = 0
  let hyperlinkCount = 0
  let currentList: { ordered: boolean; items: Array<{ level: number; text: string }> } | null = null

  const flushList = (): void => {
    const list = currentList
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
      for (const item of list.items) {
        lines.push(`${'  '.repeat(item.level)}${list.ordered ? '1.' : '-'} ${item.text}`)
      }
      currentList = null
    }
  }

  const bodyChildren: Array<[string, XmlNode]> = []
  for (const key of ['w:p', 'w:tbl']) {
    for (const node of asArray(body[key] as XmlNode | XmlNode[] | undefined)) {
      bodyChildren.push([key, node])
    }
  }

  for (const [key, node] of bodyChildren) {
    if (key === 'w:tbl') {
      flushList()
      const table = renderTable(node, warnings)
      if (table) {
        blocks.push({ kind: 'table', header: table.header, rows: table.rows })
        lines.push(table.markdown)
      }
      continue
    }

    const p = parseParagraph(node, images, hyperlinks)
    pageBreaks += p.pageBreaks
    footnoteRefs += p.footnoteRefs
    hyperlinkCount += p.hyperlinkCount

    if (p.numId !== undefined) {
      const ordered = numbering.get(p.numId)?.ordered ?? true
      if (!currentList || currentList.ordered !== ordered) {
        flushList()
        currentList = { ordered, items: [] }
      }
      currentList.items.push({ level: p.ilvl, text: p.text })
      continue
    }
    flushList()

    const heading = p.style !== undefined ? /^Heading([1-6])$/.exec(p.style) : null
    if (heading) {
      const levelText = heading[1]
      if (levelText !== undefined) {
        const level = Number.parseInt(levelText, 10) as 1 | 2 | 3 | 4 | 5 | 6
        blocks.push({ kind: 'heading', level, text: p.text })
        lines.push(`${'#'.repeat(level)} ${p.text}`)
      }
      continue
    }
    if (p.style === 'Title') {
      blocks.push({ kind: 'heading', level: 1, text: p.text })
      lines.push(`# ${p.text}`)
      continue
    }
    if (p.text.trim().length === 0) continue
    blocks.push({ kind: 'paragraph', text: p.text })
    lines.push(p.text)
  }
  flushList()

  if (images.count > 0) {
    warnings.push(`the document contains ${images.count} image(s); image bytes are not extracted, placeholders are emitted instead`)
  }
  if (pageBreaks > 0) warnings.push('page breaks are ignored during extraction')
  if (footnoteRefs > 0) warnings.push('footnotes and endnotes are not extracted')
  if (hyperlinkCount > 0) warnings.push('hyperlinks are reproduced as [text](url)')

  return {
    props,
    markdown: lines.join('\n\n'),
    blocks,
    images: images.count,
    warnings,
  }
}
