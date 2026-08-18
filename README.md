# dsh-tool-docx

English | [中文](README.zh.md) | [Русский](README.ru.md)

Roadmap: [English](ROADMAP.md) · [中文](ROADMAP.zh.md) · [Русский](ROADMAP.ru.md)

Model-facing Microsoft Word (`.docx`) tools for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): `docx_read` extracts a document as Markdown or structured JSON blocks, `docx_create` generates a new `.docx` from Markdown, and `docx_edit` replaces a document's content from Markdown while preserving its title/author/created properties. `.docx` is a ZIP of XML parts, so every tool reads the whole package through the bounded `ctx.fs.readBytes` primitive and writes packages through the plugin's `fsBinary` binary write service (or a host `ctx.fs` that provides `writeBytes` natively) — the same atomic, sandbox-fenced mutations the text tools use, without ever replacing the host's own filesystem.

This repository is the **standalone distribution** of the plugin. The plugin is **original work written for DeepSeek Harness** — an independent plugin developed by this project, initially in a local `deepseek-harness` checkout (the harness is its runtime target), not a copy of a plugin from the shared repository. It plugs into the harness's `tools`, `fs`, and `systemPrompt` services, and it builds and tests on its own against the published `@deepseek-ai/*` packages, so it can be installed into any harness checkout.

## Requirements

- A DeepSeek Harness host (the `0.1.0-rc.7` line) whose filesystem seam provides the **read** primitive `fs.readBytes` — published in `@deepseek-ai/dsh-fs` since `0.1.0-rc.7`. The **write** side (`writeBytes`) is not in any published `dsh-fs` release, so the bundle mounts the plugin's [binary fs providers](#binary-fs-providers): a separate `fsBinary` service that implements `writeBytes` (fenced for sandboxed hosts) without touching `ctx.fs`. Without any binary writer — no `fsBinary` service and no native `ctx.fs.writeBytes` — `docx_read` still works, while `docx_create`/`docx_edit` fail with a typed `DOCX_HOST_FS_UNSUPPORTED` error naming the fix.
- The harness provides the peer services (the `0.1.0-rc.7` line): `cordis`, `dsh-tools`, `dsh-fs`, `dsh-llm`, `dsh-sandbox`, `dsh-sandbox-policy`, `dsh-system-prompt`, `dsh-invariants`, `dsh-user-approval`, `dsh-session`.

## Installation

The official install path is the harness's own plugin manager — one command installs the package into the profile, and the profile launcher activates the bundle's [`cordis.patch.yml`](cordis.patch.yml) layer automatically (the package declares `dsh.bundle.patch`):

```sh
dsh plugin --profile web add github:BroBFG/dsh-tool-docx#v0.5.0
```

`dsh plugin` runs pnpm inside the profile directory and reconciles `dsh.profile.bundles` against the installed state, so nothing else is needed — no `allowBuilds` entries (the package ships its built `lib/` and has no build scripts), no manual `cordis.patch.yml` editing, no `--patch` overlays. Restart the harness afterwards.

- **Update:** `dsh plugin --profile web update dsh-tool-docx`, or re-run `add` with the new tag.
- **Remove:** `dsh plugin --profile web remove dsh-tool-docx`.
- **Local development:** `dsh plugin --profile web add ../dsh-tool-docx` (relative specs are anchored to the directory you invoke from) or `dsh plugin --profile web add link:../dsh-tool-docx`.

> npm publication is planned but not yet available; the package ships under the standalone name `dsh-tool-docx` (the `dsh-tool-*` ecosystem convention), independent of the `@deepseek-ai` scope.

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

## Binary fs providers

The base bundle's `fs-sandbox` row keeps providing `ctx.fs` **unchanged**. The bundle patch adds the docx tools plus one of the binary providers, which register the binary `writeBytes` primitive as a **separate `fsBinary` service** — the host filesystem is never replaced, so this plugin cannot break the harness boot; at worst, without the provider, the mutating tools report `DOCX_HOST_FS_UNSUPPORTED`:

- **`dsh-tool-docx/fs-binary-sandbox-plugin`** (mounted by the bundle; recommended for sandboxed hosts) — registers `fsBinary.writeBytes` fenced by the **same per-call policy** as every sandbox mutation: `workspace-write` containment, `read-only` denial, `danger-full-access` passthrough, `FS_SANDBOX_DENIED` on refusal (mapped to `DOCX_SANDBOX_DENIED` at the tool layer).
- **`dsh-tool-docx/fs-binary-local-plugin`** — registers `fsBinary.writeBytes` **unfenced**, for minimal contexts (tests, headless scripts) or hosts that fence above the provider. To mount it instead of the sandboxed one, override the bundle row in your profile `cordis.patch.yml`:

  ```yaml
  - id: fs-binary-sandbox
    disabled: true
  - insert:
      - id: fs-binary-local
        name: dsh-tool-docx/fs-binary-local-plugin
  ```

Both use the same probe → intent-guard (`createIfAbsent` / `replaceIfVersion`) → atomic-publish flow as the harness seam: a private owner-only staging directory, fsync, then atomic publication (a hard-link no-replace primitive for `createIfAbsent`), with per-target serialization. The first version omits the harness's Win32 DACL-preservation ceremony — a replacement inherits the owner-only ACL of the staged temp file.

For hosts that deliberately want the full backend mounted **as `ctx.fs`** (replacing `fs-sandbox`), the package also ships the provider classes `dsh-tool-docx/fs-binary-sandbox` and `dsh-tool-docx/fs-binary-local`; the replace-the-row recipe still applies:

```yaml
- id: fs-sandbox
  disabled: true
- insert:
    - id: fs-binary-sandbox
      name: dsh-tool-docx/fs-binary-sandbox
    - id: tool-docx
      name: dsh-tool-docx
```

## Design notes

- **Extraction** (`src/docx/extract.ts`) walks `word/document.xml` with `fast-xml-parser`: headings (`Heading1`–`Heading6`, `Title`), bold/italic/strike runs, nested lists through `word/numbering.xml` (bullet vs decimal), pipe tables (merged cells approximate), external hyperlinks through `word/_rels/document.xml.rels`, and embedded images as counted placeholders. Unsupported constructs degrade to warnings, never failures.
- **Generation** (`src/docx/generate.ts`) renders the block model with the `docx` library: ATX headings, styled inline runs, 9-level bullet/numbered numbering, pipe tables, and `[text](url)` external hyperlinks. `parseMarkdown` (src/markdown.ts) accepts the subset the extractor emits, so read → edit → write round trips are stable.
- **Caps are enforced at the seam, not in the tool** — the whole-file byte cap flows into `ctx.fs.readBytes` (`FS_TOO_LARGE` maps to `DOCX_TOO_LARGE`), and the ZIP reader applies the same cap to the uncompressed total, so a compressed bomb cannot expand without limit.
- **Sandbox parity** — `src/sandbox.ts` mirrors `dsh-tool-fs`'s escalation API (`sandbox_permissions`/`justification` advertised only under a confining backend, denial marker mapping); extracting a shared controller is deferred (see below).
- **Host filesystem contract** — `src/fs-binary.ts` declares the binary contract the tools need and resolves the writer at call time: the plugin's `fsBinary` service when mounted, else a host `ctx.fs` that natively provides `writeBytes`. Without any binary writer it raises `DOCX_HOST_FS_UNSUPPORTED` with a pointer to the fix instead of a cryptic `fs.writeBytes is not a function`; `docx_read` needs only the published `ctx.fs.readBytes`.

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
- **Structured error codes under the tsx source run** — when the harness launches from source (`node --import tsx/esm`, the dev launcher), the healed `$DSH_HOME/profiles/node_modules` junction resolves as a second module instance of the peer Service Definition packages, so plugin errors fail the host's `instanceof HarnessError` check and `error.info.code` is omitted from tool results. The model-facing message — including the `[sandbox: …]` markers and escalation hints — is unaffected, and built-bin launches (plain Node) share one instance and preserve the codes.

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
- `src/fs-binary.ts` — the binary filesystem contract and the call-time writer resolver (`fsBinary` service or native `ctx.fs.writeBytes`);
- `src/fs-binary-local.ts`, `src/fs-binary-sandbox.ts`, `src/fsio-bytes.ts`, `src/path-contains.ts` — the binary fs provider classes and the atomic writer + containment helpers;
- `src/fs-binary-sandbox-plugin.ts`, `src/fs-binary-local-plugin.ts` — the namespace plugins that register the `fsBinary` service (the bundle's default mount);
- `tests/` — conversion round-trip tests, provider tests, and consumer tests against the published `ToolRuntime` service (exported since `dsh-tools@0.1.0-rc.7`).

## Relationship to deepseek-harness

This plugin is an **original, independent project written for DeepSeek Harness** — it plugs into the harness's public services (`tools`, `fs`, `systemPrompt`) and is developed in a local `deepseek-harness` checkout for testing against the harness. It is not a copy of a plugin from the shared `deepseek-harness` repository and is not part of it; this repository is the canonical distribution. Two implementation notes:

1. `src/fs-binary.ts` (host contract + writer resolver) — the binary `readBytes`/`writeBytes` contract is part of this plugin's design. `readBytes` is published in the harness's `dsh-fs` release line since `0.1.0-rc.7`; `writeBytes` is not, so the [binary fs providers](#binary-fs-providers) ship it as a separate `fsBinary` service instead of patching the host;
2. `tests/` runs against the published `ToolRuntime` service (exported since `dsh-tools@0.1.0-rc.7`), so the consumer tests exercise the real registry pipeline rather than a local double.

The plugin is developed and maintained entirely in this repository against the published `@deepseek-ai/*` packages; the harness checkout is only a runtime target used for integration verification, and carries no copy of this plugin.

## License

MIT © 2026 BroBFG. Portions of `src/sandbox.ts`, the atomic-write pattern in `src/fsio-bytes.ts`, and the containment logic in `src/path-contains.ts` are derived from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT, Copyright (c) 2026 DeepSeek) — see [LICENSE](LICENSE).
