# Work Command Center — VS Code extension

Renders WCC inside a VS Code editor tab. When the server isn't running, the
panel shows a **▶ Start WCC** button instead of a blank frame; clicking it spawns
the dev server (detached, the same way `bin/wcc-mcp.mjs` does) and swaps in the
live app once it's accepting connections.

## What it does

- **Webview panel** embeds `http://<host>:<port>` (default `127.0.0.1:7777`) in an iframe.
- **Start button** when the server is down — spawns `npm run review` detached so the
  server outlives the VS Code window. pid/log go to `<root>/.wcc`, shared with the MCP.
- **Status-bar item** (`$(server) WCC`) shows running/stopped and opens the panel.
- Polls every 3s, so an external start/stop (MCP, terminal) is reflected automatically.

## Commands

| Command | Title |
| --- | --- |
| `wcc.open` | Open the WCC panel |
| `wcc.start` / `wcc.stop` / `wcc.restart` | Control the server |
| `wcc.openExternal` | Open WCC in your browser |

## Settings

- `wcc.rootPath` — path to the WCC repo (folder with `vite.config.mjs`). Blank =
  auto-detect from open workspace folders, then the extension's own location.
- `wcc.port` — default `7777` (mirrors `WCC_PORT`).
- `wcc.host` — host used to build the URL shown in the webview (e.g. `wcc`).

## Run it

From this folder, open VS Code and press **F5** to launch an Extension
Development Host, or package + install:

```bash
cd vscode-extension
npx @vscode/vsce package      # produces work-command-center-vscode-0.1.0.vsix
code --install-extension work-command-center-vscode-0.1.0.vsix
```

Then run **WCC: Open** from the command palette.
