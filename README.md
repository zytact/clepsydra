<div align="center">

<img src="./icon.svg" alt="" width="112">

# Clepsydra

A management panel for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), forked from [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center).

**English** · [简体中文](README_CN.md)

</div>

Clepsydra is the upstream panel with a different look and a quota page built around pooled accounts. It still ships as one `management.html` file that the proxy serves, and it still talks only to the v8 Management API (`/v8/management`).

It works with any CLIProxyAPI 8.x. The quota page's recorded history needs [clepsydra-proxy](https://github.com/zytact/clepsydra-proxy), the fork that records it. Against a stock proxy the page shows the current readings and projects from now.

## Use it

The short way is [clepsydra-proxy](https://github.com/zytact/clepsydra-proxy#set-up). It serves this panel by default, so its set up steps are all you need.

On a stock CLIProxyAPI, point the proxy at this repository's releases in its `config.yaml`:

```yaml
management:
  panel-github-repository: "https://github.com/zytact/clepsydra"
```

The proxy then downloads `management.html` from the latest release here, checks it against the sha256 digest GitHub publishes for the asset, and serves it at `http://<host>:<port>/management.html`.

## Develop

**Bun 1.4.3** and Node.js 24.

```bash
bun install --frozen-lockfile
bun run dev        # Vite on http://localhost:5173, log in to any v8 proxy
bun run verify     # tests, lint and the production build
```

`bun run build` writes a single `dist/index.html` with every script, style, font and icon inlined.

`.agents/skills/verify-clepsydra/` drives the panel in a headless browser against a live proxy, for agents that need to prove a change works.

## Release

Push a tag shaped like `v<upstream version>-clepsydra.<n>`, for example `v1.28.1-clepsydra.1`. The `Build and Release` workflow builds the panel, renames it to `management.html`, and attaches it to a GitHub release with the commit list as notes.

## Staying close to upstream

Restyling goes through the design tokens and the shared components, and new features live in new files, so merging `upstream/main` stays cheap:

```bash
git fetch upstream
git merge upstream/main
```

## License

MIT, as upstream. See [LICENSE](LICENSE).
