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

## What agents can do

- Build one project for iPhone, iPad, Android phone, and Android tablet, with
  target- and locale-specific screenshots.
- Preview and apply a screenshot directory deterministically with
  `import_screenshots`; conflicts never overwrite silently.
- Place text and devices with normalized coordinates, resize mockups, align copy,
  and rotate devices from −20° to +20°.
- Span one synchronized device across two adjacent slides. Both clipped halves
  keep their screenshot, position, scale, and rotation linked.
- Save and apply portable brand kits without carrying screenshots or project data.
- Render native store sizes, the 1024×500 Google Play feature graphic, or bounded
  custom dimensions. Custom width and height are validated together and rejected
  rather than silently replaced or clamped.
- Run the same advisory release preflight as the browser editor.
- Save a release baseline, compare added/changed/unchanged/removed assets, and
  render only changed assets.
- Round-trip editable project JSON with the Truepane web editor.

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

## Recommended agent workflow

1. Call **`list_options`** first. It returns the full capability map plus valid
   platforms, output surfaces, fonts, backgrounds, and composition presets.
2. Use **`create_project`** for slide copy and optional screenshots. Pass
   `targets` for a multi-platform project.
3. Attach target/locale media with **`set_screenshots`**, or preview a prepared
   directory with **`import_screenshots`** and explicitly apply the reviewed map.
4. Use **`set_style`** for typography, colors, backgrounds, and composition.
   With `slide_index`, composition is slide-specific; device position is normalized
   canvas space, scale is `0.4..1.6`, and rotation is `−20..20`.
   **`suggest_palette_from_screenshot`** provides a local-math starting palette.
5. Use **`span_device_across_slides`** when one linked device should cross an
   adjacent slide boundary.
6. Add localized copy and optional localized screenshots with
   **`set_translations`**. Render `language: "all"` for locale subfolders.
7. Call **`validate_project`**, then **`render`** and inspect its inline preview.
   Adjust and re-render until the set is ready.
8. Use **`export_project`** / **`load_project`** for browser-editor handoff.

## Tool map

| Goal | Tools |
|---|---|
| Create and edit content | `create_project`, `set_slides`, `set_screenshots`, `set_translations` |
| Bulk and multi-target media | `import_screenshots`, `set_screenshots` |
| Style and composition | `set_style`, `suggest_palette_from_screenshot`, `span_device_across_slides` |
| Reusable visual systems | `export_brand_kit`, `apply_brand_kit` |
| Native, feature, and custom canvases | `set_output`, `render` |
| Release safety | `validate_project`, `compare_release`, `set_release_baseline`, `render` with `changed_only` |
| Web-editor handoff | `export_project`, `load_project` |

`render` writes full-resolution PNGs and returns a compact inline preview.
Use `target: "all"` and/or `language: "all"` for the full matrix. Use
`what: "strip"` for a continuous horizontal strip.

## Fonts

Google Fonts are fetched on demand and cached in `~/.cache/truepane/fonts`
(Inter is bundled, so offline rendering works out of the box). The
`-apple-system` font renders as real San Francisco on macOS — from your own
installed system font, never bundled or redistributed — and falls back to Inter
on Linux/CI. SF is a variable font, so its full weight range resolves (including
Heavy/Black via `titleWeight`/`subtitleWeight`), not just Regular/Bold. A curated
set of Google fonts — **Inter, Manrope, and Fraunces** — is loaded as a
single-file variable font too, so their full range resolves as well; other Google
fonts use their static faces (up to ~700). Want another font's full range? Open an
issue or PR adding it to `VARIABLE_FONT_URLS` in `server/mcp/fonts.ts`. For non-Latin
target languages, pick a font that covers the script (Inter covers
Cyrillic/Greek; `Noto Sans JP/KR/SC` for CJK; `Noto Sans Arabic` for Arabic,
which is shaped and laid out right-to-left automatically) — unlike browsers,
server-side rendering has no per-glyph system-font fallback, so glyphs a font
lacks come out as boxes.

## License

[AGPL-3.0](LICENSE). Part of the Truepane project; see the
[main repository](https://github.com/antonkarliner/truepane) for the web app
and full documentation.
