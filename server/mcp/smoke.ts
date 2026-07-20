// End-to-end smoke test for the Truepane MCP server. Spawns the real stdio
// server, drives it with the SDK client, and asserts the rendered PNGs exist
// with the exact expected pixel dimensions. Run with: npm run mcp:smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCanvas } from "@napi-rs/canvas";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function pngSize(file: string): { w: number; h: number } {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(12), 0x49484452, `${file}: missing IHDR`); // "IHDR"
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function fakeScreenshot(dir: string, name: string, color: string): string {
  // iOS screen is 930x2000; render at 2x-ish native-like size, same aspect.
  const c = createCanvas(930, 2000);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(60, 120, 810, 200);
  ctx.fillStyle = color;
  ctx.font = "bold 80px sans-serif";
  ctx.fillText(name, 90, 260);
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

function firstText(res: unknown): string {
  const content = (res as { content: { type: string; text?: string }[] }).content;
  return content.find((c) => c.type === "text")?.text ?? "";
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "truepane-smoke-"));
  const outDir = path.join(tmp, "out");
  const shot1 = fakeScreenshot(tmp, "screen-a", "#c2410c");
  const shot2 = fakeScreenshot(tmp, "screen-b", "#1d4ed8");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", path.join(import.meta.dirname, "index.ts")],
    stderr: "inherit",
  });
  const client = new Client({ name: "truepane-smoke", version: "0.0.1" });
  await client.connect(transport);

  try {
    // 1) tools/list over stdio
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    console.error("tools:", names.join(", "));
    assert.deepEqual(names, [
      "create_project",
      "export_project",
      "list_options",
      "load_project",
      "render",
      "set_screenshots",
      "set_slides",
      "set_style",
      "set_translations",
      "suggest_palette_from_screenshot",
    ]);

    // 2) create a 2-slide iOS project
    const created = await client.callTool({
      name: "create_project",
      arguments: {
        id: "smoke",
        platform: "ios",
        slides: [
          { title: "Brew Better Coffee", subhead: "Guided recipes for every brewer.", screenshot_path: shot1 },
          { title: "Track Every Cup", subhead: "Your brew history, beautifully organized.", screenshot_path: shot2 },
        ],
      },
    });
    assert.match(firstText(created), /Project "smoke".*1320x2868px/s);

    // 3) style: linear gradient + bubbles shape
    const styled = await client.callTool({
      name: "set_style",
      arguments: {
        project_id: "smoke",
        fontFamily: "Bricolage Grotesque",
        titleColor: "#2d1b0e",
        background: {
          fill: "linear",
          color: "#fbe8d8",
          gradientColor: "#f5c6a0",
          gradientAngle: 160,
          shape: "bubbles",
          accent: "#c2410c",
          accentOpacity: 0.3,
          density: 3,
          seed: 7,
        },
      },
    });
    assert.match(firstText(styled), /"fill":"linear"/);
    assert.match(firstText(styled), /"shape":"bubbles"/);

    // 4) render slides + strip at full resolution
    const rendered = await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: outDir, what: "both" },
    });
    const renderText = firstText(rendered);
    console.error(renderText);
    const s1 = path.join(outDir, "slide-01.png");
    const s2 = path.join(outDir, "slide-02.png");
    const strip = path.join(outDir, "strip.png");
    for (const f of [s1, s2, strip]) assert.ok(fs.existsSync(f), `missing ${f}`);
    assert.deepEqual(pngSize(s1), { w: 1320, h: 2868 });
    assert.deepEqual(pngSize(s2), { w: 1320, h: 2868 });
    assert.deepEqual(pngSize(strip), { w: 2640, h: 2868 });
    const preview = (rendered as { content: { type: string }[] }).content.find((c) => c.type === "image");
    assert.ok(preview, "render returned no preview image");

    // 5) palette extraction from a project slide (shot1 is dominantly #c2410c)
    const palette = firstText(
      await client.callTool({
        name: "suggest_palette_from_screenshot",
        arguments: { project_id: "smoke", slide_index: 0 },
      }),
    );
    console.error(palette);
    assert.match(palette, /accent \(dominant vivid color\): #[0-9a-f]{6}/);
    assert.match(palette, /set_style/);

    // 6) agent-supplied translations: slide-count mismatch must fail loudly…
    const badTr = (await client.callTool({
      name: "set_translations",
      arguments: {
        project_id: "smoke",
        translations: [{ code: "es", name: "Spanish", slides: [{ title: "Solo una" }] }],
      },
    })) as { isError?: boolean; content: { type: string; text?: string }[] };
    assert.equal(badTr.isError, true, "set_translations should reject a slide-count mismatch");
    assert.match(firstText(badTr), /"es" has 1 slide texts but the project has 2 slides/);

    // …then store two languages (accented Spanish + non-Latin Ukrainian)
    const trText = firstText(
      await client.callTool({
        name: "set_translations",
        arguments: {
          project_id: "smoke",
          translations: [
            {
              code: "es",
              name: "Spanish",
              slides: [
                { title: "Prepara mejor café", subhead: "Recetas guiadas para cada cafetera." },
                { title: "", subhead: "" }, // empty → falls back to base text at render time
              ],
            },
            {
              code: "uk",
              name: "Ukrainian",
              slides: [
                { title: "Готуйте каву краще", subhead: "Покрокові рецепти для кожної кавоварки." },
                { title: "Кожна чашка в історії", subhead: "Вся ваша кава — гарно впорядкована." },
              ],
            },
          ],
        },
      }),
    );
    console.error(trText);
    assert.match(trText, /es, uk/);

    // 7) render language:"all" → per-language subfolders (source/ + es/ + uk/).
    // Switch to Inter first: it covers Cyrillic, while Bricolage Grotesque is
    // Latin-only and server-side rendering has no per-glyph system fallback —
    // with it, the uk render would be tofu boxes (see set_translations docs).
    await client.callTool({ name: "set_style", arguments: { project_id: "smoke", fontFamily: "Inter" } });
    const i18nDir = path.join(outDir, "i18n");
    const allRendered = firstText(
      await client.callTool({
        name: "render",
        arguments: { project_id: "smoke", output_dir: i18nDir, what: "slides", scale: 0.5, language: "all" },
      }),
    );
    console.error(allRendered);
    for (const folder of ["source", "es", "uk"]) {
      for (const f of ["slide-01.png", "slide-02.png"]) {
        const p = path.join(i18nDir, folder, f);
        assert.ok(fs.existsSync(p), `missing ${p}`);
        assert.deepEqual(pngSize(p), { w: 660, h: 1434 });
      }
    }
    // translated slide differs from source; the untranslated one falls back to identical base text
    assert.notDeepEqual(
      fs.readFileSync(path.join(i18nDir, "es", "slide-01.png")),
      fs.readFileSync(path.join(i18nDir, "source", "slide-01.png")),
      "es/slide-01 should differ from source (translated title)",
    );
    assert.deepEqual(
      fs.readFileSync(path.join(i18nDir, "es", "slide-02.png")),
      fs.readFileSync(path.join(i18nDir, "source", "slide-02.png")),
      "es/slide-02 should equal source (empty translation falls back to base text)",
    );

    // 8) export → load round-trip preserves screenshots AND translations
    const projFile = path.join(tmp, "truepane-project.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "smoke", path: projFile } });
    const parsed = JSON.parse(fs.readFileSync(projFile, "utf8"));
    assert.equal(parsed.slides.length, 2);
    assert.ok(parsed.slides[0].imageDataUrl.startsWith("data:image/png;base64,"));
    assert.equal(parsed.settings.background.shape, "bubbles");
    assert.equal(parsed.slides[0].translations.es.title, "Prepara mejor café");
    assert.deepEqual(
      parsed.settings.languages,
      [
        { code: "es", name: "Spanish" },
        { code: "uk", name: "Ukrainian" },
      ],
    );
    const loaded = await client.callTool({
      name: "load_project",
      arguments: { path: projFile, id: "smoke-2" },
    });
    assert.match(firstText(loaded), /Project "smoke-2".*2 slides/s);

    // 9) re-render the loaded copy at draft scale: hydration worked, and the
    // loaded translations render differently from the base text.
    const draftDir = path.join(tmp, "draft");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke-2", output_dir: draftDir, what: "slides", scale: 0.25 },
    });
    assert.deepEqual(pngSize(path.join(draftDir, "slide-01.png")), { w: 330, h: 717 });
    const draftUkDir = path.join(tmp, "draft-uk");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke-2", output_dir: draftUkDir, what: "slides", scale: 0.25, language: "uk" },
    });
    assert.notDeepEqual(
      fs.readFileSync(path.join(draftUkDir, "slide-01.png")),
      fs.readFileSync(path.join(draftDir, "slide-01.png")),
      "loaded project should render uk differently from base — translations survived the round-trip",
    );

    console.error(`\nSMOKE OK — inspect renders in ${outDir}`);
    console.log(outDir); // machine-readable: the only stdout line
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
