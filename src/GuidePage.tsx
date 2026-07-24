export type GuideSlug =
  | "create-app-store-screenshots-with-codex-or-claude-code"
  | "update-localized-app-store-screenshots-without-uploading";

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

function GuideHeader() {
  return (
    <header className="guide-header">
      <a className="guide-header__brand" href="/">Truepane</a>
      <nav aria-label="Guide navigation">
        <a href="/#guides">All guides</a>
        <a href="/editor">Open editor</a>
      </nav>
    </header>
  );
}

function Code({ children }: { children: string }) {
  return <pre><code>{children}</code></pre>;
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
      <Code>{`claude mcp add truepane -- npx -y truepane-mcp`}</Code>
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
        into the <a href="/editor">Truepane editor</a> to drag a device, tune typography,
        or compare every slide by eye, then hand the edited project back to the agent.
      </p>

      <aside>
        <strong>Privacy note.</strong> Truepane reads captures and writes exports locally.
        The app you build may still contact services configured in that app, so use demo
        data and review its signing, analytics, and backend settings before capture.
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
        visible. Choose fonts that cover the required script before server-side rendering.
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

      <aside>
        <strong>Nothing needs to go to a design service.</strong> Browser composition,
        MCP rendering, projects, and simulator captures can all remain on your machine.
        Google Fonts may still load from Google unless you use a system or uploaded font.
      </aside>
    </>
  );
}

export function GuidePage({ slug }: { slug: GuideSlug }) {
  return (
    <div className="guide-page">
      <GuideHeader />
      <article className="guide-article">
        {slug === "create-app-store-screenshots-with-codex-or-claude-code"
          ? <CreateWithAgentsGuide />
          : <LocalizedGuide />}
      </article>
      <footer className="guide-footer">
        <a href="/#guides">Read the other guide</a>
        <a href="/editor">Open Truepane editor →</a>
      </footer>
    </div>
  );
}
