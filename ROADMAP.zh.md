# dsh-tool-docx — 路线图

[English](ROADMAP.md) | [中文](ROADMAP.zh.md) | [Русский](ROADMAP.ru.md)

插件的计划演进，按价值与工作量排序。每一项都给出具体范围，贡献者无需做设计
决策即可接手。状态由仓库 issues 跟踪；本文件是目标描述，不是跟踪器。

## 近期 — 夯实基础

### 1. 发布到 npm

- 范围：以空闲名称 `dsh-tool-docx` 发布；配置 `publishConfig`/CI 发布；在
  README 中改为 `dsh plugin --profile web add dsh-tool-docx`（无需 git spec）。
- 价值：一条命令安装、真正的 semver 发布、`dsh plugin … update` 可获取发布版、
  生态可发现性。
- 工作量：小。

### 2. 跟踪上游 `fs.writeBytes`

- 范围：关注 `@deepseek-ai/dsh-fs` 的发布，看 `writeBytes` /
  `FsBytesWriteOutcome` 是否出现；一旦发布，优先使用原生 `ctx.fs.writeBytes`，
  并把 `fsBinary` 提供者（`fs-binary-sandbox-plugin` / `fs-binary-local-plugin`）
  保留为旧宿主的 fallback。
- 价值：收敛自维护的 seam；更少的自有代码；原语归 harness 所有。
- 工作量：小（主要是观察 + 一次解析器修改）。

### 3. 抽取共享的 `FsSandboxController`

- 范围：目前 `src/sandbox.ts` 镜像了 `dsh-tool-fs` 的升级 API。把公共控制器
  抽取到本包（或向上游提议为 `@deepseek-ai/dsh-fs-sandbox-controller`），使两
  份拷贝不再漂移。
- 价值：消除已记录的已知限制；沙箱升级契约有单一属主。
- 工作量：小–中。

### 4. CI 构建确定性门禁

- 范围：确认 hashed 的 `lib/*.js` 分块名称在 CI 中可复现（已有 `verify:lib`
  门禁；确认跨环境稳定，若 rolldown 分块命名依赖路径则修复）。
- 价值：发布可信；安装的包始终与提交的 `lib/` 一致。
- 工作量：小。

## 中期 — 认真对待 docx 格式

### 5. 通过 `attachments` 服务支持图片

- 范围：在 `docx_read` 中提取内嵌图片（`word/media/*`）；在
  `docx_create`/`docx_edit` 中嵌入图片。通过 harness 的 `attachments` 服务
  （`dsh-attachment-local`）保存 durable 字节，使图片跨会话存活并在生成时
  重新嵌入。
- 价值：最迫切的需求缺口；补齐含图文档的 读→改→写 闭环。
- 工作量：中。

### 6. 外科手术式 `docx_edit`

- 范围：就地编辑 `word/document.xml`，而不是重新生成整个包，从而保留样式、
  页眉页脚、页面设置与分节。当前重新生成路径保留为复杂重写的 fallback。
- 价值：round-trip 不再有损——这是当前最关键的质量缺口。
- 工作量：中–大（XML 手术 + 细致的 round-trip 测试）。

### 7. 表格、脚注、分页符

- 范围：双向完整支持合并单元格（`gridSpan`/`vMerge`）、脚注/尾注、分页符——
  取代当前的近似实现。
- 价值：专业文档无损 round-trip。
- 工作量：中（可按特性拆分）。

### 8. 更宽的 Markdown 子集

- 范围：引用块、水平线、嵌套围栏代码块、图片（依赖第 5 项）。
- 价值：消除降级警告；与提取侧一致。
- 工作量：小–中。

## 远期 — 文档家族

### 9. 旧版 `.doc` 转换

- 范围：可选转换器，通过 LibreOffice headless 或 Windows 上的 Word COM，以
  显式要求（已安装 LibreOffice/Word）为门槛；`docx_read` 对 `.doc` 可透明转
  换，而不再报 `DOCX_LEGACY_DOC`。
- 价值：补齐 Word 文档的最后格式缺口。
- 工作量：中。

### 10. 兄弟工具 — `dsh-tool-xlsx`、`dsh-tool-pptx`

- 范围：复用架构（通过 `fsBinary` 服务的有界二进制读取、块模型、官方
  `dsh plugin` 安装、针对已发布包的测试）做电子表格与演示文稿。先 Excel
  （需求更高）；PowerPoint 其次。
- 价值：把插件变成 harness 的办公套件。
- 工作量：每个格式都很大。

### 11. PDF 文本提取

- 范围：只读文本提取（无回写）；像 docx 读取器一样有界。
- 价值：覆盖常见引用格式。
- 工作量：中；优先级低于办公格式。

### 12. 独立转换器库

- 范围：把 `docx ↔ Markdown` 转换核心抽成不依赖 harness 的 npm 包
  （`docx-markdown` 或类似），插件作为薄封装。
- 价值：可在 DSH 之外使用；独立 CI；更广的贡献者基础。
- 工作量：中（主要是打包 + 文档）。

### 13. 生态模板

- 范围：把本插件整理成「如何构建 dsh-tool-* 插件」的参考（官方安装、独立
  服务而非替换主机、针对已发布包的测试）——文档或技能。
- 价值：降低下一个插件的门槛；标准化生态。
- 工作量：小。

## 诚实说明的限制

- 高保真 round-trip（样式、页眉页脚、分节）约为插件当前规模的一半新代码；
  外科手术式编辑（第 6 项）是正确第一步，而不是从零重写 writer。
- 加密（带密码）docx 需要 OLE/CryptoAPI 解密依赖——延后，低优先级。
- tsx 源码运行下的错误码限制（见 README「已知限制」）是 harness 侧的修复
  （tsx 下 junction 规范化）。本插件记录并跟踪上游 issue；built-bin 模式不受
  影响。

## 建议顺序

1. npm 发布 + 跟踪上游 `writeBytes` — 小工作量，大效果。
2. 通过 `attachments` 支持图片 — 中工作量，高需求。
3. 外科手术式 `docx_edit` — 中–大工作量，关键质量提升。
4. `dsh-tool-xlsx` — 下一个家族成员。
