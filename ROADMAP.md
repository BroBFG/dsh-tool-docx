# dsh-tool-docx — Roadmap

[English](ROADMAP.md) | [中文](ROADMAP.zh.md) | [Русский](ROADMAP.ru.md)

Planned evolution of the plugin, ordered by value and effort. Each item names
its concrete scope so a contributor can pick it up without making design
decisions. Statuses are tracked in the repository issues; this file is the
destination, not the tracker.

## Near term — foundation

### 1. Publish to npm

- Scope: publish under the free name `dsh-tool-docx`; wire `publishConfig`/CI
  publishing; document `dsh plugin --profile web add dsh-tool-docx` (no git
  spec) in the READMEs.
- Value: one-word install, real semver releases, `dsh plugin … update` picks
  up published versions, ecosystem discoverability.
- Effort: small.

### 2. Track upstream `fs.writeBytes`

- Scope: watch `@deepseek-ai/dsh-fs` releases for `writeBytes` /
  `FsBytesWriteOutcome`; when published, prefer the native `ctx.fs.writeBytes`
  and keep the `fsBinary` providers (`fs-binary-sandbox-plugin` /
  `fs-binary-local-plugin`) as fallback for older hosts.
- Value: collapses the self-maintained seam; less plugin-owned code; the
  harness owns the primitive.
- Effort: small (mostly watching + one resolver change).

### 3. Extract a shared `FsSandboxController`

- Scope: `src/sandbox.ts` currently mirrors `dsh-tool-fs`'s escalation API.
  Extract the common controller into the plugin's own package (or propose it
  upstream as `@deepseek-ai/dsh-fs-sandbox-controller`) so the two copies stop
  drifting.
- Value: removes a documented known-limitation; single owner for the
  sandbox-escalation contract.
- Effort: small-medium.

### 4. CI build-determinism gate

- Scope: verify that the hashed `lib/*.js` chunk names reproduce in CI (the
  `verify:lib` gate exists; confirm it is stable across environments, and fix
  if rolldown chunk naming is path-dependent).
- Value: trustworthy releases; the installed package always matches the
  committed `lib/`.
- Effort: small.

## Mid term — the docx format, seriously

### 5. Images through the `attachments` service

- Scope: extract embedded images (`word/media/*`) from `docx_read` as content;
  embed images on `docx_create`/`docx_edit`. Store durable bytes through the
  harness `attachments` service (`dsh-attachment-local`) so images survive
  sessions and re-embed on generate.
- Value: the single most-requested gap; completes the read→edit→write cycle
  for documents with figures.
- Effort: medium.

### 6. Surgical `docx_edit`

- Scope: edit `word/document.xml` in place instead of regenerating the whole
  package, preserving styles, headers/footers, page setup, and section
  breaks. Keep the current regenerate path as the fallback for complex
  rewrites.
- Value: the round-trip stops being lossy — the core quality gap today.
- Effort: medium-large (XML surgery + careful round-trip tests).

### 7. Tables, footnotes, page breaks

- Scope: full merged-cell support (`gridSpan`/`vMerge`) in both directions,
  footnotes/endnotes, page breaks — replacing today's approximations.
- Value: professional documents round-trip faithfully.
- Effort: medium (can be split by feature).

### 8. Wider Markdown subset

- Scope: blockquotes, horizontal rules, nested fenced code blocks, images
  (depends on item 5).
- Value: removes degradation warnings; pairs with the extraction side.
- Effort: small-medium.

## Long term — a document family

### 9. Legacy `.doc` conversion

- Scope: optional converter via LibreOffice headless or Word COM on Windows,
  gated behind an explicit requirement (installed LibreOffice/Word); `docx_read`
  on `.doc` could then transparently convert instead of failing with
  `DOCX_LEGACY_DOC`.
- Value: closes the last format gap for Word documents.
- Effort: medium.

### 10. Sibling tools — `dsh-tool-xlsx`, `dsh-tool-pptx`

- Scope: reuse the architecture (bounded binary reads via the `fsBinary`
  service, block model, official `dsh plugin` install, tests against published
  packages) for spreadsheets and presentations. Excel first (higher demand);
  PowerPoint second.
- Value: turns the plugin into an office suite for the harness.
- Effort: large per format.

### 11. PDF text extraction

- Scope: read-only text extraction (no write-back); bounded like the docx
  readers.
- Value: covers a common reference format.
- Effort: medium; priority lower than the office formats.

### 12. Standalone converter library

- Scope: extract the `docx ↔ Markdown` conversion core into a harness-free npm
  package (`docx-markdown` or similar), with the plugin as a thin harness
  wrapper.
- Value: usable outside DSH; independent CI; widens the contributor base.
- Effort: medium (mostly packaging + docs).

### 13. Ecosystem template

- Scope: write up the plugin as a reference "how to build a dsh-tool-* plugin"
  (official install, separate service instead of host replacement, tests
  against published packages) as docs or a skill.
- Value: lowers the barrier for the next plugin; standardizes the ecosystem.
- Effort: small.

## Honest limitations

- High-fidelity round-trip (styles, headers/footers, sections) is roughly half
  the plugin's current size in new code; the surgical-edit path (item 6) is the
  right first step, not a from-scratch writer.
- Encrypted (password-protected) docx needs an OLE/CryptoAPI decryption
  dependency — deferred, low priority.
- The tsx source-run error-code limitation (see README "Known Limitations") is
  a harness-side fix (junction canonicalization under tsx). This plugin
  documents it and tracks an upstream issue; the built-bin mode is unaffected.

## Recommended order

1. npm publish + upstream `writeBytes` tracking — small effort, large effect.
2. Images via `attachments` — medium effort, high demand.
3. Surgical `docx_edit` — medium-large effort, the key quality win.
4. `dsh-tool-xlsx` — the next family member.
