# ChatGPT LaTeX Copy

让 ChatGPT 的数学公式像 Gemini 一样，更容易复制到语雀、Obsidian、Typora 等支持 LaTeX Markdown 的编辑器中。

ChatGPT 中用鼠标直接复制公式时，往往得到的是 `∑`、上下标等视觉文本，粘贴后无法继续作为公式编辑。本扩展会把你选中的 ChatGPT 内容转换为编辑器友好的 LaTeX Markdown：

```markdown
$$\mathrm{MSE} = \frac{1}{N}\sum_{i=1}^{N}\left(y_i-\hat{y}_i\right)^2$$
```

你可以将结果粘贴到支持数学 Markdown 的编辑器中，让编辑器将其识别或渲染为正常公式。


## 适合谁

如果你会在 ChatGPT 阅读数学、物理、机器学习或科研公式，并希望把内容继续写进语雀、笔记软件或 Markdown 文档，这个扩展就是为这个场景设计的。

## 它做什么

- 在一条 ChatGPT 回复内选中普通文字、公式，或两者组合。
- 保留选中的文字。
- 将选中的渲染公式转换为 LaTeX Markdown。
- 自动移除公式旁可能被选区带出的重复视觉文本。
- 为兼容语雀的公式转换，所有公式统一输出为块级 `$$...$$`。
- 不上传对话内容；处理仅在你的浏览器当前页面内完成。

## 浏览器支持

- **Google Chrome：已支持。**
- **Microsoft Edge：已支持，安装方式与 Chrome 基本相同。**
- Brave、Vivaldi、Opera 等 Chromium 浏览器：理论上可加载，但尚未逐一测试。
- Firefox、Safari：暂未支持。

## 安装：Google Chrome

1. 下载本项目 ZIP 并解压，或克隆仓库。
2. 在 Chrome 地址栏输入并打开：

   ```text
   chrome://extensions
   ```

3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目目录，也就是能看到 `manifest.json` 的文件夹。
6. 刷新已打开的 ChatGPT 页面，或新开一个 `https://chatgpt.com/` 标签页。

扩展目录应为：

```text
ChatGPT-Latex-copy
├── manifest.json
├── bridge.js
└── source-probe-main.js
```

不要选择外层 ZIP 文件，也不要选择只包含项目的上级文件夹。

## 安装：Microsoft Edge

1. 下载本项目 ZIP 并解压，或克隆仓库。
2. 在 Edge 地址栏输入并打开：

   ```text
   edge://extensions
   ```

3. 打开页面左下角的“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择包含 `manifest.json` 的 `chatgpt-math-source-poc` 文件夹。
6. 打开或刷新 `https://chatgpt.com/`。
7. 进入一条含公式的回复，按下面的“怎么使用”步骤测试。


## 怎么使用

1. 让 ChatGPT 生成包含数学公式的回复，等待生成完成。
2. 用鼠标在**同一条 assistant 回复内**拖选需要的文字和/或公式。
3. 点击右下角的 **复制选中内容** 按钮。
4. 将结果粘贴到语雀或其他支持 LaTeX Markdown 的编辑器。

更新本地扩展文件后，需要在扩展管理页重新加载扩展，再刷新已经打开的 ChatGPT 标签页一次，才能运行新版本。按钮第二行会显示版本号。日常生成新回复不应依赖逐条刷新；v1.4.0 增加了 SSE 分段拼接和现有 WebSocket 消息监听，具体兼容性仍取决于 ChatGPT 当前的消息格式。

如果提示未捕获源码或公式数量未对齐，打开 Console，找到 `[ChatGPT Math Probe] copy blocked` 并展开。反馈时提供这一条诊断：它包含所选消息 ID、页面/源码公式数量和采集状态，比单独的 `raw-message candidate` 更能定位问题。公开反馈时可遮住消息 ID。


## 关于语雀和其他编辑器

`$...$`（行内公式）与 `$$...$$`（块级公式）是许多支持数学 Markdown 的编辑器使用的常见约定。

不同编辑器的粘贴行为不完全相同：有的会立即渲染，有的会在按空格、确认输入或切换编辑状态后转换，也有的完全不支持 LaTeX Markdown。本扩展保证输出可移植的 LaTeX Markdown，不保证每个编辑器都自动转换。

## 已知限制

- 仅支持 ChatGPT 网页版。
- 选区必须位于同一条 assistant 回复内。
- 当前通过右下角按钮复制，尚未接管普通 `Ctrl+C`。
- ChatGPT 更新页面 DOM 或消息传输格式后，扩展可能需要更新。
- 为避免复制错误的公式，只有页面公式数量与捕获到的源码数量一致时才会转换。

## 隐私

扩展只在 `https://chatgpt.com/*` 运行。它会在浏览器内存中暂存当前页面所需的消息源码，以恢复公式 LaTeX；不会上传、出售、共享或持久保存 ChatGPT 对话内容。

详情请查看 [隐私说明](docs/PRIVACY.md)。

## 开发与反馈

安装 Node.js 后，在项目目录运行 `node --test tests/*.test.cjs`，可验证历史消息、流式消息、WebSocket 分流和复制保护逻辑。测试使用本地模拟数据，不会向 ChatGPT 发消息。

欢迎提交 issue，附上：

- ChatGPT 页面中公式的截图；
- 你选中的范围；
- 实际复制结果；
- 目标编辑器及其版本；
- 期望得到的 Markdown/LaTeX。

请勿在 issue 中贴出敏感对话、Cookie、令牌或个人信息。

## 项目结构

```text
.
├── manifest.json           # Manifest V3 配置
├── source-probe-main.js    # 捕获 ChatGPT 页面中的消息源码
├── bridge.js               # 选区转换、LaTeX 格式化与复制控件
├── docs/
│   ├── ARCHITECTURE.md     # 技术架构
│   └── PRIVACY.md          # 隐私说明
└── CHANGELOG.md
```
