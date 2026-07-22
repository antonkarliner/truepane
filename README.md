# Truepane

**Truepane** is a small, fast, browser-based app screenshot generator for the App Store
and Google Play — title + subhead text, a device frame, your screenshot, and a generated
background, exported as individual PNGs, a horizontal strip, or a ZIP.

Everything renders to `<canvas>` in the browser. Screenshots stay on your machine.
Optional AI helpers send only the text you ask them to process (and, when supplied,
your Groq API key) to the configured Edge Function and model provider. Google Fonts
are also loaded from Google's CDN unless you use a system or uploaded font.

## Why this exists

Most screenshot generators composite a pre-rendered PNG of a phone. This one **draws
the device frame procedurally** on a canvas — body, bezel, buttons, camera, and the
screen mask are all geometry, not bitmaps. That choice drives most of what makes the
tool small, sharp, and cheap to run.

## Features

- **Procedural device frames** at exact store sizes: iPhone 6.9″ (1320×2868), iPad 13″
  (2064×2752), Android phone (1080×2400), Android tablet (1600×2560).
- **Backgrounds = fill + shape.** A fill layer (solid, or linear/radial gradient) plus an
  optional shape overlay (rings, blobs, waves, dots, mesh, arcs, triangles, grid, zigzag,
  bubbles), each with independent colors. Shapes flow continuously across the strip and
  reproduce exactly from a stored seed.
- **Color tools**: content-based palette extraction from your screenshot, harmonized shape
  suggestions, an eyedropper (native EyeDropper API + a click-a-slide fallback for
  Safari/Firefox), and curated color-science presets.
- **AI prompt → style** (optional): describe a vibe ("calm, warm, organic") and a Groq
  model returns a style + palette. Bring your own Groq key, or use the hosted endpoint.
- **Typography**: curated Google Fonts (incl. Apple/Android system fonts and Noto
  multi-script + CJK) plus custom `.ttf/.otf/.woff(2)` upload.
- **Export**: per-slide PNG, one horizontal strip PNG, or a ZIP of everything. Plus JSON
  project import/export. State auto-saves to `localStorage`.

## Design decisions (the interesting part)

Each of these was a deliberate fork, chosen for a reason:

- **Procedural frames, not image mockups.** The target is *flat store-submission*
  screenshots at exact required resolutions — which procedural drawing nails: crisp at
  any scale, no asset pipeline, and **no licensing exposure** (most "free" device-mockup
  packs are not actually clean for commercial redistribution). The trade-off we accept:
  no angled/perspective marketing shots.
- **Parametric backgrounds, not diffusion images.** Backgrounds are seeded procedural
  shapes that reproduce exactly and stay tasteful. A raster image model would be
  unpredictable, costly per call, hard to keep consistent across a set, and would force a
  heavier backend. AI is used only as a thin **prompt → parameters** layer.
- **Content-based palette** runs entirely client-side — no model, no cost.
- **$0-egress architecture.** The app is static and all image work happens in the
  browser, so hosting bandwidth is effectively free. The only metered cost is the
  optional AI prompt call, which is rate-limited and can be replaced with your own key.

## Architecture

- **`src/render.ts`** — the rendering engine. Pure canvas drawing, no React. Defines the
  device frames and paints every pixel.
  - **Concentric-corner invariant:** the BODY / BEZEL / SCREEN rounded rects share a
    center of curvature (`x + r` equal across all three; same for `y + r`). Breaking it
    produces "laddery" corner kinks. New frames go through `defineFrame()`, which throws
    on violation; the `shell()` helper derives the inner rects so the invariant holds by
    construction.
  - Backgrounds render in two layers: a **fill** (solid / linear / radial gradient) then an
    optional **shape** overlay from a generator registry. Each shape lays out in strip-space
    so it flows across slides; a seeded `mulberry32` PRNG keeps a strip reproducible.
  - Masking uses offscreen canvases with `destination-in` / `destination-out` (rather
    than `ctx.clip()`) to get antialiased edges.
- **`src/App.tsx`** — single source of truth for `{ slides, settings }`, persistence
  (`localStorage`), font loading, and all export paths.
- **`src/Sidebar.tsx`** — the control panel. **`src/components.tsx`** — reusable controls
  and the slide preview. **`src/palette.ts`** — screenshot palette extraction.
  **`src/ai.ts`** — client for the AI endpoint.
- **`supabase/functions/generator-bg-prompt/`** — the Edge Function that turns a prompt
  into validated, clamped style params (raw model output never reaches the renderer).

## Running locally

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve the production build
npm run typecheck
npm test           # vitest (pure-logic suite)
```

## Configuration

The AI prompt feature is optional. Without it, the app is fully functional and the
AI controls are hidden. To enable them, copy `.env.example` to `.env` and opt in:

```
VITE_ENABLE_AI=true
VITE_BG_PROMPT_URL=https://YOUR-PROJECT.supabase.co/functions/v1/generator-bg-prompt
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The Edge Function reads `GROQ_API_KEY` from its Supabase secrets (and an optional
`BG_PROMPT_MODEL`, default `llama-3.3-70b-versatile`). Deploy it with:

```sh
supabase functions deploy generator-bg-prompt --project-ref YOUR-REF --no-verify-jwt
```

Server-side rate limiting is currently best-effort (in-memory, per isolate). Add a
durable limiter before a high-traffic public launch.

### Temporary beta gate

A soft, client-side password gate can be enabled during private beta by setting
`VITE_GATE_PASSWORD_HASH` to the SHA-256 of your password (unset = no gate):

```sh
printf '%s' 'your-password' | shasum -a 256   # put the hash in .env
```

It's a deterrent, not real security (it's a static client app) — meant to be removed
after beta.

## Use with AI agents (MCP)

Truepane ships a local [MCP](https://modelcontextprotocol.io) server, so an AI agent
(Claude Code, Codex, …) can take simulator screenshots and turn them into store-ready
slides without a human driving the browser UI. It renders with a native canvas
(`@napi-rs/canvas`) — screenshots are read from local paths and PNGs are written to
local paths; nothing is uploaded anywhere, and no configuration or env vars are
needed: the agent is the LLM, so styling and translation are its own judgment calls
(the web app's AI helpers are not involved).

It's a standard stdio MCP server published to npm as
[`truepane-mcp`](https://www.npmjs.com/package/truepane-mcp), so any MCP-capable
client can launch it with `npx -y truepane-mcp` — no checkout needed. Setup for
the common ones:

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
client's `mcpServers` block (e.g. `.cursor/mcp.json`,
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "truepane": { "command": "npx", "args": ["-y", "truepane-mcp"] }
  }
}
```

The server lives in [`packages/truepane-mcp`](packages/truepane-mcp). To run it
from a repo checkout instead (for development), point the client's command at
`npx tsx server/mcp/index.ts`, or `npm run mcp:build` and run
`node packages/truepane-mcp/dist/index.js`.

### Workflow the tools expect

1. `list_options` — discover platforms (with exact store pixel sizes), fonts, fills,
   shapes.
2. `create_project` — slide titles/subheads + absolute screenshot file paths.
3. `set_style` — colors, background, typography (font, `titleScale`/`subtitleScale`,
   and `titleWeight`/`subtitleWeight` from 100–900), chosen with the agent's own
   design judgment (`suggest_palette_from_screenshot` extracts an accent + background
   tint from a screenshot with pure local math if a starting point helps).
4. `render` — writes full-resolution PNGs (e.g. iPhone 6.9″ = 1320×2868) into an
   output dir you pass, and returns a small inline preview to inspect. Adjust and
   re-render until it looks right.
5. `set_translations` — the agent translates the slide texts itself and stores the
   results per language; then `render` with `language: "all"` writes per-language
   subfolders (`source/`, `es/`, …), matching the web app's all-languages ZIP. A
   locale can also carry its **own screenshots** (for apps whose UI is itself
   localized): pass `screenshot_path` per slide here, or `set_screenshots` with a
   `language`; a locale without its own screenshot reuses the base one. Each
   language can render in its **own font** too (`font` here, or `set_style` with a
   `language`) — e.g. San Francisco for the base and `Noto Sans Arabic` for `ar` —
   since the server has no per-glyph fallback for scripts a font doesn't cover.
6. `export_project` / `load_project` — round-trip the project JSON with the web
   app's Import/Export Project, so a human can fine-tune the agent's work (or vice
   versa).

Google Fonts are fetched on demand and cached in `~/.cache/truepane/fonts` (Inter is
bundled, so offline rendering works out of the box). The `-apple-system` font renders
as real San Francisco on macOS — from your own installed system font, which is never
bundled or redistributed (Apple's font is proprietary) — and falls back to Inter on
Linux/CI. Because SF is a variable font, its full weight range resolves (including
Heavy/Black via `titleWeight`/`subtitleWeight`), not just Regular/Bold. A curated set
of Google fonts — **Inter, Manrope, and Fraunces** — is loaded as a single-file
variable font too, so their full weight range resolves as well; every other Google
font uses its static faces (typically up to 700). Want another font's full range?
Open an issue or PR adding it to `VARIABLE_FONT_URLS` in `server/mcp/fonts.ts`. For
non-Latin target languages,
pick a font that covers the script (Inter covers Cyrillic/Greek; `Noto Sans JP/KR/SC`
for CJK; `Noto Sans Arabic` for Arabic, which is shaped and laid out right-to-left
automatically) — unlike browsers, server-side rendering has no per-glyph system-font
fallback, so glyphs a font lacks come out as boxes.

## Deployment

Builds to a static site in `dist/` — deploy anywhere. **Cloudflare Pages** is recommended
(unlimited bandwidth on the free tier, so egress stays $0): build command `npm run build`,
output directory `dist`. Set the two `VITE_*` variables in the Pages project to enable AI.

## License

[AGPL-3.0](LICENSE). Because this is a client-side app, the source is distributed to
every browser — so forks, **including publicly hosted ones**, must make their source
available under the same license.

The Inter font files bundled with `truepane-mcp` are distributed under the SIL Open
Font License 1.1; the copyright notice and license travel with them in
`server/mcp/assets/fonts/LICENSE-Inter.txt` and in the published npm package.

## Support

If this is useful to you, sponsorship is welcome — see [`.github/FUNDING.yml`](.github/FUNDING.yml).
