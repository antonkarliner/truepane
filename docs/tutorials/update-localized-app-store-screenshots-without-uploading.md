# How to update localized App Store screenshots without uploading them

Localized App Store screenshots are easy to create once and painful to maintain. A small UI change can affect several devices and languages, while a hurried manual update can pair the wrong capture with a translation or leave one locale behind.

Truepane keeps the entire workflow local and makes the target-language-slide matrix visible before export. You can update the set in the browser or automate it through the Truepane MCP server.

## Start with an explicit folder structure

Arrange captures by target, locale, and slide number. You can prepare this structure yourself, or ask an agent to create and populate it while capturing the app:

```text
release-screenshots/
  ios/
    source/
      01-home.png
      02-recipe.png
      03-timer.png
    fr/
      01-home.png
      02-recipe.png
      03-timer.png
    de/
      01-home.png
      02-recipe.png
      03-timer.png
  android/
    source/
      01-home.png
      02-recipe.png
      03-timer.png
```

Truepane recognizes `ios`, `ipad`, `android`, and `android-tablet` target folders. Use `source` for the base locale and a locale code such as `fr`, `de`, or `ja` for translated captures.

The numeric prefix determines slide order. Descriptive text after the number is for humans; `02-recipe.png` still maps to slide two.

## Generate the locale folders from simulators

You do not need to capture every language by hand. An agent can launch the app in an iOS Simulator or Android emulator, switch the app or device locale, navigate through the same states, and write each screenshot to the correct folder.

The safest workflow is:

1. Read the app repository's documented build, run, and test instructions.
2. Reuse existing demo data and UI-test navigation where possible.
3. Reset to the same content state before each locale.
4. Set the app or simulator locale and relaunch if the platform requires it.
5. Capture the same ordered screen list for every language.
6. Report any screen or locale that could not be reached instead of silently substituting another image.

```text
Read this project's run and test instructions. Boot the required iOS simulators
and Android emulators. For the source locale, French, and German, launch the app
in that locale, reset it to deterministic demo data, and capture Home, Recipe,
and Timer.

Write the files to:
/absolute/path/release-screenshots/<platform>/<locale>/01-home.png
/absolute/path/release-screenshots/<platform>/<locale>/02-recipe.png
/absolute/path/release-screenshots/<platform>/<locale>/03-timer.png

Keep the content, navigation state, device, status bar, and capture order identical
across locales. Reuse existing UI-test navigation when available. Do not add
screenshot-only production code or use personal data. Report anything that
requires credentials or manual intervention.
```

This is especially useful for multi-language releases: the agent can repeat a deterministic capture flow more reliably than a manual tour through every locale.

## Preview the import before applying it

In the browser editor:

1. Create or open the project.
2. Add the required targets and languages.
3. Choose **Import folder** or **Import ZIP**.
4. Review the proposed target, locale, and slide mapping.
5. Correct unmapped files or conflicts.
6. Apply the import once the preview is complete.

Explicit folder paths take priority over filename guesses. Conflicts remain visible instead of replacing an existing screenshot silently.

For an agent-assisted workflow, ask Codex or Claude Code:

```text
Use Truepane to import /absolute/path/release-screenshots into my existing
project. Start with a dry-run mapping. Report conflicts, missing slots,
unknown locales, and files outside the slide range. Do not apply the
import until the mapping is unambiguous.
```

After reviewing the result:

```text
Apply the reviewed import. Preserve every slide whose capture did not
change, then validate all targets and languages.
```

## Separate translated copy from translated captures

Each locale can have:

- Translated title and subtitle text
- Its own screenshot
- Its own font

If a locale does not have a dedicated screenshot, Truepane can reuse the source capture from the same target. It never borrows an iPhone screenshot for Android or one device class for another.

Fallbacks are useful, but they should be deliberate. Preflight reports them so you can decide whether the base UI is acceptable for that locale.

For non-Latin scripts, choose a font that covers the language:

- Inter for Cyrillic and Greek
- Noto Sans Arabic for Arabic
- Noto Sans JP, KR, or SC for Japanese, Korean, or Simplified Chinese

Server-side rendering cannot rely on the browser’s per-glyph font fallback, so unsupported characters may otherwise appear as boxes.

## Run preflight across the complete matrix

Before exporting, check every target, locale, and slide for:

- Missing target screenshots
- Missing translations
- Source-capture fallbacks
- Font coverage
- Text or device crop risk
- Fill and text contrast
- Composition problems

In the browser, choose **Run release preflight**. Through MCP, ask the agent to call `validate_project` and return the complete ordered issue list before rendering.

Warnings are advisory. They help you find mismatches without preventing an intentional export.

## Export only what changed

The first time you finish a release set, save it as the release baseline. Truepane records deterministic signatures rather than storing duplicate rendered PNG files.

For the next release:

1. Import the new captures.
2. Update translations or composition.
3. Compare the project with the saved baseline.
4. Review added, changed, unchanged, and removed assets.
5. Export the changed-only ZIP and its manifest.
6. Save a new baseline only after approving the release.

The baseline never updates implicitly. That prevents a comparison run from erasing the reference point you intended to review.

An MCP prompt can be as simple as:

```text
Compare this project with its saved release baseline. List the changed
assets by target, language, and slide. Render only added or changed PNGs
to /absolute/path/release-assets and include the manifest. Do not update
the baseline.
```

## Keep sensitive screenshots on your machine

Truepane’s browser editor renders screenshots with the browser canvas and stores project state locally. Its MCP server reads and writes local files through a native canvas. Neither workflow requires uploading your screenshots to a design service. Simulator and emulator captures can remain local too, although the app's own build, signing, analytics, or backend configuration may still contact services defined by that app.

Google Fonts may be fetched from Google’s CDN unless you use a system or uploaded font. Optional browser AI helpers send only the text you explicitly ask them to process; they are not involved in the local MCP workflow.

Try the editor at [truepane.dev](https://truepane.dev/) or inspect the source and MCP documentation on [GitHub](https://github.com/antonkarliner/truepane).
