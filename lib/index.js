import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { XMLParser } from "fast-xml-parser";
import { HarnessError } from "@deepseek-ai/dsh-llm";
import { FsError } from "@deepseek-ai/dsh-fs";
import { Buffer } from "node:buffer";
import { fromBuffer } from "yauzl";
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, Tab, Table, TableCell, TableRow, TextRun } from "docx";
import JSZip from "jszip";
import { ESCALATION_TARGETS, approveEscalation, escalationHintMarker, sandboxDenialMarker, validateEscalationArgs } from "@deepseek-ai/dsh-sandbox";
//#region lib/types/error.js
/**
* Typed error vocabulary for the docx tools: a stable machine-routable code
* distinct from the human-readable message, plus the mapping from the
* filesystem seam's `FsError` codes.
* @module dsh-tool-docx/error
*/
/** Typed docx failure. Extends {@link HarnessError} for a stable code and `cause` chaining. */
var DocxError = class extends HarnessError {
	code;
	constructor(message, code, options) {
		super(message, code, options);
		this.code = code;
	}
};
/** Map a filesystem-seam failure to the docx vocabulary; other errors pass through.
* @param error - the thrown filesystem error (or any other value).
* @returns the mapped `DocxError`, or the original value when it is not an `FsError`.
*/
function mapFsError(error) {
	if (!(error instanceof FsError)) return error;
	switch (error.code) {
		case "FS_NOT_FOUND": return new DocxError(error.message, "DOCX_NOT_FOUND", { cause: error });
		case "FS_NOT_REGULAR_FILE": return new DocxError(error.message, "DOCX_NOT_REGULAR_FILE", { cause: error });
		case "FS_TOO_LARGE": return new DocxError(error.message, "DOCX_TOO_LARGE", { cause: error });
		case "FS_NOT_OBSERVED": return new DocxError(error.message, "DOCX_EXISTS", { cause: error });
		case "FS_STALE_VERSION": return new DocxError(error.message, "DOCX_STALE", { cause: error });
		case "FS_ABORTED": return error;
		default: return new DocxError(error.message, "DOCX_WRITE_ERROR", { cause: error });
	}
}
//#endregion
//#region lib/types/docx/zip.js
/**
* Minimal bounded ZIP reader over `yauzl`: extracts every entry of a docx
* package into a name в†’ bytes map. The uncompressed total is capped so a
* compressed bomb inside an already-bounded file cannot expand without limit.
* @module dsh-tool-docx/zip
*/
/**
* Read every file entry of a ZIP buffer into memory.
* @param data - the whole archive bytes (already bounded by the caller's read cap).
* @param maxUncompressedBytes - inclusive cap on the total uncompressed content.
* @returns archive-name в†’ content, directory entries omitted.
*/
function readZip(data, maxUncompressedBytes) {
	return new Promise((resolve, reject) => {
		fromBuffer(Buffer.from(data), {
			lazyEntries: true,
			decodeStrings: true
		}, (error, zipfile) => {
			if (error) {
				reject(error);
				return;
			}
			const entries = /* @__PURE__ */ new Map();
			let total = 0;
			let failed = false;
			const fail = (cause) => {
				if (failed) return;
				failed = true;
				reject(cause);
			};
			zipfile.on("error", fail);
			zipfile.on("end", () => {
				if (!failed) resolve(entries);
			});
			zipfile.readEntry();
			zipfile.on("entry", (entry) => {
				if (failed) return;
				if (/\/$/.test(entry.fileName)) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (streamError, stream) => {
					if (streamError) {
						fail(streamError);
						return;
					}
					const chunks = [];
					let size = 0;
					stream.on("data", (chunk) => {
						size += chunk.length;
						if (size > maxUncompressedBytes) {
							fail(/* @__PURE__ */ new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`));
							return;
						}
						chunks.push(chunk);
					});
					stream.on("end", () => {
						if (failed) return;
						total += size;
						if (total > maxUncompressedBytes) {
							fail(/* @__PURE__ */ new Error(`readZip: uncompressed content exceeds the ${maxUncompressedBytes}-byte limit`));
							return;
						}
						entries.set(entry.fileName, Buffer.concat(chunks, size));
						zipfile.readEntry();
					});
					stream.on("error", fail);
				});
			});
		});
	});
}
//#endregion
//#region lib/types/docx/extract.js
/**
* Extract a `.docx` package into Markdown and structured blocks: walks
* `word/document.xml` (paragraphs, runs, lists, tables, hyperlinks, images),
* resolves list numbering through `word/numbering.xml`, and reads document
* properties from `docProps/core.xml`. Pure вЂ” no I/O; callers supply the
* bounded package bytes.
* @module dsh-tool-docx/docx/extract
*/
const CONTENT_TYPES = "[Content_Types].xml";
const DOCUMENT_XML = "word/document.xml";
const NUMBERING_XML = "word/numbering.xml";
const CORE_PROPS_XML = "docProps/core.xml";
const DOCUMENT_RELS_XML = "word/_rels/document.xml.rels";
const XML_OPTIONS = {
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	trimValues: false,
	parseTagValue: false,
	parseAttributeValue: false,
	processEntities: true
};
function asArray(value) {
	if (value === void 0 || value === null) return [];
	return Array.isArray(value) ? value : [value];
}
function attr(node, name) {
	if (typeof node !== "object" || node === null) return void 0;
	const value = node[name];
	return typeof value === "string" ? value : void 0;
}
function textOf(node) {
	if (node === void 0 || node === null) return "";
	if (typeof node === "string") return node;
	if (typeof node === "number" || typeof node === "boolean") return String(node);
	if (typeof node === "object") {
		const text = node["#text"];
		if (typeof text === "string") return text;
	}
	return "";
}
/** Escape characters that carry Markdown meaning in body text. */
function escapeMarkdown(text, inCell = false) {
	const escaped = text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_").replace(/`/g, "\\`").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
	return inCell ? escaped.replace(/\|/g, "\\|") : escaped;
}
function renderInline(run) {
	const body = escapeMarkdown(run.text);
	if (run.code) return `\`${body}\``;
	const italic = run.italic ? `*${body}*` : body;
	const bold = run.bold ? `**${italic}**` : italic;
	return run.strike ? `~~${bold}~~` : bold;
}
/** Walk one run (`w:r`) and collect its text plus inline styling. */
function parseRun(run, images) {
	const rPr = run["w:rPr"];
	const bold = rPr !== void 0 && "w:b" in rPr;
	const italic = rPr !== void 0 && "w:i" in rPr;
	const strike = rPr !== void 0 && "w:strike" in rPr;
	const rFonts = rPr?.["w:rFonts"];
	const code = (attr(rFonts, "@_w:ascii") ?? attr(rFonts, "@_w:hAnsi")) === "Consolas";
	const parts = [];
	const add = (node) => {
		if (typeof node === "string") parts.push(node);
		else if (typeof node === "object" && node !== null) {
			const record = node;
			if ("#text" in record) parts.push(String(record["#text"]));
			if ("w:tab" in record) parts.push("	");
			if ("w:drawing" in record || "w:pict" in record) images.count += 1;
		}
	};
	if ("w:t" in run) {
		const t = run["w:t"];
		if (Array.isArray(t)) for (const piece of t) add(piece);
		else add(t);
	}
	return {
		text: parts.join(""),
		bold,
		italic,
		strike,
		code
	};
}
function parseParagraph(p, images, hyperlinks) {
	const pPr = p["w:pPr"];
	const style = pPr !== void 0 ? attr(pPr["w:pStyle"], "@_w:val") : void 0;
	const numPr = pPr?.["w:numPr"];
	const numId = numPr !== void 0 ? attr(numPr["w:numId"], "@_w:val") : void 0;
	const parsedIlvl = Number.parseInt(attr(numPr?.["w:ilvl"], "@_w:val") ?? "0", 10);
	const pieces = [];
	let pageBreaks = 0;
	let footnoteRefs = 0;
	let hyperlinkCount = 0;
	const consumeRuns = (runs) => {
		for (const runNode of asArray(runs)) {
			const run = parseRun(runNode, images);
			if (run.text.length > 0) pieces.push(renderInline(run));
			if ("w:br" in runNode) {
				for (const br of asArray(runNode["w:br"])) if (attr(br, "@_w:type") === "page") pageBreaks += 1;
			}
			if ("w:footnoteReference" in runNode || "w:endnoteReference" in runNode) footnoteRefs += 1;
		}
	};
	consumeRuns(p["w:r"]);
	for (const link of asArray(p["w:hyperlink"])) {
		const linkId = attr(link, "@_r:id");
		const target = linkId !== void 0 ? hyperlinks.get(linkId) : void 0;
		if (target !== void 0) hyperlinkCount += 1;
		const before = pieces.length;
		consumeRuns(link["w:r"]);
		if (target !== void 0 && pieces.length > before) {
			const linkText = pieces.splice(before).join("");
			pieces.push(`[${linkText}](${target.replaceAll(")", "%29")})`);
		}
	}
	return {
		style,
		numId,
		ilvl: Number.isNaN(parsedIlvl) ? 0 : parsedIlvl,
		text: pieces.join(""),
		pageBreaks,
		footnoteRefs,
		hyperlinkCount
	};
}
/** Resolve `numId` в†’ ordered/unordered from `word/numbering.xml`. */
function buildNumberingMap(entries) {
	const result = /* @__PURE__ */ new Map();
	const raw = entries.get(NUMBERING_XML);
	if (raw === void 0) return result;
	let root;
	try {
		root = new XMLParser(XML_OPTIONS).parse(raw.toString("utf8"));
	} catch {
		return result;
	}
	const numbering = root["w:numbering"];
	if (!numbering) return result;
	const abstractFormats = /* @__PURE__ */ new Map();
	for (const abstractNum of asArray(numbering["w:abstractNum"])) {
		const id = attr(abstractNum, "@_w:abstractNumId");
		if (id === void 0) continue;
		let ordered = false;
		for (const lvl of asArray(abstractNum["w:lvl"])) {
			if (Number.parseInt(attr(lvl, "@_w:ilvl") ?? "0", 10) !== 0) continue;
			ordered = (attr(lvl["w:numFmt"], "@_w:val") ?? "decimal") !== "bullet";
		}
		abstractFormats.set(id, ordered);
	}
	for (const num of asArray(numbering["w:num"])) {
		const numId = attr(num, "@_w:numId");
		const abstractId = attr(num["w:abstractNumId"], "@_w:val");
		if (numId === void 0 || abstractId === void 0) continue;
		const ordered = abstractFormats.get(abstractId);
		if (ordered !== void 0) result.set(numId, { ordered });
	}
	return result;
}
/** `word/_rels/document.xml.rels` в†’ relationship id в†’ external target. */
function buildHyperlinkMap(entries) {
	const result = /* @__PURE__ */ new Map();
	const raw = entries.get(DOCUMENT_RELS_XML);
	if (raw === void 0) return result;
	let root;
	try {
		root = new XMLParser(XML_OPTIONS).parse(raw.toString("utf8"));
	} catch {
		return result;
	}
	const relationships = root["Relationships"];
	if (!relationships) return result;
	for (const relationship of asArray(relationships["Relationship"])) {
		const id = attr(relationship, "@_Id");
		const type = attr(relationship, "@_Type") ?? "";
		if (id === void 0 || !type.endsWith("/hyperlink")) continue;
		const target = attr(relationship, "@_Target");
		if (target !== void 0) result.set(id, target);
	}
	return result;
}
/** Read document properties from `docProps/core.xml`. */
function parseCoreProps(entries) {
	const props = {
		title: null,
		author: null,
		created: null
	};
	const raw = entries.get(CORE_PROPS_XML);
	if (raw === void 0) return props;
	let root;
	try {
		root = new XMLParser(XML_OPTIONS).parse(raw.toString("utf8"));
	} catch {
		return props;
	}
	const core = root["cp:coreProperties"];
	if (!core) return props;
	const title = textOf(core["dc:title"]);
	const author = textOf(core["dc:creator"]);
	const created = textOf(core["dcterms:created"]);
	if (title.length > 0) props.title = title;
	if (author.length > 0) props.author = author;
	if (created.length > 0) props.created = created;
	return props;
}
/** Render one table (`w:tbl`) as a markdown pipe table; null when it has no rows. */
function renderTable(tbl, warnings) {
	const rows = [];
	let merged = false;
	for (const tr of asArray(tbl["w:tr"])) {
		const cells = [];
		for (const tc of asArray(tr["w:tc"])) {
			const tcPr = tc["w:tcPr"];
			if (tcPr !== void 0 && ("w:gridSpan" in tcPr || "w:vMerge" in tcPr)) merged = true;
			const lines = asArray(tc["w:p"]).map((paragraph) => parseParagraph(paragraph, { count: 0 }, /* @__PURE__ */ new Map()).text);
			cells.push(lines.join("\n"));
		}
		rows.push(cells);
	}
	const [header, ...body] = rows;
	if (header === void 0) return null;
	if (merged) warnings.push("the table contains merged cells; the pipe-table rendering is approximate");
	const cell = (value) => escapeMarkdown(value.replaceAll("\n", "<br>"), true);
	const line = (cells) => `| ${cells.map(cell).join(" | ")} |`;
	const separator = `| ${header.map(() => "---").join(" | ")} |`;
	return {
		header: header.slice(),
		rows: body,
		markdown: [
			line(header),
			separator,
			...body.map(line)
		].join("\n")
	};
}
/**
* Extract one `.docx` package into markdown + structured blocks.
* @param data - the whole package bytes (already bounded by the caller).
* @param maxUncompressedBytes - cap for the ZIP expansion.
* @returns the extraction result.
* @throws {@link DocxError} with a stable code for invalid/encrypted packages.
*/
async function extractDocx(data, maxUncompressedBytes) {
	let entries;
	try {
		entries = await readZip(data, maxUncompressedBytes);
	} catch (error) {
		throw new DocxError(`failed to read the .docx archive: ${error instanceof Error ? error.message : String(error)}`, "DOCX_NOT_DOCX", { cause: error });
	}
	const warnings = [];
	const contentTypes = entries.get(CONTENT_TYPES);
	if (contentTypes === void 0) throw new DocxError("the file is not a .docx document (missing [Content_Types].xml)", "DOCX_NOT_DOCX");
	if (contentTypes.toString("utf8").includes("EncryptionInfo")) throw new DocxError("the document is encrypted (password-protected); decryption is not supported", "DOCX_ENCRYPTED");
	const documentXml = entries.get(DOCUMENT_XML);
	if (documentXml === void 0) throw new DocxError("the file is not a .docx document (missing word/document.xml)", "DOCX_NOT_DOCX");
	let root;
	try {
		root = new XMLParser(XML_OPTIONS).parse(documentXml.toString("utf8"));
	} catch (error) {
		throw new DocxError(`failed to parse document XML: ${error instanceof Error ? error.message : String(error)}`, "DOCX_PARSE_ERROR", { cause: error });
	}
	const body = root["w:document"]?.["w:body"];
	if (!body) throw new DocxError("the document has no body (word/document.xml without w:body)", "DOCX_PARSE_ERROR");
	const numbering = buildNumberingMap(entries);
	const hyperlinks = buildHyperlinkMap(entries);
	const props = parseCoreProps(entries);
	const images = { count: 0 };
	const blocks = [];
	const lines = [];
	let pageBreaks = 0;
	let footnoteRefs = 0;
	let hyperlinkCount = 0;
	let currentList = null;
	const flushList = () => {
		const list = currentList;
		if (list) {
			blocks.push({
				kind: "list",
				ordered: list.ordered,
				items: list.items
			});
			for (const item of list.items) lines.push(`${"  ".repeat(item.level)}${list.ordered ? "1." : "-"} ${item.text}`);
			currentList = null;
		}
	};
	const bodyChildren = [];
	for (const key of ["w:p", "w:tbl"]) for (const node of asArray(body[key])) bodyChildren.push([key, node]);
	for (const [key, node] of bodyChildren) {
		if (key === "w:tbl") {
			flushList();
			const table = renderTable(node, warnings);
			if (table) {
				blocks.push({
					kind: "table",
					header: table.header,
					rows: table.rows
				});
				lines.push(table.markdown);
			}
			continue;
		}
		const p = parseParagraph(node, images, hyperlinks);
		pageBreaks += p.pageBreaks;
		footnoteRefs += p.footnoteRefs;
		hyperlinkCount += p.hyperlinkCount;
		if (p.numId !== void 0) {
			const ordered = numbering.get(p.numId)?.ordered ?? true;
			if (!currentList || currentList.ordered !== ordered) {
				flushList();
				currentList = {
					ordered,
					items: []
				};
			}
			currentList.items.push({
				level: p.ilvl,
				text: p.text
			});
			continue;
		}
		flushList();
		const heading = p.style !== void 0 ? /^Heading([1-6])$/.exec(p.style) : null;
		if (heading) {
			const levelText = heading[1];
			if (levelText !== void 0) {
				const level = Number.parseInt(levelText, 10);
				blocks.push({
					kind: "heading",
					level,
					text: p.text
				});
				lines.push(`${"#".repeat(level)} ${p.text}`);
			}
			continue;
		}
		if (p.style === "Title") {
			blocks.push({
				kind: "heading",
				level: 1,
				text: p.text
			});
			lines.push(`# ${p.text}`);
			continue;
		}
		if (p.text.trim().length === 0) continue;
		blocks.push({
			kind: "paragraph",
			text: p.text
		});
		lines.push(p.text);
	}
	flushList();
	if (images.count > 0) warnings.push(`the document contains ${images.count} image(s); image bytes are not extracted, placeholders are emitted instead`);
	if (pageBreaks > 0) warnings.push("page breaks are ignored during extraction");
	if (footnoteRefs > 0) warnings.push("footnotes and endnotes are not extracted");
	if (hyperlinkCount > 0) warnings.push("hyperlinks are reproduced as [text](url)");
	return {
		props,
		markdown: lines.join("\n\n"),
		blocks,
		images: images.count,
		warnings
	};
}
//#endregion
//#region lib/types/tool-utils.js
/**
* Shared helpers for the docx tools: path/extension validation, session-cwd
* resolution, observed-state emission, and common argument validation.
* @module dsh-tool-docx/tool-utils
*/
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
/**
* Reject `.doc` with the legacy hint; everything else is parsed by content.
* @param path - the file path to check.
*/
function assertSupportedExtension(path) {
	if (/\.doc$/i.test(path.trim())) throw new DocxError("legacy .doc format is not supported вЂ” convert the document to .docx first", "DOCX_LEGACY_DOC");
}
/**
* Validate a non-empty file path; whitespace-only paths are rejected like the fs tool suite.
* @param path - the raw tool argument.
* @returns the same path, confirmed non-blank.
*/
function requirePath(path) {
	if (path.trim().length === 0) throw new Error("file_path must be a non-empty string");
	return path;
}
/**
* The calling agent's session cwd, or undefined for a non-agent caller.
* @param exec - the tool-execution context; only its optional `agent` is read.
* @returns the agent's session workspace cwd, or undefined.
*/
function sessionCwd(exec) {
	const cwd = exec.agent?.session.header.cwd;
	if (cwd === void 0 || !PARENT_PATH_SEGMENT.test(cwd)) return cwd;
	return cwd;
}
/**
* Resolution options for the current call: session cwd + cancellation.
* @param exec - the tool-execution context supplying session cwd and cancellation.
* @returns provider resolution options for the current tool call.
*/
function resolveOptions(exec) {
	const cwd = sessionCwd(exec);
	return {
		...cwd !== void 0 ? { cwd } : {},
		signal: exec.signal
	};
}
/**
* Record an authoritative positive observation (no-op when no policy listens).
* @param ctx - the Cordis context the event is emitted on.
* @param target - the observed target.
* @param version - the observed file version.
* @param exec - the tool-execution context, carried as the event actor.
*/
function emitObserved(ctx, target, version, exec) {
	ctx.emit("fs/observed", target, {
		kind: "present",
		version
	}, exec);
}
/**
* Record a confirmed-absent observation (no-op when no policy listens).
* @param ctx - the Cordis context the event is emitted on.
* @param target - the observed (absent) target.
* @param exec - the tool-execution context, carried as the event actor.
*/
function emitAbsent(ctx, target, exec) {
	ctx.emit("fs/observed", target, { kind: "absent" }, exec);
}
/**
* Validate a positive-integer cap from config.
* @param name - the config field name, for the error message.
* @param value - the configured value to validate.
*/
function assertPositiveInteger(name, value) {
	if (!Number.isInteger(value) || value < 1) throw new Error(`tool-docx: ${name} must be a positive integer`);
}
//#endregion
//#region lib/types/fs-binary.js
/**
* Narrow the host `fs` service to the binary contract, or fail with a typed
* error explaining the host requirement.
* @param fs - the host's `fs` service.
* @returns the same service, narrowed to {@link BinaryFileSystem}.
*/
function assertBinaryFs(fs) {
	const binary = fs;
	if (typeof binary.readBytes !== "function" || typeof binary.writeBytes !== "function") throw new DocxError("the host filesystem seam lacks the binary readBytes/writeBytes primitives вЂ” this plugin requires a deepseek-harness build that includes fs.readBytes/fs.writeBytes", "DOCX_HOST_FS_UNSUPPORTED");
	return binary;
}
//#endregion
//#region lib/types/tools/read.js
/**
* Model-facing `docx_read`: extract a `.docx` file as Markdown or structured
* JSON blocks. Bounded by the configured byte cap (whole file), the ZIP
* expansion cap, and the returned-markdown character cap.
* @module dsh-tool-docx/tools/read
*/
function parseReadArgs(args) {
	const filePath = requirePath(args.file_path);
	const format = args.format ?? "markdown";
	if (args.max_chars !== void 0 && (!Number.isInteger(args.max_chars) || args.max_chars < 1)) throw new Error("max_chars must be a positive integer");
	return {
		filePath,
		format,
		maxChars: args.max_chars
	};
}
/** Render the read value as model-facing text: markdown, or pretty JSON blocks. */
function renderReadValue(value, maxChars) {
	const body = value.format === "json" ? JSON.stringify(value.blocks, null, 2) : value.markdown ?? "";
	return body.length > maxChars ? `${body.slice(0, maxChars)}\nвЂ¦ (truncated)` : body;
}
/**
* Register the `docx_read` tool and its system-prompt guidance.
* @param ctx - the plugin context; execution uses its `fs` service.
* @param caps - the deployment's resolved caps.
*/
function applyReadTool(ctx, caps) {
	ctx.systemPrompt.section({
		name: "tool:docx-read",
		order: 110,
		text: "MS Word .docx files are binary (ZIP+XML) and the read tool cannot read them. Use docx_read to extract a document as Markdown (default) or structured JSON blocks, docx_create to generate a new .docx from Markdown, and docx_edit to replace a document's content from Markdown while preserving its title/author/created properties. Legacy .doc is not supported вЂ” convert it to .docx first."
	});
	ctx.tools.register(defineTool({
		name: "docx_read",
		description: "Read a Microsoft Word .docx file: extract its content as Markdown or structured JSON blocks, plus document properties.",
		parameters: {
			file_path: {
				type: "string",
				required: true,
				description: "Path to the .docx file, resolved by the filesystem backend."
			},
			format: {
				type: "string",
				enum: ["markdown", "json"],
				description: "Output shape: markdown (default) or structured JSON blocks."
			},
			max_chars: {
				type: "number",
				description: "Optional cap on the returned markdown/JSON length (defaults to the deployment cap)."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					format: {
						type: "string",
						required: true,
						enum: ["markdown", "json"]
					},
					docProps: {
						required: true,
						type: "object",
						additionalProperties: false,
						properties: {
							title: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							},
							author: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							},
							created: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							}
						}
					},
					charCount: {
						type: "number",
						required: true
					},
					images: {
						type: "number",
						required: true
					},
					warnings: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					markdown: {
						required: true,
						oneOf: [{ type: "string" }, { type: "null" }]
					},
					blocks: {
						required: true,
						oneOf: [{
							type: "array",
							items: {
								type: "object",
								additionalProperties: true
							}
						}, { type: "null" }]
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: renderReadValue(value, caps.maxReadChars)
			}]
		},
		async execute(args, exec) {
			const input = parseReadArgs(args);
			assertSupportedExtension(input.filePath);
			const fs = assertBinaryFs(ctx.fs);
			const target = await fs.resolve(input.filePath, resolveOptions(exec));
			const info = await fs.stat(target, exec.signal);
			if (!info) {
				emitAbsent(ctx, target, exec);
				throw new DocxError(`file not found: ${target.displayPath}`, "DOCX_NOT_FOUND");
			}
			if (info.type !== "file") throw new DocxError(`cannot read "${target.displayPath}": not a regular file`, "DOCX_NOT_REGULAR_FILE");
			let data;
			try {
				data = await fs.readBytes(target, exec.signal, caps.maxDocxBytes);
			} catch (error) {
				throw mapFsError(error);
			}
			const extracted = await extractDocx(data, caps.maxDocxBytes);
			const cap = input.maxChars ?? caps.maxReadChars;
			let markdown = extracted.markdown;
			let warnings = extracted.warnings;
			if (input.format === "markdown" && markdown.length > cap) {
				markdown = markdown.slice(0, cap);
				warnings = [...warnings, `output truncated to ${cap} characters`];
			}
			emitObserved(ctx, target, info.version, exec);
			return {
				path: target.displayPath,
				format: input.format,
				docProps: extracted.props,
				charCount: markdown.length,
				images: extracted.images,
				warnings,
				markdown: input.format === "markdown" ? markdown : null,
				blocks: input.format === "json" ? extracted.blocks : null
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Read ${args.file_path}`,
				kind: "read",
				locations: [{ path: args.file_path }]
			};
		},
		presentResult(args, result) {
			if (result.isError) return void 0;
			return {
				card: "generic",
				title: `Read ${args.file_path}`
			};
		}
	}));
}
//#endregion
//#region lib/types/markdown.js
/**
* Markdown в†’ block parsing for the docx generator: headings, paragraphs,
* nested lists, pipe tables, and inline formatting (`**bold**`, `*italic*`,
* `` `code` ``, `~~strike~~`, `[text](url)`). The supported subset is
* deliberately small and matches what {@link extractDocx} emits, so a
* read в†’ edit в†’ write round trip is stable. Unsupported constructs degrade to
* paragraphs with a warning instead of failing.
* @module dsh-tool-docx/markdown
*/
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;
/** Unescape the markdown-significant escapes produced by extraction. */
function unescapeMarkdown(text) {
	return text.replace(/\\([\\*_`[\]|])/g, "$1");
}
/**
* Split inline text into styled segments. Bare asterisks, unterminated
* markers, and stray brackets stay literal text.
* @param text - inline markdown text (escapes from extraction are unescaped).
* @returns ordered segments; adjacent plain text is not merged.
*/
function parseInline(text) {
	const segments = [];
	let cursor = 0;
	for (const match of text.matchAll(INLINE_PATTERN)) {
		const index = match.index;
		if (index > cursor) segments.push({ text: unescapeMarkdown(text.slice(cursor, index)) });
		const token = match[0];
		cursor = index + token.length;
		if (token.startsWith("**") && token.endsWith("**") && token.length > 4) segments.push({
			text: unescapeMarkdown(token.slice(2, -2)),
			bold: true
		});
		else if (token.startsWith("*") && token.endsWith("*") && token.length > 2) segments.push({
			text: unescapeMarkdown(token.slice(1, -1)),
			italic: true
		});
		else if (token.startsWith("~~") && token.endsWith("~~") && token.length > 4) segments.push({
			text: unescapeMarkdown(token.slice(2, -2)),
			strike: true
		});
		else if (token.startsWith("`") && token.endsWith("`") && token.length > 2) segments.push({
			text: token.slice(1, -1),
			code: true
		});
		else {
			const link = /^\[([^\]\n]+)\]\(([^)\n]+)\)$/.exec(token);
			const text = link?.[1];
			const url = link?.[2];
			if (text !== void 0 && url !== void 0) segments.push({
				text: unescapeMarkdown(text),
				link: url
			});
			else segments.push({ text: unescapeMarkdown(token) });
		}
	}
	if (cursor < text.length) segments.push({ text: unescapeMarkdown(text.slice(cursor)) });
	return segments;
}
/** One parsed table row (raw cell strings, trimmed, unescaped). */
function splitTableRow(line) {
	const trimmed = line.trim();
	const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
	return (body.endsWith("|") ? body.slice(0, -1) : body).split("|").map((cell) => unescapeMarkdown(cell.trim()));
}
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/**
* Parse a markdown document into structured blocks.
* @param markdown - the markdown source (must fit the caller's input cap).
* @param warnings - receives human-readable notes about unsupported constructs.
* @returns the blocks the generator renders; an empty document yields `[]`.
*/
function parseMarkdown(markdown, warnings) {
	const lines = markdown.replaceAll("\r\n", "\n").split("\n");
	const blocks = [];
	let codeWarning = false;
	let imageWarning = false;
	const flushParagraph = (buffer) => {
		const text = buffer.join("\n").trimEnd();
		if (text.length > 0) blocks.push({
			kind: "paragraph",
			text
		});
	};
	let paragraph = [];
	let list = null;
	let inCodeFence = null;
	let codeBuffer = [];
	const flushList = () => {
		if (list) {
			blocks.push({
				kind: "list",
				ordered: list.ordered,
				items: list.items
			});
			list = null;
		}
	};
	const emitParagraph = () => {
		flushList();
		if (paragraph.length > 0) {
			flushParagraph(paragraph);
			paragraph = [];
		}
	};
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (line === void 0) break;
		if (inCodeFence !== null) {
			if (line.trim().startsWith(inCodeFence)) {
				inCodeFence = null;
				if (codeBuffer.length > 0) {
					emitParagraph();
					blocks.push({
						kind: "paragraph",
						text: codeBuffer.join("\n")
					});
					codeBuffer = [];
				}
				index += 1;
				continue;
			}
			codeBuffer.push(line);
			index += 1;
			continue;
		}
		const fence = /^```|^~~~/.exec(line.trim());
		if (fence) {
			emitParagraph();
			if (!codeWarning) {
				warnings.push("code blocks become paragraphs with code styling");
				codeWarning = true;
			}
			inCodeFence = fence[0];
			codeBuffer = [];
			index += 1;
			continue;
		}
		if (line.trim().length === 0) {
			emitParagraph();
			index += 1;
			continue;
		}
		const next = lines[index + 1];
		if (line.trim().startsWith("|") && next !== void 0 && TABLE_SEPARATOR.test(next.trim())) {
			emitParagraph();
			const header = splitTableRow(line);
			index += 2;
			const rows = [];
			while (index < lines.length) {
				const rowLine = lines[index];
				if (rowLine === void 0 || !rowLine.trim().startsWith("|")) break;
				rows.push(splitTableRow(rowLine));
				index += 1;
			}
			blocks.push({
				kind: "table",
				header,
				rows
			});
			continue;
		}
		const heading = /^(#{1,6})\s+(.+)$/.exec(line);
		if (heading) {
			emitParagraph();
			const hashes = heading[1];
			const text = heading[2];
			if (hashes !== void 0 && text !== void 0) blocks.push({
				kind: "heading",
				level: hashes.length,
				text: text.trim()
			});
			index += 1;
			continue;
		}
		const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (item) {
			const indent = item[1];
			const marker = item[2];
			const rest = item[3];
			if (indent !== void 0 && marker !== void 0 && rest !== void 0 && !(marker === "-" && rest.trim().length === 0)) {
				emitParagraph();
				const level = Math.max(1, Math.floor(indent.length / 2));
				const ordered = /^\d/.test(marker);
				if (!list || list.ordered !== ordered) {
					flushList();
					list = {
						ordered,
						items: []
					};
				}
				const image = /^!\[([^\]\n]*)\]\([^)\n]+\)$/.exec(rest.trim());
				const alt = image?.[1];
				if (image) {
					if (!imageWarning) {
						warnings.push("images are not supported when generating; only the alt text is kept");
						imageWarning = true;
					}
					const altText = alt ?? "";
					list.items.push({
						level,
						text: altText.length > 0 ? altText : "image"
					});
				} else list.items.push({
					level,
					text: rest.trim()
				});
			}
			index += 1;
			continue;
		}
		const image = /^!\[([^\]\n]*)\]\([^)\n]+\)$/.exec(line.trim());
		if (image) {
			emitParagraph();
			if (!imageWarning) {
				warnings.push("images are not supported when generating; only the alt text is kept");
				imageWarning = true;
			}
			const alt = image[1] ?? "";
			blocks.push({
				kind: "paragraph",
				text: alt.length > 0 ? alt : "image"
			});
			index += 1;
			continue;
		}
		paragraph.push(line.replace(/^>\s?/, ""));
		index += 1;
	}
	emitParagraph();
	if (inCodeFence !== null && codeBuffer.length > 0) blocks.push({
		kind: "paragraph",
		text: codeBuffer.join("\n")
	});
	return blocks;
}
//#endregion
//#region lib/types/docx/generate.js
/**
* Generate a `.docx` package buffer from structured blocks using the `docx`
* library: headings, paragraphs with inline styling, nested bullet/numbered
* lists, pipe tables, and external hyperlinks. Document properties come from
* the caller (extracted from the previous version on an edit).
* @module dsh-tool-docx/docx/generate
*/
const NUMBER_REFERENCE = "dsh-ordered";
const BULLET_REFERENCE = "dsh-bullet";
/** Indent (twips) per numbering level: 0.5" step, hanging first line. */
function levelStyle(level) {
	return { paragraph: { indent: {
		left: 720 + level * 720,
		hanging: 360
	} } };
}
function numberingLevels(format, text) {
	return Array.from({ length: 9 }, (_, level) => ({
		level,
		format,
		text: text(level),
		alignment: AlignmentType.LEFT,
		style: levelStyle(level)
	}));
}
const NUMBERING = { config: [{
	reference: NUMBER_REFERENCE,
	levels: numberingLevels(LevelFormat.DECIMAL, (level) => `%${level + 1}.`)
}, {
	reference: BULLET_REFERENCE,
	levels: numberingLevels(LevelFormat.BULLET, () => "•")
}] };
const HEADING_LEVELS = {
	1: HeadingLevel.HEADING_1,
	2: HeadingLevel.HEADING_2,
	3: HeadingLevel.HEADING_3,
	4: HeadingLevel.HEADING_4,
	5: HeadingLevel.HEADING_5,
	6: HeadingLevel.HEADING_6
};
/** Convert inline segments into docx run elements (tabs become `Tab` elements). */
function inlineToRuns(segments) {
	const runs = [];
	for (const segment of segments) {
		if (segment.text.length === 0) continue;
		if (segment.link !== void 0) {
			runs.push(new ExternalHyperlink({
				children: [new TextRun({ text: segment.text })],
				link: segment.link
			}));
			continue;
		}
		segment.text.split("	").forEach((part, index) => {
			if (index > 0) runs.push(new Tab());
			if (part.length === 0) return;
			runs.push(new TextRun({
				text: part,
				...segment.bold ? { bold: true } : {},
				...segment.italic ? { italics: true } : {},
				...segment.strike ? { strike: true } : {},
				...segment.code ? {
					font: { name: "Consolas" },
					color: "1F3864"
				} : {}
			}));
		});
	}
	return runs;
}
/** One paragraph element from inline-markdown text. */
function paragraphFromText(text) {
	return new Paragraph({ children: inlineToRuns(parseInline(text)) });
}
/** Render blocks into docx section children (paragraphs + tables). */
function renderBlocks(blocks) {
	const children = [];
	for (const block of blocks) switch (block.kind) {
		case "heading": {
			const level = HEADING_LEVELS[block.level] ?? HeadingLevel.HEADING_1;
			children.push(new Paragraph({
				heading: level,
				children: inlineToRuns(parseInline(block.text))
			}));
			break;
		}
		case "paragraph":
			children.push(paragraphFromText(block.text));
			break;
		case "list":
			for (const item of block.items) {
				const level = Math.min(8, Math.max(0, item.level - 1));
				children.push(new Paragraph({
					numbering: {
						reference: block.ordered ? NUMBER_REFERENCE : BULLET_REFERENCE,
						level
					},
					children: inlineToRuns(parseInline(item.text))
				}));
			}
			break;
		case "table": {
			const row = (cells) => new TableRow({ children: cells.map((cell) => new TableCell({ children: cell.split("\n").map((line) => paragraphFromText(line)) })) });
			const rows = [];
			if (block.header) rows.push(row(block.header));
			for (const bodyRow of block.rows) rows.push(row(bodyRow));
			children.push(new Table({ rows }));
			break;
		}
	}
	return children;
}
/** Escape XML text content for core-properties elements. */
function escapeXml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
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
async function patchCoreProps(packed, props) {
	const zip = await JSZip.loadAsync(packed);
	const corePath = "docProps/core.xml";
	const file = zip.file(corePath);
	if (file === null) return packed;
	let core = await file.async("string");
	const setOrRemove = (xml, tag, value) => {
		const match = new RegExp(`<${tag}[^>]*>.*?</${tag}>`).exec(xml);
		if (value === null) return match !== null ? xml.replace(match[0], "") : xml;
		const element = `<${tag}>${escapeXml(value)}</${tag}>`;
		return match !== null ? xml.replace(match[0], element) : xml;
	};
	core = setOrRemove(core, "dc:title", props.title);
	core = setOrRemove(core, "dc:creator", props.author);
	core = setOrRemove(core, "dcterms:created", props.created);
	zip.file(corePath, core);
	return await zip.generateAsync({ type: "nodebuffer" });
}
/**
* Generate a `.docx` package buffer from blocks.
* @param blocks - the structured content to render.
* @param props - document properties to stamp (title/creator/created).
* @returns the packed `.docx` bytes.
*/
async function generateDocx(blocks, props) {
	const children = renderBlocks(blocks);
	const document = new Document({
		...props.title !== null ? { title: props.title } : {},
		...props.author !== null ? { creator: props.author } : {},
		numbering: NUMBERING,
		sections: [{
			properties: {},
			children
		}]
	});
	try {
		return await patchCoreProps(await Packer.toBuffer(document), props);
	} catch (error) {
		throw new DocxError(`failed to assemble the .docx document: ${error instanceof Error ? error.message : String(error)}`, "DOCX_WRITE_ERROR", { cause: error });
	}
}
//#endregion
//#region lib/types/tools/create.js
/**
* Model-facing `docx_create`: generate a new `.docx` file from Markdown.
* Guarded with `createIfAbsent` by default so an existing file is never
* blindly overwritten (the observation-policy waterfall may supply its own
* intent).
* @module dsh-tool-docx/tools/create
*/
function parseCreateArgs(args, maxMarkdownChars) {
	const filePath = requirePath(args.file_path);
	if (args.markdown.length > maxMarkdownChars) throw new DocxError(`markdown exceeds the ${maxMarkdownChars}-character limit`, "DOCX_INPUT_TOO_LARGE");
	return {
		filePath,
		markdown: args.markdown,
		title: args.title !== void 0 && args.title.trim().length > 0 ? args.title : void 0,
		author: args.author !== void 0 && args.author.trim().length > 0 ? args.author : void 0
	};
}
/**
* Register the `docx_create` tool.
* @param ctx - the plugin context; execution uses its `fs` service.
* @param caps - the deployment's resolved caps.
* @param sandbox - the shared sandbox-escalation API.
*/
function applyCreateTool(ctx, caps, sandbox) {
	ctx.tools.register(defineTool({
		name: "docx_create",
		description: "Create a new Microsoft Word .docx file from Markdown. Refuses to overwrite an existing file (read it first, then use docx_edit).",
		parameters: {
			file_path: {
				type: "string",
				required: true,
				description: "Path of the new .docx file, resolved by the filesystem backend."
			},
			markdown: {
				type: "string",
				required: true,
				description: "Markdown content: headings, paragraphs, bold/italic/code, nested lists, and pipe tables."
			},
			title: {
				type: "string",
				description: "Optional document title property."
			},
			author: {
				type: "string",
				description: "Optional document author (creator) property."
			},
			...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					operation: {
						type: "string",
						required: true,
						enum: ["create", "update"]
					},
					bytes: {
						type: "number",
						required: true
					},
					warnings: {
						type: "array",
						required: true,
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `<path>${value.path}</path>\n<type>docx</type>\n<content>\nCreated ${value.bytes}-byte .docx document\n</content>`
			}]
		},
		async execute(args, exec) {
			const input = parseCreateArgs(args, caps.maxMarkdownChars);
			assertSupportedExtension(input.filePath);
			const fs = assertBinaryFs(ctx.fs);
			const sandboxPolicy = await sandbox.resolvePolicy("docx_create", args, exec);
			const warnings = [];
			const buffer = await generateDocx(parseMarkdown(input.markdown, warnings), {
				title: input.title ?? null,
				author: input.author ?? null,
				created: null
			});
			const target = await fs.resolve(input.filePath, resolveOptions(exec));
			const intent = await ctx.waterfall("fs/write-intent", target, exec, () => ({ kind: "createIfAbsent" }));
			let outcome;
			try {
				outcome = await fs.writeBytes(target, buffer, intent, exec.signal, sandboxPolicy);
			} catch (error) {
				throw mapFsError(sandbox.mapError(error, sandboxPolicy));
			}
			emitObserved(ctx, target, outcome.version, exec);
			return {
				path: target.displayPath,
				operation: outcome.operation,
				bytes: buffer.byteLength,
				warnings
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Create ${args.file_path}`,
				kind: "edit",
				locations: [{ path: args.file_path }]
			};
		},
		presentResult(args, result) {
			if (result.isError) return void 0;
			return {
				card: "generic",
				title: `Create ${args.file_path}`
			};
		}
	}));
}
//#endregion
//#region lib/types/tools/edit.js
/**
* Model-facing `docx_edit`: replace a `.docx` document's content from
* Markdown, preserving its title/author/created properties. Reads the current
* file (validating it is a docx), regenerates the body, and writes back with a
* version guard so a concurrent change reports `DOCX_STALE`.
* @module dsh-tool-docx/tools/edit
*/
function parseEditArgs(args, maxMarkdownChars) {
	const filePath = requirePath(args.file_path);
	if (args.markdown.length > maxMarkdownChars) throw new DocxError(`markdown exceeds the ${maxMarkdownChars}-character limit`, "DOCX_INPUT_TOO_LARGE");
	return {
		filePath,
		markdown: args.markdown
	};
}
/**
* Register the `docx_edit` tool.
* @param ctx - the plugin context; execution uses its `fs` service.
* @param caps - the deployment's resolved caps.
* @param sandbox - the shared sandbox-escalation API.
*/
function applyEditTool(ctx, caps, sandbox) {
	ctx.tools.register(defineTool({
		name: "docx_edit",
		description: "Edit a Microsoft Word .docx file: replace its content from Markdown while preserving title/author/created. Round-trip: read with docx_read, modify the Markdown, then call docx_edit with the full new Markdown.",
		parameters: {
			file_path: {
				type: "string",
				required: true,
				description: "Path of the .docx file to edit, resolved by the filesystem backend."
			},
			markdown: {
				type: "string",
				required: true,
				description: "The full new Markdown content for the document (headings, paragraphs, bold/italic/code, nested lists, pipe tables)."
			},
			...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					operation: {
						type: "string",
						required: true,
						enum: ["create", "update"]
					},
					bytes: {
						type: "number",
						required: true
					},
					warnings: {
						type: "array",
						required: true,
						items: { type: "string" }
					},
					docProps: {
						type: "object",
						additionalProperties: false,
						properties: {
							title: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							},
							author: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							},
							created: {
								required: true,
								oneOf: [{ type: "string" }, { type: "null" }]
							}
						}
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `<path>${value.path}</path>\n<type>docx</type>\n<content>\nUpdated ${value.bytes}-byte .docx document\n</content>`
			}]
		},
		async execute(args, exec) {
			const input = parseEditArgs(args, caps.maxMarkdownChars);
			assertSupportedExtension(input.filePath);
			const fs = assertBinaryFs(ctx.fs);
			const sandboxPolicy = await sandbox.resolvePolicy("docx_edit", args, exec);
			const target = await fs.resolve(input.filePath, resolveOptions(exec));
			const info = await fs.stat(target, exec.signal);
			if (!info) {
				emitAbsent(ctx, target, exec);
				throw new DocxError(`file not found: ${target.displayPath}`, "DOCX_NOT_FOUND");
			}
			if (info.type !== "file") throw new DocxError(`cannot edit "${target.displayPath}": not a regular file`, "DOCX_NOT_REGULAR_FILE");
			let data;
			try {
				data = await fs.readBytes(target, exec.signal, caps.maxDocxBytes);
			} catch (error) {
				throw mapFsError(error);
			}
			const existing = await extractDocx(data, caps.maxDocxBytes);
			const warnings = [...existing.warnings];
			const buffer = await generateDocx(parseMarkdown(input.markdown, warnings), existing.props);
			const intent = await ctx.waterfall("fs/write-intent", target, exec, () => ({
				kind: "replaceIfVersion",
				version: info.version
			}));
			let outcome;
			try {
				outcome = await fs.writeBytes(target, buffer, intent, exec.signal, sandboxPolicy);
			} catch (error) {
				throw mapFsError(sandbox.mapError(error, sandboxPolicy));
			}
			emitObserved(ctx, target, outcome.version, exec);
			return {
				path: target.displayPath,
				operation: outcome.operation,
				bytes: buffer.byteLength,
				warnings,
				docProps: existing.props
			};
		},
		presentCall(args) {
			return {
				card: "generic",
				title: `Edit ${args.file_path}`,
				kind: "edit",
				locations: [{ path: args.file_path }]
			};
		},
		presentResult(args, result) {
			if (result.isError) return void 0;
			return {
				card: "generic",
				title: `Edit ${args.file_path}`
			};
		}
	}));
}
//#endregion
//#region lib/types/sandbox.js
/**
* The sandbox-escalation API for the mutating docx tools: per-call policy
* resolution, advertised escalation fields, and denial-marker mapping вЂ” the
* same pieces `dsh-tool-fs` uses, so docx mutations escalate identically to
* bash and fs. Built ONCE per plugin from `ctx.fs.sandboxMode`.
*
* This mirrors `packages/fs/tool-fs/src/sandbox.ts`; extracting a shared
* controller is deferred work (see the package README).
*
* @module dsh-tool-docx/sandbox
*/
/** The docx escalation API: advertisement gating, policy resolution, and denial mapping. */
var DocxSandboxController = class {
	ctx;
	/** Escalation targets this composition advertises (`[]` when no confining backend is mounted). */
	escalationModes;
	policy;
	constructor(ctx) {
		this.ctx = ctx;
		const defaultMode = ctx.fs.sandboxMode;
		this.escalationModes = defaultMode === void 0 ? [] : ESCALATION_TARGETS;
		this.policy = defaultMode === void 0 ? void 0 : ctx.get("sandboxPolicy");
		if (defaultMode !== void 0 && this.policy === void 0) throw new Error("tool-docx: the mounted filesystem confines but ctx.sandboxPolicy is missing");
	}
	/**
	* The escalation schema fields for a mutating tool's `parameters` (confining backend only).
	* @returns the two escalation parameter specs.
	*/
	schemaFields() {
		return {
			sandbox_permissions: {
				type: "string",
				enum: [...this.escalationModes],
				description: "The wider sandbox mode this file operation needs. Only valid as a one-shot retry of an operation the sandbox just denied; requires justification and user approval."
			},
			justification: {
				type: "string",
				description: "Required with sandbox_permissions: one sentence for the user explaining why this exact file operation needs the wider access."
			}
		};
	}
	/**
	* The policy to stamp onto this mutation: an approved escalation grant, else
	* the session's standing mode (with the session cwd as the workspace root).
	* @param toolName - the mutating tool's name, for the approval audit trail.
	* @param args - the call's escalation arguments.
	* @param exec - the tool-execution context.
	* @returns the policy for the mutation, or undefined for an unsandboxed backend.
	*/
	async resolvePolicy(toolName, args, exec) {
		validateEscalationArgs(args.sandbox_permissions, args.justification);
		const standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
		if (args.sandbox_permissions === void 0 || args.justification === void 0) return standingPolicy;
		if (this.escalationModes.length === 0) throw new Error("sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)");
		const policy = standingPolicy;
		const approvedMode = await approveEscalation({
			requestedMode: args.sandbox_permissions,
			justification: args.justification,
			effectiveMode: policy.mode,
			subject: "operation"
		}, {
			approver: this.ctx.get("approval"),
			agent: exec.agent,
			callId: exec.callId,
			toolName,
			signal: exec.signal
		});
		return {
			...policy,
			mode: approvedMode
		};
	}
	/**
	* Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes a
	* `DocxError` carrying the shared `[sandbox: вЂ¦]` marker plus the same-turn
	* escalation hint (keeping the structured `DOCX_SANDBOX_DENIED` code).
	* @param error - the error thrown by the mutation.
	* @param policy - the policy stamped onto the call.
	* @returns the error to throw.
	*/
	mapError(error, policy) {
		if (!(error instanceof FsError) || error.code !== "FS_SANDBOX_DENIED") return error;
		const mode = policy.mode;
		return new DocxError(`${sandboxDenialMarker(mode)}\n${escalationHintMarker("operation")}`, "DOCX_SANDBOX_DENIED", { cause: error });
	}
};
//#endregion
//#region lib/types/index.js
/**
* Model-facing Microsoft Word (.docx) tools: `docx_read` (docx в†’ Markdown or
* structured JSON blocks), `docx_create` (Markdown в†’ new docx), and
* `docx_edit` (round-trip Markdown replacement preserving document
* properties). Reading uses the bounded `ctx.fs.readBytes` primitive; creating
* and editing use the new binary-safe `ctx.fs.writeBytes` primitive, so the
* sandbox fence and observation policy apply to docx mutations exactly as they
* do to text writes.
* @module dsh-tool-docx
*/
/** Cordis plugin name used by loader diagnostics. */
const name = "tool-docx";
/** Services required by the docx tool suite. */
const inject = [
	"tools",
	"fs",
	"systemPrompt"
];
const Config = z.object({
	maxDocxBytes: z.number().default(67108864),
	maxMarkdownChars: z.number().default(1e6),
	maxReadChars: z.number().default(2e5)
});
/** Register the full `docx_read`/`docx_create`/`docx_edit` tool suite. */
function apply(ctx, config) {
	const resolved = config;
	assertPositiveInteger("maxDocxBytes", resolved.maxDocxBytes);
	assertPositiveInteger("maxMarkdownChars", resolved.maxMarkdownChars);
	assertPositiveInteger("maxReadChars", resolved.maxReadChars);
	const sandbox = new DocxSandboxController(ctx);
	applyReadTool(ctx, resolved);
	applyCreateTool(ctx, resolved, sandbox);
	applyEditTool(ctx, resolved, sandbox);
}
//#endregion
export { Config, apply, inject, name };
