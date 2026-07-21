# truepane-mcp

A local [MCP](https://modelcontextprotocol.io) server for
[Truepane](https://github.com/antonkarliner/truepane). It lets an AI agent
(Claude Code, Codex, …) take raw app screenshots — e.g. captured from a
simulator — and turn them into store-ready App Store / Google Play slides:
procedural device frames at exact store resolutions, generated backgrounds,
typography, and per-language localization.

Everything runs locally. It renders with a native canvas
(`@napi-rs/canvas`): screenshots are read from local file paths and PNGs are
written to local file paths — nothing is uploaded anywhere. **No configuration
or API keys are needed.** The agent is itself the language model, so styling and
translation are its own judgment calls.

## Install

It's a standard stdio MCP server — any MCP-capable client can launch it with
`npx -y truepane-mcp` (no checkout required). Requires Node ≥ 18.

**Claude Code**

```sh
claude mcp add truepane -- npx -y truepane-mcp
```

**Codex CLI** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.truepane]
command = "npx"
args = ["-y", "truepane-mcp"]
```

**Cursor, Windsurf, Claude Desktop, and other JSON-config clients** — add to the
client's `mcpServers` block:

```json
{
  "mcpServers": {
    "truepane": { "command": "npx", "args": ["-y", "truepane-mcp"] }
  }
}
```

## Workflow the tools expect

1. **`list_options`** — discover platforms (with exact store pixel sizes),
   fonts, background fills, and shapes.
2. **`create_project`** — slide titles/subheads plus absolute screenshot file
   paths.
3. **`set_style`** — colors, background, and typography (font,
   `titleScale`/`subtitleScale`, `titleWeight`/`subtitleWeight` from 100–900),
   chosen with the agent's own design judgment. `suggest_palette_from_screenshot`
   extracts an accent + background tint from a screenshot with pure local math if
   a starting point helps.
4. **`render`** — writes full-resolution PNGs (e.g. iPhone 6.9″ = 1320×2868)
   into an output directory you pass, and returns a small inline preview to
   inspect. Adjust and re-render until it looks right.
5. **`set_translations`** — the agent translates the slide texts itself and
   stores the results per language; then `render` with `language: "all"` writes
   per-language subfolders (`source/`, `es/`, …). A locale can also carry its
   own screenshots (for localized app UIs) via `screenshot_path` here or
   `set_screenshots` with a `language`; locales without one reuse the base. Each
   language can also render in its own font (`font` here, or `set_style` with a
   `language`) — e.g. SF for the base, `Noto Sans Arabic` for `ar`.
6. **`export_project`** / **`load_project`** — round-trip the project JSON with
   the Truepane web app's Import/Export Project, so a human can fine-tune the
   agent's work (or vice versa).

## Fonts

Google Fonts are fetched on demand and cached in `~/.cache/truepane/fonts`
(Inter is bundled, so offline rendering works out of the box). The
`-apple-system` font renders as real San Francisco on macOS — from your own
installed system font, never bundled or redistributed — and falls back to Inter
on Linux/CI. For non-Latin
target languages, pick a font that covers the script (Inter covers
Cyrillic/Greek; `Noto Sans JP/KR/SC` for CJK; `Noto Sans Arabic` for Arabic,
which is shaped and laid out right-to-left automatically) — unlike browsers,
server-side rendering has no per-glyph system-font fallback, so glyphs a font
lacks come out as boxes.

## License

[AGPL-3.0](LICENSE). Part of the Truepane project; see the
[main repository](https://github.com/antonkarliner/truepane) for the web app
and full documentation.
