# @deepseek-ai/dsh-tool-docx

[English](README.md) | 中文

面向模型的微软 Word（`.docx`）工具，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：`docx_read` 将文档提取为 Markdown 或结构化 JSON 块，`docx_create` 从 Markdown 生成新的 `.docx`，`docx_edit` 从 Markdown 替换文档内容并保留其 title/author/created 属性。`.docx` 是 ZIP 封装的 XML 部件，因此每个工具都通过有界的 `ctx.fs.readBytes` 原语读取整个包，并通过二进制安全的 `ctx.fs.writeBytes` 原语写入包——与文本工具使用相同的原子、沙箱围栏变更。

本仓库是随 `deepseek-harness` 单仓（`packages/docx/tool-docx`）一起发布的插件的**独立、可移植副本**：同一份源码，可针对已发布的 `@deepseek-ai/*` 包独立构建和测试，因此可以安装到任何 harness 检出中。

## 需求

- 一个文件系统 seam 提供**二进制**原语 `fs.readBytes` 和 `fs.writeBytes` 的 DeepSeek Harness 宿主（当前 `deepseek-harness` `main` 可用；已发布的 `@deepseek-ai/dsh-fs@0.0.1-rc.1` 更旧，只提供文本操作）。在旧宿主机上，每次调用都会以带类型的 `DOCX_HOST_FS_UNSUPPORTED` 错误说明该需求——见[宿主文件系统契约](#宿主文件系统契约)。
- harness 提供 peer 服务：`cordis`、`dsh-tools`、`dsh-fs`、`dsh-llm`、`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-system-prompt`、`dsh-invariants`、`dsh-user-approval`、`dsh-session`。

## 安装

在 DeepSeek Harness 检出（pnpm workspace）中，从本仓库添加插件：

```sh
pnpm add github:BroBFG/dsh-tool-docx
```

或在开发时作为本地路径安装：

```sh
pnpm add ../dsh-tool-docx
```

然后在 harness 插件配置中挂载它：

```yaml
plugins:
  - id: tool-docx
    name: '@deepseek-ai/dsh-tool-docx'
```

> npm 发布已计划但尚未提供；包保留 `@deepseek-ai` scope，以便在 scope 所有者启用后发布到与其 peers 相同的 registry。

## 工具

| 工具 | 用途 |
|---|---|
| `docx_read(file_path, format?, max_chars?)` | 将文档正文提取为 Markdown（默认）或结构化 JSON 块以及 `docProps`。发出 `fs/observed`。 |
| `docx_create(file_path, markdown, title?, author?)` | 从 Markdown 生成新的 `.docx`。受 `createIfAbsent` 保护：绝不盲目覆盖现有文件。 |
| `docx_edit(file_path, markdown)` | 读取当前文档（校验其为 docx），保留 `docProps`，从完整 Markdown 重新生成正文，并以版本守卫写回（并发变更时返回 `DOCX_STALE`）。 |

三个工具都针对调用代理的会话 cwd 解析相对路径，在变更前派发 `fs/write-intent` 瀑布（观察策略插件可以提供自己的 intent），并在完成时记录 `fs/observed`——因此沙箱围栏、升权字段和写前读取策略对 docx 变更的作用与对 `write`/`edit` 完全一致。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxDocxBytes` | 64 MiB | 整个 `.docx` 文件的字节上限（读取 + ZIP 展开）。 |
| `maxMarkdownChars` | 1 000 000 | create/edit 的 Markdown 输入字符上限。 |
| `maxReadChars` | 200 000 | `docx_read` 返回的 Markdown 字符上限。 |

## 设计说明

- **提取**（`src/docx/extract.ts`）用 `fast-xml-parser` 遍历 `word/document.xml`：标题（`Heading1`–`Heading6`、`Title`）、粗体/斜体/删除线 run、通过 `word/numbering.xml` 的嵌套列表（bullet 与 decimal）、管道表格（合并单元格近似）、通过 `word/_rels/document.xml.rels` 的外部超链接，以及按计数占位的嵌入图片。不支持的构造降级为警告，绝不会失败。
- **生成**（`src/docx/generate.ts`）用 `docx` 库渲染块模型：ATX 标题、带样式的行内 run、9 级 bullet/数字编号、管道表格和 `[text](url)` 外部超链接。`parseMarkdown`（src/markdown.ts）接受提取器输出的子集，因此读 → 改 → 写往返是稳定的。
- **上限在 seam 层而非工具层强制**——整文件字节上限流入 `ctx.fs.readBytes`（`FS_TOO_LARGE` 映射为 `DOCX_TOO_LARGE`），ZIP 读取器对未压缩总量施加同一上限，因此压缩炸弹无法无界展开。
- **沙箱对等**——`src/sandbox.ts` 镜像 `dsh-tool-fs` 的升权 API（仅在受限后端下暴露 `sandbox_permissions`/`justification`，拒绝标记映射）；提取共享控制器属于延后工作（见下文）。
- **宿主文件系统契约**——`src/fs-binary.ts` 将二进制契约（`readBytes`/`writeBytes`）声明为已发布 `FileSystem` 类型的本地扩展，并在运行时守卫它。在当前 harness 树上守卫是无操作；在旧宿主机上它抛出 `DOCX_HOST_FS_UNSUPPORTED` 并指向此需求，而不是晦涩的 `fs.readBytes is not a function`。

## 模型体验

### 系统提示词

#### 模型看到什么

插件应用时注册一次下面的 `tool:docx-read` 段落：

##### docx 指南段落

```markdown
MS Word .docx files are binary (ZIP+XML) and the read tool cannot read them. Use docx_read to extract a document as Markdown (default) or structured JSON blocks, docx_create to generate a new .docx from Markdown, and docx_edit to replace a document's content from Markdown while preserving its title/author/created properties. Legacy .doc is not supported — convert it to .docx first.
```

#### Token 影响

插件挂载期间每次请求有固定的指南成本；作用域工具限制不影响该段落。

#### KV Cache 影响

在指南文本不变时前缀稳定。插件生命周期或文本变更可能从首个变更的提示词段开始使复用失效。

### 工具 schema

#### 模型看到什么

生成的 [`docx_read`、`docx_create` 和 `docx_edit` schema](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/tool-catalog.md#deepseek-aidsh-tool-docx)。字节/字符上限是部署设置而非模型参数；升权字段只在受限文件系统后端下出现。

#### Token 影响

每个挂载工具每次请求有固定的 schema 成本；配置禁用会同时移除 schema 和指南，而作用域限制只移除 schema。

#### KV Cache 影响

在定义与可见性不变时前缀稳定。配置启用、插件生命周期或作用域限制可能从首个变更的 schema token 开始使复用失效。

### 读取结果

#### 模型看到什么

成功的 `docx_read` 渲染提取的 Markdown（或美化后的 JSON 块）。截断时追加 `\n… (truncated)`；失败是带类型的消息，例如 `file not found: <path>`、`the document is encrypted (password-protected); decryption is not supported`，或旧版提示 `legacy .doc format is not supported — convert the document to .docx first`。

#### Token 影响

数据相关结果由 `maxReadChars`（或调用的 `max_chars`）限制，并在压缩前重复发送。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀，不会使既有 KV-cache 条目失效。

### 创建/编辑结果

#### 模型看到什么

成功的创建/编辑渲染一个简短的 `<path>`/`<type>docx</type>` 信封并附带字节大小——绝不返回文档正文。近似警告（图片、合并单元格、代码块）携带在规范 `warnings` 数组中并以纯文本渲染。

#### Token 影响

只有保留的调用参数（含完整 Markdown 输入）和简短结果增加 token；生成的包字节绝不进入会话日志。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀，不会使既有 KV-cache 条目失效。

### 参数错误

#### 模型看到什么

空 `file_path` 变成 `Error: file_path must be a non-empty string`；markdown 超出输入上限变成 `Error: markdown exceeds the <n>-character limit`。

#### Token 影响

只有失败的调用增加这些保留 token。

#### KV Cache 影响

仅追加；新可见内容跟随可复用请求前缀，不会使既有 KV-cache 条目失效。

## 已知限制与延后工作

- **不支持旧版 `.doc`（OLE）**——二进制 OLE 需要 LibreOffice 或 Word COM 转换；工具返回 `DOCX_LEGACY_DOC` 并提示先转换为 `.docx`。
- **不提取或嵌入图片**——`docx_read` 统计图片并输出占位符；`docx_create`/`docx_edit` 丢弃图片语法并给出警告。提取图片字节并在生成时嵌入属于延后工作。
- **往返会重新生成文档**——样式、页面设置、页眉页脚和分节符不会被保留；编辑会用默认样式重建正文，只保留 title/author/created。版式保真不是往返的目标。
- **合并单元格近似**——`gridSpan`/`vMerge` 降级为普通管道表格单元格并给出警告；脚注、尾注、文本框和分页符会被丢弃（含警告）。
- **沙箱控制器与 `dsh-tool-fs` 重复**——提取共享的 `FsSandboxController` 属于延后工作；在此之前两份拷贝必须保持同步。
- **Markdown 输入子集**——引用块、水平线、嵌套围栏和图片无法表示；它们降级为段落并给出警告（围栏代码变成代码样式段落）。

## 开发

```sh
pnpm install
pnpm typecheck   # tsc 检查 src/
pnpm build       # tsc → lib/types + tsdown → lib/index.js, lib/invariant.js
pnpm test        # vitest：单元转换测试 + 基于假 fs 的消费者测试
pnpm pack        # 生成 npm tarball（files：lib/index.js、lib/invariant.js、lib/types/**/*.d.ts）
```

结构：

- `src/docx/`——ZIP/XML 提取与 `docx` 库生成；
- `src/tools/`——三个工具注册；
- `src/fs-binary.ts`——二进制文件系统契约守卫；
- `tests/`——转换往返测试与消费者测试（使用一个小的 `ToolRuntime` 垫片，因为已发布的 `dsh-tools` 版本尚未导出该服务类）。

## 与 deepseek-harness 的关系

插件在 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 的 `packages/docx/tool-docx` 上游开发，本仓库为其独立分发镜像。此处仅有两处小的差异：

1. `src/fs-binary.ts`（宿主契约守卫）——上游 `FileSystem` 已声明 `readBytes`/`writeBytes`；
2. `tests/tool-runtime-shim.ts`——上游测试使用真实的 `ToolRuntime` 服务。

拉取上游变更时，从新的 harness 检出复制 `packages/docx/tool-docx/{src,tests,README*}`（保留 `src/fs-binary.ts` 与垫片）。

## 许可证

MIT © 2026 BroBFG。`src/sandbox.ts` 的部分内容衍生自 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，Copyright (c) 2026 DeepSeek）——见 [LICENSE](LICENSE)。
