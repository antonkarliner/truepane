// In-memory project store for the MCP server. Each project is the same
// AppState document the web app persists/exports, with the slide images
// hydrated to @napi-rs/canvas Images for rendering.
import * as fs from "node:fs";
import * as path from "node:path";
import { defaultState } from "../../src/core/constants";
import { normalizeAppState, serializeTranslations } from "../../src/core/normalize";
import type { AppState, ImageSourceLike } from "../../src/core/types";
import { tryLoadImage } from "./canvas";

export interface Project {
  id: string;
  state: AppState;
}

const projects = new Map<string, Project>();
let counter = 0;

export function newProjectId(): string {
  counter += 1;
  let id = `project-${counter}`;
  while (projects.has(id)) id = `project-${++counter}`;
  return id;
}

export function createProject(id: string | undefined): Project {
  const pid = id || newProjectId();
  if (projects.has(pid)) throw new Error(`Project "${pid}" already exists.`);
  const project: Project = { id: pid, state: defaultState() };
  projects.set(pid, project);
  return project;
}

export function getProject(id: string): Project {
  const p = projects.get(id);
  if (!p) {
    const known = [...projects.keys()];
    throw new Error(
      `Unknown project "${id}". ${known.length ? `Known projects: ${known.join(", ")}` : "No projects exist yet — call create_project first."}`,
    );
  }
  return p;
}

export function listProjects(): string[] {
  return [...projects.keys()];
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Read a local screenshot file → { dataUrl, image }. Throws on missing file
 * or unsupported extension; returns image: null if decode fails. */
export async function loadScreenshot(
  filePath: string,
): Promise<{ dataUrl: string; image: ImageSourceLike | null }> {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`Screenshot path must be absolute, got: ${filePath}`);
  }
  if (!fs.existsSync(filePath)) throw new Error(`Screenshot file not found: ${filePath}`);
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (!mime) {
    throw new Error(
      `Unsupported screenshot type "${path.extname(filePath)}" (${filePath}); use PNG, JPEG, or WebP.`,
    );
  }
  const buf = fs.readFileSync(filePath);
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const image = (await tryLoadImage(buf)) as unknown as ImageSourceLike | null;
  return { dataUrl, image };
}

async function decodeDataUrl(dataUrl: string): Promise<ImageSourceLike | null> {
  return (await tryLoadImage(
    Buffer.from(dataUrl.split(",")[1] ?? "", "base64"),
  )) as unknown as ImageSourceLike | null;
}

/** Rebuild napi Images from imageDataUrl strings (after load_project) — the
 * base screenshot on each slide plus any per-locale translation screenshots. */
export async function hydrateImages(state: AppState): Promise<void> {
  for (const slide of state.slides) {
    if (slide.imageDataUrl && !slide.image) {
      slide.image = await decodeDataUrl(slide.imageDataUrl);
    }
    for (const t of Object.values(slide.translations ?? {})) {
      if (t.imageDataUrl && !t.image) {
        t.image = await decodeDataUrl(t.imageDataUrl);
      }
    }
  }
}

/** The exact JSON payload the web app writes on Export Project (see
 * exportJson in src/App.tsx) — keep in sync so files round-trip. */
export function projectJson(state: AppState): string {
  const payload = {
    settings: state.settings,
    slides: state.slides.map((s) => ({
      title: s.title,
      subhead: s.subhead,
      imageDataUrl: s.imageDataUrl || null,
      background: s.background,
      translations: serializeTranslations(s.translations),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export async function loadProjectFromFile(id: string | undefined, filePath: string): Promise<Project> {
  const text = fs.readFileSync(filePath, "utf8");
  const state = normalizeAppState(JSON.parse(text));
  await hydrateImages(state);
  const pid = id || newProjectId();
  const project: Project = { id: pid, state };
  projects.set(pid, project);
  return project;
}
