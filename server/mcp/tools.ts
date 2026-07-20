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
import { normalizeBackground } from "../../src/core/normalize";
import {
  dimFor,
  FILL_OPTIONS,
  getFrame,
  paintSlide,
  paintStrip,
  PLATFORMS,
  RING_LAYOUTS,
  SHAPE_FAMILIES,
} from "../../src/core/render";
import type { AppState, Background, CanvasLike, LanguageTarget, Settings, Slide, SlideText } from "../../src/core/types";
import { makeCanvas, paletteOfImage, pngBuffer, tryLoadImage } from "./canvas";
import { ensureFontsForState } from "./fonts";
import {
  createProject,
  getProject,
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

const platformList = PLATFORMS.map((p) => {
  const d = dimFor(p.id);
  return `"${p.id}" (${p.storeLabel}, ${d.W}x${d.H}px)`;
}).join(", ");

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
  })
  .partial();

type BackgroundPatch = z.infer<typeof backgroundSchema>;

function patchBackground(base: Background, patch: BackgroundPatch): Background {
  return normalizeBackground({ ...base, ...patch });
}

function text(msg: string) {
  return { content: [{ type: "text" as const, text: msg }] };
}

function assertPlatform(platform: string): void {
  if (!PLATFORM_IDS.includes(platform)) {
    throw new Error(`Unknown platform "${platform}". Valid: ${PLATFORM_IDS.join(", ")}`);
  }
}

// Warn (not fail) when a screenshot's aspect ratio is off from the device
// screen — it will be center-crop-filled, so mild mismatch is fine.
function aspectNote(slideNo: number, img: { width: number; height: number }, platform: string): string | null {
  const S = getFrame(platform).SCREEN;
  const imgAspect = img.width / img.height;
  const screenAspect = S.w / S.h;
  const rel = Math.abs(imgAspect - screenAspect) / screenAspect;
  if (rel > 0.02) {
    return (
      `slide ${slideNo}: screenshot aspect ${img.width}x${img.height} (${imgAspect.toFixed(3)}) ` +
      `differs from the ${platform} screen aspect (${screenAspect.toFixed(3)}) — it will be scaled to fill and center-cropped`
    );
  }
  return null;
}

async function attachScreenshot(slide: Slide, filePath: string, platform: string, slideNo: number, notes: string[]): Promise<void> {
  const { dataUrl, image } = await loadScreenshot(filePath);
  slide.imageDataUrl = dataUrl;
  slide.image = image;
  if (!image) {
    notes.push(`slide ${slideNo}: could not decode image at ${filePath} — the screen will show a placeholder`);
    return;
  }
  const note = aspectNote(slideNo, image, platform);
  if (note) notes.push(note);
}

function summarize(state: AppState, id: string): string {
  const d = dimFor(state.settings.platform);
  const lines = state.slides.map(
    (s, i) => `  ${i + 1}. "${s.title}" — "${s.subhead}"${s.imageDataUrl ? " [screenshot]" : " [no screenshot]"}`,
  );
  return `Project "${id}" — platform ${state.settings.platform} (${d.storeLabel}, ${d.W}x${d.H}px), font ${state.settings.fontFamily}, ${state.slides.length} slides:\n${lines.join("\n")}`;
}

// Swap a slide's title/subhead to a language's translation. Mirrors
// resolveSlide in src/App.tsx exactly: `lang === ""` is the source text, and
// any blank translated field falls back to the source string.
function resolveSlide(slide: Slide, lang: string): Slide {
  if (!lang) return slide;
  const t = slide.translations?.[lang];
  if (!t) return slide;
  return {
    ...slide,
    title: t.title?.trim() ? t.title : slide.title,
    subhead: t.subhead?.trim() ? t.subhead : slide.subhead,
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
      title: "List style options",
      description:
        "List every valid value for Truepane projects: platforms/device frames with exact export pixel " +
        "dimensions, fonts, background fills, shape overlays, and ring layouts. Call this first to learn " +
        "valid ids before create_project or set_style.",
      inputSchema: {},
    },
    async () => {
      const platforms = PLATFORMS.map((p) => {
        const d = dimFor(p.id);
        return `- "${p.id}": ${p.label} — ${p.storeLabel} — exports ${d.W}x${d.H}px`;
      });
      const fonts = FONT_OPTIONS.map(
        (f) => `- "${f.id}": ${f.label}${f.google ? " (Google Fonts, downloaded on demand)" : " (system font — rendered with bundled Inter on the server)"}`,
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
          "Workflow: create_project → set_style (and set_slides / set_screenshots) → render → inspect the preview → adjust → render.",
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
    async ({ id, platform, slides }) => {
      if (platform) assertPlatform(platform);
      const project = createProject(id);
      const state = project.state;
      if (platform) state.settings.platform = platform;
      const notes: string[] = [];
      state.slides = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const slide: Slide = { title: s.title, subhead: s.subhead ?? "", image: null, imageDataUrl: null };
        if (s.screenshot_path) {
          await attachScreenshot(slide, s.screenshot_path, state.settings.platform, i + 1, notes);
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
          background: prev?.background,
          titleColor: prev?.titleColor,
          subheadColor: prev?.subheadColor,
          translations: prev?.translations,
        };
        if (s.screenshot_path) {
          await attachScreenshot(slide, s.screenshot_path, state.settings.platform, i + 1, notes);
        }
        next.push(slide);
      }
      state.slides = next;
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
        "reported as warnings, not errors.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        screenshots: z
          .array(
            z.object({
              index: z.number().int().min(0).describe("0-based slide index"),
              path: z.string().describe("Absolute path to the screenshot file"),
            }),
          )
          .min(1),
      },
    },
    async ({ project_id, screenshots }) => {
      const project = getProject(project_id);
      const state = project.state;
      const notes: string[] = [];
      for (const { index, path: p } of screenshots) {
        if (index >= state.slides.length) {
          throw new Error(`Slide index ${index} out of range (project has ${state.slides.length} slides).`);
        }
        await attachScreenshot(state.slides[index], p, state.settings.platform, index + 1, notes);
      }
      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return text(`${summarize(state, project.id)}${noteBlock}`);
    },
  );

  server.registerTool(
    "set_style",
    {
      title: "Set typography, colors, background",
      description:
        "Patch project style. Without slide_index, patches global settings: fontFamily (see list_options), " +
        "titleColor/subheadColor (CSS colors), titleScale/subtitleScale (multipliers, ~0.5-1.5), platform " +
        `(${PLATFORM_IDS.join(" | ")}), and background — a partial patch merged onto the current background. ` +
        "Background fields: fill (solid|linear|radial), shape (see list_options), color, gradientColor, accent, " +
        "accentOpacity (0..1), ringLayout, ringCount (1..8), seed, density (1..8), dotsAligned, gradientAngle. " +
        "With slide_index (0-based), background/titleColor/subheadColor apply as per-slide overrides instead " +
        "(other fields are global-only and rejected). Re-render after changes to see the result.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        slide_index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("If set, apply background/titleColor/subheadColor to this slide only"),
        fontFamily: z
          .enum(FONT_IDS as [string, ...string[]])
          .optional()
          .describe("Font id from list_options (global only)"),
        titleColor: z.string().optional().describe("Title color, e.g. #1a1612"),
        subheadColor: z.string().optional().describe("Subhead color, e.g. rgba(26,22,18,0.62)"),
        titleScale: z.number().min(0.3).max(2).optional().describe("Title size multiplier (global only)"),
        subtitleScale: z.number().min(0.3).max(2).optional().describe("Subhead size multiplier (global only)"),
        platform: z
          .enum(PLATFORM_IDS as [string, ...string[]])
          .optional()
          .describe("Switch device frame (global only)"),
        background: backgroundSchema.optional().describe("Partial background patch"),
      },
    },
    async ({ project_id, slide_index, fontFamily, titleColor, subheadColor, titleScale, subtitleScale, platform, background }) => {
      const project = getProject(project_id);
      const state = project.state;
      if (slide_index !== undefined) {
        if (fontFamily || titleScale !== undefined || subtitleScale !== undefined || platform) {
          throw new Error(
            "fontFamily/titleScale/subtitleScale/platform are global settings — call set_style without slide_index to change them.",
          );
        }
        const slide = state.slides[slide_index];
        if (!slide) throw new Error(`Slide index ${slide_index} out of range (project has ${state.slides.length} slides).`);
        if (titleColor !== undefined) slide.titleColor = titleColor;
        if (subheadColor !== undefined) slide.subheadColor = subheadColor;
        if (background) {
          slide.background = patchBackground(slide.background ?? state.settings.background, background);
        }
        return text(`Updated slide ${slide_index} overrides.\n${summarize(state, project.id)}`);
      }
      if (platform) {
        assertPlatform(platform);
        state.settings.platform = platform;
      }
      if (fontFamily) state.settings.fontFamily = fontFamily;
      if (titleColor !== undefined) state.settings.titleColor = titleColor;
      if (subheadColor !== undefined) state.settings.subheadColor = subheadColor;
      if (titleScale !== undefined) state.settings.titleScale = titleScale;
      if (subtitleScale !== undefined) state.settings.subtitleScale = subtitleScale;
      if (background) {
        state.settings.background = patchBackground(state.settings.background, background);
      }
      return text(
        `Style updated. Background now: ${JSON.stringify(state.settings.background)}\n${summarize(state, project.id)}`,
      );
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
        "ZIP (add languages with set_translations first). Fonts are fetched/registered automatically before " +
        "rendering. Iterate: render → look at preview → set_style → render again.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        output_dir: z.string().describe("Absolute directory for the PNGs (created if missing)"),
        what: z.enum(["slides", "strip", "both"]).optional().describe('What to render. Default "slides".'),
        scale: z.number().gt(0).max(1).optional().describe("Downscale factor for draft output (default 1 = full store resolution)"),
        language: z
          .string()
          .optional()
          .describe('Omit = base text; a language code = that translation; "all" = per-language subfolders'),
      },
    },
    async ({ project_id, output_dir, what, scale, language }) => {
      const project = getProject(project_id);
      const state = project.state;
      if (!path.isAbsolute(output_dir)) throw new Error(`output_dir must be an absolute path, got: ${output_dir}`);
      await ensureFontsForState(state);
      const mode = what ?? "slides";
      const k = scale ?? 1;
      const notes: string[] = [];

      // Which languages go where. Mirrors exportAllLanguages in src/App.tsx:
      // "all" = source/ + one folder per settings.languages code.
      const lang = language ?? "";
      let targets: { code: string; dir: string }[];
      if (lang === "all") {
        const langs = state.settings.languages ?? [];
        if (langs.length === 0) notes.push('language "all": project has no settings.languages — only source/ was written (run set_translations first)');
        targets = [
          { code: "", dir: path.join(output_dir, "source") },
          ...langs.map((l) => ({ code: l.code, dir: path.join(output_dir, l.code) })),
        ];
      } else {
        if (lang && !state.slides.some((s) => s.translations?.[lang])) {
          notes.push(`no slide has a translation for "${lang}" — rendered base text (run set_translations first)`);
        }
        targets = [{ code: lang, dir: output_dir }];
      }

      const out: string[] = [];
      let previewCanvas: Canvas | null = null;
      for (const { code, dir } of targets) {
        fs.mkdirSync(dir, { recursive: true });
        const slides = state.slides.map((s) => resolveSlide(s, code));
        if (mode === "slides" || mode === "both") {
          for (let i = 0; i < slides.length; i++) {
            const c = await renderSlideCanvas(slides, state.settings, i, k);
            const file = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`);
            fs.writeFileSync(file, pngBuffer(c));
            out.push(`${file} (${c.width}x${c.height})`);
            if (!previewCanvas) previewCanvas = c;
          }
        }
        if (mode === "strip" || mode === "both") {
          const full = makeCanvas(1, 1);
          await paintStrip(full as unknown as CanvasLike, slides, state.settings);
          const c = scaled(full, k);
          const file = path.join(dir, "strip.png");
          fs.writeFileSync(file, pngBuffer(c));
          out.push(`${file} (${c.width}x${c.height})`);
          if (!previewCanvas) previewCanvas = c;
        }
      }

      const noteBlock = notes.length ? `\nNotes:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
      return {
        content: [
          { type: "text" as const, text: `Rendered:\n${out.map((f) => `- ${f}`).join("\n")}${noteBlock}` },
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
        "Point it at a project slide (project_id + slide_index) or any local image file (image_path). Purely " +
        "local math — no AI, no network. Apply the result with set_style.",
      inputSchema: {
        project_id: z.string().optional().describe("Project id (with slide_index)"),
        slide_index: z.number().int().min(0).optional().describe("0-based slide whose screenshot to sample"),
        image_path: z.string().optional().describe("Absolute path to an image file (instead of project_id/slide_index)"),
      },
    },
    async ({ project_id, slide_index, image_path }) => {
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
        img = slide.image;
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
        "For non-Latin scripts, pick a fontFamily that covers them (e.g. Inter covers Cyrillic/Greek, Noto Sans " +
        "JP/KR cover CJK) — server-side rendering has no per-glyph system-font fallback, so uncovered glyphs " +
        "come out as boxes; always inspect the render preview.",
      inputSchema: {
        project_id: z.string().describe("Project id"),
        translations: z
          .array(
            z.object({
              code: z.string().min(1).describe('Language code, used as folder name and translations key (e.g. "es")'),
              name: z.string().min(1).describe('Human-readable language name (e.g. "Spanish")'),
              slides: z
                .array(
                  z.object({
                    title: z.string().describe("Translated title (empty = fall back to base title)"),
                    subhead: z.string().optional().describe("Translated subhead (empty/omitted = fall back to base subhead)"),
                  }),
                )
                .min(1)
                .describe("Translated texts, aligned 1:1 with the project's slides (same count, same order)"),
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
      for (const t of translations) {
        const items: SlideText[] = t.slides.map((s) => ({ title: s.title, subhead: s.subhead ?? "" }));
        state.slides.forEach((slide, i) => {
          slide.translations = { ...slide.translations, [t.code]: items[i] };
        });
        const lang: LanguageTarget = { code: t.code, name: t.name };
        const existing = state.settings.languages ?? [];
        const at = existing.findIndex((l) => l.code === t.code);
        state.settings.languages =
          at >= 0 ? existing.map((l, i) => (i === at ? lang : l)) : [...existing, lang];
      }
      return text(
        `Stored translations for ${n} slides in: ${translations.map((t) => t.code).join(", ")}.\n` +
          `settings.languages: ${(state.settings.languages ?? []).map((l) => l.code).join(", ")}\n` +
          `Next: render with language:"all" for per-language folders, or a single code to inspect one language.`,
      );
    },
  );
}
