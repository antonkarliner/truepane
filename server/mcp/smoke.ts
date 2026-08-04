// End-to-end smoke test for the Truepane MCP server. Spawns the real stdio
// server, drives it with the SDK client, and asserts the rendered PNGs exist
// with the exact expected pixel dimensions. Run with: npm run mcp:smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
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

// A panorama sized for the whole strip: a continuous horizontal hue ramp, so a
// backdrop that repeats per slide instead of flowing across it is obvious both
// to the assertions below and to a human looking at the PNGs.
function stripPanorama(dir: string, width: number, height: number): string {
  const c = createCanvas(width, height);
  const ctx = c.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  for (let stop = 0; stop <= 10; stop++) {
    gradient.addColorStop(stop / 10, `hsl(${stop * 36}, 70%, 45%)`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const file = path.join(dir, "panorama.png");
  fs.writeFileSync(file, c.toBuffer("image/png"));
  return file;
}

/** RGB of one pixel in a rendered PNG. */
async function pixelAt(file: string, x: number, y: number): Promise<[number, number, number]> {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  const data = c.getContext("2d").getImageData(x, y, 1, 1).data;
  return [data[0], data[1], data[2]];
}

function channelDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
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
      "apply_brand_kit",
      "compare_release",
      "create_project",
      "export_brand_kit",
      "export_project",
      "import_screenshots",
      "list_options",
      "load_project",
      "render",
      "set_background_image",
      "set_output",
      "set_release_baseline",
      "set_screenshots",
      "set_slides",
      "set_style",
      "set_translations",
      "span_device_across_slides",
      "suggest_palette_from_screenshot",
      "validate_project",
    ]);
    const discovery = firstText(await client.callTool({ name: "list_options", arguments: {} }));
    for (const capability of [
      "Multi-target or bulk media",
      "span_device_across_slides",
      "export_brand_kit",
      "Google Play feature",
      "set_background_image",
      "validate_project",
      "render changed_only",
      "export_project and load_project",
    ]) {
      assert.match(discovery, new RegExp(capability), `list_options did not surface ${capability}`);
    }

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

    // 2b) bulk import is preview-first and applies only with explicit opt-in.
    await client.callTool({
      name: "create_project",
      arguments: {
        id: "bulk-smoke",
        targets: ["ios", "android"],
        slides: [{ title: "One" }, { title: "Two" }],
      },
    });
    const importDir = path.join(tmp, "bulk-import");
    fs.mkdirSync(path.join(importDir, "ios", "source"), { recursive: true });
    fs.mkdirSync(path.join(importDir, "android", "source"), { recursive: true });
    fs.copyFileSync(shot1, path.join(importDir, "ios", "source", "01-home.png"));
    fs.copyFileSync(shot2, path.join(importDir, "android", "source", "02-detail.png"));
    const dryBulk = await client.callTool({
      name: "import_screenshots",
      arguments: { project_id: "bulk-smoke", directory: importDir },
    });
    assert.match(firstText(dryBulk), /Dry run only/);
    const bulkBefore = path.join(tmp, "bulk-before.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "bulk-smoke", path: bulkBefore } });
    assert.equal(JSON.parse(fs.readFileSync(bulkBefore, "utf8")).slides[0].media, undefined);
    const appliedBulk = await client.callTool({
      name: "import_screenshots",
      arguments: { project_id: "bulk-smoke", directory: importDir, dry_run: false, apply: true },
    });
    assert.match(firstText(appliedBulk), /Applied 2 screenshot/);
    const bulkAfter = path.join(tmp, "bulk-after.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "bulk-smoke", path: bulkAfter } });
    const bulkParsed = JSON.parse(fs.readFileSync(bulkAfter, "utf8"));
    assert.ok(bulkParsed.slides[0].media.ios.source.imageDataUrl);
    assert.ok(bulkParsed.slides[1].media.android.source.imageDataUrl);
    const bulkPreflight = firstText(await client.callTool({
      name: "validate_project",
      arguments: { project_id: "bulk-smoke" },
    }));
    assert.match(bulkPreflight, /missing-target-screenshot/);
    assert.match(bulkPreflight, /screenshot-aspect-crop/);

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

    // 3a) one device can be cleanly clipped across an adjacent slide pair.
    const spanned = await client.callTool({
      name: "span_device_across_slides",
      arguments: { project_id: "smoke", left_slide_index: 0 },
    });
    assert.match(firstText(spanned), /Spanned one device across slides 0 and 1/);
    const spanPath = path.join(tmp, "span-check.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "smoke", path: spanPath } });
    const spanCheck = JSON.parse(fs.readFileSync(spanPath, "utf8"));
    assert.equal(spanCheck.slides[0].composition.device.x, 1);
    assert.equal(spanCheck.slides[1].composition.device.x, 0);
    assert.equal(
      spanCheck.slides[1].media.ios.source.imageDataUrl,
      spanCheck.slides[0].media.ios.source.imageDataUrl,
    );
    await client.callTool({
      name: "set_screenshots",
      arguments: { project_id: "smoke", screenshots: [{ index: 1, path: shot2 }] },
    });
    const mediaPath = path.join(tmp, "span-media-check.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "smoke", path: mediaPath } });
    const mediaCheck = JSON.parse(fs.readFileSync(mediaPath, "utf8"));
    assert.equal(
      mediaCheck.slides[0].media.ios.source.imageDataUrl,
      mediaCheck.slides[1].media.ios.source.imageDataUrl,
    );
    await client.callTool({
      name: "set_screenshots",
      arguments: { project_id: "smoke", screenshots: [{ index: 0, path: shot1 }] },
    });

    // 3b) brand kit export/apply restores style without changing project media.
    const brandPath = path.join(tmp, "smoke.truepane-brand.json");
    await client.callTool({
      name: "export_brand_kit",
      arguments: { project_id: "smoke", path: brandPath, name: "Smoke brand" },
    });
    const brandParsed = JSON.parse(fs.readFileSync(brandPath, "utf8"));
    assert.equal(brandParsed.version, 1);
    assert.equal(brandParsed.style.titleColor, "#2d1b0e");
    assert.equal(brandParsed.slides, undefined);
    await client.callTool({
      name: "set_style",
      arguments: { project_id: "smoke", titleColor: "#ffffff" },
    });
    await client.callTool({
      name: "apply_brand_kit",
      arguments: { project_id: "smoke", path: brandPath },
    });
    const brandCheckPath = path.join(tmp, "brand-check.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "smoke", path: brandCheckPath } });
    const brandCheck = JSON.parse(fs.readFileSync(brandCheckPath, "utf8"));
    assert.equal(brandCheck.settings.titleColor, "#2d1b0e");
    assert.ok(brandCheck.slides[0].media.ios.source.imageDataUrl);

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

    // 4b) feature/custom outputs have exact bounded dimensions.
    await client.callTool({
      name: "set_output",
      arguments: { project_id: "smoke", output_id: "play-feature", frame: "android" },
    });
    const featureDir = path.join(outDir, "feature");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: featureDir, what: "slides" },
    });
    assert.deepEqual(pngSize(path.join(featureDir, "slide-01.png")), { w: 1024, h: 500 });
    const customDir = path.join(outDir, "custom");
    await client.callTool({
      name: "render",
      arguments: {
        project_id: "smoke",
        output_dir: customDir,
        what: "slides",
        output_id: "custom",
        output_width: 1200,
        output_height: 700,
        output_frame: "android",
      },
    });
    assert.deepEqual(pngSize(path.join(customDir, "slide-01.png")), { w: 1200, h: 700 });
    const incompleteCustom = await client.callTool({
      name: "set_output",
      arguments: {
        project_id: "smoke",
        output_id: "custom",
        width: 1000,
        frame: "android",
      },
    }) as { isError?: boolean; content: { type: string; text?: string }[] };
    assert.equal(incompleteCustom.isError, true, "set_output should reject incomplete custom dimensions");
    assert.match(firstText(incompleteCustom), /Enter both width and height/);
    const oversizedCustom = await client.callTool({
      name: "render",
      arguments: {
        project_id: "smoke",
        output_dir: customDir,
        output_id: "custom",
        output_width: 8192,
        output_height: 8192,
        output_frame: "android",
      },
    }) as { isError?: boolean; content: { type: string; text?: string }[] };
    assert.equal(oversizedCustom.isError, true, "render should reject custom canvases above 40 megapixels");
    assert.match(firstText(oversizedCustom), /40 megapixels/);
    await client.callTool({
      name: "set_output",
      arguments: { project_id: "smoke", output_id: "ios" },
    });

    // 4c) explicit release baselines drive changed-only manifests/renders.
    const beforeBaseline = firstText(await client.callTool({
      name: "compare_release",
      arguments: { project_id: "smoke" },
    }));
    assert.match(beforeBaseline, /"added":4/);
    await client.callTool({ name: "set_release_baseline", arguments: { project_id: "smoke" } });
    const unchangedRelease = firstText(await client.callTool({
      name: "compare_release",
      arguments: { project_id: "smoke" },
    }));
    assert.match(unchangedRelease, /"unchanged":4/);
    await client.callTool({
      name: "set_slides",
      arguments: {
        project_id: "smoke",
        slides: [
          { title: "Brew Better Coffee — Updated", subhead: "Guided recipes for every brewer." },
          { title: "Track Every Cup", subhead: "Your brew history, beautifully organized." },
        ],
      },
    });
    const changedRelease = firstText(await client.callTool({
      name: "compare_release",
      arguments: { project_id: "smoke" },
    }));
    assert.match(changedRelease, /"changed":2/);
    const changedDir = path.join(outDir, "changed-only");
    const changedRender = firstText(await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: changedDir, what: "slides", changed_only: true },
    }));
    assert.ok(fs.existsSync(path.join(changedDir, "slide-01.png")));
    assert.ok(!fs.existsSync(path.join(changedDir, "slide-02.png")));
    assert.match(changedRender, /Skipped unchanged/);

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

    // 5b) target-specific media stays separate and render target:"all" writes
    // one platform folder per configured target.
    await client.callTool({
      name: "set_screenshots",
      arguments: {
        project_id: "smoke",
        screenshots: [{ index: 0, path: shot1, target: "android" }],
      },
    });
    const multiDir = path.join(outDir, "targets");
    await client.callTool({
      name: "render",
      arguments: {
        project_id: "smoke",
        output_dir: multiDir,
        what: "slides",
        scale: 0.25,
        target: "all",
      },
    });
    assert.deepEqual(pngSize(path.join(multiDir, "ios", "slide-01.png")), { w: 330, h: 717 });
    assert.deepEqual(pngSize(path.join(multiDir, "android", "slide-01.png")), { w: 270, h: 600 });

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

    // 7b) per-locale screenshot: give es its own screenshot for slide 2 (which
    // otherwise falls back to the base). es/slide-02 must then differ from
    // source — proving one project can hold a distinct screenshot per locale.
    const esShot = fakeScreenshot(tmp, "es-screen", "#16a34a");
    await client.callTool({
      name: "set_screenshots",
      arguments: { project_id: "smoke", screenshots: [{ index: 1, path: esShot, language: "es" }] },
    });
    const esDir = path.join(outDir, "es-only");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: esDir, what: "slides", scale: 0.5, language: "es" },
    });
    assert.notDeepEqual(
      fs.readFileSync(path.join(esDir, "slide-02.png")),
      fs.readFileSync(path.join(i18nDir, "source", "slide-02.png")),
      "es/slide-02 should differ from source once the es locale has its own screenshot",
    );

    // 7c) per-language font override: render es in a different font (Bricolage,
    // already registered) than the global Inter. Only the font changes, so the
    // es slide must differ from its Inter render — proving set_style { language }.
    await client.callTool({
      name: "set_style",
      arguments: { project_id: "smoke", language: "es", fontFamily: "Bricolage Grotesque" },
    });
    const esFontDir = path.join(outDir, "es-font");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: esFontDir, what: "slides", scale: 0.5, language: "es" },
    });
    assert.notDeepEqual(
      fs.readFileSync(path.join(esFontDir, "slide-01.png")),
      fs.readFileSync(path.join(i18nDir, "es", "slide-01.png")),
      "es/slide-01 should change when the es locale gets its own font override",
    );

    // 7d) configurable text weights on a project that also carries per-locale
    // font overrides (es → Bricolage above). Render the title light (400 → Inter
    // Regular) then heavy (800 → Inter's heaviest face): they map to different
    // faces, so the slide must change — proving titleWeight reaches the canvas.
    // Leaves the project at 800/400 for the export round-trip below.
    await client.callTool({
      name: "set_style",
      arguments: { project_id: "smoke", titleWeight: 400, subtitleWeight: 400 },
    });
    const lightDir = path.join(outDir, "w400");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: lightDir, what: "slides", scale: 0.5, language: "all" },
    });
    await client.callTool({
      name: "set_style",
      arguments: { project_id: "smoke", titleWeight: 800, subtitleWeight: 400 },
    });
    const heavyDir = path.join(outDir, "w800");
    await client.callTool({
      name: "render",
      arguments: { project_id: "smoke", output_dir: heavyDir, what: "slides", scale: 0.5, language: "all" },
    });
    assert.notDeepEqual(
      fs.readFileSync(path.join(heavyDir, "source", "slide-01.png")),
      fs.readFileSync(path.join(lightDir, "source", "slide-01.png")),
      "source/slide-01 should change between titleWeight 400 and 800",
    );
    assert.ok(
      fs.existsSync(path.join(heavyDir, "es", "slide-01.png")),
      "es render (per-locale font override) should still be produced with the weights applied",
    );

    // 8) export → load round-trip preserves screenshots AND translations
    const projFile = path.join(tmp, "truepane-project.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "smoke", path: projFile } });
    const parsed = JSON.parse(fs.readFileSync(projFile, "utf8"));
    assert.equal(parsed.version, 2);
    assert.equal(parsed.releaseBaseline.version, 1);
    assert.equal(parsed.slides.length, 2);
    assert.ok(parsed.slides[0].media.ios.source.imageDataUrl.startsWith("data:image/png;base64,"));
    assert.ok(parsed.slides[0].media.android.source.imageDataUrl.startsWith("data:image/png;base64,"));
    assert.equal(parsed.settings.background.shape, "bubbles");
    assert.equal(parsed.settings.titleWeight, 800, "titleWeight should round-trip in exported settings");
    assert.equal(parsed.settings.subtitleWeight, 400, "subtitleWeight should round-trip in exported settings");
    assert.equal(parsed.slides[0].translations.es.title, "Prepara mejor café");
    assert.ok(
      parsed.slides[1].media.ios.locales.es.imageDataUrl?.startsWith("data:image/png;base64,"),
      "per-locale screenshot should round-trip in the exported JSON",
    );
    assert.ok(
      !("image" in parsed.slides[1].media.ios.locales.es),
      "the live image must not leak into exported JSON",
    );
    assert.deepEqual(
      parsed.settings.languages,
      [
        { code: "es", name: "Spanish", font: "Bricolage Grotesque" },
        { code: "uk", name: "Ukrainian" },
      ],
      "per-language font override should round-trip in exported settings.languages",
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

    // 10) variable-font weight axis (macOS only): San Francisco must resolve
    // Heavy/Black, so -apple-system at 900 differs from 700. Without driving the
    // wght axis, @napi-rs/canvas quantizes both to Bold and they'd be identical.
    // Skipped where SF isn't installed (Linux/CI).
    const SF_PATH = "/System/Library/Fonts/SFNS.ttf";
    if (fs.existsSync(SF_PATH)) {
      await client.callTool({
        name: "set_style",
        arguments: { project_id: "smoke", fontFamily: "-apple-system", titleWeight: 700 },
      });
      const sf7 = path.join(outDir, "sf700");
      await client.callTool({ name: "render", arguments: { project_id: "smoke", output_dir: sf7, what: "slides", scale: 0.5 } });
      await client.callTool({ name: "set_style", arguments: { project_id: "smoke", titleWeight: 900 } });
      const sf9 = path.join(outDir, "sf900");
      await client.callTool({ name: "render", arguments: { project_id: "smoke", output_dir: sf9, what: "slides", scale: 0.5 } });
      assert.notDeepEqual(
        fs.readFileSync(path.join(sf9, "slide-01.png")),
        fs.readFileSync(path.join(sf7, "slide-01.png")),
        "SF (-apple-system) slide-01 should differ at weight 900 vs 700 (variable wght axis)",
      );
      console.error("variable-weight check (SF 700 vs 900): OK");
    } else {
      console.error("variable-weight check: skipped (SF not installed)");
    }

    // 11) variable Google font: Inter's full weight range resolves via the
    // single-file variable font, so 900 differs from 700. Static Inter tops out
    // at 700 and would render both identically. Uses the network like the other
    // font fetches; a fetch failure falls back to static and this would flag it.
    await client.callTool({ name: "set_style", arguments: { project_id: "smoke", fontFamily: "Inter", titleWeight: 700 } });
    const inter7 = path.join(outDir, "inter700");
    await client.callTool({ name: "render", arguments: { project_id: "smoke", output_dir: inter7, what: "slides", scale: 0.5 } });
    await client.callTool({ name: "set_style", arguments: { project_id: "smoke", titleWeight: 900 } });
    const inter9 = path.join(outDir, "inter900");
    await client.callTool({ name: "render", arguments: { project_id: "smoke", output_dir: inter9, what: "slides", scale: 0.5 } });
    assert.notDeepEqual(
      fs.readFileSync(path.join(inter9, "slide-01.png")),
      fs.readFileSync(path.join(inter7, "slide-01.png")),
      "Inter slide-01 should differ at weight 900 vs 700 (single-file variable font resolves the full range)",
    );
    console.error("variable Google font (Inter 700 vs 900): OK");

    // 12) background image, spanned across the strip.
    //
    // The whole point of strip span is that the seam between two exported
    // slides is invisible on a store listing page. That is a continuity claim
    // about adjacent pixels, so this asserts exactly that: the last column of
    // slide N and the first column of slide N+1 must be the same colour, and
    // slide 1 must not simply repeat on slide 2.
    await client.callTool({
      name: "create_project",
      arguments: {
        id: "bg-smoke",
        platform: "ios",
        slides: [{ title: "One" }, { title: "Two" }, { title: "Three" }, { title: "Four" }],
      },
    });
    // 1320*4 x 2868 is the strip; half that is what the importer stores.
    const panorama = stripPanorama(tmp, 2640, 1434);
    const bgSet = firstText(await client.callTool({
      name: "set_background_image",
      arguments: { project_id: "bg-smoke", image_path: panorama, span: "strip" },
    }));
    assert.match(bgSet, /Background image set for every slide/);
    assert.match(bgSet, /5280x2868/, "should report the full-strip destination box");

    // A style patch tunes placement without needing the bytes again.
    const bgStyled = firstText(await client.callTool({
      name: "set_style",
      arguments: {
        project_id: "bg-smoke",
        background: { image: { scrim: 0.25, scrimColor: "#101010", opacity: 0.95 } },
      },
    }));
    assert.match(bgStyled, /"scrim":0\.25/, "set_style should accept an image placement patch");
    assert.match(bgStyled, /"span":"strip"/, "a placement patch must not erase the image it tunes");
    assert.doesNotMatch(bgStyled, /base64/, "tool responses must not echo the image bytes back");

    const bgDir = path.join(outDir, "background-strip");
    await client.callTool({
      name: "render",
      arguments: { project_id: "bg-smoke", output_dir: bgDir, what: "slides", scale: 0.5 },
    });
    const bgWidth = pngSize(path.join(bgDir, "slide-01.png")).w;
    const sampleY = 8; // above the text block: background pixels only
    for (let slide = 1; slide < 4; slide++) {
      const left = await pixelAt(path.join(bgDir, `slide-0${slide}.png`), bgWidth - 1, sampleY);
      const right = await pixelAt(path.join(bgDir, `slide-0${slide + 1}.png`), 0, sampleY);
      assert.ok(
        channelDistance(left, right) <= 12,
        `seam between slide ${slide} and ${slide + 1} does not line up: ${left} vs ${right}`,
      );
    }
    const firstSlideLeft = await pixelAt(path.join(bgDir, "slide-01.png"), 0, sampleY);
    const secondSlideLeft = await pixelAt(path.join(bgDir, "slide-02.png"), 0, sampleY);
    assert.ok(
      channelDistance(firstSlideLeft, secondSlideLeft) > 20,
      "strip span repeated the same slice on every slide instead of advancing",
    );
    console.error("background image strip continuity: OK");

    const bgCleared = firstText(await client.callTool({
      name: "set_background_image",
      arguments: { project_id: "bg-smoke", clear: true },
    }));
    assert.match(bgCleared, /Cleared the background image for every slide/);
    const bgClearedPath = path.join(tmp, "bg-cleared.json");
    await client.callTool({ name: "export_project", arguments: { project_id: "bg-smoke", path: bgClearedPath } });
    assert.equal(
      JSON.parse(fs.readFileSync(bgClearedPath, "utf8")).settings.background.image,
      undefined,
      "cleared background image should be absent, not null",
    );

    // 13) the composable "custom" shape family, the agent-facing surface for
    // background variation. Reuses the 4-slide bg-smoke project.
    const customStyled = firstText(await client.callTool({
      name: "set_style",
      arguments: {
        project_id: "bg-smoke",
        background: {
          fill: "solid",
          color: "#f2eee6",
          shape: "custom",
          accent: "#c47c3b",
          accentOpacity: 0.6,
          seed: 12,
          customShape: {
            primitive: "disc",
            layout: "row",
            count: 12,
            size: 0.3,
            sizeJitter: 0,
            spacingX: 1,
            spacingY: 0.2,
            phase: 0.5,
            strokeWidth: 0,
          },
        },
      },
    }));
    assert.match(customStyled, /"shape":"custom"/);
    assert.match(customStyled, /"primitive":"disc"/);

    // A partial patch tunes one knob without wiping the other eleven — the same
    // rule the image layer follows.
    const customPatched = firstText(await client.callTool({
      name: "set_style",
      arguments: { project_id: "bg-smoke", background: { customShape: { count: 14 } } },
    }));
    assert.match(customPatched, /"count":14/);
    assert.match(customPatched, /"layout":"row"/, "a partial customShape patch must not reset the layout");

    // Out-of-range values are rejected at the schema boundary with a message
    // naming the field, rather than being silently swallowed.
    const outOfRange = (await client.callTool({
      name: "set_style",
      arguments: { project_id: "bg-smoke", background: { customShape: { count: 1e9 } } },
    })) as { isError?: boolean; content: { type: string; text?: string }[] };
    assert.equal(outOfRange.isError, true, "an out-of-range count should fail at the schema boundary");
    assert.match(firstText(outOfRange), /count/i, "the rejection should name the offending field");

    const customShapeDir = path.join(outDir, "custom-shape");
    await client.callTool({
      name: "render",
      arguments: { project_id: "bg-smoke", output_dir: customShapeDir, what: "slides", scale: 0.5 },
    });
    // phase 0.5 with spacingX 1 centers a disc exactly on each slide boundary,
    // so the two sides of every seam must be the same color: the family lays out
    // in strip-space and is culled per slide, never re-laid-out per slide.
    const customWidth = pngSize(path.join(customShapeDir, "slide-01.png")).w;
    const discY = Math.round(pngSize(path.join(customShapeDir, "slide-01.png")).h * 0.5);
    for (let slide = 1; slide < 4; slide++) {
      const left = await pixelAt(path.join(customShapeDir, `slide-0${slide}.png`), customWidth - 1, discY);
      const right = await pixelAt(path.join(customShapeDir, `slide-0${slide + 1}.png`), 0, discY);
      assert.ok(
        channelDistance(left, right) <= 12,
        `custom shape seam between slide ${slide} and ${slide + 1}: ${left} vs ${right}`,
      );
    }
    console.error("custom shape strip continuity: OK");

    // A hand-edited project file is the path Zod does not guard, so junk there
    // must clamp and still render rather than throw or hang.
    const hostilePath = path.join(tmp, "custom-hostile.json");
    const hostileProject = JSON.parse(fs.readFileSync(bgClearedPath, "utf8"));
    hostileProject.settings.background.shape = "custom";
    hostileProject.settings.background.customShape = {
      primitive: "hexagon",
      layout: "spiral",
      count: 1e9,
      size: 99,
      spacingX: 0,
      spacingY: null,
      strokeWidth: -4,
      opacityRamp: "lots",
    };
    fs.writeFileSync(hostilePath, JSON.stringify(hostileProject));
    await client.callTool({ name: "load_project", arguments: { path: hostilePath, id: "custom-hostile" } });
    const hostileExport = path.join(tmp, "custom-hostile-out.json");
    await client.callTool({
      name: "export_project",
      arguments: { project_id: "custom-hostile", path: hostileExport },
    });
    const healed = JSON.parse(fs.readFileSync(hostileExport, "utf8")).settings.background.customShape;
    assert.equal(healed.count, 200, "count must clamp to its allocation bound");
    assert.equal(healed.primitive, "ring", "an unknown primitive must fall back, not persist");
    assert.equal(healed.layout, "scatter", "an unknown layout must fall back, not persist");
    assert.ok(healed.spacingX >= 0.02, "a zero lattice step must clamp to a non-zero floor");
    await client.callTool({
      name: "render",
      arguments: {
        project_id: "custom-hostile",
        output_dir: path.join(outDir, "custom-hostile"),
        what: "slides",
        scale: 0.25,
      },
    });
    console.error("custom shape hostile-input clamping: OK");

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
