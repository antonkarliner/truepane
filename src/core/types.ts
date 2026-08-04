// Shared types for Truepane.

// Minimal structural types for the rendering surface, so the core can run
// against both DOM objects (HTMLCanvasElement / HTMLImageElement) and Node
// implementations (e.g. @napi-rs/canvas) without naming either. The browser
// types satisfy these structurally — no casts needed at call sites.
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
  /** Present on HTMLCanvasElement and @napi-rs/canvas alike. Optional so a
   * minimal canvas stand-in still satisfies the render path, which never
   * encodes — only the background-image importer does. */
  toDataURL?(type?: string, quality?: number): string;
}

/** A drawImage-able pixel source. `naturalWidth`/`naturalHeight` are present
 * on HTMLImageElement and preferred over `width`/`height` when set. */
export interface ImageSourceLike {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface RoundRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface IslandCamera {
  kind: "island";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HoleCamera {
  kind: "hole";
  cx: number;
  cy: number;
  r: number;
}

export type Camera = IslandCamera | HoleCamera;

export interface SideButton {
  side: "left" | "right";
  y: number;
  h: number;
}

export interface FrameColors {
  body: string;
  bezel: string;
  button: string;
  edgeHi: string;
}

export interface FrameText {
  leftPad: number;
  rightPad: number;
  titleTop: number;
  titleFontSize: number;
  titleLineHeight: number;
  titleWeight: number;
  subheadTop: number;
  subheadFontSize: number;
  subheadLineHeight: number;
  subheadWeight: number;
  titleToSubheadGap: number;
}

export type StoreId = "appstore" | "playstore";

export interface Frame {
  id: string;
  label: string;
  store: StoreId;
  storeLabel: string;
  W: number;
  H: number;
  BODY: RoundRect;
  BEZEL: RoundRect;
  SCREEN: RoundRect;
  CAMERA: Camera;
  SIDE_BUTTONS: SideButton[];
  COLORS: FrameColors;
  TEXT: FrameText;
  /** Geometry scale relative to the native frame, for non-native output surfaces. */
  geometryScale?: number;
}

// Background = a fill layer (solid or gradient) with an optional shape overlay
// drawn on top of it.
export type BackgroundFill = "solid" | "linear" | "radial";
export type ShapeKind =
  | "none"
  | "rings"
  | "blobs"
  | "waves"
  | "dots"
  | "mesh"
  | "arcs"
  | "triangles"
  | "grid"
  | "zigzag"
  | "bubbles"
  | "custom";

// The one parameterized family. Everything here is DATA — never code — so a
// shared .truepane file stays inert, the renderer stays fixed for release
// baselines, and an agent can compose a look by filling in numbers.
export type CustomShapePrimitive = "ring" | "disc" | "arc" | "triangle" | "bar" | "blob";
export type CustomShapeLayout = "scatter" | "grid" | "row" | "radial" | "wave";

export interface CustomShapeSpec {
  primitive: CustomShapePrimitive;
  layout: CustomShapeLayout;
  /** Instances across the WHOLE strip (1..200). Also the allocation bound. */
  count: number;
  /** Instance radius in slide-width units, 0..1. */
  size: number;
  /** Random size variation, 0..1. */
  sizeJitter: number;
  /** Base rotation in degrees, -180..180. */
  rotation: number;
  /** Random rotation spread in degrees, 0..360. */
  rotationJitter: number;
  /** Lattice step along the strip in slide-width units, 0.02..2. */
  spacingX: number;
  /** Lattice step / wave amplitude in slide-height units, 0.02..2. */
  spacingY: number;
  /** Shifts the lattice along the strip, 0..1. */
  phase: number;
  /** Outline width in px at native scale; 0 = filled. 0..40. */
  strokeWidth: number;
  /** Alpha ramp across the strip, -1..1. 0 = flat, >0 fades in, <0 fades out. */
  opacityRamp: number;
}

// Where a background image's pixels come from. "screenshot" is retained only
// so projects saved before uploaded-backdrop blur was introduced still paint.
export type BackgroundImageSource =
  | { kind: "upload"; id: string; dataUrl: string; width: number; height: number }
  | { kind: "screenshot"; blur: number };

export interface BackgroundImage {
  source: BackgroundImageSource;
  /** "slide" fits one slide; "strip" fits W*N and is sliced by slideIndex. */
  span: "slide" | "strip";
  fit: "cover" | "contain";
  /** Backdrop blur, 0..1. Optional only for projects saved before this field. */
  blur?: number;
  opacity: number;
  /** User-controlled wash between image and text — the legibility control. */
  scrim: number;
  scrimColor: string;
  /** Mean relative luminance (0..1), measured once at import so preflight can
   * estimate text contrast without a canvas. */
  meanLuminance: number;
}

export interface Background {
  fill: BackgroundFill;
  shape: ShapeKind;
  color: string; // solid fill / gradient start
  gradientColor: string; // gradient end (independent of the shape color)
  accent: string; // shape color
  accentOpacity: number;
  ringLayout: string;
  ringCount: number;
  seed: number;
  density: number;
  dotsAligned: boolean;
  gradientAngle: number;
  /** Optional image layer, painted between the fill and the shape overlay. */
  image?: BackgroundImage | null;
  /** Parameters for shape "custom". Absent until the family is used, so a
   * project that never selects it serializes exactly as it did before. */
  customShape?: CustomShapeSpec;
}

export interface FillOption {
  id: BackgroundFill;
  name: string;
}

export interface ShapeFamily {
  id: ShapeKind;
  name: string;
  /** Shows the density slider + Randomize (seed-based scatter styles). */
  seeded?: boolean;
}

export interface CustomFont {
  name: string;
  dataUrl: string;
}

export type CompositionPreset = "classic" | "hero" | "tilt-left" | "tilt-right" | "editorial";
export type TextAlign = "left" | "center" | "right";

export interface TextPlacement {
  /** Normalized canvas coordinates (0..1; controlled bleed may exceed this). */
  x: number;
  y: number;
  width: number;
  align: TextAlign;
  /**
   * Flat 2D rotation of the whole block in degrees, about its center. Clamped
   * tighter than the device's ±20 — rotated text loses legibility faster.
   */
  rotation: number;
}

export interface DevicePlacement {
  /** Device BODY center in normalized canvas coordinates. */
  x: number;
  y: number;
  scale: number;
  /** Flat 2D rotation in degrees. */
  rotation: number;
}

export interface Composition {
  preset: CompositionPreset;
  text?: Partial<TextPlacement>;
  device?: Partial<DevicePlacement>;
}

// A title/subhead pair, optionally with its own localized screenshot. The base
// text/image live on the slide directly; per-language overrides are stored as a
// map of these keyed by language code. `imageDataUrl` is the serialized locale
// screenshot; `image` is the live decode, rebuilt from it and never serialized.
// Both are optional — a locale with no screenshot falls back to the base image.
export interface SlideText {
  title: string;
  subhead: string;
  /** @deprecated Legacy v1 locale media, migrated into Slide.media. */
  imageDataUrl?: string | null;
  image?: ImageSourceLike | null;
}

export interface ImageAsset {
  imageDataUrl: string | null;
  image?: ImageSourceLike | null;
  width?: number;
  height?: number;
}

export interface TargetMedia {
  source?: ImageAsset;
  locales?: Record<string, ImageAsset>;
}

// A target language for AI translation. `code` is used for ZIP folder names and
// as the key into `Slide.translations`; `name` is the human label sent to the AI.
// `font` optionally overrides the global fontFamily when rendering this language
// — e.g. a Noto Sans Arabic override so an Arabic locale renders while the base
// uses San Francisco. A FONT_OPTIONS id; falls back to the global font if unset.
export interface LanguageTarget {
  code: string;
  name: string;
  font?: string;
}

export type OutputKind = "native" | "feature" | "custom";

export interface OutputSpec {
  id: string;
  label: string;
  width: number;
  height: number;
  store: StoreId;
  kind: OutputKind;
  frame: string;
}

export interface Settings {
  platform: string;
  /** Optional output surface. Absent preserves the legacy native platform canvas. */
  output?: OutputSpec;
  /** Export targets included in this project. `platform` is the active target. */
  targets?: string[];
  fontFamily: string;
  customFont: CustomFont | null;
  titleColor: string;
  titleScale: number;
  titleWeight: number; // font weight 100..900 (default 700)
  subheadColor: string;
  subtitleScale: number;
  subtitleWeight: number; // font weight 100..900 (default 400)
  background: Background;
  composition?: Composition;
  languages?: LanguageTarget[];
  translationContext?: string;
}

export interface Slide {
  title: string;
  subhead: string;
  image: ImageSourceLike | null;
  imageDataUrl: string | null;
  /** Target-specific source and localized screenshots (project format v2). */
  media?: Record<string, TargetMedia>;
  background?: Background;
  composition?: Composition;
  /** Links this device to the matching half on an adjacent slide. */
  deviceSpan?: { id: string; role: "left" | "right" };
  titleColor?: string;
  subheadColor?: string;
  translations?: Record<string, SlideText>;
}

export interface AppState {
  slides: Slide[];
  settings: Settings;
  releaseBaseline?: ReleaseBaseline;
}

export interface ReleaseBaseline {
  version: 1;
  rendererVersion: number;
  createdAt: string;
  signatures: Record<string, string>;
}

export type ReleaseAssetStatus = "added" | "changed" | "unchanged" | "removed";

export interface ReleaseAssetComparison {
  key: string;
  status: ReleaseAssetStatus;
  slide: number;
  target: string;
  language: string;
  output: string;
}

export interface RingGroup {
  cx: number;
  cy: number;
  baseR: number;
  spacing: number;
}

export interface RingLayout {
  id: string;
  name: string;
  groups: (n: number) => RingGroup[];
}

export interface FontOption {
  id: string;
  label: string;
  /** Google Fonts css2 family spec. Omitted for system fonts (no web load). */
  google?: string;
  /** Large fonts (e.g. CJK) loaded only on selection, never in the preload. */
  heavy?: boolean;
}

export interface PlatformMeta {
  id: string;
  label: string;
  store: StoreId;
  storeLabel: string;
  dim: string;
}

export interface PlatformDim {
  W: number;
  H: number;
  storeLabel: string;
  label: string;
}
