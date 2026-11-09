<p align="center"><img src="assets/icon.png" width="140" alt="Sabir logo"></p>

<h1 align="center">Sabir</h1>
<p align="center"><b>Teach your agent any app.</b><br>Computer use, without the screenshots.</p>
<p align="center">
  <a href="https://123456789babygaminng.github.io/sabir">Website</a> ·
  <a href="https://github.com/123456789babygaminng/sabir/releases/latest">Download for Windows</a>
</p>

---

Sabir lets AI agents — **Claude, Codex, Gemini CLI and any MCP client** — use Windows apps, including apps that have no API.

Instead of taking screenshots and guessing where to click, Sabir reads an app's interface through **Windows UI Automation**, saves every function it finds (buttons, menus, text fields, switches) as a **reusable tool**, and serves those tools to your agent over **MCP**. Every agent asks you once per app (**Always allow / Allow once / Deny**), and every action lands in the **activity log**.

## Why not just computer use?

| | Computer use | Sabir |
|---|---|---|
| How it finds a button | Screenshot → look → guess pixels | Reads the UI tree, clicks the control by its automation ID |
| Screenshots per action | 1 (~1,365 image tokens at 1280×800) | 0 |
| Your mouse and screen | Taken over | Stays yours — Sabir works in the background |
| Next time | Figures the app out again | Learned once, reused by every agent |

Measured on a Windows 10 PC: learning Calculator (37 functions) took **235 ms**; typing `12 + 30 =` and reading the result took **84 ms**; writing a 7-line list into Notepad took **63 ms**. (That is Sabir's execution time — your agent still needs its own model calls to decide what to do.)

## Install

1. Download `Sabir-win-x64.zip` from the [latest release](https://github.com/123456789babygaminng/sabir/releases/latest) and unzip it anywhere.
2. Start `Sabir.exe`. It lives in the tray (click the gear icon). The build is not code-signed yet, so Windows SmartScreen may warn you — choose *More info → Run anyway*.
3. In the setup, click **Connect** for your agent. Sabir writes the MCP entry for you:
   - **Claude Code** — user-scoped HTTP server (`claude mcp add-json`), **Claude Desktop** — stdio bridge
   - **Codex** — `~/.codex/config.toml`
   - **Gemini CLI** — `~/.gemini/settings.json`
   - **Other agents** — *Copy config* gives you a ready MCP snippet
4. Restart your agent once and ask it, e.g. *"Open Notepad and write a shopping list."*

Requires Windows 10 or 11. Nothing else to install — the download is self-contained.

## MCP tools

`sabir_list_apps` · `sabir_open_app` · `sabir_learn_app` · `sabir_list_tools` · `sabir_use_tool` · `sabir_read_app` · `sabir_act` · `sabir_press_keys`

…plus one tool per learned function, e.g. `notepad__file_save`, `notepad__set_text_editor`, `calculator__equals`. New tools are announced to connected agents right away (`tools/list_changed`).

## Security

- The MCP server listens on `127.0.0.1` only and requires a random bearer token (stored in `%APPDATA%\Sabir\config.json`). Browser origins other than localhost are rejected.
- Agents need your permission per app. *Allow once* lasts until the agent disconnects; *Deny* blocks the app for that session.
- Pause stops all agent actions immediately (tray → Pause).
- Everything is logged in `%APPDATA%\Sabir\activity.jsonl`. Before Sabir edits an agent config file, it keeps a `.sabir-backup` copy.

## Build from source

```bash
npm install
npm run build:uia   # C# UI Automation helper (needs the .NET 9 SDK)
npm start           # run in development
npm run dist        # standalone build: dist/Sabir-win32-x64/Sabir.exe
```

| Part | Where |
|---|---|
| Electron main process: tray, windows, permission dialog | `main.js` |
| Screens (tray, main window, permission, setup) | `ui/` |
| UI Automation helper (C#) | `uia/Program.cs` |
| Learning, tools, permissions, log | `core/engine.js`, `core/store.js` |
| MCP server (Streamable HTTP) | `core/mcp.js` |
| stdio bridge for stdio-only MCP clients | `bridge/sabir-mcp.js` |
| Agent config writer | `core/connect.js` |

## Credits

Fonts: Cinzel, Barlow Condensed, Inter — SIL Open Font License (see `ui/fonts`). Built with Electron and .NET.

## License

[MIT](LICENSE)
