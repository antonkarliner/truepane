// Canvas rendering for App Store / Play Store screenshot slides.
//
// Two platforms ship today:
//   iOS     — App Store, iPhone 16 Pro Max 6.9" portrait, 1320 × 2868
//             Dynamic Island, action + volume + power buttons.
//   Android — Google Play, Pixel-style portrait, 1080 × 2400 (20:9)
//             Centered hole-punch camera, power + volume rocker on right.
//
// Both fit each store's published specs and share design language: text
// stacked on top, phone below, identical generated backgrounds.
//
// CONCENTRIC-CORNER INVARIANT — for uniform-thickness bezels at the corners
// as well as the sides, the BODY / BEZEL / SCREEN rounded rects must share a
// center of curvature:
//   centerX = BODY.x + BODY.r = BEZEL.x + BEZEL.r = SCREEN.x + SCREEN.r
//   centerY = BODY.y + BODY.r = BEZEL.y + BEZEL.r = SCREEN.y + SCREEN.r
// Non-concentric rects produce a "laddery" corner kink. `defineFrame` below
// asserts the invariant so a new frame can't silently break it.

import type {
  Background,
  CanvasLike,
  FillOption,
  Frame,
  ImageSourceLike,
  PlatformDim,
  PlatformMeta,
  RingLayout,
  RoundRect,
  Settings,
  ShapeFamily,
  Slide,
} from "./types";

// ---------------------------------------------------------------------
// Canvas factory — where every canvas this module draws on comes from.
// Defaults to the DOM implementation; a Node entry point installs its own
// (e.g. @napi-rs/canvas) via setCanvasFactory. `document` is only touched
// when a canvas is actually created without an override, so importing this
// module outside the browser is safe.
// ---------------------------------------------------------------------
export type CanvasFactory = (width: number, height: number) => CanvasLike;

let canvasFactory: CanvasFactory | null = null;

export function setCanvasFactory(fn: CanvasFactory): void {
  canvasFactory = fn;
}

function createCanvas(width: number, height: number): CanvasLike {
  const c: CanvasLike = canvasFactory
    ? canvasFactory(width, height)
    : document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

// drawImage only needs a width/height-bearing pixel source at runtime, but
// the DOM typings insist on the concrete CanvasImageSource union — funnel our
// structural types through this single cast.
function toDrawable(src: CanvasLike | ImageSourceLike): CanvasImageSource {
  return src as unknown as CanvasImageSource;
}

// ---------------------------------------------------------------------
// Frame factory — validates the concentric-corner invariant at definition.
// ---------------------------------------------------------------------
export function defineFrame(frame: Frame): Frame {
  const cxBody = frame.BODY.x + frame.BODY.r;
  const cxBezel = frame.BEZEL.x + frame.BEZEL.r;
  const cxScreen = frame.SCREEN.x + frame.SCREEN.r;
  const cyBody = frame.BODY.y + frame.BODY.r;
  const cyBezel = frame.BEZEL.y + frame.BEZEL.r;
  const cyScreen = frame.SCREEN.y + frame.SCREEN.r;
  const tol = 0.5;
  if (Math.abs(cxBody - cxBezel) > tol || Math.abs(cxBody - cxScreen) > tol) {
    throw new Error(
      `Frame "${frame.id}" breaks the concentric-corner invariant on X: ` +
        `BODY=${cxBody}, BEZEL=${cxBezel}, SCREEN=${cxScreen}`,
    );
  }
  if (Math.abs(cyBody - cyBezel) > tol || Math.abs(cyBody - cyScreen) > tol) {
    throw new Error(
      `Frame "${frame.id}" breaks the concentric-corner invariant on Y: ` +
        `BODY=${cyBody}, BEZEL=${cyBezel}, SCREEN=${cyScreen}`,
    );
  }
  return frame;
}

// Build concentric BODY / BEZEL / SCREEN rects from a single body rect plus
// two uniform insets. Deriving each inner radius as (bodyR − inset) keeps the
// shared center of curvature by construction, so the invariant always holds.
function shell(
  body: RoundRect,
  bezelInset: number,
  screenInset: number,
): Pick<Frame, "BODY" | "BEZEL" | "SCREEN"> {
  return {
    BODY: body,
    BEZEL: {
      x: body.x + bezelInset,
      y: body.y + bezelInset,
      w: body.w - 2 * bezelInset,
      h: body.h - 2 * bezelInset,
      r: body.r - bezelInset,
    },
    SCREEN: {
      x: body.x + screenInset,
      y: body.y + screenInset,
      w: body.w - 2 * screenInset,
      h: body.h - 2 * screenInset,
      r: body.r - screenInset,
    },
  };
}

const SHARED_COLORS = {
  body: "#1d1d1f",
  bezel: "#0a0a0c",
  button: "#2a2a2d",
  edgeHi: "rgba(255,255,255,0.10)",
};

// ---------------------------------------------------------------------
// Frame definitions
// ---------------------------------------------------------------------
const IOS_FRAME: Frame = defineFrame({
  id: "ios",
  label: "iPhone 6.9″",
  store: "appstore",
  storeLabel: "App Store · 6.9″ iPhone",
  W: 1320,
  H: 2868,
  BODY: { x: 169, y: 742, w: 976, h: 2046, r: 155 },
  BEZEL: { x: 174, y: 747, w: 966, h: 2036, r: 150 },
  SCREEN: { x: 192, y: 765, w: 930, h: 2000, r: 132 },
  CAMERA: { kind: "island", x: 497, y: 795, w: 326, h: 80 },
  SIDE_BUTTONS: [
    { side: "left", y: 1190, h: 80 }, // action
    { side: "left", y: 1320, h: 200 }, // volume up
    { side: "left", y: 1550, h: 200 }, // volume down
    { side: "right", y: 1230, h: 270 }, // power
  ],
  COLORS: {
    body: "#1d1d1f",
    bezel: "#0a0a0c",
    button: "#2a2a2d",
    edgeHi: "rgba(255,255,255,0.10)",
  },
  TEXT: {
    leftPad: 115,
    rightPad: 115,
    titleTop: 192,
    titleFontSize: 110,
    titleLineHeight: 110,
    titleWeight: 700,
    subheadTop: 332,
    subheadFontSize: 62,
    subheadLineHeight: 84,
    subheadWeight: 400,
    titleToSubheadGap: 60,
  },
});

const ANDROID_FRAME: Frame = defineFrame({
  id: "android",
  label: "Phone",
  store: "playstore",
  storeLabel: "Play Store · Pixel portrait",
  W: 1080,
  H: 2400,
  // Centers of curvature (all corners) = (230, 690) top-left, mirrored.
  BODY: { x: 140, y: 600, w: 800, h: 1720, r: 90 },
  BEZEL: { x: 146, y: 606, w: 788, h: 1708, r: 84 },
  SCREEN: { x: 164, y: 624, w: 752, h: 1672, r: 66 },
  // Hole-punch camera, centered horizontally, just below screen top.
  CAMERA: { kind: "hole", cx: 540, cy: 678, r: 22 },
  // Pixel layout: both buttons on the RIGHT — power on top, volume below.
  SIDE_BUTTONS: [
    { side: "right", y: 900, h: 130 }, // power
    { side: "right", y: 1060, h: 260 }, // volume rocker
  ],
  COLORS: {
    body: "#1d1d1f",
    bezel: "#0a0a0c",
    button: "#2a2a2d",
    edgeHi: "rgba(255,255,255,0.08)",
  },
  TEXT: {
    leftPad: 95,
    rightPad: 95,
    titleTop: 160,
    titleFontSize: 92,
    titleLineHeight: 92,
    titleWeight: 700,
    subheadTop: 280,
    subheadFontSize: 52,
    subheadLineHeight: 70,
    subheadWeight: 400,
    titleToSubheadGap: 50,
  },
});

// iPad Pro 13" portrait — App Store "13-inch iPad" screenshot size. Uniform
// thin bezels, modest corner radius, small front camera in the top bezel.
const IPAD_FRAME: Frame = defineFrame({
  id: "ipad",
  label: "iPad 13″",
  store: "appstore",
  storeLabel: "App Store · 13″ iPad",
  W: 2064,
  H: 2752,
  ...shell({ x: 312, y: 740, w: 1440, h: 1960, r: 68 }, 6, 40),
  CAMERA: { kind: "hole", cx: 1032, cy: 760, r: 9 },
  SIDE_BUTTONS: [
    { side: "right", y: 860, h: 90 }, // power (top edge, shown as a side nub)
    { side: "right", y: 1020, h: 170 }, // volume
  ],
  COLORS: { ...SHARED_COLORS, edgeHi: "rgba(255,255,255,0.09)" },
  TEXT: {
    leftPad: 150,
    rightPad: 150,
    titleTop: 170,
    titleFontSize: 128,
    titleLineHeight: 132,
    titleWeight: 700,
    subheadTop: 330,
    subheadFontSize: 72,
    subheadLineHeight: 96,
    subheadWeight: 400,
    titleToSubheadGap: 60,
  },
});

// Android tablet portrait (10", 16:10) — Pixel-Tablet styling with a
// hole-punch camera near the top of the screen.
const ANDROID_TABLET_FRAME: Frame = defineFrame({
  id: "android-tablet",
  label: "Tablet",
  store: "playstore",
  storeLabel: "Play Store · 10″ tablet",
  W: 1600,
  H: 2560,
  ...shell({ x: 150, y: 600, w: 1300, h: 1800, r: 60 }, 6, 34),
  CAMERA: { kind: "hole", cx: 800, cy: 672, r: 14 },
  SIDE_BUTTONS: [
    { side: "right", y: 740, h: 120 }, // power
    { side: "right", y: 900, h: 220 }, // volume
  ],
  COLORS: { ...SHARED_COLORS, edgeHi: "rgba(255,255,255,0.08)" },
  TEXT: {
    leftPad: 120,
    rightPad: 120,
    titleTop: 140,
    titleFontSize: 104,
    titleLineHeight: 108,
    titleWeight: 700,
    subheadTop: 270,
    subheadFontSize: 60,
    subheadLineHeight: 80,
    subheadWeight: 400,
    titleToSubheadGap: 50,
  },
});

const FRAMES: Record<string, Frame> = {
  ios: IOS_FRAME,
  ipad: IPAD_FRAME,
  android: ANDROID_FRAME,
  "android-tablet": ANDROID_TABLET_FRAME,
};

export function getFrame(platform: string): Frame {
  return FRAMES[platform] || IOS_FRAME;
}

// ---------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------
function get2d(canvas: CanvasLike): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------
// Phone chrome — body, bezel, side buttons, edge highlight.
// Drawn onto an offscreen canvas so we can punch the screen hole cleanly
// with destination-out (antialiased).
// ---------------------------------------------------------------------
function paintFrameChrome(ctx: CanvasRenderingContext2D, F: Frame): void {
  const c = createCanvas(F.W, F.H);
  const fx = get2d(c);

  // 1) Soft drop shadow under the body
  fx.save();
  fx.shadowColor = "rgba(0,0,0,0.22)";
  fx.shadowBlur = 40;
  fx.shadowOffsetY = 18;
  fx.fillStyle = "#0a0a0c";
  roundRect(fx, F.BODY.x, F.BODY.y, F.BODY.w, F.BODY.h, F.BODY.r);
  fx.fill();
  fx.restore();

  // 2) Body fill (solid dark)
  fx.fillStyle = F.COLORS.body;
  roundRect(fx, F.BODY.x, F.BODY.y, F.BODY.w, F.BODY.h, F.BODY.r);
  fx.fill();

  // 3) Side buttons — flush nubs, a hair lighter than the body so they
  //    read as physical without shouting.
  const BTN_W = 6;
  fx.fillStyle = F.COLORS.button;
  for (const b of F.SIDE_BUTTONS) {
    const bx = b.side === "left" ? F.BODY.x - BTN_W : F.BODY.x + F.BODY.w;
    roundRect(fx, bx, b.y, BTN_W, b.h, 2);
    fx.fill();
  }

  // 4) Inner bezel ring (concentric with body)
  fx.fillStyle = F.COLORS.bezel;
  roundRect(fx, F.BEZEL.x, F.BEZEL.y, F.BEZEL.w, F.BEZEL.h, F.BEZEL.r);
  fx.fill();

  // 5) Punch screen interior (antialiased mask via destination-out)
  fx.save();
  fx.globalCompositeOperation = "destination-out";
  roundRect(fx, F.SCREEN.x, F.SCREEN.y, F.SCREEN.w, F.SCREEN.h, F.SCREEN.r);
  fx.fill();
  fx.restore();

  // 6) Hairline edge highlight — gives the dark body a glint of definition
  //    without reading as "shiny metal".
  fx.save();
  fx.globalCompositeOperation = "source-atop";
  fx.lineWidth = 2;
  fx.strokeStyle = F.COLORS.edgeHi;
  roundRect(fx, F.BODY.x + 1, F.BODY.y + 1, F.BODY.w - 2, F.BODY.h - 2, F.BODY.r - 1);
  fx.stroke();
  fx.restore();

  ctx.drawImage(toDrawable(c), 0, 0);
}

// Front camera — Dynamic Island (iOS) or hole-punch dot (Android).
function paintCamera(ctx: CanvasRenderingContext2D, F: Frame): void {
  const cam = F.CAMERA;
  if (cam.kind === "island") {
    ctx.fillStyle = "#000";
    roundRect(ctx, cam.x, cam.y, cam.w, cam.h, cam.h / 2);
    ctx.fill();
  } else {
    // Hole-punch dot with a subtle lens reflection.
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(cam.cx, cam.cy, cam.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(80, 130, 200, 0.35)";
    ctx.beginPath();
    ctx.arc(cam.cx - cam.r * 0.35, cam.cy - cam.r * 0.35, cam.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------
// Background painters
// ---------------------------------------------------------------------
function paintSolid(ctx: CanvasRenderingContext2D, bg: Background, F: Frame): void {
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, F.W, F.H);
}

// Pour-over rings — predefined layouts. Each group is normalized: cx is in
// slide-units across the strip (0..N), cy / baseR / spacing are fractions of
// slide width W. paintRings multiplies them out.
export const RING_LAYOUTS: RingLayout[] = [
  {
    id: "calm",
    name: "Calm",
    groups: (N) => {
      const out = [];
      for (let i = 0; i < N; i++) out.push({ cx: i + 0.5, cy: 0.58, baseR: 0.42, spacing: 0.055 });
      return out;
    },
  },
  {
    id: "anchor-low",
    name: "Anchor low",
    groups: (N) => {
      const out = [];
      for (let i = 0; i < N; i++) out.push({ cx: i + 0.5, cy: 0.95, baseR: 0.55, spacing: 0.06 });
      return out;
    },
  },
  {
    id: "drift",
    name: "Drift",
    groups: (N) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const high = i % 2 === 0;
        out.push({ cx: i + 0.5, cy: high ? 0.3 : 0.74, baseR: 0.4, spacing: 0.055 });
      }
      return out;
    },
  },
  {
    id: "bookends",
    name: "Bookends",
    groups: (N) => [
      { cx: 0.15, cy: 0.55, baseR: 0.58, spacing: 0.06 },
      { cx: N - 0.15, cy: 0.45, baseR: 0.58, spacing: 0.06 },
      { cx: N / 2, cy: 0.68, baseR: 0.32, spacing: 0.05 },
    ],
  },
  {
    id: "center-stage",
    name: "Center stage",
    groups: (N) => [
      { cx: N / 2, cy: 0.5, baseR: 0.7, spacing: 0.055 },
      { cx: 0.3, cy: 0.3, baseR: 0.26, spacing: 0.05 },
      { cx: N - 0.3, cy: 0.8, baseR: 0.26, spacing: 0.05 },
    ],
  },
  {
    id: "constellation",
    name: "Constellation",
    groups: (N) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const phase = i % 3;
        if (phase === 0) out.push({ cx: i + 0.3, cy: 0.25, baseR: 0.32, spacing: 0.05 });
        if (phase === 1) out.push({ cx: i + 0.7, cy: 0.82, baseR: 0.36, spacing: 0.05 });
        if (phase === 2) out.push({ cx: i + 0.5, cy: 0.5, baseR: 0.3, spacing: 0.05 });
      }
      return out;
    },
  },
  {
    id: "march",
    name: "March",
    groups: (N) => {
      const out = [];
      for (let i = 0; i < N; i++) out.push({ cx: i + 0.5, cy: 0.78, baseR: 0.36, spacing: 0.045 });
      return out;
    },
  },
];

export function getLayout(id: string): RingLayout {
  return RING_LAYOUTS.find((l) => l.id === id) || RING_LAYOUTS[0];
}

function paintRings(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const layout = getLayout(bg.ringLayout || "calm");
  const ringsPerGroup = Math.max(1, Math.min(8, bg.ringCount ?? 4));
  const groups = layout.groups(totalSlides);

  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.lineWidth = 4;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;

  for (const g of groups) {
    const wcx = (g.cx - slideIndex) * F.W;
    const wcy = g.cy * F.H;
    const outerR = (g.baseR + (ringsPerGroup - 1) * g.spacing) * F.W;
    if (wcx + outerR < -200 || wcx - outerR > F.W + 200) continue;

    for (let k = 0; k < ringsPerGroup; k++) {
      const r = (g.baseR + k * g.spacing) * F.W;
      ctx.beginPath();
      ctx.arc(wcx, wcy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Seeded PRNG (mulberry32). Each generator reseeds from bg.seed and produces
// the SAME sequence regardless of which slide is being painted — shapes are
// laid out in strip-space (0..N) and culled to the visible slide, so a
// multi-slide strip reads as one continuous, reproducible composition.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paintBlobs(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const n = Math.round(totalSlides * Math.max(1, Math.min(8, bg.density ?? 3)));
  // Lay blobs out on a jittered grid sized to the whole strip so they spread
  // evenly instead of piling up. Higher density => more, smaller blobs rather
  // than a tangle of overlapping large ones.
  const stripW = totalSlides * F.W;
  const cell = Math.sqrt((stripW * F.H) / n);
  const cols = Math.max(1, Math.round(stripW / cell));
  const rows = Math.max(1, Math.round(F.H / cell));
  const cw = stripW / cols;
  const ch = F.H / rows;

  // Paint onto an offscreen layer at full opacity, then composite once at
  // accentOpacity, so blobs that do touch don't stack into darker lobes.
  const layer = createCanvas(F.W, F.H);
  const lx = get2d(layer);
  lx.fillStyle = bg.accent;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      // Radius + jitter kept small enough that neighbours stay separated even
      // at low density (where cells — and therefore blobs — are largest).
      const jx = (rng() - 0.5) * cw * 0.3;
      const jy = (rng() - 0.5) * ch * 0.3;
      const rad = Math.min(cw, ch) * (0.24 + rng() * 0.1);
      const gx = (c + 0.5) * cw + jx;
      const gy = (r + 0.5) * ch + jy;
      const x = gx - slideIndex * F.W;
      if (x + rad < -100 || x - rad > F.W + 100) continue;
      lx.beginPath();
      lx.arc(x, gy, rad, 0, Math.PI * 2);
      lx.fill();
    }
  }

  ctx.save();
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.drawImage(toDrawable(layer), 0, 0);
  ctx.restore();
}

function paintWaves(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  _totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const lines = Math.max(2, Math.round((bg.density ?? 3) + 2));
  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.lineWidth = 4;
  for (let i = 0; i < lines; i++) {
    const baseY = ((i + 0.5) / lines) * F.H;
    const amp = (0.02 + rng() * 0.05) * F.H;
    const wl = (0.5 + rng() * 1.0) * F.W;
    const phase = rng() * Math.PI * 2;
    ctx.beginPath();
    for (let x = 0; x <= F.W; x += 8) {
      const gx = x + slideIndex * F.W; // global x keeps waves continuous across slides
      const y = baseY + Math.sin((gx / wl) * Math.PI * 2 + phase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function paintDots(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const spacing = F.W / Math.max(2, Math.round((bg.density ?? 3) * 3));
  const dotR = spacing * 0.12;
  const cols = Math.ceil((totalSlides * F.W) / spacing);
  const rows = Math.ceil(F.H / spacing);
  const aligned = bg.dotsAligned ?? false;
  ctx.save();
  ctx.fillStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Always advance the rng so toggling alignment doesn't reshuffle the grid.
      const jx = (rng() - 0.5) * spacing * 0.5;
      const jy = (rng() - 0.5) * spacing * 0.5;
      const gx = c * spacing + spacing / 2 + (aligned ? 0 : jx);
      const gy = r * spacing + spacing / 2 + (aligned ? 0 : jy);
      const x = gx - slideIndex * F.W;
      if (x < -50 || x > F.W + 50) continue;
      ctx.beginPath();
      ctx.arc(x, gy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintMesh(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const count = Math.round(totalSlides * Math.max(1, bg.density ?? 3));
  ctx.save();
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  for (let i = 0; i < count; i++) {
    const gx = rng() * totalSlides * F.W;
    const cy = rng() * F.H;
    const r = (0.3 + rng() * 0.4) * F.W;
    const x = gx - slideIndex * F.W;
    if (x + r < -200 || x - r > F.W + 200) continue;
    const grad = ctx.createRadialGradient(x, cy, 0, x, cy, r);
    grad.addColorStop(0, bg.accent);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Full-bleed grid of lines (graph-paper / blueprint). Lines run edge to edge;
// seed shifts the phase, continuous across the strip.
function paintGrid(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  _totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const cells = Math.max(2, Math.round((bg.density ?? 3) + 2));
  const spacing = F.W / cells;
  const phx = rng() * spacing;
  const phy = rng() * spacing;
  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.lineWidth = Math.max(2, spacing * 0.04);
  const k0 = Math.floor((slideIndex * F.W - phx) / spacing) - 1;
  const k1 = Math.ceil(((slideIndex + 1) * F.W - phx) / spacing) + 1;
  for (let k = k0; k <= k1; k++) {
    const x = k * spacing + phx - slideIndex * F.W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, F.H);
    ctx.stroke();
  }
  for (let y = phy; y < F.H; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(F.W, y);
    ctx.stroke();
  }
  ctx.restore();
}

// Full-width zigzag (chevron) rows; seed shifts the phase, continuous across
// the strip via global x.
function paintZigzag(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  _totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const rows = Math.max(2, Math.round((bg.density ?? 3) + 2));
  const rowH = F.H / rows;
  const amp = rowH * 0.45;
  const wl = rowH * 1.6;
  const phase = rng() * wl;
  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.lineWidth = Math.max(3, rowH * 0.08);
  for (let i = 0; i <= rows; i++) {
    const baseY = i * rowH;
    ctx.beginPath();
    for (let x = 0; x <= F.W; x += 4) {
      const gx = x + slideIndex * F.W + phase;
      const tri = Math.abs(((gx % wl) / wl) - 0.5) * 2; // 0..1..0 triangle wave
      const y = baseY + (tri - 0.5) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Outlined circles ("bubbles") of varied size scattered on a jittered grid —
// closed shapes, so nothing reads as a cut-off end.
function paintBubbles(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const n = Math.round(totalSlides * Math.max(1, Math.min(8, bg.density ?? 3)));
  const stripW = totalSlides * F.W;
  const cell = Math.sqrt((stripW * F.H) / n);
  const cols = Math.max(1, Math.round(stripW / cell));
  const rows = Math.max(1, Math.round(F.H / cell));
  const cw = stripW / cols;
  const ch = F.H / rows;
  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.lineWidth = Math.max(2, Math.min(cw, ch) * 0.045);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const jx = (rng() - 0.5) * cw * 0.4;
      const jy = (rng() - 0.5) * ch * 0.4;
      const rad = Math.min(cw, ch) * (0.2 + rng() * 0.22);
      const x = (c + 0.5) * cw + jx - slideIndex * F.W;
      const y = (r + 0.5) * ch + jy;
      if (x + rad < -50 || x - rad > F.W + 50) continue;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Concentric arcs rising from below the strip (topographic / sunrise feel);
// seed shifts the center horizontally.
function paintArcs(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const n = Math.max(3, Math.round((bg.density ?? 3) * 2));
  const cx = (0.3 + rng() * 0.4) * totalSlides * F.W - slideIndex * F.W;
  const cy = F.H * 1.02;
  const spacing = F.H * 0.12;
  ctx.save();
  ctx.strokeStyle = bg.accent;
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.lineWidth = 5;
  for (let i = 1; i <= n; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, i * spacing, Math.PI, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

// Scattered, rotated triangles on a jittered grid; flattened through an
// offscreen layer so overlaps don't darken.
function paintTriangles(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const rng = mulberry32(bg.seed);
  const n = Math.round(totalSlides * Math.max(1, Math.min(8, bg.density ?? 3)));
  const stripW = totalSlides * F.W;
  const cell = Math.sqrt((stripW * F.H) / n);
  const cols = Math.max(1, Math.round(stripW / cell));
  const rows = Math.max(1, Math.round(F.H / cell));
  const cw = stripW / cols;
  const ch = F.H / rows;
  const layer = createCanvas(F.W, F.H);
  const lx = get2d(layer);
  lx.fillStyle = bg.accent;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const jx = (rng() - 0.5) * cw * 0.4;
      const jy = (rng() - 0.5) * ch * 0.4;
      const size = Math.min(cw, ch) * (0.3 + rng() * 0.18);
      const rot = rng() * Math.PI * 2;
      const x = (c + 0.5) * cw + jx - slideIndex * F.W;
      const y = (r + 0.5) * ch + jy;
      if (x + size < -50 || x - size > F.W + 50) continue;
      lx.save();
      lx.translate(x, y);
      lx.rotate(rot);
      lx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * size;
        const py = Math.sin(a) * size;
        if (k === 0) lx.moveTo(px, py);
        else lx.lineTo(px, py);
      }
      lx.closePath();
      lx.fill();
      lx.restore();
    }
  }
  ctx.save();
  ctx.globalAlpha = bg.accentOpacity ?? 0.55;
  ctx.drawImage(toDrawable(layer), 0, 0);
  ctx.restore();
}

// Linear gradient (background → accent) at bg.gradientAngle, spanning the whole
// strip so it flows continuously across slides.
function paintLinearGradient(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const stripW = totalSlides * F.W;
  const rad = ((bg.gradientAngle ?? 135) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  let tmin = Infinity;
  let tmax = -Infinity;
  for (const [px, py] of [
    [0, 0],
    [stripW, 0],
    [0, F.H],
    [stripW, F.H],
  ]) {
    const t = px * dx + py * dy;
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  const g = ctx.createLinearGradient(
    dx * tmin - slideIndex * F.W,
    dy * tmin,
    dx * tmax - slideIndex * F.W,
    dy * tmax,
  );
  g.addColorStop(0, bg.color);
  g.addColorStop(1, bg.gradientColor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, F.W, F.H);
}

// Radial gradient centered on the strip (gradient color glow → background).
function paintRadialGradient(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  const stripW = totalSlides * F.W;
  const cx = stripW / 2 - slideIndex * F.W;
  const cy = F.H / 2;
  const r = Math.hypot(stripW, F.H) / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, bg.gradientColor);
  g.addColorStop(1, bg.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, F.W, F.H);
}

type ShapePainter = (
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
) => void;

// Shape overlays drawn on top of the fill layer (no longer paint a background
// themselves — the fill is a separate layer).
const SHAPE_GENERATORS: Record<string, ShapePainter> = {
  rings: paintRings,
  blobs: paintBlobs,
  waves: paintWaves,
  dots: paintDots,
  mesh: paintMesh,
  arcs: paintArcs,
  triangles: paintTriangles,
  grid: paintGrid,
  zigzag: paintZigzag,
  bubbles: paintBubbles,
};

// Fill layer options (solid + gradients).
export const FILL_OPTIONS: FillOption[] = [
  { id: "solid", name: "Solid" },
  { id: "linear", name: "Linear gradient" },
  { id: "radial", name: "Radial gradient" },
];

// Shape overlay options. `seeded` => density slider + Randomize.
export const SHAPE_FAMILIES: ShapeFamily[] = [
  { id: "none", name: "None" },
  { id: "rings", name: "Rings" },
  { id: "blobs", name: "Blobs", seeded: true },
  { id: "waves", name: "Waves", seeded: true },
  { id: "dots", name: "Dots", seeded: true },
  { id: "mesh", name: "Mesh", seeded: true },
  { id: "arcs", name: "Arcs", seeded: true },
  { id: "triangles", name: "Triangles", seeded: true },
  { id: "grid", name: "Grid", seeded: true },
  { id: "zigzag", name: "Zigzag", seeded: true },
  { id: "bubbles", name: "Bubbles", seeded: true },
];

function paintBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  slideIndex: number,
  totalSlides: number,
  F: Frame,
): void {
  // 1) Fill layer.
  if (bg.fill === "linear") paintLinearGradient(ctx, bg, slideIndex, totalSlides, F);
  else if (bg.fill === "radial") paintRadialGradient(ctx, bg, slideIndex, totalSlides, F);
  else paintSolid(ctx, bg, F);

  // 2) Optional shape overlay on top of the fill.
  const gen = bg.shape && bg.shape !== "none" ? SHAPE_GENERATORS[bg.shape] : undefined;
  if (gen) gen(ctx, bg, slideIndex, totalSlides, F);
}

// ---------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? cur + " " + w : w;
    if (ctx.measureText(probe).width <= maxWidth) cur = probe;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Build a canvas font-family stack. System keywords (e.g. "-apple-system",
// "system-ui") must NOT be quoted; everything else is a real loaded family.
function familyToCss(family: string): string {
  const bare = family.startsWith("-") || family === "system-ui";
  return (bare ? family : `"${family}"`) + ", system-ui, sans-serif";
}

// Strong right-to-left scripts (Arabic, Hebrew, and their presentation forms).
// A field containing any of these is drawn right-aligned with an RTL base
// direction. Glyph shaping and bidi reordering are handled by the canvas
// engine itself (browser DOM canvas and @napi-rs/canvas both shape); this only
// fixes alignment and base direction so a title like Arabic reads from the
// right edge instead of the left.
const RTL_CHARS = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿיִ-﷿ﹰ-﻿]/;

function paintText(
  ctx: CanvasRenderingContext2D,
  slide: Slide,
  settings: Settings,
  F: Frame,
): void {
  const T = F.TEXT;
  const maxW = F.W - T.leftPad - T.rightPad;
  const font = familyToCss(settings.fontFamily || "Inter");
  ctx.textBaseline = "top";

  const title = slide.title || "";
  const titleRtl = RTL_CHARS.test(title);
  const titleScale = settings.titleScale ?? 1;
  ctx.fillStyle = slide.titleColor ?? (settings.titleColor || "#1a1612");
  ctx.font = `${T.titleWeight} ${Math.round(T.titleFontSize * titleScale)}px ${font}`;
  ctx.textAlign = titleRtl ? "right" : "left";
  ctx.direction = titleRtl ? "rtl" : "ltr";
  const titleX = titleRtl ? F.W - T.rightPad : T.leftPad;
  const titleLines = wrapText(ctx, title, maxW);
  let y = T.titleTop;
  for (const line of titleLines) {
    ctx.fillText(line, titleX, y);
    y += Math.round(T.titleLineHeight * titleScale);
  }
  const titleBottom = y;

  if (slide.subhead) {
    const subRtl = RTL_CHARS.test(slide.subhead);
    const scale = settings.subtitleScale ?? 1;
    ctx.fillStyle = slide.subheadColor ?? (settings.subheadColor || "rgba(26,22,18,0.62)");
    ctx.font = `${T.subheadWeight} ${Math.round(T.subheadFontSize * scale)}px ${font}`;
    ctx.textAlign = subRtl ? "right" : "left";
    ctx.direction = subRtl ? "rtl" : "ltr";
    const subX = subRtl ? F.W - T.rightPad : T.leftPad;
    const subLines = wrapText(ctx, slide.subhead, maxW);
    let sy = Math.max(T.subheadTop, titleBottom + 30);
    for (const line of subLines) {
      ctx.fillText(line, subX, sy);
      sy += Math.round(T.subheadLineHeight * scale);
    }
  }

  // Restore defaults so later draws sharing this context are unaffected.
  ctx.textAlign = "left";
  ctx.direction = "ltr";
}

// ---------------------------------------------------------------------
// Screen content (screenshot or placeholder). Rendered into an offscreen
// canvas sized to SCREEN, then masked with a rounded rect using
// `destination-in` — unlike ctx.clip(), destination-in antialiases the mask
// edge, killing the "laddery" stairstepping on inner bezel corners.
// ---------------------------------------------------------------------
function paintScreenshot(
  ctx: CanvasRenderingContext2D,
  screenshotImg: ImageSourceLike | null,
  F: Frame,
): void {
  const S = F.SCREEN;
  const off = createCanvas(S.w, S.h);
  const o = get2d(off);

  if (!screenshotImg) {
    o.fillStyle = "#ffffff";
    o.fillRect(0, 0, S.w, S.h);
    o.strokeStyle = "rgba(0,0,0,0.04)";
    o.lineWidth = 2;
    for (let k = -S.h; k < S.w + S.h; k += 48) {
      o.beginPath();
      o.moveTo(k, 0);
      o.lineTo(k - S.h, S.h);
      o.stroke();
    }
    o.fillStyle = "rgba(26,22,18,0.30)";
    o.font = '500 56px "Inter", system-ui';
    o.textAlign = "center";
    o.textBaseline = "middle";
    o.fillText("Drop screenshot", S.w / 2, S.h / 2);
  } else {
    const iw = screenshotImg.naturalWidth || screenshotImg.width;
    const ih = screenshotImg.naturalHeight || screenshotImg.height;
    const sr = iw / ih;
    const tr = S.w / S.h;
    let dx, dy, dw, dh;
    if (sr > tr) {
      dh = S.h;
      dw = dh * sr;
      dx = (S.w - dw) / 2;
      dy = 0;
    } else {
      dw = S.w;
      dh = dw / sr;
      dx = 0;
      dy = (S.h - dh) / 2;
    }
    o.drawImage(toDrawable(screenshotImg), dx, dy, dw, dh);
  }

  o.globalCompositeOperation = "destination-in";
  o.fillStyle = "#000";
  roundRect(o, 0, 0, S.w, S.h, S.r);
  o.fill();

  ctx.drawImage(toDrawable(off), S.x, S.y);
}

function paintFrameOverlay(ctx: CanvasRenderingContext2D, F: Frame): void {
  paintFrameChrome(ctx, F);
  paintCamera(ctx, F);
}

// ---------------------------------------------------------------------
// Main entry — slide & strip
// ---------------------------------------------------------------------
export async function paintSlide(
  canvas: CanvasLike,
  slide: Slide,
  settings: Settings,
  slideIndex: number,
  totalSlides: number,
): Promise<void> {
  const F = getFrame(settings.platform || "ios");
  canvas.width = F.W;
  canvas.height = F.H;
  const ctx = get2d(canvas);
  ctx.clearRect(0, 0, F.W, F.H);

  paintBackground(ctx, slide.background ?? settings.background, slideIndex, totalSlides, F);
  paintText(ctx, slide, settings, F);
  paintScreenshot(ctx, slide.image, F);
  paintFrameOverlay(ctx, F);
}

export async function paintStrip(
  canvas: CanvasLike,
  slides: Slide[],
  settings: Settings,
): Promise<void> {
  const F = getFrame(settings.platform || "ios");
  const N = slides.length;
  canvas.width = F.W * N;
  canvas.height = F.H;
  const ctx = get2d(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < N; i++) {
    const slideCanvas = createCanvas(F.W, F.H);
    await paintSlide(slideCanvas, slides[i], settings, i, N);
    ctx.drawImage(toDrawable(slideCanvas), i * F.W, 0);
  }
}

// Dimensions for a given platform — used by previews to size canvases.
export function dimFor(platform: string): PlatformDim {
  const F = getFrame(platform);
  return { W: F.W, H: F.H, storeLabel: F.storeLabel, label: F.label };
}

// Picker order: App Store frames first, then Play Store.
export const PLATFORMS: PlatformMeta[] = [IOS_FRAME, IPAD_FRAME, ANDROID_FRAME, ANDROID_TABLET_FRAME].map(
  (f) => ({
    id: f.id,
    label: f.label,
    store: f.store,
    storeLabel: f.storeLabel,
    dim: `${f.W} × ${f.H}`,
  }),
);
