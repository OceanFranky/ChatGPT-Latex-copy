# ChatGPT LaTeX Copy

一个本地运行的 Chrome 扩展测试版：在 ChatGPT 回复中鼠标选中普通文字和数学公式后，将选区复制为紧凑 Markdown + LaTeX。

例如，页面上的渲染公式会复制为：

```markdown
$$\mathrm{MSE} = \frac{1}{N} \sum_{i=1}^{N} \left(y_i-\hat{y}_i\right)^2$$
```

而不是 `∑`、上下标等视觉文本。

> 这是实验性本地扩展，不隶属于或由 OpenAI、ChatGPT 或 Google 官方发布。

## 当前能力

- 支持同一条 ChatGPT assistant 回复内的局部鼠标选区。
- 保留选中的普通文本。
- 将选区内触及的 KaTeX 公式替换为缓存的 LaTeX 源码。
- 将块级公式统一输出为单行 `$$...$$`，行内公式统一输出为 `$...$`。
- 不上传数据、不使用后端、不写入磁盘；消息内容只在当前页面内存中短暂缓存。

## 安装

1. 下载本项目 ZIP 并解压，或克隆仓库。
2. 在 Chrome 地址栏打开：

   ```text
   chrome://extensions
   ```

3. 打开右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择**本目录**（必须能看到 `manifest.json` 的目录）。
6. 打开新的 `https://chatgpt.com/` 标签页。

## 使用

1. 让 ChatGPT 生成包含数学公式的回复。
2. 在同一条 assistant 回复中拖选文字、公式，或两者组合。
3. 点击页面右下角的 **复制选中内容** 按钮。
4. 粘贴到支持 Markdown/LaTeX 的编辑器。

提示：扩展需要在页面加载前安装，因此安装、更新或刷新扩展后，请刷新 ChatGPT 标签页。

## 隐私与权限

扩展只匹配 `https://chatgpt.com/*`。

为取得公式的 LaTeX 源码，它会在页面主世界观察 ChatGPT 的相关 `fetch` / XHR 响应，并仅在浏览器内存中建立 `messageId → raw content` 缓存。它不会：

- 向任何服务器发送会话内容；
- 使用分析、广告、遥测或远程代码；
- 写入本地文件、Cookie、账号信息或浏览历史。

仍请谨慎：扩展会接触当前 ChatGPT 页面返回的会话文本。不要在未审查源码的情况下用于包含敏感信息的对话。

完整说明见 [隐私说明](docs/PRIVACY.md)。

## 已知限制

- 仅支持 ChatGPT 网页版，且只支持同一条 assistant 回复内的选区。
- 目前通过右下角按钮复制，**不会拦截普通 Ctrl+C**。
- 依赖 ChatGPT 当前 Network payload 和 DOM 结构；ChatGPT 更新后可能需要适配。
- 只在 raw message 中的公式数量与页面公式数量一致时转换，避免复制错误 LaTeX。
- 当前探针覆盖 `fetch` / XHR；如果 ChatGPT 切换到其他传输机制，可能无法捕获消息源码。

## 项目结构

```text
.
├── manifest.json           # Manifest V3 配置
├── source-probe-main.js    # MAIN world：捕获页面消息数据
├── bridge.js               # 选区映射、LaTeX 格式化与浮动复制控件
├── docs/
│   ├── ARCHITECTURE.md     # 数据流与边界说明
│   └── PRIVACY.md          # 隐私说明
└── CHANGELOG.md
```

## 开发

修改代码后：

1. 在 `chrome://extensions` 点击扩展卡片的刷新按钮。
2. 刷新 ChatGPT 页面。
3. 使用含公式的新回复回归测试：普通文本、单个公式、文字加公式、多个公式。

提交前可做基础语法检查：

```powershell
node --check .\bridge.js
node --check .\source-probe-main.js
```

## 发布到 GitHub

推荐创建一个新的 GitHub 仓库，并将本目录内容作为仓库根目录上传。对于非技术用户，可在 GitHub Releases 附上 ZIP；ZIP 解压后应直接包含 `manifest.json`，避免多嵌套一层目录。

GitHub 发布不会让扩展自动更新。用户需要下载新版本、替换本地文件，并在扩展管理页刷新扩展。
