<div align="center">

<img src="./icon.svg" alt="" width="112">

# Clepsydra

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的管理面板，派生自 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)。

[English](README.md) · **简体中文**

</div>

Clepsydra 在上游面板的基础上换了一套外观，并提供围绕账号池设计的额度页面。它仍然是代理直接提供的单个 `management.html` 文件，也仍然只调用 v8 管理 API（`/v8/management`）。

它适用于任意 CLIProxyAPI 8.x。额度页面的历史记录需要 [clepsydra-proxy](https://github.com/zytact/clepsydra-proxy)，这个派生版本负责记录额度历史。连接原版代理时，页面只显示当前读数，并从现在开始预测。

## 使用

最简单的方式是使用 [clepsydra-proxy](https://github.com/zytact/clepsydra-proxy#set-up)。它默认提供本面板，按它的安装步骤操作即可。

使用原版 CLIProxyAPI 时，在代理的 `config.yaml` 中指向本仓库的发布：

```yaml
management:
  panel-github-repository: "https://github.com/zytact/clepsydra"
```

代理随后会从这里的最新发布下载 `management.html`，用 GitHub 为该附件公布的 sha256 摘要校验，然后在 `http://<host>:<port>/management.html` 提供它。

## 开发

**Bun 1.4.3** 与 Node.js 24。

```bash
bun install --frozen-lockfile
bun run dev        # Vite 运行在 http://localhost:5173，可登录任意 v8 代理
bun run verify     # 测试、lint 与生产构建
```

`bun run build` 生成单个 `dist/index.html`，所有脚本、样式、字体和图标都已内联。

`.agents/skills/verify-clepsydra/` 用无头浏览器连接真实代理驱动面板，供需要证明改动有效的代理工具使用。

## 发布

推送形如 `v<上游版本>-clepsydra.<n>` 的标签，例如 `v1.28.1-clepsydra.1`。`Build and Release` 工作流会构建面板，改名为 `management.html`，并以提交列表作为说明附加到 GitHub 发布中。

## 与上游保持接近

外观改动通过设计令牌和共享组件完成，新功能放在新文件中，因此合并 `upstream/main` 的成本很低：

```bash
git fetch upstream
git merge upstream/main
```

## 许可证

与上游相同，采用 MIT 许可证。见 [LICENSE](LICENSE)。
