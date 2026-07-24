# Create App Store screenshots with Codex or Claude Code

App Store screenshots tend to become a release-night chore: collect simulator captures, place them in device frames, write the captions, repeat the work for every platform and language, and export everything at the correct dimensions.

Truepane turns that into an agent-assisted workflow. Its local MCP server lets Codex, Claude Code, and other MCP-capable agents compose, localize, check, and render a complete App Store or Google Play screenshot set. The screenshots are read from local paths and the finished PNGs are written locally. No account or API key is required.

This guide can start with the app source itself—or with captures you already have—and ends with store-ready PNG files. An agent can launch the app in a simulator or emulator, capture each required state and locale, then continue directly into Truepane.

## What you need

- Node.js 18 or newer
- Codex or Claude Code
- An app that can run in an iOS Simulator or Android emulator, or two to five screenshots you already captured
- A folder where Truepane can write the finished assets

Truepane supports iPhone, iPad, Android phone, and Android tablet output. A single project can contain more than one target.

## 1. Add the Truepane MCP server

For Codex, run:

```sh
codex mcp add truepane -- npx -y truepane-mcp
```

Confirm that the server is configured:

```sh
codex mcp list
```

Codex shares MCP configuration between its CLI, desktop app, and IDE extension. Restart the client after adding the server, then use `/mcp` to confirm that the Truepane tools are available.

For Claude Code, run:

```sh
claude mcp add truepane -- npx -y truepane-mcp
```

You do not need to clone Truepane or create an environment file. `npx` downloads and starts the published `truepane-mcp` package as a local stdio server.

## 2. Let the agent capture the app

If the app has documented run commands, demo data, or UI tests, an agent can often produce the raw screenshots too:

1. Read the repository's `AGENTS.md`, `README`, and existing run or test instructions.
2. Boot the requested iOS Simulator or Android emulator.
3. Build, install, and launch the app using its existing workflow.
4. Navigate to each required screen with deterministic demo or test data.
5. Wait for animations, dismiss keyboards and alerts, and keep status-bar conditions consistent.
6. Save every capture directly into the intended platform and locale folder.

For a multi-language release, ask the agent to set the app or simulator locale, relaunch when necessary, and repeat exactly the same navigation for every language.

```text
Read this repository's documented run and test workflow. Launch the app in an
iPhone simulator and use existing demo or test data. Capture the Home, Recipe,
and Timer screens in English, French, and German.

Save them as:
/absolute/path/screenshots/ios/<locale>/01-home.png
/absolute/path/screenshots/ios/<locale>/02-recipe.png
/absolute/path/screenshots/ios/<locale>/03-timer.png

For each locale, show the same content and navigation state. Wait for animations,
dismiss keyboards and system alerts, and keep the status bar consistent. Reuse
existing UI-test navigation when available. Do not add screenshot-only production
code or use personal data. If a screen requires credentials or cannot be reached,
report it instead of fabricating the capture.
```

Once the captures exist, the same agent can continue directly into Truepane.

## 3. Put the captures in a predictable folder

Simple names make the project easier to review:

```text
screenshots/
  01-home.png
  02-timer.png
  03-history.png
```

If you already have multiple targets or languages, use explicit folders:

```text
screenshots/
  ios/
    source/
      01-home.png
      02-timer.png
    fr/
      01-home.png
      02-timer.png
  android/
    source/
      01-home.png
      02-timer.png
```

The `target/locale/NN-name.png` structure lets Truepane map files deterministically. It previews a bulk import before applying it, so naming conflicts do not silently overwrite a capture.

## 4. Give the agent a concrete brief

Open Codex or Claude Code in the app repository and use a prompt like this:

```text
Use the Truepane tools to create a three-slide iPhone App Store
screenshot project from the PNG files in /absolute/path/screenshots.

The audience is home coffee brewers. Use concise, benefit-led copy.
Choose a warm background palette from the first screenshot and keep the
set visually consistent. Run Truepane preflight, fix material issues,
and render full-resolution PNGs to /absolute/path/store-assets.

Show me the first render before making subjective design refinements.
Do not upload the screenshots anywhere.
```

The absolute paths matter: the MCP server reads the source files directly from your machine and needs an explicit output directory.

## 5. Review the workflow, not just the final files

A good end-to-end agent run should:

1. Launch the app and capture the required simulator or emulator screens when captures were not supplied.
2. Call `list_options` to inspect supported targets, layouts, fonts, fills, and shapes.
3. Create the project and attach each screenshot to the intended slide and target.
4. Set the typography, colors, background, and composition.
5. Render a preview for inspection.
6. Run `validate_project` and report any missing captures, contrast risks, font problems, or localization fallbacks.
7. Write the final PNG files at the native store dimensions.

Ask for one revision at a time. “Make slide two’s device larger” is easier to evaluate than “make everything more exciting.”

## 6. Continue visually when needed

The MCP project and browser editor use the same JSON project format. Ask the agent to export the project, then import that JSON at [truepane.dev](https://truepane.dev/) if you want to drag a device, tune typography, or compare every slide by eye.

You can move the edited project back to the agent later. This makes the workflow collaborative: automation handles repetitive release work while the browser editor remains available for visual judgment.

## Useful follow-up prompts

Add another platform:

```text
Add Android phone as a second target. Keep the copy and visual direction,
attach the Android captures from /absolute/path/android, run preflight,
and render both targets into separate folders.
```

Add localization:

```text
Launch the app in French and German and capture the same screens and app
state used for the source locale. Keep the meaning concise rather than
translating literally. Use those locale-specific screenshots, validate
every target and language, then render all languages.
```

Prepare a later release:

```text
Save the current project as the release baseline. Compare it with the
new captures and render only assets whose pixels would change.
```

## What remains local

The MCP workflow does not upload screenshots to Truepane. It reads image files from local paths, renders with a local canvas, and writes the results to the output path you choose. The browser editor also performs screenshot composition locally.

Truepane is free and open source under AGPL-3.0. Browse the source and full MCP reference on [GitHub](https://github.com/antonkarliner/truepane).
