import * as React from "react";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";

type GuideEntry = {
  title: string;
  description: string;
  component: () => React.JSX.Element;
};

const capturePrompt = `Read this repository's documented run and test workflow. Launch the app in an
iPhone simulator and use existing demo or test data. Capture the Home, Recipe,
and Timer screens in English, French, and German.

Save them as:
/absolute/path/screenshots/ios/<locale>/01-home.png
/absolute/path/screenshots/ios/<locale>/02-recipe.png
/absolute/path/screenshots/ios/<locale>/03-timer.png

Keep the content, navigation state, device, status bar, and capture order
identical across locales. Reuse existing UI-test navigation when available.
Do not add screenshot-only production code or use personal data. Report
anything that requires credentials or manual intervention.`;

const composePrompt = `Use the Truepane tools to create a three-slide iPhone App Store screenshot
project from the PNG files in /absolute/path/screenshots.

Use concise, benefit-led copy. Choose a palette from the first screenshot
and keep the set visually consistent. Run Truepane preflight, fix material
issues, and render full-resolution PNGs to /absolute/path/store-assets.

Show me the first render before making subjective design refinements.
Do not upload the screenshots anywhere.`;

const folderTree = `release-screenshots/
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
      03-timer.png`;

function GuideHeader({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  return (
    <header className="guide-header">
      <a className="guide-header__brand" href="/" aria-label="Truepane home">
        <span className="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="guide-brand-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#e07828" />
                <stop offset="100%" stopColor="#8840b8" />
              </linearGradient>
            </defs>
            <rect x="4" y="8" width="5.5" height="16" rx="1.6" fill="var(--brand-left-fill)" />
            <rect x="13.25" y="6" width="5.5" height="20" rx="1.6" fill="url(#guide-brand-gradient)" />
            <rect x="22.5" y="8" width="5.5" height="16" rx="1.6" fill="#7060a8" />
          </svg>
        </span>
        <span>Truepane</span>
      </a>
      <nav aria-label="Guide navigation">
        <a href="/#guides">All guides</a>
        <a href="/editor">Open editor</a>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
      </nav>
    </header>
  );
}

function Code({ children }: { children: string }) {
  return <pre><code>{children}</code></pre>;
}

function ComparisonTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="guide-table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>{row.map((cell, index) => index === 0
              ? <th key={cell} scope="row">{cell}</th>
              : <td key={`${row[0]}-${index}`}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const comparisonGuides = [
  ["truepane-vs-applaunchpad", "AppLaunchpad"],
  ["truepane-vs-previewed", "Previewed"],
  ["truepane-vs-appscreens", "AppScreens"],
  ["truepane-vs-screenshots-pro", "Screenshots.pro"],
  ["truepane-vs-appmockup", "AppMockUp"],
] as const;

function RelatedComparisons({ current }: { current: typeof comparisonGuides[number][0] }) {
  return (
    <section className="guide-related" aria-labelledby="related-comparisons-title">
      <h2 id="related-comparisons-title">Related comparisons</h2>
      <ul>
        <li><a href="/guides/best-app-store-screenshot-generators">All screenshot generators compared</a></li>
        {comparisonGuides
          .filter(([slug]) => slug !== current)
          .map(([slug, name]) => (
            <li key={slug}><a href={`/guides/${slug}`}>Truepane vs {name}</a></li>
          ))}
      </ul>
    </section>
  );
}

function CreateWithAgentsGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Agent workflow</p>
      <h1>Create App Store screenshots with Codex or Claude Code</h1>
      <p className="guide-lead">
        Start with the app source—or captures you already have—and finish with store-ready
        App Store and Google Play PNGs. Your agent can run the simulator, capture every
        locale, compose the set in Truepane, and leave the visual decisions to you.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>Node.js 18 or newer</li>
        <li>Codex, Claude Code, or another MCP-capable agent</li>
        <li>An app that runs in an iOS Simulator or Android emulator, or existing captures</li>
        <li>A local folder for the finished assets</li>
      </ul>

      <h2>1. Add the Truepane MCP server</h2>
      <p>For Codex:</p>
      <Code>{`codex mcp add truepane -- npx -y truepane-mcp`}</Code>
      <p>For Claude Code:</p>
      <Code>{`claude mcp add --scope user truepane -- npx -y truepane-mcp`}</Code>
      <p>
        Restart the client and confirm that the Truepane tools are available. The server
        runs locally and does not require a Truepane account or API key.
      </p>

      <h2>2. Let the agent capture the app</h2>
      <p>
        Ask the agent to follow the repository’s existing run and test instructions,
        reuse deterministic demo data, and capture the same state for every locale.
        Stable status bars, finished animations, and dismissed keyboards make the
        resulting set much easier to compare.
      </p>
      <Code>{capturePrompt}</Code>

      <h2>3. Compose the set in Truepane</h2>
      <p>
        Once the raw captures exist, the same agent can import them, choose the target
        frames, write the captions, render a preview, and run release preflight.
      </p>
      <Code>{composePrompt}</Code>

      <h2>4. Review before full-resolution export</h2>
      <ol>
        <li>Check that each screenshot maps to the intended slide, target, and locale.</li>
        <li>Review one preview strip before asking for subjective refinements.</li>
        <li>Run <code>validate_project</code> and resolve material warnings.</li>
        <li>Export native PNGs or a ZIP only after the set looks right.</li>
      </ol>

      <h2>Continue visually when needed</h2>
      <p>
        MCP and the browser editor use the same JSON project format. Import the project
        into the <a href="/editor">Truepane editor</a> to drag a device, place text, tune
        typography, build <a href="/guides/build-one-continuous-background-across-app-store-screenshots">a continuous background</a>,
        or compare every slide by eye, then hand the edited project back to the agent.
      </p>

      <h2>Continue from export to store delivery</h2>
      <p>
        Once the visual set is approved, follow the guide to
        <a href="/guides/localize-and-publish-app-store-screenshots-with-ai-agent"> localizing and publishing screenshots with an AI agent</a>.
        It adds translation review, a dry-run manifest, an upload approval gate, and remote
        verification without putting store credentials inside Truepane.
      </p>

      <aside>
        <strong>Privacy note.</strong> Truepane reads captures and writes exports locally.
        The app you build may still contact services configured in that app, so use demo
        data and review its signing, analytics, and backend settings before capture.
      </aside>
    </>
  );
}

function MaestroTruepaneGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Maestro + Truepane</p>
      <h1>Automate App Store screenshots with Maestro and Truepane—and save AI tokens</h1>
      <p className="guide-lead">
        Let <a href="https://maestro.dev/" target="_blank" rel="noopener noreferrer">Maestro</a> repeat the taps, locale changes,
        assertions, and raw captures. Then use Truepane to compose, validate, and render
        the store-ready slides. The split turns a repetitive visual-agent job into a
        deterministic command, keeping AI tokens for the review and design decisions that
        actually need them. The workflow works with native iOS and Android apps, React
        Native, Flutter, and other mobile stacks Maestro can drive through the platform
        accessibility layer.
      </p>

      <h2>Why screenshot capture can consume so many agent tokens</h2>
      <p>
        A visual agent can open a simulator, inspect a screen, choose a control, tap it,
        inspect again, and take a screenshot. That works for a small set. It becomes
        expensive when the same route must be repeated for every screen and language:
        each visual observation and navigation decision adds more context to the run.
      </p>
      <p>
        Maestro moves that repetition into a human-readable YAML Flow. It drives the app
        through the UI and accessibility layer, can assert that the destination is visible,
        and writes the current screen to a PNG with <code>takeScreenshot</code>. Truepane
        starts where capture ends: it places those original PNGs inside device frames,
        applies localized store copy and a reusable design, runs preflight, and renders
        the final assets locally.
      </p>

      <ComparisonTable
        headers={["Stage", "Best tool", "Why"]}
        rows={[
          ["Open app screens", "Maestro", "Repeatable UI navigation and assertions"],
          ["Capture each locale", "Maestro", "Deterministic YAML and stable PNG paths"],
          ["Approve raw UI", "Human + agent", "Visual judgment still matters"],
          ["Compose store slides", "Truepane", "Editable frames, copy, backgrounds, and layout"],
          ["Validate and render", "Truepane", "Local preflight and store-size exports"],
        ]}
      />

      <h2>One complete workflow used 64.9% fewer cache-adjusted agent tokens</h2>
      <p>
        In a verified repeat-release benchmark, the same three screens were captured in
        English, French, and Arabic with visual-agent navigation and with Maestro. Both
        legs included all nine raw captures, contact-sheet QA, Truepane project updates,
        preflight, rendering, and review of the three localized strips.
      </p>
      <ComparisonTable
        headers={["Metric", "Visual agent", "Maestro + QA", "Reduction"]}
        rows={[
          ["Cache-adjusted agent tokens", "86,304", "30,260", "64.9%"],
          ["Elapsed time", "10m 21s", "3m 44s", "63.9%"],
          ["Tool calls", "53", "22", "58.5%"],
          ["Usable raw captures", "9 of 9", "9 of 9", "Same output count"],
        ]}
      />
      <p>
        This was one local 3×3 A/B run, not a universal performance claim. The first-ever
        Maestro release also included installation, selector work, tests, and debugging.
        On this small matrix, that one-time setup cost broke even after about seven repeat
        releases by cache-adjusted tokens or five by elapsed time. Larger or more stable
        projects will have different results.
      </p>

      <h2>1. Prepare a stable test device</h2>
      <p>
        Build and install the app, then select an explicit iOS Simulator, Android emulator,
        or supported physical Android device. Populate it with representative demo data and
        keep that fixture between languages. Reinstalling a build can preserve app data;
        erasing the device, uninstalling the app, or clearing state may remove the content
        your store story depends on.
      </p>
      <p>
        If Maestro is not installed yet, follow its <a href="https://docs.maestro.dev/get-started/quickstart" target="_blank" rel="noopener noreferrer">official quickstart</a>{" "}
        to connect a test device and run a first YAML Flow before adding the screenshot matrix.
      </p>
      <p>
        Before automation, dismiss unexpected permission prompts and confirm that every
        target screen is reachable. A green flow cannot make unstable source data look
        intentional.
      </p>

      <h2>2. Give Maestro stable selectors</h2>
      <p>
        For localized apps, avoid navigating by translated visible text when a permanent
        accessibility identifier is available. Maestro's <code>id</code> selector maps to
        the identifier exposed by each platform or framework, so the Flow can stay readable
        even when the UI language changes.
      </p>
      <ComparisonTable
        headers={["App stack", "Stable selector source"]}
        rows={[
          ["UIKit or SwiftUI", "iOS accessibilityIdentifier"],
          ["Android Views", "Resource ID or content description"],
          ["Jetpack Compose", "Semantics test tag exposed as a resource ID"],
          ["React Native", "testID or accessible text"],
          ["Flutter", "Semantics identifier or semantic label—not a Flutter Key"],
        ]}
      />
      <Code>{`appId: \${APP_ID}
---
- launchApp
- tapOn:
    id: "settings"
- tapOn:
    id: "localeFrenchListTile"
- tapOn:
    id: "recipeListItem_107"
- assertVisible:
    id: "recipeDetailNextButton"
- takeScreenshot:
    path: "fr-FR/slide-01"`}</Code>
      <p>
        Put an <code>assertVisible</code> immediately before each capture. It turns a wrong
        screen into a loud failure instead of a plausible-looking PNG that reaches design
        review. Use coordinates only when the accessibility tree cannot expose the control,
        and validate the destination after the tap. If iOS and Android use different app
        IDs, inject <code>APP_ID</code> as an environment variable rather than duplicating
        the entire Flow.
      </p>

      <h2>3. Run the locale matrix as a command</h2>
      <p>
        Keep the mapping between store locales and app locales explicit—for example,
        <code>fr-FR</code> to <code>fr</code>. A small runner can select the target device,
        normalize the status bar where the platform allows it, execute the same Flow for
        each locale, copy successful captures into predictable folders, retain diagnostics
        for failed runs, and exit non-zero when an expected file is missing.
      </p>
      <Code>{`raw-captures/
  en-US/
    slide-01.png
    slide-02.png
    slide-03.png
  fr-FR/
    slide-01.png
    slide-02.png
    slide-03.png
  ar-SA/
    slide-01.png
    slide-02.png
    slide-03.png`}</Code>

      <h2>4. Review the raw captures before Truepane</h2>
      <p>
        Automation proves that commands ran; it does not approve the pixels. Build a
        contact sheet and check the language, screen, data, status bar, screenshot order,
        text overflow, loading states, keyboards, dialogs, and right-to-left layout. Feed
        the original full-resolution PNGs to Truepane, not the reduced contact sheet.
      </p>

      <h2>5. Replace captures and render in Truepane</h2>
      <p>
        Start from the previous approved <code>.truepane.json</code> project. Replace each
        slide image with the matching locale capture while preserving the approved frame,
        background, typography, localized headline, sizing, and order unless the release
        includes a deliberate redesign. Then run preflight, render individual slides and
        full-locale preview strips, review every locale, and save the updated portable
        project beside the output.
      </p>
      <p>
        With <code>truepane-mcp</code>, an AI agent can perform those structured project
        updates without repeatedly operating a visual editor. Open the same project in the
        <a href="/editor"> Truepane browser editor</a> whenever a human needs to adjust
        composition by eye.
      </p>
      <p>
        For the complete agent setup—from installing <code>truepane-mcp</code> through the
        first local render—continue with <a href="/guides/create-app-store-screenshots-with-codex-or-claude-code">the
        Codex and Claude Code screenshot guide</a>.
      </p>

      <h2>Where the token savings come from</h2>
      <ComparisonTable
        headers={["Work", "Visual-agent loop", "Maestro + Truepane"]}
        rows={[
          ["Navigation", "Observe, decide, tap, observe again for every run", "Execute a reviewed YAML Flow"],
          ["Locale repetition", "Repeat the visual conversation per language", "Loop over an explicit locale map"],
          ["File mapping", "Infer captures from the current session", "Use stable locale and slide paths"],
          ["Failure detection", "Agent notices an unexpected screen", "Assertions and missing-file checks fail loudly"],
          ["Composition", "Repeated browser manipulation", "Structured Truepane project edits and local rendering"],
          ["Judgment", "Mixed with routine control work", "Reserved for QA, copy, and design choices"],
        ]}
      />
      <p>
        The saving is not “no AI.” The agent still helps design the flow, diagnoses failures,
        reviews contact sheets, updates the Truepane project, and flags visual problems. The
        saving comes from running deterministic code for deterministic work instead of asking
        the model to rediscover the same path hundreds of times.
      </p>

      <h2>Maestro and Truepane answer different questions</h2>
      <p>
        Maestro asks: “Can we reach the right app state and capture it reliably?” Truepane
        asks: “Can we turn those captures into a consistent, localized, store-ready visual
        set?” Keeping that boundary clear makes both tools easier to replace, inspect, and
        debug—and keeps App Store delivery behind a separate human approval step.
      </p>

      <aside>
        <strong>Sources:</strong> Timer.Coffee local A/B benchmark recorded 10 August 2026;
        official Maestro documentation for <a href="https://docs.maestro.dev/getting-started/build-and-install-your-app" target="_blank" rel="noopener noreferrer">supported platforms</a>,
        <a href="https://docs.maestro.dev/reference/selectors/core-selectors" target="_blank" rel="noopener noreferrer"> cross-platform selectors</a>,
        <a href="https://docs.maestro.dev/get-started/supported-platform/flutter" target="_blank" rel="noopener noreferrer"> Flutter Semantics</a>, and
        <a href="https://docs.maestro.dev/reference/commands-available/takescreenshot" target="_blank" rel="noopener noreferrer"> screenshot capture</a>.
        Maestro’s commands and installation details can change, so check the current docs
        before adapting the example Flow.
      </aside>
    </>
  );
}

function LocalizedGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Localization</p>
      <h1>Update localized App Store screenshots without uploading them</h1>
      <p className="guide-lead">
        Keep every target, language, and slide in one local project. Agents can repeat a
        deterministic simulator flow for each locale, while Truepane catches missing
        captures and renders only the assets that changed.
      </p>

      <h2>1. Use an explicit folder structure</h2>
      <Code>{folderTree}</Code>
      <p>
        The numeric prefix fixes slide order. Target and locale folders make the mapping
        deterministic and expose missing or conflicting captures before import.
      </p>

      <h2>2. Generate locale folders from simulators</h2>
      <p>
        An agent can switch the app or device locale, relaunch when required, reset to
        the same demo state, and capture the same ordered screen list for every language.
        Reuse existing UI-test navigation rather than adding screenshot-only production code.
      </p>
      <Code>{capturePrompt.split("/screenshots/").join("/release-screenshots/")}</Code>

      <h2>3. Preview the import</h2>
      <ol>
        <li>Add the required targets and languages to the Truepane project.</li>
        <li>Import the folder or ZIP and review the proposed mapping.</li>
        <li>Resolve unknown locales, conflicts, and files outside the slide range.</li>
        <li>Apply the import only when the mapping is unambiguous.</li>
      </ol>

      <h2>4. Check copy, captures, and fonts separately</h2>
      <p>
        Each locale can have translated titles, its own screenshot, and its own font.
        Source-capture fallback can be useful, but preflight should make every fallback
        visible. A backdrop can apply across the whole localized set. Choose fonts that
        cover the required script before server-side rendering.
      </p>

      <h2>5. Run preflight across the complete matrix</h2>
      <p>
        Check missing screenshots and translations, capture fallbacks, font coverage,
        crop risk, contrast, and composition for every target, locale, and slide.
      </p>

      <h2>6. Export only what changed</h2>
      <ol>
        <li>Save the approved release as a baseline.</li>
        <li>Import new captures and update translations.</li>
        <li>Review added, changed, unchanged, and removed assets.</li>
        <li>Export a changed-only ZIP and save the next baseline after approval.</li>
      </ol>

      <h2>Ready to publish the localized set?</h2>
      <p>
        Continue with the end-to-end guide to
        <a href="/guides/localize-and-publish-app-store-screenshots-with-ai-agent"> localizing and publishing screenshots through an AI agent</a>.
        It keeps this local project workflow, then adds explicit store API delivery and
        post-upload verification.
      </p>

      <aside>
        <strong>Nothing needs to go to a design service.</strong> Browser composition,
        MCP rendering, projects, and simulator captures can all remain on your machine.
        Google Fonts may still load from Google unless you use a system or uploaded font.
      </aside>
    </>
  );
}

function LocalizeAndPublishGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Localization + publishing</p>
      <h1>Localize and publish App Store screenshots with an AI agent and Truepane</h1>
      <p className="guide-lead">
        Use an agent to translate and assemble every locale, Truepane to validate and render
        the screenshot matrix, and separately configured store tools to deliver the approved
        assets. One workflow can reach App Store Connect and Google Play without giving
        Truepane your publishing credentials.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>A reviewed source-language Truepane project and the original app captures</li>
        <li>Codex, Claude Code, or another MCP-capable agent with the Truepane server configured</li>
        <li>An explicit list of targets, stores, and locale codes for this release</li>
        <li>Existing App Store Connect or Google Play delivery tooling available to the agent</li>
        <li>Store credentials configured through that tool’s normal secure environment—not pasted into a prompt</li>
      </ul>

      <h2>1. Freeze the release matrix</h2>
      <p>
        Start by listing every expected target, locale, and slide. Keep this matrix separate
        from the files themselves so the agent can report missing combinations instead of
        silently falling back to another language or device.
      </p>
      <Code>{`Prepare this Truepane project for App Store Connect and Google Play.

Targets: iPhone 6.9, iPad 13, Android phone, Android tablet
Locales: en-US, fr-FR, de-DE, ja-JP
Slides: 5 per target and locale

Inspect the source project and captures. Report missing targets, locale captures,
fonts, or copy before changing anything. Do not translate, render, or upload yet.`}</Code>

      <h2>2. Let the agent draft locale-aware copy</h2>
      <p>
        Ask for concise adaptation rather than literal translation. Preserve product names,
        placeholders, and claims; respect the space available on each slide; and let the
        locale use natural app-store language. Treat the result as an editorial draft until
        a fluent reviewer has checked it.
      </p>
      <Code>{`Create draft screenshot titles and subtitles for every requested locale.
Preserve meaning and product terminology, but adapt the phrasing naturally.
Keep each line within the source copy's approximate visual length.
Flag ambiguous terms instead of guessing. Apply approved translations to the
Truepane project, but mark the locale set as awaiting linguistic review.`}</Code>

      <h2>3. Attach the right capture and font to each locale</h2>
      <p>
        Localized copy does not guarantee a localized screenshot. Give each locale its own
        app capture when the interface language changes. If source-capture fallback is
        intentional, keep it visible in preflight. Choose a font with full coverage for the
        locale’s script before rendering; do not assume browser fallback will match the
        server-side output.
      </p>

      <h2>4. Review the project in two passes</h2>
      <ol>
        <li><strong>Linguistic review:</strong> meaning, terminology, tone, truncation, and regional wording.</li>
        <li><strong>Visual review:</strong> hierarchy, line breaks, device crops, text expansion, contrast, and strip continuity.</li>
      </ol>
      <p>
        Run <code>validate_project</code> across the complete matrix, render previews, and
        import the editable JSON into the <a href="/editor">Truepane browser editor</a> when
        a title or device needs manual adjustment. Return the edited project to the agent
        before the final render.
      </p>

      <h2>5. Render an approval package</h2>
      <p>
        Render the store-size PNGs into folders organized by store, target, and locale.
        Include a manifest with the expected remote destination, file order, dimensions,
        and checksum or deterministic signature for each asset. This package becomes the
        boundary between design work and an external write.
      </p>
      <Code>{`Render the approved target-locale matrix to /absolute/path/store-assets.
Create a dry-run manifest that maps every PNG to its intended store, target,
locale, and screenshot position. Include dimensions and checksums.
Do not contact App Store Connect or Google Play. Stop for approval.`}</Code>

      <h2>6. Approve the exact upload scope</h2>
      <p>
        Review the manifest before authorizing delivery. Confirm the app identifier, store,
        target, locales, screenshot ordering, files to replace, and anything that must remain
        untouched. Store upload is an external change; a successful local render is not proof
        that the assets reached the intended listing.
      </p>

      <h2>7. Let the agent publish through configured store tools</h2>
      <p>
        After explicit approval, the agent can use the App Store Connect or Google Play API
        client already configured in its environment. Truepane is not the credential holder
        or uploader: it produced the validated assets and manifest that the agent now delivers.
      </p>
      <Code>{`The dry-run manifest is approved. Use the existing configured store API
tools and credentials to upload only the assets in that manifest.

Preserve the approved locale and screenshot order. Do not change descriptions,
keywords, pricing, release state, or unrelated listing metadata. Do not submit
the app or release for review. Report the result for every target and locale.`}</Code>

      <h2>8. Verify the remote result</h2>
      <ol>
        <li>Read the screenshot state back from each store after upload.</li>
        <li>Compare remote locale, target, count, order, and filenames with the manifest.</li>
        <li>Report rejected or missing assets without silently retrying a different mapping.</li>
        <li>Save the approved Truepane project as the next release baseline only after verification.</li>
      </ol>

      <aside>
        <strong>Keep the trust boundary explicit.</strong> Truepane reads captures, validates
        the project, and renders locally. Translation services and store APIs are contacted
        only through tools the agent is separately authorized to use. Keep credentials in
        those tools’ secure configuration and require approval before the upload step.
      </aside>
    </>
  );
}

function ContinuousBackgroundGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Continuous backgrounds</p>
      <h1>Build one continuous background across App Store screenshots</h1>
      <p className="guide-lead">
        Turn separate store screenshots into one connected visual sequence. Truepane can
        slice a single backdrop across the full strip, while every exported slide remains
        the exact size your store listing expects.
      </p>

      <h2>1. Prepare the backdrop at strip dimensions</h2>
      <p>
        Start with the dimensions shown in the Background panel. One iPhone slide is
        1320×2868, so a seven-slide backdrop is 9240×2868. Design the image at that full
        width when exact placement matters, and keep important details away from slide
        boundaries where titles and devices will overlap them.
      </p>

      <img
        src="/welcome-strip-continuity.jpg"
        alt="Seven Truepane screenshots connected by one continuous illustrated backdrop"
        loading="lazy"
      />

      <h2>2. Choose how the image applies</h2>
      <p>
        Drop the image into the Background panel, then choose the scope that matches the
        result you want:
      </p>
      <ul>
        <li><strong>Across strip</strong> maps one wide image across the complete set, so adjacent exports meet at their edges.</li>
        <li><strong>All slides</strong> uses the same image on every slide, fitting it separately inside each canvas.</li>
        <li><strong>This slide</strong> applies an override only to the selected slide.</li>
      </ul>
      <p>
        With an agent, call <code>set_background_image</code> with the local file first,
        then use <code>set_style</code> with <code>background.image</code> to tune the
        result. The image and rendered exports stay on your machine.
      </p>

      <h2>3. Keep every title readable</h2>
      <p>
        Place titles over the quietest parts of the composition. If the backdrop still
        competes with the copy, lower Image opacity or add a Scrim in the title area. A
        dark scrim helps light text; a light scrim helps dark text. Check every slide,
        because contrast can change as the backdrop moves across the strip.
      </p>

      <h2>4. Build a continuous backdrop without an image</h2>
      <p>
        For a smaller, fully editable project, choose the <code>custom</code> shape family
        instead. Its primitives are laid out in strip-space, so rings, discs, arcs,
        triangles, bars, or blobs can flow continuously across multiple slides. The
        arrangement is deterministic from its parameters and seed, which makes it easy
        to reproduce in the editor or through MCP without storing a backdrop image.
      </p>

      <aside>
        <strong>Export still happens slide by slide.</strong> Across strip changes how the
        backdrop is sampled, not the output format. You can export individual PNGs, a
        horizontal strip, or a ZIP from the same project.
      </aside>
    </>
  );
}

function AgentToBrowserGuide() {
  return (
    <>
      <p className="guide-eyebrow">Guide · Agent + browser workflow</p>
      <h1>Start App Store screenshots with an AI agent, then finish them in your browser</h1>
      <p className="guide-lead">
        Let Codex or Claude Code assemble the repetitive first draft, then switch to a
        visual editor for the judgment calls. Truepane keeps both stages in one editable
        project, so you do not have to choose between automation and hands-on design.
      </p>

      <h2>Why use a hybrid workflow?</h2>
      <p>
        Agents are good at repeatable work: finding captures, applying a shared palette,
        drafting concise headlines, checking a target-language matrix, and rendering
        another version after a precise instruction. A browser canvas is better when you
        want to judge balance, drag a device a few pixels, or compare the rhythm of a
        whole strip. The handoff should preserve the work instead of flattening it to PNG.
      </p>

      <h2>1. Give the agent your raw captures and a clear brief</h2>
      <p>
        Install the local Truepane MCP server, then point the agent at absolute file paths.
        Name the audience, the store targets, the one benefit each slide should explain,
        and any brand constraints. Ask for a preview before subjective refinement.
      </p>
      <Code>{`codex mcp add truepane -- npx -y truepane-mcp`}</Code>
      <Code>{`Create a five-slide iPhone App Store project from
/absolute/path/captures. Use one clear benefit per slide, keep the existing
brand colors, and use the same visual system across the strip. Run preflight,
render a preview, and stop for review. Do not upload anything.`}</Code>

      <h2>2. Review the first render as an art director</h2>
      <p>
        Do not start with “make it better.” Check the sequence first: does slide one make
        the app understandable, do later slides add new reasons to install, and is the
        most important UI large enough? Then give bounded feedback such as “shorten slide
        three,” “increase the device scale on slides two and four,” or “reduce background
        contrast behind the first headline.”
      </p>

      <h2>3. Export the editable project, not only the images</h2>
      <p>
        Ask the agent to call <code>export_project</code>. Open the resulting JSON in the
        <a href="/editor"> Truepane browser editor</a>. The project retains slides,
        screenshots, targets, locales, typography, backgrounds, and composition settings.
        You can now drag, scale, rotate, edit copy, or change the backdrop by eye.
      </p>

      <h2>4. Make the manual adjustments that need visual judgment</h2>
      <ol>
        <li>View the full strip before polishing individual slides.</li>
        <li>Keep title position and type scale consistent unless a deliberate break helps.</li>
        <li>Check that app UI remains legible at store-card size, not only when zoomed in.</li>
        <li>Run release preflight after changing targets, languages, crops, or fonts.</li>
      </ol>

      <h2>5. Hand the project back when repetition returns</h2>
      <p>
        Export the edited JSON from the browser and ask the agent to <code>load_project</code>.
        It can add Android, create locale variants, compare with a saved release baseline,
        or render only changed assets. The JSON is the source of truth; PNGs are release
        outputs, not the editable master. For the complete next step, follow the guide to
        <a href="/guides/localize-and-publish-app-store-screenshots-with-ai-agent"> localizing and publishing the approved set with an agent</a>.
      </p>

      <h2>A practical division of labor</h2>
      <ComparisonTable
        headers={["Task", "Best starting point"]}
        rows={[
          ["Capture repeatable app states", "Agent"],
          ["Draft and apply a consistent five-slide system", "Agent"],
          ["Judge hierarchy, spacing, and strip rhythm", "Browser"],
          ["Nudge devices and tune typography", "Browser"],
          ["Repeat across targets and locales", "Agent"],
          ["Approve the final visual result", "Human"],
        ]}
      />

      <aside>
        <strong>The useful boundary is reversibility.</strong> Keep exporting the editable
        project between stages. Once you hand off only flattened PNG files, the next
        revision becomes a rebuild instead of a tweak.
      </aside>
    </>
  );
}

function AppLaunchpadComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Truepane vs AppLaunchpad: which App Store screenshot generator fits your workflow?</h1>
      <p className="guide-lead">
        AppLaunchpad is a template-rich hosted editor. Truepane is a free, open-source,
        local-first editor with an MCP server for AI agents. The better choice depends on
        whether you want a large ready-made asset library or an editable agent-to-browser workflow.
      </p>

      <h2>Short answer</h2>
      <ul>
        <li><strong>Choose AppLaunchpad</strong> if 1,000+ templates, icons, illustrations, and a conventional hosted design workflow are the main attraction.</li>
        <li><strong>Choose Truepane</strong> if you want an agent to orchestrate local composition, asset generation, localization, validation, and delivery while preserving an editable browser handoff.</li>
      </ul>

      <h2>Feature comparison</h2>
      <ComparisonTable
        headers={["Area", "Truepane", "AppLaunchpad"]}
        rows={[
          ["Starting point", "Blank/editor presets or an AI agent", "Large pre-built template library"],
          ["AI-agent workflow", "Documented local MCP server", "Not advertised on the public pages reviewed"],
          ["Manual editing", "Browser editor with free placement", "Browser editor with custom layouts"],
          ["Platforms", "iPhone, iPad, Android phone/tablet, feature graphic, custom output", "App Store and Google Play device sizes"],
          ["Localization", "Agent-generated translations plus per-locale copy, captures, fonts, and preflight", "Built-in design duplication and language editing"],
          ["Assets", "Agent-generated or supplied images, procedural backgrounds, and brand kits", "1,000+ built-in templates plus icon, SVG, image, and illustration libraries"],
          ["Data model", "Local project storage and portable JSON", "Hosted account workflow"],
          ["Price model", "Free and open source", "Free entry; paid plans are offered"],
        ]}
      />

      <h2>Where AppLaunchpad is stronger</h2>
      <p>
        AppLaunchpad’s public site emphasizes breadth: more than 1,000 templates, current
        iOS and Android frames, portrait and landscape layouts, 2,000+ icons and SVGs,
        illustrations, localization, and automatic generation of required store sizes.
        If you want to browse until a finished visual direction feels right, that catalog
        can get you moving faster than building a system from a smaller set of primitives.
      </p>

      <h2>Where Truepane is different</h2>
      <p>
        Truepane can be operated by an MCP-capable coding agent without browser automation.
        The agent can create and translate a project, generate or attach assets, validate it,
        render a preview, and export the same JSON the browser editor reads. With the relevant
        store tools and credentials, it can continue to delivery after rendering. Composition
        stays local, which is useful when screenshot work is part of a repository-driven release
        rather than a separate design task.
      </p>

      <h2>Which should an indie developer choose?</h2>
      <p>
        Pick AppLaunchpad when template variety and built-in decorative assets matter most.
        Pick Truepane when you want your agent to do the first pass, your browser to handle
        visual tweaks, and the final project to remain portable and inspectable. Try the
        actual export path before committing: templates, licensing, and paid-plan limits can change.
      </p>

      <RelatedComparisons current="truepane-vs-applaunchpad" />

      <aside>
        <strong>Sources checked:</strong> the <a href="https://theapplaunchpad.com/">AppLaunchpad product page</a> and
        <a href="https://theapplaunchpad.com/pricing"> pricing page</a> on 5 August 2026.
        Product details and prices can change; verify them before purchase.
      </aside>
    </>
  );
}

function PreviewedComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Truepane vs Previewed: store screenshot workflow or 3D mockup studio?</h1>
      <p className="guide-lead">
        Previewed covers 2D mockups, 3D scenes, animation, video, social graphics, and team
        sharing. Truepane stays focused on repeatable App Store and Google Play screenshot
        sets, with local rendering and an AI-agent handoff.
      </p>

      <h2>Short answer</h2>
      <ul>
        <li><strong>Choose Previewed</strong> for 3D device angles, animated scenes, MP4 exports, presentation graphics, or cloud collaboration.</li>
        <li><strong>Choose Truepane</strong> for a local, open-source store-asset workflow that moves between an AI agent and a browser editor.</li>
      </ul>

      <h2>Feature comparison</h2>
      <ComparisonTable
        headers={["Area", "Truepane", "Previewed"]}
        rows={[
          ["Primary focus", "App Store and Google Play screenshot sets", "2D/3D device mockups and promo media"],
          ["Image export", "Store-size PNG, strip, ZIP, and changed-only output", "JPEG and PNG at plan-dependent resolution"],
          ["Video and 3D", "Not built in; an agent can hand assets to specialized tools", "Built-in 3D snapshots, animations, and MP4"],
          ["AI-agent workflow", "Local MCP server and editable JSON handoff", "Not advertised on the public pages reviewed"],
          ["Collaboration", "Portable JSON for Git or file handoff; no built-in cloud workspace", "Built-in team invitations and shared mockup groups"],
          ["Storage", "Local browser/project storage", "Saved templates backed up in the cloud"],
          ["Pricing", "Free and open source", "Free 720p with attribution; paid export and subscription plans"],
        ]}
      />

      <h2>Where Previewed is stronger</h2>
      <p>
        Previewed is the broader creative studio. It advertises customizable 3D cameras and
        environments, animated device scenes, 30 or 60 fps video exports on paid plans,
        social-media mockups, hundreds of fonts, custom images, free positioning, and team
        sharing. If your deliverables include a launch video, a website hero mockup, and
        social assets as well as store screenshots, keeping them in one service may be useful.
      </p>

      <h2>Where Truepane is stronger</h2>
      <p>
        Truepane treats screenshots as release assets rather than general mockups. One project
        can track targets, locales, capture fallbacks, typography, brand kits, and release
        baselines. Preflight calls out missing or risky combinations, while changed-only export
        helps with later releases. Codex or Claude Code can operate that workflow locally, then
        hand the project to the browser for manual adjustments. If a release also needs video,
        3D, social assets, or store delivery, the same agent can coordinate specialized tools;
        those outputs simply are not built into Truepane itself.
      </p>

      <h2>Price and license differences</h2>
      <p>
        On 5 August 2026, Previewed listed a free Lite tier with unlimited 720p 2D exports
        under a CC attribution license, a US$9.99 one-time Plus pack with ten 1080p+ exports,
        and a Pro plan listed at US$19 per month when billed annually. Truepane does not meter
        exports and uses the AGPL-3.0 license for its source code. These are different kinds of
        licenses, so review the current terms for your intended commercial use.
      </p>

      <RelatedComparisons current="truepane-vs-previewed" />

      <aside>
        <strong>Sources checked:</strong> the <a href="https://previewed.app/">Previewed product page</a> and
        <a href="https://previewed.app/plans/"> plans page</a> on 5 August 2026.
        Verify current features, resolution limits, and licensing before purchase.
      </aside>
    </>
  );
}

function AppScreensComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Truepane vs AppScreens: agent-orchestrated release or built-in publishing?</h1>
      <p className="guide-lead">
        AppScreens is a mature hosted platform for templates, responsive sizing,
        localization, variants, and direct store upload. Truepane is a free open-source
        tool where an AI agent can localize the set, render it locally, and continue to
        store delivery through APIs or other release tools available to that agent.
      </p>

      <h2>Short answer</h2>
      <ul>
        <li><strong>Choose AppScreens</strong> for a large template catalog, many storefronts and locales, responsive resizing, or one-click App Store Connect and Google Play uploads.</li>
        <li><strong>Choose Truepane</strong> when you want an agent to orchestrate capture, localization, design, validation, export, and—when equipped with the relevant store tools and credentials—delivery.</li>
      </ul>

      <h2>Feature comparison</h2>
      <ComparisonTable
        headers={["Area", "Truepane", "AppScreens"]}
        rows={[
          ["Workflow", "Browser editor plus local MCP agent", "Hosted responsive project editor"],
          ["Templates", "Focused layouts and procedural backgrounds", "150+ template sets and 500+ editable layouts advertised"],
          ["Localization", "Agent-generated translations plus per-locale copy, captures, fonts, fallbacks, and preflight", "Built-in localization: 5 locales on Pro; 80+ on Scale as listed"],
          ["Store delivery", "Agent can upload exports through store APIs; no built-in publisher", "Direct Apple and Google upload on paid plans"],
          ["Release updates", "Baseline comparison and changed-only ZIP", "Variants, restyling, CPP/PPO workflows"],
          ["Agent/API", "Published MCP server for local agents", "Public site says API discussions are available on request"],
          ["Price model", "Free and open source", "Free Basic plus paid Pro and Scale plans"],
        ]}
      />

      <h2>Where AppScreens is stronger</h2>
      <p>
        AppScreens packages more of the publishing pipeline inside one product. Its public pages advertise
        responsive designs across phones, tablets, watches, feature graphics, and custom
        sizes; AI captions and translation; many localized markets; and direct upload to
        Apple and Google. Paid plans also add richer device scenes, custom fonts, bulk
        workflows, and Custom Product Page or Product Page Optimization variants.
      </p>

      <h2>Where Truepane is different</h2>
      <p>
        Truepane itself does not contain a store publisher, but the agent workflow does not
        have to stop at export. Your coding agent can read local captures, create and translate
        the set, validate every locale, render outputs, and then use App Store Connect or Google
        Play API tooling available in its environment to upload them. You can still open the
        same JSON in the browser for manual design changes. This keeps store credentials outside
        Truepane while allowing one agent to coordinate the complete release.
      </p>
      <p>
        See the full workflow for
        <a href="/guides/localize-and-publish-app-store-screenshots-with-ai-agent"> localizing, approving, and publishing a Truepane project with an agent</a>.
      </p>

      <h2>Which workflow costs less?</h2>
      <p>
        Truepane is free under AGPL-3.0 and does not meter projects or exports. On 5 August
        2026, AppScreens listed a free Basic plan, Pro at US$8.25 per month when billed
        annually, and Scale at US$15 per month when billed annually. Those plans package
        localization and publishing into the AppScreens interface. Truepane shifts the same
        repetitive work to an agent and its connected tools, so compare setup, control,
        credential boundaries, and template breadth rather than the subscription alone.
      </p>

      <RelatedComparisons current="truepane-vs-appscreens" />

      <aside>
        <strong>Sources checked:</strong> the <a href="https://appscreens.com/">AppScreens product page</a> and
        <a href="https://appscreens.com/pricing"> pricing page</a> on 5 August 2026.
        Verify current prices, limits, and upload support before purchase.
      </aside>
    </>
  );
}

function ScreenshotsProComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Truepane vs Screenshots.pro: open-source MCP workflow or hosted API?</h1>
      <p className="guide-lead">
        Both tools can go beyond manual editing. Truepane exposes a local MCP server for
        AI agents and portable projects; Screenshots.pro offers a hosted editor with REST
        API access and license tiers for commercial and client work.
      </p>

      <h2>Feature comparison</h2>
      <ComparisonTable
        headers={["Area", "Truepane", "Screenshots.pro"]}
        rows={[
          ["Automation", "Local MCP tools; the agent can coordinate other release APIs", "Hosted REST API on Extended plan"],
          ["Editor", "Local-rendering browser editor", "Hosted editor with templates and auto-save"],
          ["Output sizing", "Apple, Google, feature graphic, and bounded custom sizes", "Smart export for all sizes"],
          ["Localization", "Agent-generated translations with per-locale preflight", "Built-in localization on Standard and Extended plans"],
          ["Custom fonts", "System, Google, or uploaded fonts", "Listed on Standard and Extended plans"],
          ["Client work", "No separate client-output license tier; review AGPL if modifying or providing the software", "Extended license explicitly permits charging clients"],
          ["Price model", "Free and open source", "Free Basic; paid Standard and Extended"],
        ]}
      />

      <h2>Choose Screenshots.pro for a conventional API service</h2>
      <p>
        Screenshots.pro’s Basic tier advertises all devices, templates, editor features,
        auto-save, and smart multi-size export. Standard adds 3D angles, template storage,
        custom fonts, localization, and a no-attribution commercial license. Extended adds
        API access and licensing designed for paid client deliverables. That packaging is
        useful when a hosted service and explicit agency rights are requirements.
      </p>

      <h2>Choose Truepane for a local, inspectable workflow</h2>
      <p>
        Truepane’s MCP server is designed for conversational agents rather than a remote
        rendering API. Captures and outputs use local paths; the browser and server share
        editable project JSON; and release preflight can check every target, locale, and
        slide before export. The agent can then coordinate store APIs or other release tools
        available in its environment. There is no hosted project account or per-export plan.
      </p>

      <h2>Pricing and licensing need separate checks</h2>
      <p>
        On 5 August 2026, Screenshots.pro listed Basic at US$0, Standard at US$19 per month,
        and Extended at US$49 per month before annual discounts. Its Basic license requires
        attribution, while Standard removes attribution and Extended covers derivative work
        sold to clients. Truepane’s software is AGPL-3.0; that does not impose attribution on
        PNG exports, but it does matter if you modify and provide the software as a network service.
      </p>

      <RelatedComparisons current="truepane-vs-screenshots-pro" />

      <aside>
        <strong>Sources checked:</strong> the <a href="https://screenshots.pro/">Screenshots.pro product and pricing page</a> and
        <a href="https://screenshots.pro/license"> license page</a> on 5 August 2026.
        This is a workflow comparison, not legal advice.
      </aside>
    </>
  );
}

function AppMockUpComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Truepane vs AppMockUp: two free ways to design App Store screenshots</h1>
      <p className="guide-lead">
        AppMockUp offers a conventional layered visual editor without requiring an account.
        Truepane adds a local AI-agent workflow that can coordinate captures, localization,
        release checks, exports, and store delivery around a portable project file. Both are
        reasonable starting points for indie apps.
      </p>

      <h2>Feature comparison</h2>
      <ComparisonTable
        headers={["Area", "Truepane", "AppMockUp"]}
        rows={[
          ["Starting experience", "Agent, browser editor, or imported JSON", "Browser visual editor"],
          ["Project model", "Targets, locales, slides, brand kit, release baseline", "Master screenshots, device instances, components, and layers"],
          ["AI-agent workflow", "Documented local MCP server", "Not advertised in the public help pages reviewed"],
          ["Manual control", "Free placement, typography, device and backdrop controls", "Layer-based visual editing"],
          ["Account", "Not required", "Not required according to its About page"],
          ["Price model", "Free and open source", "Described by its maker as a free service"],
        ]}
      />

      <h2>Where AppMockUp is appealing</h2>
      <p>
        AppMockUp’s mental model will feel familiar to designers. A Main Screenshot acts
        like a master; device-specific Instance Screenshots inherit its basic design; and
        layers hold text, icons, and devices. Its public site reports more than seven million
        screenshots generated. If you want to open a browser and work visually without an
        account, that is a straightforward proposition.
      </p>

      <h2>Where Truepane is different</h2>
      <p>
        Truepane connects the visual editor to a release workflow. An agent can capture or
        import files from predictable folders, compose and translate the first version,
        validate missing target-locale combinations, and render native outputs. A human can
        then adjust the same project in the browser and hand it back for repetitive localization,
        exports, or API delivery through other tools available to the agent.
      </p>

      <h2>How to decide</h2>
      <p>
        Choose AppMockUp if the layered master-and-instance editing model is the main thing
        you need. Choose Truepane if agent automation, local project portability, preflight,
        or changed-only release output matters. Because both can be tried without an account,
        the best test is to build and revise the same two-slide set in each.
      </p>

      <RelatedComparisons current="truepane-vs-appmockup" />

      <aside>
        <strong>Sources checked:</strong> the <a href="https://app-mockup.com/">AppMockUp product page</a>,
        <a href="https://app-mockup.com/help/"> help center</a>, and <a href="https://app-mockup.com/about/">About page</a> on 5 August 2026.
      </aside>
    </>
  );
}

function ScreenshotGeneratorsComparisonGuide() {
  return (
    <>
      <p className="guide-eyebrow">Comparison · Reviewed August 2026</p>
      <h1>Best App Store screenshot generators: six different workflows compared</h1>
      <p className="guide-lead">
        The best generator is not the one with the longest feature list. Choose around the
        work you repeat: template selection, localization, 3D promotion, client delivery,
        direct store upload, or agent-assisted releases.
      </p>

      <h2>At a glance</h2>
      <ComparisonTable
        headers={["Tool", "Best fit", "Notable trade-off"]}
        rows={[
          ["Truepane", "Agent-orchestrated localization and releases", "No built-in store publisher or 3D video; delivery depends on the agent’s connected tools"],
          ["AppLaunchpad", "Large template and asset library", "Hosted workflow; review current plan limits"],
          ["Previewed", "Built-in 3D mockups, animation, and promo video", "Store-release management is not its only focus"],
          ["AppScreens", "Built-in localization and direct store uploads", "Advanced workflows are paid"],
          ["Screenshots.pro", "Templates plus API access for client/automation work", "Localization, custom fonts, API, and licensing vary by paid tier"],
          ["AppMockUp", "Free visual editing without an account", "Check its current export and advanced-workflow fit yourself"],
        ]}
      />

      <h2>1. Truepane: best for AI agent plus browser editing</h2>
      <p>
        Truepane is free and open source. Its web editor renders locally, while the local
        MCP server lets Codex, Claude Code, and other agents build, validate, localize, and
        render the same editable project. It is the clearest fit when screenshot generation
        belongs inside a software release workflow and you still want manual visual control.
        The <a href="/guides/localize-and-publish-app-store-screenshots-with-ai-agent">localization and publishing guide</a> shows how the agent can continue through store delivery.
      </p>

      <h2>2. AppLaunchpad: best for browsing a large ready-made catalog</h2>
      <p>
        AppLaunchpad advertises 1,000+ templates, 2,000+ icons and SVGs, illustrations,
        current Apple and Android devices, localization, and automatic output sizing. It
        suits someone who would rather choose a polished direction from a broad catalog
        than ask an agent to assemble a design system.
      </p>

      <h2>3. Previewed: best for 3D and video mockups</h2>
      <p>
        Previewed spans 2D screenshots, 3D snapshots, device animations, MP4 video, social
        formats, cloud template storage, and team sharing. It is the most natural choice in
        this list when you want those launch-media outputs built into one editor. A Truepane
        agent can coordinate separate 3D or video tools, but Truepane does not render those
        formats itself.
      </p>

      <h2>4. AppScreens: best for built-in localization and store upload</h2>
      <p>
        AppScreens advertises responsive layouts across many store sizes, 150+ template sets,
        AI captions and translation, 80+ localizations on its Scale tier, and direct upload
        to App Store Connect and Google Play on paid plans. Teams shipping many languages or
        variants may value having that workflow inside one hosted product. Truepane can cover
        localization and delivery through an agent, but the agent needs the relevant translation,
        store API tooling, and credentials in its environment.
      </p>

      <h2>5. Screenshots.pro: best when API access or client licensing matters</h2>
      <p>
        Screenshots.pro includes all devices, templates, editor features, auto-save, and
        smart multi-size export on its Basic tier. Its paid tiers add 3D angles, saved
        templates, custom fonts, localization, commercial license options, and API access.
        Agencies should read the license page carefully because client work is separated
        into an Extended license.
      </p>

      <h2>6. AppMockUp: best for a free, no-account visual starting point</h2>
      <p>
        AppMockUp describes itself as a free service that does not require an account. Its
        help center documents master screenshots, device-specific instances, device
        components, and editable layers. It is worth trying when you want a conventional
        visual editor and reusable layouts without first adopting an automation workflow.
      </p>

      <h2>How to choose in ten minutes</h2>
      <ol>
        <li>List the outputs you actually need: stills, video, locales, targets, or direct upload.</li>
        <li>Build the same two-slide sample in your top two tools.</li>
        <li>Change one headline and one screenshot, then regenerate every required size.</li>
        <li>Check the exported resolution, watermark, naming, license, and re-editability.</li>
        <li>Choose the workflow you would tolerate repeating on the next release.</li>
      </ol>

      <aside>
        <strong>Research basis:</strong> public product, pricing, help, and licensing pages for
        <a href="https://theapplaunchpad.com/"> AppLaunchpad</a>, <a href="https://previewed.app/">Previewed</a>,
        <a href="https://appscreens.com/"> AppScreens</a>, <a href="https://screenshots.pro/">Screenshots.pro</a>, and
        <a href="https://app-mockup.com/"> AppMockUp</a>, checked 5 August 2026. Pricing and features change.
      </aside>
    </>
  );
}

export const GUIDE_REGISTRY = {
  "create-app-store-screenshots-with-codex-or-claude-code": {
    title: "Create App Store screenshots with Codex or Claude Code · Truepane",
    description: "Launch the app, capture simulator states, compose with Truepane, and export native PNGs.",
    component: CreateWithAgentsGuide,
  },
  "automate-app-store-screenshots-maestro-truepane-save-ai-tokens": {
    title: "Automate App Store screenshots with Maestro and Truepane · Truepane",
    description: "See how Maestro and Truepane used 64.9% fewer cache-adjusted agent tokens in one complete 3×3 repeat-release benchmark.",
    component: MaestroTruepaneGuide,
  },
  "update-localized-app-store-screenshots-without-uploading": {
    title: "Update localized App Store screenshots locally · Truepane",
    description: "Repeat deterministic captures across locales and render only the assets that changed.",
    component: LocalizedGuide,
  },
  "localize-and-publish-app-store-screenshots-with-ai-agent": {
    title: "Localize and publish App Store screenshots with an AI agent · Truepane",
    description: "Use an AI agent and Truepane to translate, validate, render, approve, and publish localized store screenshots through configured APIs.",
    component: LocalizeAndPublishGuide,
  },
  "build-one-continuous-background-across-app-store-screenshots": {
    title: "Build one continuous background across App Store screenshots · Truepane",
    description: "Prepare one backdrop, flow it across a complete screenshot set, and keep every title readable.",
    component: ContinuousBackgroundGuide,
  },
  "agent-to-browser-app-store-screenshot-workflow": {
    title: "Design App Store screenshots with an AI agent, then edit in browser · Truepane",
    description: "Use an AI agent for the first screenshot draft, then hand the editable project to a browser for visual tweaks.",
    component: AgentToBrowserGuide,
  },
  "truepane-vs-applaunchpad": {
    title: "Truepane vs AppLaunchpad: App screenshot generators compared",
    description: "Compare Truepane and AppLaunchpad for templates, AI-agent workflows, localization, privacy, editing, and exports.",
    component: AppLaunchpadComparisonGuide,
  },
  "truepane-vs-previewed": {
    title: "Truepane vs Previewed: App screenshot and mockup tools compared",
    description: "Compare Truepane and Previewed for store screenshots, 3D mockups, video, agent automation, storage, and pricing.",
    component: PreviewedComparisonGuide,
  },
  "truepane-vs-appscreens": {
    title: "Truepane vs AppScreens: App screenshot workflows compared",
    description: "Compare Truepane and AppScreens for templates, localization, store upload, agent automation, release updates, and pricing.",
    component: AppScreensComparisonGuide,
  },
  "truepane-vs-screenshots-pro": {
    title: "Truepane vs Screenshots.pro: MCP and API workflows compared",
    description: "Compare Truepane and Screenshots.pro for automation, templates, localization, commercial licensing, privacy, and pricing.",
    component: ScreenshotsProComparisonGuide,
  },
  "truepane-vs-appmockup": {
    title: "Truepane vs AppMockUp: free screenshot generators compared",
    description: "Compare Truepane and AppMockUp for visual editing, reusable projects, AI agents, local workflows, and release checks.",
    component: AppMockUpComparisonGuide,
  },
  "best-app-store-screenshot-generators": {
    title: "Best App Store screenshot generators compared (2026) · Truepane",
    description: "Compare six App Store screenshot generators for templates, localization, 3D video, APIs, direct upload, and AI agents.",
    component: ScreenshotGeneratorsComparisonGuide,
  },
} satisfies Record<string, GuideEntry>;

export type GuideSlug = keyof typeof GUIDE_REGISTRY;

export function GuidePage({
  slug,
  theme = "light",
  onToggleTheme = () => undefined,
}: {
  slug: GuideSlug;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
}) {
  const Guide = GUIDE_REGISTRY[slug].component;

  return (
    <div className="guide-page">
      <GuideHeader theme={theme} onToggleTheme={onToggleTheme} />
      <article className="guide-article">
        <Guide />
      </article>
      <footer className="guide-footer">
        <a href="/#guides">More guides</a>
        <a href="/editor">Open Truepane editor →</a>
      </footer>
    </div>
  );
}
