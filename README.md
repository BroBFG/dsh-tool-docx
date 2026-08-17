# @deepseek-ai/dsh-tool-docx

English | [中文](README.zh.md)

Model-facing Microsoft Word (`.docx`) tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): `docx_read` extracts a document as Markdown or structured JSON blocks, `docx_create` generates a new `.docx` from Markdown, and `docx_edit` replaces a document's content from Markdown while preserving its title/author/created properties. `.docx` is a ZIP of XML parts, so every tool reads the whole package through the bounded `ctx.fs.readBytes` primitive and writes packages through the binary-safe `ctx.fs.writeBytes` primitive — the same atomic, sandbox-fenced mutations the text tools use.

This repository is the **standalone distribution** of the plugin. The plugin is **original work written for DeepSeek Harness** — an independent plugin developed by this project, initially in a local `deepseek-harness` checkout (the harness is its runtime target), not a copy of a plugin from the shared repository. It plugs into the harness's `tools`, `fs`, and `systemPrompt` services, and it builds and tests on its own against the published `@deepseek-ai/*` packages, so it can be installed into any harness checkout.

## Requirements

- A DeepSeek Harness host whose filesystem seam provides the **binary** primitives `fs.readBytes` and `fs.writeBytes`. `readBytes` already exists on the public `master` of deepseek-harness; `writeBytes` was introduced together with this plugin and is present in the local tree we develop against, but is not yet in any published release (the published `@deepseek-ai/dsh-fs@0.0.1-rc.1` ships text-only operations). On a host without the primitives, every call fails with a typed `DOCX_HOST_FS_UNSUPPORTED` error — see [Host filesystem contract](#host-filesystem-contract).
- The harness provides the peer services: `cordis`, `dsh-tools`, `dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-system-prompt`, `dsh-invariants`, `dsh-user-approval`, `dsh-session`.

## Installation

Inside a DeepSeek Harness checkout (pnpm workspace), add the plugin from this repository:

```sh
pnpm add github:BroBFG/dsh-tool-docx
```

or install it as a local path while developing:

```sh
pnpm add ../dsh-tool-docx
```

Then mount it in the harness plugin configuration:

```yaml
plugins:
  - id: tool-docx
    name: '@deepseek-ai/dsh-tool-docx'
```

> npm publication is planned but not yet available; the package keeps the `@deepseek-ai` scope so it can be published to the same registry as its peers once the scope owner enables it.

## Tools

| Tool | Purpose |
|---|---|
| `docx_read(file_path, format?, max_chars?)` | Extract document body as Markdown (default) or structured JSON blocks plus `docProps`. Emits `fs/observed`. |
| `docx_create(file_path, markdown, title?, author?)` | Generate a new `.docx` from Markdown. Guarded `createIfAbsent`: an existing file is never blindly overwritten. |
| `docx_edit(file_path, markdown)` | Read the current document (validating it is a docx), preserve `docProps`, regenerate the body from the full Markdown, and write back with a version guard (`DOCX_STALE` on a concurrent change). |

All three resolve relative paths against the calling agent's session cwd, dispatch the `fs/write-intent` waterfall before mutating (the observation-policy plugin may supply its own intent), and record `fs/observed` on completion — so the sandbox fence, escalation fields, and read-before-write policy apply to docx mutations exactly as they do to `write`/`edit`.

## Config

| Field | Default | Meaning |
|---|---|---|
| `maxDocxBytes` | 64 MiB | Inclusive byte cap on a whole `.docx` file (read + ZIP expansion). |
| `maxMarkdownChars` | 1 000 000 | Inclusive character cap on the Markdown input to create/edit. |
| `maxReadChars` | 200 000 | Inclusive character cap on the Markdown returned by `docx_read`. |

## Design notes

- **Extraction** (`src/docx/extract.ts`) walks `word/document.xml` with `fast-xml-parser`: headings (`Heading1`–`Heading6`, `Title`), bold/italic/strike runs, nested lists through `word/numbering.xml` (bullet vs decimal), pipe tables (merged cells approximate), external hyperlinks through `word/_rels/document.xml.rels`, and embedded images as counted placeholders. Unsupported constructs degrade to warnings, never failures.
- **Generation** (`src/docx/generate.ts`) renders the block model with the `docx` library: ATX headings, styled inline runs, 9-level bullet/numbered numbering, pipe tables, and `[text](url)` external hyperlinks. `parseMarkdown` (src/markdown.ts) accepts the subset the extractor emits, so read → edit → write round trips are stable.
- **Caps are enforced at the seam, not in the tool** — the whole-file byte cap flows into `ctx.fs.readBytes` (`FS_TOO_LARGE` maps to `DOCX_TOO_LARGE`), and the ZIP reader applies the same cap to the uncompressed total, so a compressed bomb cannot expand without limit.
- **Sandbox parity** — `src/sandbox.ts` mirrors `dsh-tool-fs`'s escalation API (`sandbox_permissions`/`justification` advertised only under a confining backend, denial marker mapping); extracting a shared controller is deferred (see below).
- **Host filesystem contract** — `src/fs-binary.ts` declares the binary contract (`readBytes`/`writeBytes`) the tools need, as a local extension of the published `FileSystem` type, and guards it at runtime. In the local tree we develop against the guard is a no-op; on a host without the binary primitives it raises `DOCX_HOST_FS_UNSUPPORTED` with a pointer to this requirement instead of a cryptic `fs.readBytes is not a function`.

## Model Experience

### System prompt

#### What the model sees

The `tool:docx-read` section below is registered once at plugin apply:

##### The docx guidance section

```markdown
MS Word .docx files are binary (ZIP+XML) and the read tool cannot read them. Use docx_read to extract a document as Markdown (default) or structured JSON blocks, docx_create to generate a new .docx from Markdown, and docx_edit to replace a document's content from Markdown while preserving its title/author/created properties. Legacy .doc is not supported — convert it to .docx first.
```

#### Token effect

Fixed guidance cost per request while the plugin is mounted; the section is unaffected by scoped tool restrictions.

#### KV Cache effect

Prefix-stable while the guidance text is unchanged. Plugin lifecycle or a text change may invalidate reuse from the first changed prompt section.

### Tool schemas

#### What the model sees

The generated `docx_read`, `docx_create`, and `docx_edit` schemas — parameters and canonical outputs as summarized in the [Tools](#tools) table. The byte/character caps are deployment settings, not model arguments; the escalation fields appear only under a confining filesystem backend.

#### Token effect

Fixed schema cost per request for each mounted tool; config disablement removes schemas and guidance together, while a scoped restriction removes only the schema.

#### KV Cache effect

Prefix-stable while definitions and visibility are unchanged. Config enablement, plugin lifecycle, or scoped restrictions may invalidate reuse from the first changed schema token.

### Read result

#### What the model sees

A successful `docx_read` renders the extracted Markdown (or pretty-printed JSON blocks). Truncation appends `\n… (truncated)`; failures are typed messages such as `file not found: <path>`, `the document is encrypted (password-protected); decryption is not supported`, or the legacy hint `legacy .doc format is not supported — convert the document to .docx first`.

#### Token effect

Data-dependent results are capped by `maxReadChars` (or the call's `max_chars`) and resent until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Create/Edit result

#### What the model sees

A successful create/edit renders a short `<path>`/`<type>docx</type>` envelope with the byte size — never the document body. Warnings about approximations (images, merged cells, code blocks) are carried in the canonical `warnings` array and rendered as plain text.

#### Token effect

Only the retained call arguments (including the full Markdown input) and the short result add tokens; the generated package bytes never enter the session log.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Argument errors

#### What the model sees

Blank `file_path` becomes `Error: file_path must be a non-empty string`; markdown over the input cap becomes `Error: markdown exceeds the <n>-character limit`.

#### Token effect

Only the failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Legacy `.doc` (OLE) is unsupported** — binary OLE needs LibreOffice or Word COM conversion; the tools fail with `DOCX_LEGACY_DOC` and a hint to convert to `.docx` first.
- **Images are not extracted or embedded** — `docx_read` counts images and emits placeholders; `docx_create`/`docx_edit` drop image syntax with a warning. Extracting image bytes and embedding them on generate is deferred.
- **Round-trip regenerates the document** — styles, page setup, headers/footers, and section breaks are not preserved; an edit rebuilds the body with default styles, keeping only title/author/created. Layout fidelity is not a goal of the round trip.
- **Merged table cells approximate** — `gridSpan`/`vMerge` degrade to plain pipe-table cells with a warning; footnotes, endnotes, text boxes, and page breaks are dropped (warnings included).
- **The sandbox controller duplicates `dsh-tool-fs`** — extracting a shared `FsSandboxController` is deferred; the two copies must be kept in sync until then.
- **Markdown input subset** — blockquotes, horizontal rules, nested fences, and images are not represented; they degrade to paragraphs with a warning (fenced code becomes code-styled paragraphs).

## Development

```sh
pnpm install
pnpm typecheck   # tsc over src/
pnpm build       # tsc → lib/types + tsdown → lib/index.js, lib/invariant.js
pnpm test        # vitest: unit conversion tests + consumer tests over a fake fs
pnpm pack        # produce the npm tarball (files: lib/index.js, lib/invariant.js, lib/types/**/*.d.ts)
```

Layout:

- `src/docx/` — ZIP/XML extraction and `docx`-library generation;
- `src/tools/` — the three tool registrations;
- `src/fs-binary.ts` — the binary filesystem contract guard;
- `tests/` — conversion round-trip tests and consumer tests (with a small `ToolRuntime` shim, since the published `dsh-tools` release does not export the service class yet).

## Relationship to deepseek-harness

This plugin is an **original, independent project written for DeepSeek Harness** — it plugs into the harness's public services (`tools`, `fs`, `systemPrompt`) and is developed in a local `deepseek-harness` checkout for testing against the harness. It is not a copy of a plugin from the shared `deepseek-harness` repository and is not part of it; this repository is the canonical distribution. Two implementation notes:

1. `src/fs-binary.ts` (host contract guard) — the binary `readBytes`/`writeBytes` contract is part of this plugin's design. The local tree's `FileSystem` already provides both primitives (the guard is a no-op there); the published `@deepseek-ai/dsh-fs` release does not, hence the guard;
2. `tests/tool-runtime-shim.ts` — a minimal test double for the harness's `ToolRuntime` service, because the published `dsh-tools` release does not export the service class.

The same source lives in the local `deepseek-harness` checkout used for development (`packages/docx/tool-docx`); keep this repository in sync by copying `src` and `tests` from there (keeping `src/fs-binary.ts` and the shim).

## License

MIT © 2026 BroBFG. Portions of `src/sandbox.ts` are derived from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT, Copyright (c) 2026 DeepSeek) — see [LICENSE](LICENSE).
