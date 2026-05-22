# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Truepane is a single-page browser app that generates App Store / Google Play screenshot strips. The user fills in per-slide title/subhead text, drops in app screenshots, picks typography and a generated background, then exports individual slide PNGs, a single horizontal strip, or a ZIP. All work is rendered to `<canvas>` and persists to `localStorage` (key `appstore-generator-v1`). The only backend is an optional Supabase Edge Function powering the AI prompt→style helper (Groq); without it the app is fully functional. It originated as an internal tool for Timer.Coffee and is being modernized and open-sourced (AGPL-3.0); see `README.md` and the migration plan for the broader direction.

## Running it

Stack: **Vite + React 18 + TypeScript.** Dependencies are installed via npm (`react`, `react-dom`, `jszip`); Google Fonts still load from the CDN at runtime. There is no server — it builds to a static site.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve the production build
npm run typecheck  # tsc -b --noEmit
npm test           # vitest (pure-logic suite)
```

`npm test` covers only pure logic (text wrapping, ring-layout resolution, the concentric-corner invariant). There is **no automated visual/pixel test** — frame correctness is still verified by eye. After a change, run the dev server and exercise the feature in the browser.

## Architecture

`index.html` is the Vite entry point; it loads `src/main.tsx`, which mounts `<App/>` (React 18 `createRoot`, `StrictMode`). Modules are wired with normal ESM `import`/`export` — there is no `window`-global wiring anymore. Shared constants live in `src/constants.ts` and shared types in `src/types.ts`.

- **`src/render.ts`** — the rendering engine. Pure canvas drawing, no React. This is where all pixels come from.
  - Four procedural frames in `FRAMES` (iPhone 6.9″, iPad 13″, Android phone, Android tablet), each defining body/bezel/screen geometry, camera (Dynamic Island vs hole-punch), side buttons, colors, and text metrics. New frames are built with the `shell()` helper, which derives concentric BEZEL/SCREEN rects from a BODY rect + insets.
  - **Concentric-corner invariant:** BODY/BEZEL/SCREEN rounded rects must share a center of curvature (`x + r` equal across all three, same for `y + r`). Breaking it produces "laddery" corner kinks. `defineFrame()` asserts this at definition time and throws on violation, so every frame must be created through it.
  - **Backgrounds render in two layers:** a *fill* (`solid` / `linear` / `radial` gradient, using `color` → `gradientColor`) is painted first, then an optional *shape* overlay (`SHAPE_GENERATORS`: rings, blobs, waves, dots, mesh, arcs, triangles, grid, zigzag, bubbles) is drawn on top in the `accent` color. Shape generators do **not** fill the background themselves; each lays out in strip-space (cx in slide-units) so it flows continuously across the strip and uses the seeded `mulberry32` PRNG for reproducibility. `RING_LAYOUTS` holds the named ring arrangements (calm, drift, bookends, …).
  - Public API (named exports): `paintSlide`, `paintStrip`, `dimFor`, `getFrame`, `getLayout`, `wrapText`, `defineFrame`, `mulberry32`, plus `RING_LAYOUTS`, `SHAPE_FAMILIES`, `FILL_OPTIONS`, `PLATFORMS`. Masking uses offscreen canvases with `destination-in`/`destination-out` rather than `ctx.clip()` to get antialiased edges.

- **`src/App.tsx`** — `App`, the single source of truth for state. Holds `{ slides, settings }`, all mutators (add/delete/move slide, update settings/background), localStorage persistence, font loading, and every export path (PNG / strip / ZIP / JSON project import-export).

- **`src/constants.ts`** — `DEFAULT_SLIDES`, `FONT_OPTIONS` (Google Fonts loaded on demand via `ensureGoogleFont` in `App.tsx`), `BG_PRESETS`, `STORAGE_KEY`, and `defaultState()`.

- **`src/Sidebar.tsx`** — `Sidebar`, the entire left-hand control panel (platform, per-slide text, screenshot drop, typography, background, export buttons). Pure presentation; receives all state and callbacks as props from `App`.

- **`src/components.tsx`** — reusable pieces: `SlidePreview` (renders a slide to a scaled canvas; also samples a pixel for the eyedropper fallback when in eyedrop mode), `ImageDrop`, and atomic controls (`Field`, `TextInput`, `Segmented`, `ColorRow` (with a native/​fallback eyedropper button), `LayoutSlider`).

- **`src/palette.ts`** — client-side palette extraction (downscale screenshot → quantize → dominant accent + soft tint). No AI.

- **`src/ai.ts`** — client for the optional AI prompt→style endpoint. Gated on `VITE_BG_PROMPT_URL`; reads `VITE_SUPABASE_ANON_KEY`. The app hides the feature when unset. The endpoint still returns a single `pattern`, which `ai.ts` maps to the `fill` + `shape` split.

- **`src/Gate.tsx`** — optional temporary beta password gate wrapping `<App/>` in `main.tsx`. Active only when `VITE_GATE_PASSWORD_HASH` (SHA-256 of the password) is set; otherwise renders the app directly. Soft client-side gate — remove after beta.

- **`supabase/functions/generator-bg-prompt/`** — self-contained Deno Edge Function: prompt → Groq (`GROQ_API_KEY`, model via `BG_PROMPT_MODEL`) → **validated/clamped** style params. Deployed with `verify_jwt=false`; best-effort in-memory rate limiting. Deploy via the Supabase CLI (`supabase functions deploy generator-bg-prompt --project-ref <ref> --no-verify-jwt`).

### State & persistence detail

Slides carry both a live `image` (an `HTMLImageElement`, not serializable) and an `imageDataUrl` (a base64 string that is). Only `imageDataUrl` is persisted; on load, `hydrateImages` rebuilds the `HTMLImageElement`s from the data URLs. When adding any image-bearing state, keep this split or images won't survive a reload. Custom uploaded fonts are stored as a data URL in `settings.customFont` and re-registered via `FontFace` on load.

The background model is `{ fill, shape, color, gradientColor, accent, accentOpacity, ringLayout, ringCount, seed, density, dotsAligned, gradientAngle }`. `normalizeBackground` (in `App.tsx`) deep-merges a loaded/imported background onto current defaults and migrates the legacy single `pattern` field to `fill` + `shape`, so older saved projects keep working.

### Throwaway HTML helpers

For two recurring tasks, a one-off HTML file in the browser beats editing-and-reloading: (1) comparing the versioned `exports*/` runs side by side to judge a visual change, and (2) tuning the hand-set constants in `src/render.ts` (frame geometry, `RING_LAYOUTS`) via live sliders. Generate these as disposable scratch artifacts that end with an "export as JSON" / "copy values" button — don't wire them into the app.

## `misc/`

Not part of the running app, and gitignored (excluded from the published repo). Contains: `legacy/` (the pre-migration build-free prototype — original `generator/*.jsx` + `render.js` and `App Store Generator.html`, kept for reference), an earlier standalone prototype (`App Store Strip.html` + `fonts.css` + `fonts/`), plus generated output and reference imagery: `exports*/` (versioned export runs), `screens/` (source app screenshots), and `uploads/`. Safe to ignore when working on the generator itself.

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.
