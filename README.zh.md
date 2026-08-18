# dsh-tool-docx

[English](README.md) | 中文 | [Русский](README.ru.md)

面向模型的微软 Word（`.docx`）工具，用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：`docx_read` 将文档提取为 Markdown 或结构化 JSON 块，`docx_create` 从 Markdown 生成新的 `.docx`，`docx_edit` 从 Markdown 替换文档内容并保留其 title/author/created 属性。`.docx` 是 ZIP 封装的 XML 部件，因此每个工具都通过有界的 `ctx.fs.readBytes` 原语读取整个包，并通过插件的 `fsBinary` 二进制写入服务（或原生提供 `writeBytes` 的宿主 `ctx.fs`）写入包——与文本工具使用相同的原子、沙箱围栏变更，且从不替换宿主自身的文件系统。

本仓库是插件的**独立分发**。该插件是**为 DeepSeek Harness 编写的原创作品**——由本项目独立开发，最初在本地 `deepseek-harness` 检出中进行（harness 是它的运行目标），而非共享仓库中某个插件的副本。它接入 harness 的 `tools`、`fs` 与 `systemPrompt` 服务，并可针对已发布的 `@deepseek-ai/*` 包独立构建和测试，因此可以安装到任何 harness 检出中。

## 需求

- 一个文件系统 seam 提供**读取**原语 `fs.readBytes` 的 DeepSeek Harness 宿主（`0.1.0-rc.7` 线）——`readBytes` 自 `@deepseek-ai/dsh-fs@0.1.0-rc.7` 起已发布。**写入**侧（`writeBytes`）不在任何已发布的 `dsh-fs` 版本中，因此捆绑包会挂载插件的[二进制 fs 提供者](#二进制-fs-提供者)：一个独立的 `fsBinary` 服务，在不触碰 `ctx.fs` 的前提下实现 `writeBytes`（沙箱宿主下带围栏）。没有任何二进制写入器——既无 `fsBinary` 服务也无原生 `ctx.fs.writeBytes` 时——`docx_read` 仍可工作，而 `docx_create`/`docx_edit` 会以带类型的 `DOCX_HOST_FS_UNSUPPORTED` 错误失败并指明修复方式。
- harness 提供 peer 服务（`0.1.0-rc.7` 线）：`cordis`、`dsh-tools`、`dsh-fs`、`dsh-llm`、`dsh-sandbox`、`dsh-sandbox-policy`、`dsh-system-prompt`、`dsh-invariants`、`dsh-user-approval`、`dsh-session`。

## 安装

官方安装路径是 harness 自带的插件管理器——一条命令即可将包安装到配置文件，profile 启动器会自动激活捆绑包的 [`cordis.patch.yml`](cordis.patch.yml) 层（包声明了 `dsh.bundle.patch`）：

```sh
dsh plugin --profile web add github:BroBFG/dsh-tool-docx#v0.5.0
```

`dsh plugin` 会在配置文件目录内运行 pnpm，并根据已安装状态协调 `dsh.profile.bundles`，因此无需其他任何操作——不需要 `allowBuilds` 条目（包自带构建好的 `lib/`，没有 build 脚本）、不需要手工编辑 `cordis.patch.yml`、不需要 `--patch` overlay。之后重启 harness。

- **更新**：`dsh plugin --profile web update dsh-tool-docx`，或用新 tag 重新 `add`。
- **移除**：`dsh plugin --profile web remove dsh-tool-docx`。
- **本地开发**：`dsh plugin --profile web add ../dsh-tool-docx`（相对 spec 以调用目录为锚点）或 `dsh plugin --profile web add link:../dsh-tool-docx`。

> npm 发布已计划但尚未提供；包以独立名称 `dsh-tool-docx` 发布（`dsh-tool-*` 生态惯例），不依赖 `@deepseek-ai` scope。

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

## 二进制 fs 提供者

基础包的 `fs-sandbox` 行继续**原样**提供 `ctx.fs`。捆绑包在它旁边添加 docx 工具和一个二进制提供者，后者将二进制 `writeBytes` 原语注册为**独立的 `fsBinary` 服务**——宿主文件系统永远不会被替换，因此该插件不可能破坏 harness 启动；最坏情况下，没有提供者时变更类工具会报告 `DOCX_HOST_FS_UNSUPPORTED`：

- **`dsh-tool-docx/fs-binary-sandbox-plugin`**（捆绑包挂载；沙箱宿主推荐）——注册的 `fsBinary.writeBytes` 与每次沙箱变更走**相同的按调用策略围栏**：`workspace-write` 包含检查、`read-only` 拒绝、`danger-full-access` 放行、拒绝时 `FS_SANDBOX_DENIED`（在工具层映射为 `DOCX_SANDBOX_DENIED`）。
- **`dsh-tool-docx/fs-binary-local-plugin`**——注册**无围栏**的 `fsBinary.writeBytes`，用于最小环境（测试、headless 脚本）或宿主已在提供者之上围栏的场景。要改用它而不是沙箱版本，可在配置文件的 `cordis.patch.yml` 中覆盖捆绑包行：

  ```yaml
  - id: fs-binary-sandbox
    disabled: true
  - insert:
      - id: fs-binary-local
        name: dsh-tool-docx/fs-binary-local-plugin
  ```

两者都使用与 harness seam 相同的 probe → intent 守卫（`createIfAbsent` / `replaceIfVersion`）→ 原子发布流程：私有 owner-only staging 目录、fsync、然后原子发布（`createIfAbsent` 用硬链接 no-replace 原语），并按目标串行化。第一版省略 harness 的 Win32 DACL 保留仪式——替换文件继承暂存临时文件的所有者 ACL。

对于想刻意把完整后端**挂载为 `ctx.fs`**（替换 `fs-sandbox`）的宿主，包还提供提供者类 `dsh-tool-docx/fs-binary-sandbox` 与 `dsh-tool-docx/fs-binary-local`；替换行的配方仍然适用：

```yaml
- id: fs-sandbox
  disabled: true
- insert:
    - id: fs-binary-sandbox
      name: dsh-tool-docx/fs-binary-sandbox
    - id: tool-docx
      name: dsh-tool-docx
```

## 设计说明

- **提取**（`src/docx/extract.ts`）用 `fast-xml-parser` 遍历 `word/document.xml`：标题（`Heading1`–`Heading6`、`Title`）、粗体/斜体/删除线 run、通过 `word/numbering.xml` 的嵌套列表（bullet 与 decimal）、管道表格（合并单元格近似）、通过 `word/_rels/document.xml.rels` 的外部超链接，以及按计数占位的嵌入图片。不支持的构造降级为警告，绝不会失败。
- **生成**（`src/docx/generate.ts`）用 `docx` 库渲染块模型：ATX 标题、带样式的行内 run、9 级 bullet/数字编号、管道表格和 `[text](url)` 外部超链接。`parseMarkdown`（src/markdown.ts）接受提取器输出的子集，因此读 → 改 → 写往返是稳定的。
- **上限在 seam 层而非工具层强制**——整文件字节上限流入 `ctx.fs.readBytes`（`FS_TOO_LARGE` 映射为 `DOCX_TOO_LARGE`），ZIP 读取器对未压缩总量施加同一上限，因此压缩炸弹无法无界展开。
- **沙箱对等**——`src/sandbox.ts` 镜像 `dsh-tool-fs` 的升权 API（仅在受限后端下暴露 `sandbox_permissions`/`justification`，拒绝标记映射）；提取共享控制器属于延后工作（见下文）。
- **宿主文件系统契约**——`src/fs-binary.ts` 声明工具所需的二进制契约，并在调用时解析写入器：优先使用已挂载的 `fsBinary` 服务，否则使用原生提供 `writeBytes` 的宿主 `ctx.fs`。没有任何二进制写入器时，它抛出 `DOCX_HOST_FS_UNSUPPORTED` 并指明修复方式，而不是晦涩的 `fs.writeBytes is not a function`；`docx_read` 只需已发布的 `ctx.fs.readBytes`。

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

生成的 `docx_read`、`docx_create` 和 `docx_edit` schema——参数与规范输出见上方[工具](#工具)表格汇总。字节/字符上限是部署设置而非模型参数；升权字段只在受限文件系统后端下出现。

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
- `src/fs-binary.ts`——二进制文件系统契约与调用时写入器解析（`fsBinary` 服务或原生 `ctx.fs.writeBytes`）；
- `src/fs-binary-local.ts`、`src/fs-binary-sandbox.ts`、`src/fsio-bytes.ts`、`src/path-contains.ts`——二进制 fs 提供者类以及原子写入器与包含性辅助；
- `src/fs-binary-sandbox-plugin.ts`、`src/fs-binary-local-plugin.ts`——注册 `fsBinary` 服务的命名空间插件（捆绑包的默认挂载）；
- `tests/`——转换往返测试、提供者测试与针对已发布 `ToolRuntime` 服务的消费者测试（自 `dsh-tools@0.1.0-rc.7` 起导出）。

## 与 deepseek-harness 的关系

该插件是**为 DeepSeek Harness 编写的原创独立项目**——它接入 harness 的公开服务（`tools`、`fs`、`systemPrompt`），并在本地 `deepseek-harness` 检出中开发以对 harness 进行测试。它不是共享 `deepseek-harness` 仓库中某个插件的副本，也不属于该仓库；本仓库是规范的发行渠道。两点实现说明：

1. `src/fs-binary.ts`（宿主契约 + 写入器解析）——二进制 `readBytes`/`writeBytes` 契约是插件设计的一部分。`readBytes` 自 `0.1.0-rc.7` 起已发布在 harness 的 `dsh-fs` 发布线中；`writeBytes` 没有，因此[二进制 fs 提供者](#二进制-fs-提供者)以独立的 `fsBinary` 服务提供它，而不是修补宿主；
2. `tests/` 针对已发布的 `ToolRuntime` 服务运行（自 `dsh-tools@0.1.0-rc.7` 起导出），因此消费者测试走真实的注册表流水线而非本地替身。

该插件完全在本仓库中针对已发布的 `@deepseek-ai/*` 包进行开发与维护；harness 检出只是用于集成验证的运行目标，不携带本插件的副本。

## 许可证

MIT © 2026 BroBFG。`src/sandbox.ts` 的部分内容、`src/fsio-bytes.ts` 中的原子写入模式与 `src/path-contains.ts` 中的包含性逻辑衍生自 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT，Copyright (c) 2026 DeepSeek）——见 [LICENSE](LICENSE)。
