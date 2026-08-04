// MCP tool definitions for the Truepane screenshot generator.
//
// Workflow the tools teach: list_options → create_project → set_style /
// set_slides / set_screenshots → render (look at the returned preview) →
// adjust → render again. export_project/load_project round-trip the project
// JSON with the web app's Import/Export Project feature.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { FONT_OPTIONS } from "../../src/core/constants";
import { backgroundImageFromUpload, prepareBackgroundImage } from "../../src/core/background-image";
import { normalizeBackground } from "../../src/core/normalize";
import { COMPOSITION_PRESETS, mirrorSpannedMedia, normalizeComposition, spanDeviceAcrossPair, updateSpannedComposition } from "../../src/core/composition";
import { getImageAsset, setImageAsset } from "../../src/core/media";
import { bulkSlotKey, mapBulkImport } from "../../src/core/bulk-import";
import { validateProject } from "../../src/core/preflight";
import {
  applyBrandKit,
  brandKitFromSettings,
  MAX_BRAND_KIT_BYTES,
  normalizeBrandKit,
} from "../../src/core/brand-kit";
import {
  BUILTIN_OUTPUTS,
  normalizeOutput,
  outputForSettings,
  validateCustomOutputDimensions,
} from "../../src/core/output";
import {
  compareRelease,
  createReleaseBaseline,
  releaseAssetKey,
} from "../../src/core/release";
import {
  dimFor,
  FILL_OPTIONS,
  getFrame,
  getRenderFrame,
  paintSlide,
  paintStrip,
  PLATFORMS,
  registerBackgroundImage,
  RING_LAYOUTS,
  SHAPE_FAMILIES,
} from "../../src/core/render";
import type { AppState, Background, CanvasLike, ImageSourceLike, LanguageTarget, Settings, Slide, SlideText } from "../../src/core/types";
import { makeCanvas, paletteOfImage, pngBuffer, tryLoadImage } from "./canvas";
import { ensureFamily, ensureFontsForState } from "./fonts";
import {
  createProject,
  getProject,
  hydrateBackgroundImages,
  listProjects,
  loadProjectFromFile,
  loadScreenshot,
  projectJson,
} from "./projects";
import type { Canvas } from "@napi-rs/canvas";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
const FONT_IDS = FONT_OPTIONS.map((f) => f.id);
const SHAPE_IDS = SHAPE_FAMILIES.map((s) => s.id);
const FILL_IDS = FILL_OPTIONS.map((f) => f.id);
const RING_LAYOUT_IDS = RING_LAYOUTS.map((l) => l.id);
const OUTPUT_CHOICES = ["ios", "ipad", "android", "android-tablet", "play-feature", "custom"] as const;

const platformList = PLATFORMS.map((p) => {
  const d = dimFor(p.id);
  return `"${p.id}" (${p.storeLabel}, ${d.W}x${d.H}px)`;
}).join(", ");

// Placement knobs only — no bytes. Moving image data is set_background_image's
// job, so an agent cannot write an unprocessed payload through a style patch.
const backgroundImageSchema = z
  .object({
    span: z.enum(["slide", "strip"]).describe('"slide" fits one slide; "strip" fits the whole strip and slices it'),
    fit: z.enum(["cover", "contain"]).describe("cover fills and crops; contain fits and letterboxes"),
    opacity: z.number().min(0).max(1).describe("Image opacity over the fill, 0..1"),
    scrim: z.number().min(0).max(1).describe("Wash of scrimColor over the image, 0..1 — the legibility control"),
    scrimColor: z.string().describe("Scrim color (CSS color, default #000000)"),
    useScreenshotBlur: z
      .boolean()
      .describe("Derive the background from this slide's own screenshot, blurred. Costs no storage. false clears it."),
    blur: z.number().min(0).max(1).describe("Blur amount for useScreenshotBlur, 0..1"),
  })
  .partial();

// The one parameterized shape family. Every knob is a bounded number or a
// closed enum, so a style patch stays pure data: nothing here can describe
// drawing code, which is what keeps a shared .truepane file inert and the
// renderer fixed enough for release baselines to mean anything.
//
// Ranges live in the schema so a bad call fails at the boundary with a message
// naming the field, instead of being silently clamped inside the renderer.
const customShapeSchema = z
  .object({
    primitive: z
      .enum(["ring", "disc", "arc", "triangle", "bar", "blob"])
      .describe(
        "What each instance is. ring = annulus, disc = solid circle, arc = half-circle sweep, " +
          "triangle = equilateral, bar = rounded capsule, blob = soft three-lobed shape.",
      ),
    layout: z
      .enum(["scatter", "grid", "row", "radial", "wave"])
      .describe(
        "How instances are arranged across the strip. scatter = seeded random fill, " +
          "grid = lattice on spacingX/spacingY, row = single band across the middle, " +
          "radial = concentric rings around the strip center, wave = a row on a sine curve.",
      ),
    count: z
      .number()
      .int()
      .min(1)
      .max(200)
      .describe(
        "Instances across the WHOLE strip, not per slide, so it means the same thing whatever " +
          "the slide count. For grid it is a cap on the lattice. 1..200.",
      ),
    size: z
      .number()
      .min(0)
      .max(1)
      .describe("Instance radius in slide-width units. 0.05 is a speck, 0.5 is half a slide wide. 0..1."),
    sizeJitter: z
      .number()
      .min(0)
      .max(1)
      .describe("Random variation in size, and position wobble for the lattice layouts. 0 = uniform. 0..1."),
    rotation: z.number().min(-180).max(180).describe("Base rotation of every instance, in degrees. -180..180."),
    rotationJitter: z
      .number()
      .min(0)
      .max(360)
      .describe("Random rotation spread around `rotation`, in degrees. 360 = fully random. 0..360."),
    spacingX: z
      .number()
      .min(0.02)
      .max(2)
      .describe(
        "Step along the strip in slide-width units (grid, row, wave) or horizontal ring step (radial). " +
          "0.5 puts two instances per slide width. 0.02..2.",
      ),
    spacingY: z
      .number()
      .min(0.02)
      .max(2)
      .describe(
        "Step down the slide in slide-height units (grid), wave amplitude (wave), or vertical ring " +
          "step (radial). 0.02..2.",
      ),
    phase: z
      .number()
      .min(0)
      .max(1)
      .describe("Shifts the lattice along the strip by a fraction of one step — use it to nudge instances off the text. 0..1."),
    strokeWidth: z
      .number()
      .min(0)
      .max(40)
      .describe("Outline width in export pixels. 0 fills the primitive instead of stroking it. 0..40."),
    opacityRamp: z
      .number()
      .min(-1)
      .max(1)
      .describe(
        "Alpha ramp along the strip. 0 = flat, +1 fades in from a transparent first slide, " +
          "-1 fades out toward a transparent last slide. -1..1.",
      ),
  })
  .partial();

const backgroundSchema = z
  .object({
    fill: z.enum(FILL_IDS as [string, ...string[]]).describe("Fill layer: solid | linear | radial"),
    shape: z
      .enum(SHAPE_IDS as [string, ...string[]])
      .describe(`Shape overlay drawn in the accent color: ${SHAPE_IDS.join(" | ")}`),
    color: z.string().describe("Fill color / gradient start (CSS color, e.g. #f2eee6)"),
    gradientColor: z.string().describe("Gradient end color (linear/radial fills only)"),
    accent: z.string().describe("Shape overlay color"),
    accentOpacity: z.number().min(0).max(1).describe("Shape opacity, 0..1 (default 0.55)"),
    ringLayout: z
      .enum(RING_LAYOUT_IDS as [string, ...string[]])
      .describe(`Ring arrangement (shape "rings" only): ${RING_LAYOUT_IDS.join(" | ")}`),
    ringCount: z.number().int().min(1).max(8).describe("Rings per group, 1..8"),
    seed: z.number().int().describe("PRNG seed for seeded shapes — change to reshuffle"),
    density: z.number().min(1).max(8).describe("Shape density, 1..8 (seeded shapes)"),
    dotsAligned: z.boolean().describe('Align "dots" to a strict grid (no jitter)'),
    gradientAngle: z.number().describe("Linear gradient angle in degrees (default 135)"),
    image: backgroundImageSchema.describe(
      "Placement of the background image layer. Set the image itself with set_background_image.",
    ),
    customShape: customShapeSchema.describe(
      'Parameters for shape "custom" — the one composable family. Ignored unless shape is "custom". ' +
        "Partial: fields you omit keep their current value. See list_options for a worked example.",
    ),
  })
  .partial();

type BackgroundPatch = z.infer<typeof backgroundSchema>;

const compositionSchema = z.object({
  preset: z.enum(COMPOSITION_PRESETS.map((p) => p.id) as [string, ...string[]]).optional(),
  text: z.object({
    x: z.number().min(-0.5).max(1.5).optional(),
    y: z.number().min(-0.5).max(1.5).optional(),
    width: z.number().min(0.2).max(1.2).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    rotation: z.number().min(-12).max(12).optional(),
  }).partial().optional(),
  device: z.object({
    x: z.number().min(-0.5).max(1.5).optional(),
    y: z.number().min(-0.5).max(1.5).optional(),
    scale: z.number().min(0.4).max(1.6).optional(),
    rotation: z.number().min(-20).max(20).optional(),
  }).partial().optional(),
}).partial();

function patchBackground(base: Background, patch: BackgroundPatch): Background {
  const { image, customShape, ...rest } = patch;
  const merged = { ...base, ...rest } as Background;
  // Same partial-patch rule as the image layer: tuning one knob must not wipe
  // the other eleven. normalizeBackground fills any field still missing.
  if (customShape) {
    merged.customShape = { ...(base.customShape ?? {}), ...customShape } as Background["customShape"];
  }
  if (!image) return normalizeBackground(merged);

  // A patch tunes the existing layer rather than replacing it — spreading the
  // partial over the whole image would erase the source with every scrim tweak.
  const current = base.image;
  let source = current?.source;
  if (image.useScreenshotBlur === true) {
    source = {
      kind: "screenshot",
      blur: image.blur ?? (current?.source.kind === "screenshot" ? current.source.blur : 0.5),
    };
  } else if (image.useScreenshotBlur === false && current?.source.kind === "screenshot") {
    // Turning the derived source off with no upload behind it means "no image".
    return normalizeBackground({ ...merged, image: null });
  } else if (image.blur !== undefined && source?.kind === "screenshot") {
    source = { kind: "screenshot", blur: image.blur };
  }
  if (!source) {
    throw new Error(
      "This background has no image to place. Call set_background_image first, or pass image.useScreenshotBlur:true to derive one from the slide's screenshot.",
    );
  }
  const { useScreenshotBlur: _mode, blur: _blur, ...placement } = image;
  return normalizeBackground({ ...merged, image: { ...(current ?? {}), ...placement, source } });
}

/**
 * The background as JSON for a tool response, with an uploaded image's bytes
 * replaced by a short descriptor.
 *
 * Echoing a multi-megabyte data URL back at the agent that just set it would
 * spend its whole context window on base64 it cannot use.
 */
function backgroundJson(background: Background): string {
  const image = background.image;
  if (!image || image.source.kind !== "upload") return JSON.stringify(background);
  const { dataUrl, ...source } = image.source;
  const kb = Math.round((dataUrl.length * 0.75) / 1024);
  return JSON.stringify({
    ...background,
    image: { ...image, source: { ...source, dataUrl: `<${kb} KB, set via set_background_image>` } },
  });
}

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

function assertPlatform(platform: string): void {
  if (!PLATFORM_IDS.includes(platform)) {
    throw new Error(`Unknown platform "${platform}". Valid: ${PLATFORM_IDS.join(", ")}`);
  }
}

function customOutputDimensions(width: number | undefined, height: number | undefined): {
  width: number;
  height: number;
} {
  const result = validateCustomOutputDimensions(
    width === undefined ? "" : String(width),
    height === undefined ? "" : String(height),
  );
  if ("error" in result) throw new Error(result.error);
  return result;
}

function imageFilesUnder(directory: string): { absolutePath: string; relativePath: string }[] {
  const root = path.resolve(directory);
  const out: { absolutePath: string; relativePath: string }[] = [];
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.resolve(current, entry.name);
      if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Refusing path outside import directory: ${absolutePath}`);
      }
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)) {
        out.push({ absolutePath, relativePath: path.relative(root, absolutePath).split(path.sep).join("/") });
      }
    }
  };
  visit(root);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

// Warn (not fail) when a screenshot's aspect ratio is off from the device
// screen — it will be center-crop-filled, so mild mismatch is fine.
function aspectNote(label: string, img: { width: number; height: number }, platform: string): string | null {
  const S = getFrame(platform).SCREEN;
  const imgAspect = img.width / img.height;
  const screenAspect = S.w / S.h;
  const rel = Math.abs(imgAspect - screenAspect) / screenAspect;
  if (rel > 0.02) {
    return (
      `${label}: screenshot aspect ${img.width}x${img.height} (${imgAspect.toFixed(3)}) ` +
      `differs from the ${platform} screen aspect (${screenAspect.toFixed(3)}) — it will be scaled to fill and center-cropped`
    );
  }
  return null;
}

// Load a screenshot file and write it into any image-bearing target (a base
// slide or a per-locale translation entry), collecting warnings.
async function applyScreenshot(
  target: { image?: ImageSourceLike | null; imageDataUrl?: string | null },
  filePath: string,
  platform: string,
  label: string,
  notes: string[],
): Promise<void> {
  const { dataUrl, image } = await loadScreenshot(filePath);
  target.imageDataUrl = dataUrl;
  target.image = image;
  if (!image) {
    notes.push(`${label}: could not decode image at ${filePath} — the screen will show a placeholder`);
    return;
  }
  const note = aspectNote(label, image, platform);
  if (note) notes.push(note);
}

// Ensure a locale is in settings.languages so language:"all" renders it. Adds
// { code, name, font? } if new; for an existing code, only updates name/font
// when explicitly given (so a screenshot-only call can't clobber a label/font).
function mergeLanguage(state: AppState, code: string, name?: string, font?: string): void {
  const existing = state.settings.languages ?? [];
  const at = existing.findIndex((l) => l.code === code);
  if (at >= 0) {
    const patch: Partial<LanguageTarget> = {};
    if (name) patch.name = name;
    if (font !== undefined) patch.font = font;
    state.settings.languages = Object.keys(patch).length
      ? existing.map((l, i) => (i === at ? { ...l, ...patch } : l))
      : existing;
  } else {
    state.settings.languages = [...existing, { code, name: name || code, ...(font ? { font } : {}) }];
  }
}

// Ensure slide.translations[code] exists (empty text falls back to base at
// render time) and return it, so a per-locale screenshot can attach to it.
function ensureTranslation(slide: Slide, code: string): SlideText {
  const current = slide.translations?.[code] ?? { title: "", subhead: "" };
  slide.translations = { ...slide.translations, [code]: current };
  return slide.translations[code];
}

function summarize(state: AppState, id: string): string {
  const d = outputForSettings(state.settings);
  const lines = state.slides.map(
    (s, i) => `  ${i + 1}. "${s.title}" — "${s.subhead}"${getImageAsset(s, state.settings.platform).imageDataUrl ? " [screenshot]" : " [no screenshot]"}`,
  );
  return `Project "${id}" — active target ${state.settings.platform}, output ${d.label} (${d.width}x${d.height}px), targets ${(state.settings.targets ?? [state.settings.platform]).join(", ")}, font ${state.settings.fontFamily}, ${state.slides.length} slides:\n${lines.join("\n")}`;
}

// Swap a slide's title/subhead to a language's translation. Mirrors
// resolveSlide in src/App.tsx exactly: `lang === ""` is the source text, and
// any blank translated field falls back to the source string.
function resolveSlide(slide: Slide, lang: string, target: string): Slide {
  const asset = getImageAsset(slide, target, lang);
  if (!lang) return { ...slide, image: asset.image ?? null, imageDataUrl: asset.imageDataUrl };
  const t = slide.translations?.[lang];
  if (!t) return { ...slide, image: asset.image ?? null, imageDataUrl: asset.imageDataUrl };
  return {
    ...slide,
    title: t.title?.trim() ? t.title : slide.title,
    subhead: t.subhead?.trim() ? t.subhead : slide.subhead,
    image: asset.image ?? null,
    imageDataUrl: asset.imageDataUrl,
  };
}

// Render one slide at full frame resolution, optionally downscaled.
async function renderSlideCanvas(slides: Slide[], settings: Settings, i: number, scale: number): Promise<Canvas> {
  const full = makeCanvas(1, 1); // paintSlide resizes to frame dims
  await paintSlide(full as unknown as CanvasLike, slides[i], settings, i, slides.length);
  return scaled(full, scale);
}

function scaled(c: Canvas, scale: number): Canvas {
  if (scale === 1) return c;
  const out = makeCanvas(Math.round(c.width * scale), Math.round(c.height * scale));
  out.getContext("2d").drawImage(c, 0, 0, out.width, out.height);
  return out;
}

function previewOf(c: Canvas): { type: "image"; data: string; mimeType: string } {
  const w = 400;
  const p = scaled(c, Math.min(1, w / c.width));
  return { type: "image", data: pngBuffer(p).toString("base64"), mimeType: "image/png" };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------
export function registerTools(server: McpServer): void {
  server.registerTool(
    "list_options",
    {
      title: "List capabilities and style options",
      description:
        "Start here. Lists Truepane's complete agent workflow and every valid platform, output, font, " +
        "background, and composition option, including bulk import, multi-target sets, linked devices, " +
        "preflight, brand kits, custom outputs, and changed-only release exports.",
      inputSchema: {},
    },
    async () => {
      const platforms = PLATFORMS.map((p) => {
        const d = dimFor(p.id);
        return `- "${p.id}": ${p.label} — ${p.storeLabel} — exports ${d.W}x${d.H}px`;
      });
      const fonts = FONT_OPTIONS.map(
        (f) => `- "${f.id}": ${f.label}${f.google ? " (Google Fonts, downloaded on demand)" : " (system font — real San Francisco on macOS if installed, else bundled Inter)"}`,
      );
      const fills = FILL_OPTIONS.map((f) => `- "${f.id}": ${f.name}`);
      const shapes = SHAPE_FAMILIES.map(
        (s) => `- "${s.id}": ${s.name}${s.seeded ? " (seeded: `seed` reshuffles, `density` 1..8 controls amount)" : ""}`,
      );
      const rings = RING_LAYOUTS.map((l) => `- "${l.id}": ${l.name}`);
      return text(
        [
          "Platforms (settings.platform):",
          ...platforms,
          "",
          "Output formats:",
          ...BUILTIN_OUTPUTS.map((output) => `- "${output.id}": ${output.label} — ${output.width}x${output.height}`),
          '- "custom": bounded custom width/height (320..8192, maximum 40 megapixels)',
          "",
          "Fonts (settings.fontFamily):",
          ...fonts,
          "",
          "Background fills (background.fill) — solid uses `color`; gradients blend `color` → `gradientColor`:",
          ...fills,
          "",
          'Shape overlays (background.shape) — drawn on top of the fill in `accent` at `accentOpacity`; "none" disables:',
          ...shapes,
          "",
          'Ring layouts (background.ringLayout, only for shape "rings"):',
          ...rings,
          "",
          'The composable family (background.shape "custom", parameters in background.customShape):',
          "- The ten families above are fixed looks you pick. \"custom\" is a parameter surface you compose,",
          "  and it is the intended place to invent a background instead of settling for the nearest preset.",
          "- It is data, never code: twelve bounded numbers and two closed enums. A project using it stays a",
          "  plain JSON file, renders identically forever, and is safe to share.",
          "- primitive: ring | disc | arc | triangle | bar | blob — what each instance is.",
          "- layout: scatter | grid | row | radial | wave — how instances are arranged.",
          "- count (1..200): instances across the WHOLE strip, not per slide, so density means the same",
          "  thing on a 3-slide and a 6-slide project. For layout \"grid\" it caps the lattice.",
          "- size (0..1): radius in slide-width units. sizeJitter (0..1) varies it (and wobbles the lattice).",
          "- rotation (-180..180) and rotationJitter (0..360), in degrees.",
          "- spacingX / spacingY (0.02..2): lattice step in slide-width / slide-height units. For \"wave\",",
          "  spacingY is the amplitude; for \"radial\" the two are the horizontal and vertical ring steps.",
          "- phase (0..1): shifts the lattice along the strip — the knob to nudge shapes off the titles.",
          "- strokeWidth (0..40): outline width in export px; 0 fills instead of stroking.",
          "- opacityRamp (-1..1): 0 flat, +1 fades in from the first slide, -1 fades out toward the last.",
          "- Instances are laid out across the whole strip and culled per slide, so a multi-slide strip is",
          "  one continuous composition with no seam at slide boundaries. `seed` reshuffles the jitter.",
          "- Worked example — sparse outlined rings drifting up the strip and fading in:",
          '    set_style { background: { shape: "custom", accent: "#c47c3b", accentOpacity: 0.5, seed: 12,',
          '      customShape: { primitive: "ring", layout: "wave", count: 22, size: 0.16, sizeJitter: 0.5,',
          '        spacingX: 0.42, spacingY: 0.18, phase: 0.25, strokeWidth: 6, opacityRamp: 0.6 } } }',
          "  Then iterate one field at a time: raise count for density, raise strokeWidth for weight, set",
          '  strokeWidth 0 for solid shapes, change primitive to "blob" for a softer read.',
          "",
          "Background image (an optional layer painted between the fill and the shapes):",
          "- Set the bytes with set_background_image (absolute path; downscaled and re-encoded server-side).",
          '- background.image.span: "slide" fits one slide; "strip" fits slide width x slide count and slices ' +
            "it by slide, so one long backdrop flows continuously across the whole strip with no seam.",
          '- background.image.fit: "cover" (fills and crops) | "contain" (fits and letterboxes).',
          "- background.image.opacity (0..1) blends the image into the fill; background.image.scrim (0..1) " +
            "washes background.image.scrimColor over it — scrim is the control that keeps titles readable.",
          "- background.image.useScreenshotBlur:true derives the backdrop from each slide's own screenshot, " +
            "blurred by background.image.blur (0..1). It costs no storage and is always slide-span.",
          "- Without slide_index the image applies to every slide; with slide_index it is that slide's override.",
          "",
          `Composition presets: ${COMPOSITION_PRESETS.map((p) => `"${p.id}" (${p.name})`).join(", ")}. ` +
            "Device rotation is flat 2D and bounded to -20..20 degrees.",
          "",
          "Capabilities and tools:",
          "- Build/edit projects: create_project, set_slides, set_screenshots, set_translations",
          "- Multi-target or bulk media: create_project targets, set_screenshots target/language, import_screenshots (dry-run first)",
          "- Custom backdrops: set_background_image (one slide, every slide, or one image sliced across the strip)",
          "- Compose freely: set_style composition controls normalized text/device position, size, and rotation",
          "- Span one linked device across adjacent slides: span_device_across_slides (media and geometry stay synchronized)",
          "- Reuse visual systems: export_brand_kit, apply_brand_kit",
          "- Native, Google Play feature, or custom canvases: set_output",
          "- Release safety: validate_project, compare_release, set_release_baseline, render changed_only",
          "- Human handoff: export_project and load_project round-trip with the web editor",
          "",
          "Recommended workflow: create_project → set/import screenshots → set_style → validate_project → render → inspect preview → adjust → render.",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create a screenshot project",
      description:
        `Create a named in-memory project from slide texts and local screenshot files. Platforms: ${platformList}. ` +
        "Screenshots are read from absolute local paths (PNG/JPEG/WebP), ideally raw device/simulator captures " +
        "matching the device screen aspect; they are scaled to fill the device screen and center-cropped. " +
        "Slides without a screenshot render a placeholder. After creating, style with set_style, then call render.",
      inputSchema: {
        id: z.string().optional().describe("Project id (slug). Auto-generated if omitted."),
        targets: z
          .array(z.enum(PLATFORM_IDS as [string, ...string[]]))
          .optional()
          .describe("Platform targets included in the project. The first is active."),
        platform: z
          .enum(PLATFORM_IDS as [string, ...string[]])
          .optional()
          .describe(`Device frame. One of: ${PLATFORM_IDS.join(", ")}. Default "ios".`),
        slides: z
          .array(
            z.object({
              title: z.string().describe("Headline drawn above the device"),
              subhead: z.string().optional().describe("Smaller line under the title"),
              screenshot_path: z.string().optional().describe("Absolute path to a screenshot file"),
            }),
          )
          .min(1)
          .describe("Slides in order (1-8 typical)"),
      },
    },
    async ({ id, platform, targets, slides }) => {
      if (platform) assertPlatform(platform);
      const project = createProject(id);
      const state = project.state;
      const selectedTargets = targets?.length ? Array.from(new Set(targets)) : [platform ?? state.settings.platform];
      state.settings.targets = selectedTargets;
      state.settings.platform = platform ?? selectedTargets[0];
      const notes: string[] = [];
      state.slides = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const slide: Slide = { title: s.title, subhead: s.subhead ?? "", image: null, imageDataUrl: null };
        if (s.screenshot_path) {
          const asset = { image: null, imageDataUrl: null };
          await applyScreenshot(asset, s.screenshot_path, state.settings.platform, `slide ${i + 1}`, notes);
          Object.assign(slide, setImageAsset(slide, state.settings.platform, "", asset));
        }
        state.slides.push(slide);
      }
      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return text(`${summarize(state, project.id)}${noteBlock}\nNext: set_style to pick colors/background, then render.`);
    },
  );

  server.registerTool(
    "set_slides",
    {
      title: "Replace slide texts",
      description:
        "Replace the project's slide list (full-array replace — send ALL slides in final order). Each slide keeps " +
        "its existing screenshot by position unless a screenshot_path is given for it; use set_screenshots to change " +
        "images only. Reorder/add/remove by sending the array you want.",
      inputSchema: {
        project_id: z.string().describe("Project id from create_project"),
        slides: z
          .array(
            z.object({
              title: z.string(),
              subhead: z.string().optional(),
              screenshot_path: z.string().optional().describe("Absolute path; omit to keep the screenshot currently at this position"),
            }),
          )
          .min(1),
      },
    },
    async ({ project_id, slides }) => {
      const project = getProject(project_id);
      const state = project.state;
      const notes: string[] = [];
      const next: Slide[] = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const prev = state.slides[i];
        const slide: Slide = {
          title: s.title,
          subhead: s.subhead ?? "",
          image: prev?.image ?? null,
          imageDataUrl: prev?.imageDataUrl ?? null,
          media: prev?.media,
          background: prev?.background,
          composition: prev?.composition,
          deviceSpan: prev?.deviceSpan,
          titleColor: prev?.titleColor,
          subheadColor: prev?.subheadColor,
          translations: prev?.translations,
        };
        if (s.screenshot_path) {
          const asset = { image: null, imageDataUrl: null };
          await applyScreenshot(asset, s.screenshot_path, state.settings.platform, `slide ${i + 1}`, notes);
          Object.assign(slide, setImageAsset(slide, state.settings.platform, "", asset));
        }
        next.push(slide);
      }
      state.slides = next;
      for (let i = 0; i < slides.length; i++) {
        if (slides[i].screenshot_path) state.slides = mirrorSpannedMedia(state.slides, i);
      }
      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return text(`${summarize(state, project.id)}${noteBlock}`);
    },
  );

  server.registerTool(
    "set_screenshots",
    {
      title: "Attach screenshots to slides",
      description:
        "Attach or replace screenshots on existing slides by 0-based index, from absolute local file paths " +
        "(PNG/JPEG/WebP). Images are scaled to fill the device screen and center-cropped; aspect mismatches are " +
        "reported as warnings, not errors. Pass language (a locale code, e.g. \"ar\") to set a screenshot for " +
        "just that locale instead of the base slide — useful when your app UI is itself localized, so each " +
        'language renders its own screenshot. A locale screenshot with no translated text still falls back to ' +
        "the base title/subhead; the locale is added to settings.languages so render language:\"all\" includes " +
        "it. Omit language to set the base screenshot (used by every locale that has none of its own).",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        screenshots: z
          .array(
            z.object({
              index: z.number().int().min(0).describe("0-based slide index"),
              path: z.string().describe("Absolute path to the screenshot file"),
              target: z
                .enum(PLATFORM_IDS as [string, ...string[]])
                .optional()
                .describe("Platform target. Defaults to the active target for v1 compatibility."),
              language: z
                .string()
                .optional()
                .describe('Locale code for a per-language screenshot (e.g. "ar"); omit for the base slide'),
              language_name: z
                .string()
                .optional()
                .describe('Human label when introducing a new language (e.g. "Arabic"); defaults to the code'),
            }),
          )
          .min(1),
      },
    },
    async ({ project_id, screenshots }) => {
      const project = getProject(project_id);
      const state = project.state;
      const notes: string[] = [];
      for (const { index, path: p, target, language, language_name } of screenshots) {
        if (index >= state.slides.length) {
          throw new Error(`Slide index ${index} out of range (project has ${state.slides.length} slides).`);
        }
        const slide = state.slides[index];
        const platformTarget = target ?? state.settings.platform;
        const asset = { image: null, imageDataUrl: null };
        await applyScreenshot(
          asset,
          p,
          platformTarget,
          `slide ${index + 1} [${platformTarget}${language ? `/${language}` : ""}]`,
          notes,
        );
        state.slides[index] = setImageAsset(slide, platformTarget, language ?? "", asset);
        state.slides = mirrorSpannedMedia(state.slides, index);
        state.settings.targets = Array.from(new Set([...(state.settings.targets ?? []), platformTarget]));
        if (language) {
          ensureTranslation(state.slides[index], language);
          mergeLanguage(state, language, language_name);
        }
      }
      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return text(`${summarize(state, project.id)}${noteBlock}`);
    },
  );

  server.registerTool(
    "import_screenshots",
    {
      title: "Preview or apply a screenshot folder",
      description:
        "Deterministically map a local screenshot directory to target/locale/slide slots. " +
        "Defaults to a read-only dry run. Files named target/locale/NN-name.png map explicitly; " +
        "otherwise known dimensions and filename tokens are used. Conflicts are reported and never overwritten.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        directory: z.string().describe("Absolute directory containing PNG/JPEG/WebP screenshots"),
        dry_run: z.boolean().optional().describe("Preview only (default true)"),
        apply: z.boolean().optional().describe("Must be true to apply non-conflicting mappings"),
      },
    },
    async ({ project_id, directory, dry_run, apply }) => {
      if (!path.isAbsolute(directory)) throw new Error(`directory must be absolute, got: ${directory}`);
      const root = path.resolve(directory);
      if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
      const project = getProject(project_id);
      const state = project.state;
      const targets = state.settings.targets ?? [state.settings.platform];
      const languages = (state.settings.languages ?? []).map((language) => language.code);
      const files = imageFilesUnder(root);
      const descriptors = await Promise.all(files.map(async (file, index) => {
        const image = await tryLoadImage(fs.readFileSync(file.absolutePath));
        return {
          id: String(index),
          name: file.relativePath,
          width: image?.width ?? 0,
          height: image?.height ?? 0,
        };
      }));
      const occupied = new Set<string>();
      state.slides.forEach((slide, slideIndex) => {
        for (const target of targets) {
          for (const language of ["", ...languages]) {
            if (getImageAsset(slide, target, language).imageDataUrl) {
              occupied.add(bulkSlotKey({ slideIndex, target, language }));
            }
          }
        }
      });
      const proposal = mapBulkImport(descriptors, {
        slideCount: state.slides.length,
        targets,
        languages,
        occupied,
      });
      const shouldApply = apply === true && dry_run !== true;
      let applied = 0;
      if (shouldApply) {
        for (const assignment of proposal.assignments) {
          if (assignment.conflict) continue;
          const file = files[Number(assignment.file.id)];
          if (!file) continue;
          const loaded = await loadScreenshot(file.absolutePath);
          state.slides[assignment.slot.slideIndex] = setImageAsset(
            state.slides[assignment.slot.slideIndex],
            assignment.slot.target,
            assignment.slot.language,
            { image: loaded.image, imageDataUrl: loaded.dataUrl },
          );
          state.slides = mirrorSpannedMedia(state.slides, assignment.slot.slideIndex);
          applied++;
        }
      }
      const mapped = proposal.assignments.map((item) =>
        `- ${item.file.name} -> ${item.slot.target}/${item.slot.language || "source"}/slide-${item.slot.slideIndex + 1}` +
        `${item.conflict ? ` [${item.conflict}]` : ""}`,
      );
      const unmapped = proposal.unmapped.map((item) => `- ${item.file.name} [${item.reason}]`);
      return text([
        shouldApply ? `Applied ${applied} screenshot(s).` : "Dry run only; project was not changed.",
        mapped.length ? `Mapped:\n${mapped.join("\n")}` : "Mapped: none",
        unmapped.length ? `Unmapped:\n${unmapped.join("\n")}` : "Unmapped: none",
        shouldApply ? "" : "Call again with apply:true and dry_run:false to apply non-conflicting mappings.",
      ].filter(Boolean).join("\n"));
    },
  );

  server.registerTool(
    "set_background_image",
    {
      title: "Set or clear the background image",
      description:
        "Put a custom image behind the slides. The image is read from an absolute local path, downscaled " +
        "and re-encoded server-side, so an agent cannot write an oversized payload. " +
        'span "slide" fits one slide; span "strip" fits the whole strip (slide width x slide count) and ' +
        "slices it by slide, which is how one long backdrop flows continuously across the export. " +
        "Without slide_index the image applies to every slide; with slide_index it becomes that slide's " +
        "override. Pass clear:true to remove it. " +
        "Tune opacity, scrim, fit, and scrimColor afterwards with set_style background.image; " +
        "for a backdrop derived from the slide's own screenshot use set_style background.image.useScreenshotBlur " +
        "instead of this tool — it costs no storage.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        image_path: z
          .string()
          .optional()
          .describe("Absolute path to a PNG/JPEG/WebP image. Required unless clear:true."),
        slide_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("If set, apply to this slide only instead of every slide"),
        span: z
          .enum(["slide", "strip"])
          .optional()
          .describe('"slide" (default) fits one slide; "strip" spreads one image across the whole strip'),
        clear: z.boolean().optional().describe("Remove the background image instead of setting one"),
      },
    },
    async ({ project_id, image_path, slide_index, span, clear }) => {
      const project = getProject(project_id);
      const state = project.state;
      const slide = slide_index === undefined ? null : state.slides[slide_index];
      if (slide_index !== undefined && !slide) {
        throw new Error(`Slide index ${slide_index} out of range (project has ${state.slides.length} slides).`);
      }

      const write = (background: Background): void => {
        if (slide) slide.background = background;
        else state.settings.background = background;
      };
      const current = slide ? slide.background ?? state.settings.background : state.settings.background;

      if (clear) {
        write(normalizeBackground({ ...current, image: null }));
        return text(
          `Cleared the background image ${slide ? `on slide ${slide_index}` : "for every slide"}.\n${summarize(state, project.id)}`,
        );
      }
      if (!image_path) throw new Error("Pass image_path, or clear:true to remove the background image.");

      const { image } = await loadScreenshot(image_path);
      if (!image) throw new Error(`Could not decode image at ${image_path}.`);

      // Prepared against the whole strip, the largest box it could be painted
      // into, so switching span later never needs a re-import.
      const frame = getRenderFrame(state.settings.platform, state.settings.output);
      const prepared = await prepareBackgroundImage(image, {
        width: frame.W * Math.max(1, state.slides.length),
        height: frame.H,
      });
      // The renderer is synchronous: it looks the decoded pixels up by content
      // id rather than decoding mid-draw, so registering is not optional.
      const decoded = await tryLoadImage(Buffer.from(prepared.source.dataUrl.split(",")[1] ?? "", "base64"));
      if (!decoded) throw new Error("Re-encoded background image could not be decoded.");
      registerBackgroundImage(prepared.source.id, decoded as unknown as ImageSourceLike);

      write(
        normalizeBackground({
          ...current,
          image: {
            ...backgroundImageFromUpload(prepared, span ?? "slide"),
            // Keep the placement the user already chose, if any.
            ...(current.image
              ? {
                  fit: current.image.fit,
                  opacity: current.image.opacity,
                  scrim: current.image.scrim,
                  scrimColor: current.image.scrimColor,
                }
              : {}),
            span: span ?? current.image?.span ?? "slide",
          },
        }),
      );

      const notes = [
        `Background image set ${slide ? `on slide ${slide_index}` : "for every slide"}: ` +
          `${prepared.source.width}x${prepared.source.height}, span "${span ?? current.image?.span ?? "slide"}".`,
      ];
      if (prepared.warning) notes.push(prepared.warning);
      notes.push(
        `Destination box is ${frame.W * Math.max(1, state.slides.length)}x${frame.H} for a full-strip background, ${frame.W}x${frame.H} for one slide.`,
      );
      return text(`${notes.join("\n")}\n${summarize(state, project.id)}`);
    },
  );

  server.registerTool(
    "span_device_across_slides",
    {
      title: "Span a device across two slides",
      description:
        "Place one identical device across the boundary between an adjacent slide pair. " +
        "The left slide exports the left half and the next slide exports the right half; their text and backgrounds remain independent.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        left_slide_index: z.number().int().min(0).describe("0-based index of the first slide"),
      },
    },
    async ({ project_id, left_slide_index }) => {
      const project = getProject(project_id);
      const state = project.state;
      if (left_slide_index >= state.slides.length - 1) {
        throw new Error("The first slide must have a following slide.");
      }
      const [left, right] = spanDeviceAcrossPair(
        state.slides[left_slide_index],
        state.slides[left_slide_index + 1],
        state.settings.composition,
        getRenderFrame(state.settings.platform, state.settings.output),
        `span-${Date.now()}-${left_slide_index}`,
      );
      state.slides[left_slide_index] = left;
      state.slides[left_slide_index + 1] = right;
      return text(`Spanned one device across slides ${left_slide_index} and ${left_slide_index + 1}.\n${summarize(state, project.id)}`);
    },
  );

  server.registerTool(
    "set_style",
    {
      title: "Set typography, colors, background",
      description:
        "Patch project style. Without slide_index, patches global settings: fontFamily (see list_options), " +
        "titleColor/subheadColor (CSS colors), titleScale/subtitleScale (multipliers, ~0.5-1.5), " +
        "titleWeight/subtitleWeight (font weight 100..900; default 700/400), platform " +
        `(${PLATFORM_IDS.join(" | ")}), and background — a partial patch merged onto the current background. ` +
        "Background fields: fill (solid|linear|radial), shape (see list_options), color, gradientColor, accent, " +
        "accentOpacity (0..1), ringLayout, ringCount (1..8), seed, density (1..8), dotsAligned, gradientAngle. " +
        'With shape "custom", background.customShape carries the composable parameters (primitive, layout, count, ' +
        "size, spacing, rotation, strokeWidth, opacityRamp) — see list_options for the ranges and a worked example. " +
        "Composition supports a preset plus normalized text/device placement, scale, and flat rotation (-20..20). " +
        "With slide_index (0-based), background/titleColor/subheadColor/composition apply as per-slide overrides instead " +
        "(other fields are global-only and rejected). With language (a locale code, e.g. \"ar\"), fontFamily " +
        "sets that locale's font override — used only when rendering that language, while the base keeps the " +
        "global font (pass only fontFamily). Re-render after changes to see the result.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        slide_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("If set, apply background/titleColor/subheadColor to this slide only"),
        language: z
          .string()
          .optional()
          .describe('If set (a locale code, e.g. "ar"), fontFamily becomes that language\'s font override'),
        fontFamily: z
          .enum(FONT_IDS as [string, ...string[]])
          .optional()
          .describe("Font id from list_options (global only)"),
        titleColor: z.string().optional().describe("Title color, e.g. #1a1612"),
        subheadColor: z.string().optional().describe("Subhead color, e.g. rgba(26,22,18,0.62)"),
        titleScale: z.number().min(0.3).max(2).optional().describe("Title size multiplier (global only)"),
        subtitleScale: z.number().min(0.3).max(2).optional().describe("Subhead size multiplier (global only)"),
        titleWeight: z.number().int().min(100).max(900).optional().describe("Title font weight 100..900, default 700 (global only)"),
        subtitleWeight: z.number().int().min(100).max(900).optional().describe("Subhead font weight 100..900, default 400 (global only)"),
        platform: z
          .enum(PLATFORM_IDS as [string, ...string[]])
          .optional()
          .describe("Switch device frame (global only)"),
        background: backgroundSchema.optional().describe("Partial background patch"),
        composition: compositionSchema.optional().describe(
          "Composition preset and optional text/device placement. Device x/y are normalized canvas coordinates; rotation is -20..20 degrees.",
        ),
      },
    },
    async ({ project_id, slide_index, language, fontFamily, titleColor, subheadColor, titleScale, subtitleScale, titleWeight, subtitleWeight, platform, background, composition }) => {
      const project = getProject(project_id);
      const state = project.state;
      if (language !== undefined) {
        if (slide_index !== undefined) throw new Error("Pass either language or slide_index, not both.");
        if (!fontFamily) throw new Error('set_style with language sets that locale\'s font — pass fontFamily (a font id from list_options).');
        if (titleColor !== undefined || subheadColor !== undefined || background || composition || titleScale !== undefined || subtitleScale !== undefined || titleWeight !== undefined || subtitleWeight !== undefined || platform) {
          throw new Error("With language, only fontFamily is applied (per-language font override). Set colors/background/scale/weight/platform without language.");
        }
        mergeLanguage(state, language, undefined, fontFamily);
        return text(`Set the font for language "${language}" to "${fontFamily}" (base keeps "${state.settings.fontFamily}").\n${summarize(state, project.id)}`);
      }
      if (slide_index !== undefined) {
        if (fontFamily || titleScale !== undefined || subtitleScale !== undefined || titleWeight !== undefined || subtitleWeight !== undefined || platform) {
          throw new Error(
            "fontFamily/titleScale/subtitleScale/titleWeight/subtitleWeight/platform are global settings — call set_style without slide_index to change them.",
          );
        }
        const slide = state.slides[slide_index];
        if (!slide) throw new Error(`Slide index ${slide_index} out of range (project has ${state.slides.length} slides).`);
        if (titleColor !== undefined) slide.titleColor = titleColor;
        if (subheadColor !== undefined) slide.subheadColor = subheadColor;
        if (background) {
          slide.background = patchBackground(slide.background ?? state.settings.background, background);
        }
        if (composition) {
          const nextComposition = normalizeComposition({
            ...(slide.composition ?? state.settings.composition),
            ...composition,
            text: { ...(slide.composition ?? state.settings.composition)?.text, ...composition.text },
            device: { ...(slide.composition ?? state.settings.composition)?.device, ...composition.device },
          });
          state.slides = updateSpannedComposition(
            state.slides,
            slide_index,
            nextComposition,
            getRenderFrame(state.settings.platform, state.settings.output),
          );
        }
        return text(`Updated slide ${slide_index} overrides.\n${summarize(state, project.id)}`);
      }
      if (platform) {
        assertPlatform(platform);
        state.settings.platform = platform;
        state.settings.targets = Array.from(new Set([...(state.settings.targets ?? []), platform]));
      }
      if (fontFamily) state.settings.fontFamily = fontFamily;
      if (titleColor !== undefined) state.settings.titleColor = titleColor;
      if (subheadColor !== undefined) state.settings.subheadColor = subheadColor;
      if (titleScale !== undefined) state.settings.titleScale = titleScale;
      if (subtitleScale !== undefined) state.settings.subtitleScale = subtitleScale;
      if (titleWeight !== undefined) state.settings.titleWeight = titleWeight;
      if (subtitleWeight !== undefined) state.settings.subtitleWeight = subtitleWeight;
      if (background) {
        state.settings.background = patchBackground(state.settings.background, background);
      }
      if (composition) {
        state.settings.composition = normalizeComposition({
          ...state.settings.composition,
          ...composition,
          text: { ...state.settings.composition?.text, ...composition.text },
          device: { ...state.settings.composition?.device, ...composition.device },
        });
      }
      return text(
        `Style updated. Background now: ${backgroundJson(state.settings.background)}\n${summarize(state, project.id)}`,
      );
    },
  );

  server.registerTool(
    "apply_brand_kit",
    {
      title: "Apply a brand kit file",
      description:
        "Apply typography, text colors, background, and default composition from a local .truepane-brand.json file. " +
        "Targets, slides, screenshots, translations, and release data are preserved. Per-slide overrides are preserved by default.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        path: z.string().describe("Absolute path to a .truepane-brand.json file"),
        clear_slide_overrides: z.boolean().optional().describe(
          "Before applying, clear every slide-specific background, text-color, and composition override so all slides inherit the kit",
        ),
      },
    },
    async ({ project_id, path: kitPath, clear_slide_overrides }) => {
      if (!path.isAbsolute(kitPath)) throw new Error(`Brand kit path must be absolute, got: ${kitPath}`);
      const stat = fs.statSync(kitPath);
      if (stat.size > MAX_BRAND_KIT_BYTES) throw new Error("Brand kit file is too large.");
      const kit = normalizeBrandKit(JSON.parse(fs.readFileSync(kitPath, "utf8")));
      const project = getProject(project_id);
      project.state = applyBrandKit(project.state, kit, clear_slide_overrides === true);
      // A kit can carry a brand backdrop; the renderer only paints images it
      // has been handed by content id.
      await hydrateBackgroundImages(project.state);
      return text(`Applied brand kit "${kit.name}"${clear_slide_overrides ? " and cleared slide overrides" : ""}.\n${summarize(project.state, project.id)}`);
    },
  );

  server.registerTool(
    "export_brand_kit",
    {
      title: "Export a brand kit file",
      description:
        "Write this project's current typography, colors, background, custom font, and default composition to a portable brand kit file.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        path: z.string().describe("Absolute output path, conventionally ending .truepane-brand.json"),
        name: z.string().optional().describe("Brand kit display name"),
      },
    },
    async ({ project_id, path: kitPath, name }) => {
      if (!path.isAbsolute(kitPath)) throw new Error(`Brand kit path must be absolute, got: ${kitPath}`);
      const project = getProject(project_id);
      const kit = brandKitFromSettings(name ?? project.id, project.state.settings);
      fs.mkdirSync(path.dirname(kitPath), { recursive: true });
      fs.writeFileSync(kitPath, JSON.stringify(kit, null, 2));
      return text(`Exported brand kit "${kit.name}" to ${kitPath}`);
    },
  );

  server.registerTool(
    "set_output",
    {
      title: "Set output canvas",
      description:
        "Choose a native store screenshot, the 1024x500 Google Play feature graphic, or bounded custom dimensions. " +
        "The device frame remains procedural and is never stretched.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        output_id: z.enum(OUTPUT_CHOICES).describe("Built-in output id or custom"),
        width: z.number().optional().describe("Custom width in whole pixels; required with height for output_id custom (320..8192)"),
        height: z.number().optional().describe("Custom height in whole pixels; required with width for output_id custom (320..8192)"),
        frame: z.enum(PLATFORM_IDS as [string, ...string[]]).optional().describe("Device frame/source target"),
      },
    },
    async ({ project_id, output_id, width, height, frame }) => {
      const project = getProject(project_id);
      const state = project.state;
      const builtin = BUILTIN_OUTPUTS.find((output) => output.id === output_id);
      const customDimensions = output_id === "custom"
        ? customOutputDimensions(width, height)
        : undefined;
      if (builtin?.kind === "native") {
        state.settings.platform = builtin.frame;
        state.settings.output = undefined;
      } else {
        state.settings.output = normalizeOutput(
          builtin
            ? { ...builtin, frame: frame ?? builtin.frame }
            : {
                id: "custom",
                label: "Custom output",
                width: customDimensions?.width,
                height: customDimensions?.height,
                store: getFrame(frame ?? state.settings.platform).store,
                frame: frame ?? state.settings.platform,
              },
          frame ?? state.settings.platform,
        );
        if (state.settings.output) state.settings.platform = state.settings.output.frame;
      }
      state.settings.targets = Array.from(new Set([...(state.settings.targets ?? []), state.settings.platform]));
      const output = outputForSettings(state.settings);
      return text(`Output set to "${output.id}" (${output.width}x${output.height}) with frame "${output.frame}".`);
    },
  );

  server.registerTool(
    "validate_project",
    {
      title: "Run release preflight",
      description:
        "Return the same ordered release-preflight issues shown by the web editor. Validation is advisory; " +
        "stable issue codes are suitable for automation.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
      },
    },
    async ({ project_id }) => {
      const project = getProject(project_id);
      const issues = validateProject(project.state);
      if (!issues.length) return text("Preflight passed: no issues.");
      return text([
        `Preflight found ${issues.length} issue(s):`,
        ...issues.map((issue) =>
          `- [${issue.severity}] ${issue.code} target=${issue.target} language=${issue.language || "source"} slide=${issue.slide + 1}: ${issue.message}`,
        ),
      ].join("\n"));
    },
  );

  server.registerTool(
    "compare_release",
    {
      title: "Compare with release baseline",
      description:
        "Compare deterministic slide/output/locale signatures with the explicit saved release baseline. " +
        "Returns added, changed, unchanged, and removed assets without rendering PNGs or changing the baseline.",
      inputSchema: { project_id: z.string().describe("Project id") },
    },
    async ({ project_id }) => {
      const state = getProject(project_id).state;
      const rows = await compareRelease(state);
      const counts = Object.fromEntries(["added", "changed", "unchanged", "removed"].map((status) => [
        status,
        rows.filter((row) => row.status === status).length,
      ]));
      return text([
        `Release comparison: ${JSON.stringify(counts)}`,
        ...rows.map((row) => `- [${row.status}] ${row.key}`),
      ].join("\n"));
    },
  );

  server.registerTool(
    "set_release_baseline",
    {
      title: "Set release baseline",
      description:
        "Explicitly replace the project's release baseline with deterministic signatures for the current assets. " +
        "Previewing, importing, validating, and rendering never call this automatically.",
      inputSchema: { project_id: z.string().describe("Project id") },
    },
    async ({ project_id }) => {
      const project = getProject(project_id);
      project.state.releaseBaseline = await createReleaseBaseline(project.state);
      return text(`Release baseline set with ${Object.keys(project.state.releaseBaseline.signatures).length} asset signature(s).`);
    },
  );

  server.registerTool(
    "render",
    {
      title: "Render PNGs to disk",
      description:
        "Render the project to PNG files at full store resolution (e.g. ios = 1320x2868) and return the absolute " +
        "output paths plus a small inline preview image of the first slide (or the strip) so you can inspect the " +
        'result. what: "slides" writes slide-01.png, slide-02.png, …; "strip" writes strip.png (all slides ' +
        'side by side — backgrounds flow continuously across it); "both" writes both. Pass scale (e.g. 0.25) for ' +
        'smaller draft output. language: omit for the base text; a language code (e.g. "es") renders that ' +
        'translation (blank/missing fields fall back to base text); "all" writes per-language subfolders of ' +
        "output_dir — source/ plus one per settings.languages code, same layout as the web app's all-languages " +
        "ZIP (add languages with set_translations first). Each language renders in its own font override when " +
        "set (see set_translations font / set_style language), else the global font. Fonts are " +
        "fetched/registered automatically before rendering. Iterate: render → look at preview → set_style → render again.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        output_dir: z.string().describe("Absolute directory for the PNGs (created if missing)"),
        what: z.enum(["slides", "strip", "both"]).optional().describe('What to render. Default "slides".'),
        scale: z.number().gt(0).max(1).optional().describe("Downscale factor for draft output (default 1 = full store resolution)"),
        target: z
          .union([z.enum(PLATFORM_IDS as [string, ...string[]]), z.literal("all")])
          .optional()
          .describe('Platform target. Omit = active target; "all" = every settings.targets target.'),
        output_id: z.enum(OUTPUT_CHOICES).optional()
          .describe("Temporary output override for this render"),
        output_width: z.number().optional().describe("Custom width in whole pixels; required with output_height for custom output (320..8192)"),
        output_height: z.number().optional().describe("Custom height in whole pixels; required with output_width for custom output (320..8192)"),
        output_frame: z.enum(PLATFORM_IDS as [string, ...string[]]).optional().describe("Device frame for feature/custom output"),
        changed_only: z.boolean().optional().describe("Write only added/changed assets compared with the explicit release baseline"),
        language: z
          .string()
          .optional()
          .describe('Omit = base text; a language code = that translation; "all" = per-language subfolders'),
      },
    },
    async ({ project_id, output_dir, what, scale, target, output_id, output_width, output_height, output_frame, changed_only, language }) => {
      const project = getProject(project_id);
      const state = project.state;
      if (!path.isAbsolute(output_dir)) throw new Error(`output_dir must be an absolute path, got: ${output_dir}`);
      if (changed_only && output_id) throw new Error("changed_only uses the project's persisted output; set_output before comparing/rendering.");
      const customDimensions = output_id === "custom"
        ? customOutputDimensions(output_width, output_height)
        : undefined;
      await ensureFontsForState(state);
      const mode = what ?? "slides";
      const k = scale ?? 1;
      const notes: string[] = [];
      const renderOutput = output_id
        ? normalizeOutput(
            output_id === "custom"
              ? {
                  id: "custom",
                  label: "Custom output",
                  width: customDimensions?.width,
                  height: customDimensions?.height,
                  store: getFrame(output_frame ?? state.settings.platform).store,
                  frame: output_frame ?? state.settings.platform,
                }
              : {
                  ...BUILTIN_OUTPUTS.find((output) => output.id === output_id),
                  frame: output_frame ?? BUILTIN_OUTPUTS.find((output) => output.id === output_id)?.frame,
                },
            output_frame ?? state.settings.platform,
          )
        : state.settings.output;
      const preflightIssues = validateProject(state);
      if (preflightIssues.length) {
        const codes = Array.from(new Set(preflightIssues.map((issue) => issue.code)));
        notes.push(`preflight: ${preflightIssues.length} advisory issue(s) (${codes.join(", ")}); run validate_project for the full matrix`);
      }

      // Which languages go where. Mirrors exportAllLanguages in src/App.tsx:
      // "all" = source/ + one folder per settings.languages code.
      const lang = language ?? "";
      let languageTargets: { code: string; folder: string }[];
      if (lang === "all") {
        const langs = state.settings.languages ?? [];
        if (langs.length === 0) notes.push('language "all": project has no settings.languages — only source/ was written (run set_translations first)');
        languageTargets = [
          { code: "", folder: "source" },
          ...langs.map((l) => ({ code: l.code, folder: l.code })),
        ];
      } else {
        if (lang && !state.slides.some((s) => s.translations?.[lang])) {
          notes.push(`no slide has a translation for "${lang}" — rendered base text (run set_translations first)`);
        }
        languageTargets = [{ code: lang, folder: "" }];
      }

      const out: string[] = [];
      const skipped: string[] = [];
      const releaseRows = changed_only ? await compareRelease(state) : [];
      const releaseStatus = new Map(releaseRows.map((row) => [row.key, row.status]));
      let previewCanvas: Canvas | null = null;
      const renderTargets = target === "all"
        ? (state.settings.targets ?? [state.settings.platform])
        : [target ?? state.settings.platform];
      for (const platformTarget of renderTargets) {
        assertPlatform(platformTarget);
        for (const { code, folder } of languageTargets) {
        const dir = path.join(
          output_dir,
          ...(target === "all" ? [platformTarget] : []),
          ...(folder ? [folder] : []),
        );
        fs.mkdirSync(dir, { recursive: true });
        // Per-language font override: a locale can render in its own font (e.g.
        // Noto Sans Arabic) while the base uses the global one. Falls back to
        // the global fontFamily when the language has no override.
        const langFont = code ? state.settings.languages?.find((l) => l.code === code)?.font : undefined;
        const rs: Settings = {
          ...state.settings,
          platform: platformTarget,
          output: renderOutput,
          ...(langFont ? { fontFamily: langFont } : {}),
        };
        if (langFont) await ensureFamily(langFont);
        const slides = state.slides.map((s) => resolveSlide(s, code, platformTarget));
        if (mode === "slides" || mode === "both") {
          for (let i = 0; i < slides.length; i++) {
            const key = releaseAssetKey(platformTarget, outputForSettings(rs).id, code, i);
            if (changed_only && releaseStatus.get(key) === "unchanged") {
              skipped.push(key);
              continue;
            }
            const c = await renderSlideCanvas(slides, rs, i, k);
            const file = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`);
            fs.writeFileSync(file, pngBuffer(c));
            out.push(`${file} (${c.width}x${c.height})`);
            if (!previewCanvas) previewCanvas = c;
          }
        }
        if (mode === "strip" || mode === "both") {
          const groupChanged = slides.some((_, index) => {
            const key = releaseAssetKey(platformTarget, outputForSettings(rs).id, code, index);
            return releaseStatus.get(key) !== "unchanged";
          });
          if (changed_only && !groupChanged) {
            skipped.push(`${platformTarget}/${outputForSettings(rs).id}/${code || "source"}/strip`);
            continue;
          }
          const full = makeCanvas(1, 1);
          await paintStrip(full as unknown as CanvasLike, slides, rs);
          const c = scaled(full, k);
          const file = path.join(dir, "strip.png");
          fs.writeFileSync(file, pngBuffer(c));
          out.push(`${file} (${c.width}x${c.height})`);
          if (!previewCanvas) previewCanvas = c;
        }
      }
      }

      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Rendered:\n${out.length ? out.map((f) => `- ${f}`).join("\n") : "- none"}` +
              `${skipped.length ? `\nSkipped unchanged:\n${skipped.map((key) => `- ${key}`).join("\n")}` : ""}` +
              `${noteBlock}`,
          },
          ...(previewCanvas ? [previewOf(previewCanvas)] : []),
        ],
      };
    },
  );

  server.registerTool(
    "export_project",
    {
      title: "Save project JSON",
      description:
        "Write the project as JSON to an absolute path. The file is the exact format the Truepane web app's " +
        "Import Project accepts (screenshots embedded as data URLs), so a human can open and fine-tune it later.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        path: z.string().describe("Absolute output path, e.g. /tmp/my-app/truepane-project.json"),
      },
    },
    async ({ project_id, path: filePath }) => {
      const project = getProject(project_id);
      if (!path.isAbsolute(filePath)) throw new Error(`path must be absolute, got: ${filePath}`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, projectJson(project.state));
      return text(`Saved project "${project.id}" to ${filePath}`);
    },
  );

  server.registerTool(
    "load_project",
    {
      title: "Load project JSON",
      description:
        "Load a Truepane project JSON file (from export_project or the web app's Export Project) into memory as a " +
        "new project. Returns the project id and a summary. Screenshots embedded in the file are restored.",
      inputSchema: {
        path: z.string().describe("Absolute path to the project JSON file"),
        id: z.string().optional().describe("Project id to assign (auto-generated if omitted; replaces any existing project with this id)"),
      },
    },
    async ({ path: filePath, id }) => {
      if (!path.isAbsolute(filePath)) throw new Error(`path must be absolute, got: ${filePath}`);
      const project = await loadProjectFromFile(id, filePath);
      return text(`${summarize(project.state, project.id)}\nProjects in memory: ${listProjects().join(", ")}`);
    },
  );

  server.registerTool(
    "suggest_palette_from_screenshot",
    {
      title: "Extract a palette from a screenshot",
      description:
        "Extract a color palette from a screenshot: the dominant vivid color as the shape/accent color plus a " +
        "soft near-white tint of it as the background color (same algorithm as the web app's palette button). " +
        "Applying the suggestion changes the background base/gradient-start color and shape accent only; it " +
        "does not change the fill, shape, gradient end, or layout. " +
        "Point it at a project slide (project_id + slide_index) or any local image file (image_path). Purely " +
        "local math — no AI, no network. Apply the result with set_style.",
      inputSchema: {
        project_id: z.string().optional().describe("Project id (with slide_index)"),
        slide_index: z.number().int().min(0).optional().describe("0-based slide whose screenshot to sample"),
        target: z.enum(PLATFORM_IDS as [string, ...string[]]).optional().describe("Platform target; defaults to active"),
        image_path: z.string().optional().describe("Absolute path to an image file (instead of project_id/slide_index)"),
      },
    },
    async ({ project_id, slide_index, target, image_path }) => {
      let img: Slide["image"];
      let source: string;
      if (image_path) {
        if (!path.isAbsolute(image_path)) throw new Error(`image_path must be absolute, got: ${image_path}`);
        img = (await tryLoadImage(fs.readFileSync(image_path))) as unknown as Slide["image"];
        source = image_path;
        if (!img) throw new Error(`Could not decode image at ${image_path}.`);
      } else if (project_id !== undefined && slide_index !== undefined) {
        const state = getProject(project_id).state;
        const slide = state.slides[slide_index];
        if (!slide) throw new Error(`Slide index ${slide_index} out of range (project has ${state.slides.length} slides).`);
        img = getImageAsset(slide, target ?? state.settings.platform).image ?? null;
        source = `project "${project_id}" slide ${slide_index}`;
        if (!img) throw new Error(`Slide ${slide_index} has no screenshot — attach one with set_screenshots first.`);
      } else {
        throw new Error("Pass either image_path, or project_id + slide_index.");
      }
      const p = paletteOfImage(img);
      if (!p) throw new Error(`Could not extract a palette from ${source} (no opaque pixels?).`);
      return text(
        `Palette from ${source}:\n- accent (dominant vivid color): ${p.accent}\n- background tint: ${p.color}\n` +
          `Apply with: set_style { background: { color: "${p.color}", accent: "${p.accent}" } } — then render to check.`,
      );
    },
  );

  server.registerTool(
    "set_translations",
    {
      title: "Store slide translations",
      description:
        "Store per-language translations of the slide texts. You are a language model: translate the slide " +
        "titles/subheads YOURSELF — preserve the marketing tone and keep lengths similar to the source (titles " +
        "wrap to ~2 lines on the slide) — then call this with the results. Each entry: code (folder/storage key, " +
        'e.g. "es", "pt-BR"), name (human label, e.g. "Spanish"), and slides aligned 1:1 with the project\'s ' +
        "slides (same count, same order). An empty title/subhead falls back to the base text at render time. " +
        "Translations are stored on the slides (slide.translations) and the languages merged into " +
        "settings.languages, exactly like the web app — so the project round-trips through export_project. " +
        'Then render with language:"all" for per-language folders (or one code to inspect a single language). ' +
        "Each slide entry may also include screenshot_path to give that locale its own screenshot (for apps " +
        "whose UI is itself localized — e.g. an Arabic build); omit it and the locale reuses the base " +
        "screenshot. You can also set locale screenshots separately with set_screenshots (pass language). " +
        "For non-Latin scripts set a per-language font (the entry's font, or set_style with language) so this " +
        "locale renders in a covering font while the base keeps the global one — Inter covers Cyrillic/Greek, Noto Sans " +
        'JP/KR/SC cover CJK, "Noto Sans Arabic" covers Arabic). Arabic is shaped and laid out right-to-left ' +
        "automatically. Server-side rendering has no per-glyph system-font fallback, so glyphs a font lacks " +
        "come out as boxes; always inspect the render preview.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        translations: z
          .array(
            z.object({
              code: z.string().min(1).describe('Language code, used as folder name and translations key (e.g. "es")'),
              name: z.string().min(1).describe('Human-readable language name (e.g. "Spanish")'),
              font: z
                .enum(FONT_IDS as [string, ...string[]])
                .optional()
                .describe("Font id (from list_options) to render this language in, overriding the global font"),
              slides: z
                .array(
                  z.object({
                    title: z.string().describe("Translated title (empty = fall back to base title)"),
                    subhead: z.string().optional().describe("Translated subhead (empty/omitted = fall back to base subhead)"),
                    screenshot_path: z
                      .string()
                      .optional()
                      .describe("Absolute path to this locale's own screenshot for this slide (optional; omit to reuse the base)"),
                  }),
                )
                .min(1)
                .describe("Translated texts (and optional per-locale screenshots), aligned 1:1 with the project's slides"),
            }),
          )
          .min(1),
      },
    },
    async ({ project_id, translations }) => {
      const state = getProject(project_id).state;
      const n = state.slides.length;
      const mismatches = translations
        .filter((t) => t.slides.length !== n)
        .map((t) => `"${t.code}" has ${t.slides.length} slide texts but the project has ${n} slides`);
      if (mismatches.length) {
        throw new Error(
          `Translations must align 1:1 with the project's slides:\n${mismatches.map((m) => `- ${m}`).join("\n")}\n` +
            "Send one { title, subhead } per slide, in slide order, for every language.",
        );
      }
      const notes: string[] = [];
      for (const t of translations) {
        for (let i = 0; i < t.slides.length; i++) {
          const s = t.slides[i];
          const entry = ensureTranslation(state.slides[i], t.code);
          entry.title = s.title;
          entry.subhead = s.subhead ?? "";
          if (s.screenshot_path) {
            const asset = { image: null, imageDataUrl: null };
            await applyScreenshot(asset, s.screenshot_path, state.settings.platform, `slide ${i + 1} [${t.code}]`, notes);
            state.slides[i] = setImageAsset(state.slides[i], state.settings.platform, t.code, asset);
            state.slides = mirrorSpannedMedia(state.slides, i);
          }
        }
        mergeLanguage(state, t.code, t.name, t.font);
      }
      const withShots = translations.filter((t) => t.slides.some((s) => s.screenshot_path)).map((t) => t.code);
      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return text(
        `Stored translations for ${n} slides in: ${translations.map((t) => t.code).join(", ")}` +
          `${withShots.length ? ` (with per-locale screenshots: ${withShots.join(", ")})` : ""}.\n` +
          `settings.languages: ${(state.settings.languages ?? []).map((l) => l.code).join(", ")}\n` +
          `Next: render with language:"all" for per-language folders, or a single code to inspect one language.${noteBlock}`,
      );
    },
  );
}
