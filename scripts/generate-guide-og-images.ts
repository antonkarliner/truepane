import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GUIDE_REGISTRY } from "../src/GuidePage";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "public", "og", "guides");
const WIDTH = 1200;
const HEIGHT = 630;
const ACCENTS = ["#c47c3b", "#7060a8", "#5b6647"];

for (const font of ["Inter-400.ttf", "Inter-500.ttf", "Inter-700.ttf"]) {
  GlobalFonts.registerFromPath(join(ROOT, "server", "mcp", "assets", "fonts", font), "Inter");
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapTitle(ctx: SKRSContext2D, title: string, maxWidth: number): { lines: string[]; size: number } {
  for (let size = 60; size >= 44; size -= 2) {
    ctx.font = `700 ${size}px Inter`;
    const lines: string[] = [];
    for (const word of title.split(/\s+/)) {
      const next = lines.length === 0 ? word : `${lines.at(-1)} ${word}`;
      if (lines.length > 0 && ctx.measureText(next).width > maxWidth) lines.push(word);
      else if (lines.length === 0) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    if (lines.length <= 5) return { lines, size };
  }
  throw new Error(`Guide title is too long for its OG card: ${title}`);
}

function accentFor(slug: string): string {
  const hash = [...slug].reduce((total, char) => total + char.charCodeAt(0), 0);
  return ACCENTS[hash % ACCENTS.length];
}

function drawLogo(ctx: SKRSContext2D): void {
  roundedRect(ctx, 64, 52, 52, 52, 12);
  ctx.fillStyle = "#f4f1ea";
  ctx.fill();

  const gradient = ctx.createLinearGradient(0, 61, 0, 95);
  gradient.addColorStop(0, "#e07828");
  gradient.addColorStop(1, "#8840b8");
  const strips = [
    { x: 71, y: 65, w: 9, h: 26, color: "#a89070" },
    { x: 86, y: 61, w: 9, h: 34, color: gradient },
    { x: 101, y: 65, w: 9, h: 26, color: "#5c4e96" },
  ];
  for (const strip of strips) {
    roundedRect(ctx, strip.x, strip.y, strip.w, strip.h, 3);
    ctx.fillStyle = strip.color;
    ctx.fill();
  }

  ctx.fillStyle = "#1a1612";
  ctx.font = "700 30px Inter";
  ctx.fillText("Truepane", 134, 89);
}

async function generateCard(slug: string, rawTitle: string): Promise<void> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const accent = accentFor(slug);
  const title = rawTitle.replace(/ · Truepane$/, "");

  ctx.fillStyle = "#f6f3ec";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.globalAlpha = 0.11;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(1035, 315, 420, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawLogo(ctx);

  ctx.fillStyle = accent;
  ctx.font = "700 15px Inter";
  ctx.fillText("TRUEPANE GUIDE", 66, 157);

  const titleLayout = wrapTitle(ctx, title, 680);
  ctx.fillStyle = "#1a1612";
  ctx.font = `700 ${titleLayout.size}px Inter`;
  const lineHeight = Math.round(titleLayout.size * 1.08);
  titleLayout.lines.forEach((line, index) => ctx.fillText(line, 64, 218 + index * lineHeight));

  const paneGradient = ctx.createLinearGradient(0, 85, 0, 545);
  paneGradient.addColorStop(0, "#e07828");
  paneGradient.addColorStop(1, "#8840b8");
  const panes = [
    { x: 820, y: 150, width: 90, height: 330, color: "#a89070" },
    { x: 950, y: 85, width: 90, height: 460, color: paneGradient },
    { x: 1080, y: 150, width: 90, height: 330, color: "#5c4e96" },
  ];
  ctx.shadowColor = "rgba(26, 22, 18, 0.10)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 10;
  for (const pane of panes) {
    roundedRect(ctx, pane.x, pane.y, pane.width, pane.height, 24);
    ctx.fillStyle = pane.color;
    ctx.fill();
  }
  ctx.shadowColor = "transparent";

  const output = join(OUTPUT_DIR, `${slug}.png`);
  await writeFile(output, canvas.toBuffer("image/png"));
}

await mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all(
  Object.entries(GUIDE_REGISTRY).map(([slug, guide]) => generateCard(slug, guide.title)),
);
console.log(`Generated ${Object.keys(GUIDE_REGISTRY).length} guide OG images in ${OUTPUT_DIR}`);
