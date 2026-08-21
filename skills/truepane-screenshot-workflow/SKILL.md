---
name: truepane-screenshot-workflow
description: Create, localize, validate, and render App Store or Google Play screenshot sets with the local Truepane MCP server. Use when an agent should produce or update store screenshots from local captures; do not use for direct store publishing.
---

# Truepane screenshot workflow

Use the local `truepane-mcp` stdio server when a user needs editable, store-ready screenshot assets without uploading private captures.

1. Start with `list_options` to confirm supported targets, outputs, fonts, backgrounds, and composition presets.
2. Create a project or preview a deterministic directory import before applying it. Preserve conflicts for review instead of overwriting them silently.
3. Attach captures from explicit local paths, then set copy, typography, backgrounds, target-specific overrides, and locale-specific content.
4. Run `validate_project` before rendering. Resolve missing captures, translation gaps, crop risks, font issues, and contrast warnings that affect the requested output.
5. Render a reduced-scale preview, inspect it visually, and iterate before producing full-resolution assets.
6. Export the editable project JSON when the user needs browser review or a future release baseline.

Keep screenshots and generated assets on the machine running the MCP server. Do not claim that Truepane uploaded or published anything to App Store Connect or Google Play; store submission is a separate workflow.
