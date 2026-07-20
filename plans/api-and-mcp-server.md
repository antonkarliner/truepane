# Plan: Truepane as a pluggable service (API + MCP server)

**Goal.** Let AI agents use Truepane programmatically: an agent screenshots an app
in the simulator, hands the raw PNGs to Truepane, and gets back store-ready
framed slides — styled backgrounds, typography, and localized text — without a
human driving the browser UI.

**Status:** Phases 1–2b implemented (2026-07-19). Phase 3 (HTTP API) still deferred.

---

## 1. Where we are

The whole product is already a pure function at heart. `src/render.ts` (1,100
lines) draws everything and has exactly one DOM dependency:
`document.createElement("canvas")` at 4 call sites (plus `HTMLCanvasElement` /
`HTMLImageElement` types). No React, no `window`, no fetch. Everything else it
needs — frames, layouts, shape generators, seeded PRNG — is self-contained.

Other relevant facts:

- The app already has a serializable project document: `AppState`
  (`{ slides, settings }`, `src/types.ts`), exported/imported as JSON with
  `imageDataUrl` strings instead of live images, and healed on load by
  `normalizeBackground`. This is the natural API contract — we should not
  invent a second schema.
- AI helpers (background prompt→style, slide translation) are already
  server-side Supabase Edge Functions (`generator-bg-prompt`,
  `generator-translate`). They are reusable as-is from any client.
- Fonts load from the Google Fonts CDN at runtime via `ensureGoogleFont` /
  `FontFace` in `App.tsx` — this is browser-only and is the main porting cost.
- Deployment is Cloudflare Workers (static assets via wrangler). Workers
  **cannot** run a native canvas, which constrains where a rendering API can
  live (see §5).

## 2. Shape of the solution

Three deliverables, built in this order because each is a superset of the last:

1. **`core` — a runtime-agnostic rendering package.** `render.ts` + `types.ts`
   + `constants.ts` refactored so they run in both browser and Node. This is
   the only refactor of existing code; everything else is additive.
2. **MCP server (local, stdio).** The primary agent interface. Runs on the
   agent's machine via `npx`, renders with a native Node canvas, reads
   simulator screenshots straight off the local disk. No hosting, no auth, no
   upload of images anywhere. This covers the stated use case completely.
3. **HTTP API (optional, later).** A thin hono/express wrapper around the same
   core for remote/hosted use. Deferred until there's a concrete consumer,
   because it drags in hosting, auth, quotas, and image upload — none of which
   the simulator workflow needs.

MCP-first is the deliberate call: the described agent workflow (Claude Code /
Codex screenshotting a simulator) is local, and a stdio MCP server is both the
easiest to ship and the best UX for it (`claude mcp add truepane -- npx -y
truepane-mcp`).

## 3. Phase 1 — extract `core` (runtime-agnostic renderer)

The one refactor. Keep it surgical:

- **Canvas factory.** Replace the 4 `document.createElement("canvas")` calls
  with a module-level `createCanvas(w, h)` hook: defaults to the DOM
  implementation, overridable via a `setCanvasFactory()` export (the Node entry
  point sets it to `@napi-rs/canvas`). Type the touchpoints against a minimal
  structural interface (`{ width, height, getContext }`) instead of
  `HTMLCanvasElement` so both worlds typecheck. `drawImage` accepts
  napi-rs `Image` fine — the code only needs `width`/`height` on it.
- **Layout.** No monorepo. Move the pure modules into `src/core/`
  (`render.ts`, `types.ts`, `constants.ts` minus browser-only bits) and update
  imports in the React app. The MCP server lives in `server/` and imports from
  `src/core/` directly. Splitting into published npm workspaces can happen
  later if someone actually wants the renderer as a library.
- **Verification.** Existing vitest suite keeps passing unchanged; the browser
  app renders pixel-identical (spot-check dev server by eye, per project
  convention).

Choice of Node canvas: **`@napi-rs/canvas`** — prebuilt binaries (no
node-gyp), Skia-based so gradients/shadows/`destination-in` compositing match
the browser closely, and it ships `GlobalFonts.register` for font loading.
Fallback if fidelity problems appear: `skia-canvas`.

## 4. Phase 2 — MCP server

New code under `server/mcp/`, published to npm as `truepane-mcp` (bin entry),
using `@modelcontextprotocol/sdk` over stdio.

### State model

Agents work in multi-step sessions ("make slide 2's title bigger"), so the
server holds **named in-memory projects** (the same `AppState` JSON), plus
load/save to a project file so state survives restarts and round-trips with the
web app's Import/Export Project feature.

### Tools (first cut)

| Tool | Purpose |
|---|---|
| `create_project` | New project from platform + slide texts + screenshot **file paths** (server reads the files, stores data URLs). Returns project id + a validation summary (expected px dims per store, screenshot aspect warnings). |
| `set_screenshots` | Attach/replace screenshots on slides from local paths. |
| `set_slide_text` / `set_slides` | Edit titles/subheads, add/remove/reorder slides. |
| `set_style` | Typography + colors + background (full `Background` object or partial patch; server applies `normalizeBackground`). |
| `suggest_style_from_prompt` | Proxy to the existing `generator-bg-prompt` edge function ("warm, playful, coffee app" → style params). Optional: gated on env config, like the web app. |
| `suggest_palette_from_screenshot` | Port of `src/palette.ts` (pure math — trivially portable) so agents get accent/tint extracted from their own screenshot. |
| `translate_slides` | Proxy to `generator-translate`; stores results in `slide.translations` keyed by language code, mirroring the web app. |
| `render` | The payoff. Renders slides / strip / all languages to PNG **files** in an output dir; returns file paths + a small preview image (downscaled, as MCP image content) so the agent can look at the result and iterate. |
| `list_options` | Frames/platforms, fonts, fills, shapes, ring layouts, with px dimensions — so agents discover valid values instead of guessing. |
| `export_project` / `load_project` | Round-trip the project JSON with the web UI (a human can open the agent's project and fine-tune, or vice versa). |

Design notes:

- **Paths in, paths out.** Simulator screenshots are already on the agent's
  disk, and final PNGs are large; shuttling base64 through the model's context
  is waste. Only the deliberate small preview goes back as image content.
- **Descriptions are the UX.** Tool descriptions must teach the workflow
  (create → style → render → look at preview → adjust) and encode store
  constraints (e.g. App Store 6.9″ = 1320×2868) so agents self-correct.

### Fonts in Node

The CDN/`FontFace` path doesn't exist in Node. Approach: keep the existing
`FONT_OPTIONS` list, and at server start register locally cached TTF/OTFs via
`GlobalFonts.register`. Fetch-on-first-use from Google Fonts into a cache dir
(`~/.cache/truepane/fonts`), with the default font bundled in the package so
offline first-run still works. Custom fonts (`settings.customFont` data URL)
decode and register directly. **Open question for later:** whether to bundle a
subset of fonts vs. cache-on-demand for all — decide when picking the npm
package size budget.

### Verification

- Golden-image test: render the default project in Node, compare against a
  checked-in reference with a pixel-diff tolerance (this becomes the first
  automated visual test the project has — browser fidelity stays eyeball-only
  per current convention, but Node output regressions get caught).
- End-to-end: drive the MCP server from Claude Code against a real simulator
  screenshot; confirm the iterate loop (render → preview → tweak style →
  re-render) feels right.

## 5. Phase 3 — HTTP API (deferred)

When a hosted consumer shows up: `server/http/` wrapping the same core with
hono. Endpoints mirror the MCP tools but stateless — `POST /render` takes the
full project JSON (images as data URLs or multipart) and streams back a ZIP,
same as the web app's export. The hard part isn't code, it's operations:

- **Hosting:** native canvas won't run on Cloudflare Workers. Options, in
  order of preference: Cloudflare **Containers** (stays in the current CF
  setup), or Fly/Railway. Decide then.
- **Auth/quotas:** rendering is CPU-bound and the AI proxies cost money —
  needs at least API keys + rate limiting before any public exposure.
- AGPL note: hosted use of the renderer is exactly what AGPL is for; no
  license work needed, but the API should surface a source link.

Nothing in Phases 1–2 blocks on any of this.

## 6. Sequencing & effort

| Phase | Work | Size |
|---|---|---|
| 1 | Canvas factory, `src/core/` move, imports, tests still green | Small (~1 session) |
| 2a | MCP scaffold + project tools + `render` + fonts | Medium (2–3 sessions) |
| 2b | AI proxies, palette port, previews, golden test, npm packaging + README for agent setup | Medium |
| 3 | HTTP API | Deferred |

## 7. Open decisions (flagged, not blocking)

1. **Font distribution** — bundle vs. cache-on-demand (see §4).
2. **npm layout** — single `truepane-mcp` package importing from this repo at
   publish time, vs. proper workspaces. Start single-package; revisit if the
   core gets a second consumer.
3. **AI proxy config** — MCP server needs the edge-function URL + anon key via
   env (same `VITE_*` values, un-prefixed). Ship disabled-by-default like the
   web app, or bake in the public Truepane endpoint? Leaning: default to the
   public endpoint since it's already deployed with `verify_jwt=false` and rate
   limiting — zero-config matters a lot for agent adoption.
