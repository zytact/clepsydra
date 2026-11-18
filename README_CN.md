<div align="center">

<img src="./icon.svg" alt="" width="112">

# Clepsydra

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的管理面板，派生自 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)。

[English](README.md) · **简体中文**

</div>

Clepsydra 在上游面板的基础上换了一套外观，并提供围绕账号池设计的额度页面。它仍然是代理直接提供的单个 `management.html` 文件，也仍然只调用 v8 管理 API（`/v8/management`）。

它适用于任意 CLIProxyAPI 8.x。额度页面的历史记录需要 [clepsydra-proxy](https://github.com/zytact/clepsydra-proxy)，这个派生版本负责记录额度历史。连接原版代理时，页面只显示当前读数，并从现在开始预测。

## 额度页面

每个提供商一张卡片，依次展示该提供商报告的全部额度窗口：Claude 的 5 小时、每周和 Fable 窗口，Codex 的 5 小时和每周窗口等。

- 每个窗口显示账号池的剩余额度“X% / Y%”、额度池与首个账号何时耗尽、下次重置，以及最近 1、3 或 6 小时的消耗。
- 图表用实线绘制已记录的历史，用虚线绘制预测。5 小时窗口显示 24 小时，更长的窗口显示两周。‹ 今天 › 用于前后移动。
- 未来用量可按“与现在相同”、“平常”（从历史中学到的每日模式）或“立即停止”预测。消耗速率视图把账号池的消耗与平常范围对比，并标出火龙和乌龟时段。
- 用完较长的全模型窗口的账号，会在该窗口重置前退出较短窗口的账号池，预测中的路由也会绕开它。
- 账号表在每行的“详情”中保留上游卡片展示的全部内容，并增加路由权重。权重仅作展示，账号池是简单求和。

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

每次推送到 `main` 都会运行 release-please。出现 `feat` 或 `fix` 提交后，它会打开一个带有下一个版本号和变更日志的发布 PR，并保持更新。合并该 PR 会打上 `v<上游版本>-clepsydra.<n>` 标签，例如 `v1.28.1-clepsydra.2`。上游版本是已合并到 `main` 的最新 `vX.Y.Z` 上游标签，`<n>` 对每个上游版本从 1 开始递增。随后 `release` 工作流构建面板，以 `management.html` 附加到发布中并发布。release-please 创建发布后几秒内发布会转回草稿，直到附件上传完成。

release-please 需要在 Settings > Actions > General 中开启 "Allow GitHub Actions to create and approve pull requests"。

如果构建失败，请手动运行 `release` 工作流并填入草稿的标签来构建并发布。只有在没有更新的发布时，重新构建的发布才会成为最新发布。

## 与上游保持接近

外观改动通过设计令牌和共享组件完成，新功能放在新文件中，因此合并 `upstream/main` 的成本很低：

```bash
git fetch upstream
git merge upstream/main
```

## 许可证

与上游相同，采用 MIT 许可证。见 [LICENSE](LICENSE)。
