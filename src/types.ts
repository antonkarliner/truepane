// Shared types for Truepane.

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
  | "bubbles";

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

// A title/subhead pair. The base text lives on the slide directly; per-language
// translations are stored as a map of these keyed by language code.
export interface SlideText {
  title: string;
  subhead: string;
}

// A target language for AI translation. `code` is used for ZIP folder names and
// as the key into `Slide.translations`; `name` is the human label sent to the AI.
export interface LanguageTarget {
  code: string;
  name: string;
}

export interface Settings {
  platform: string;
  fontFamily: string;
  customFont: CustomFont | null;
  titleColor: string;
  titleScale: number;
  subheadColor: string;
  subtitleScale: number;
  background: Background;
  languages?: LanguageTarget[];
  translationContext?: string;
}

export interface Slide {
  title: string;
  subhead: string;
  image: HTMLImageElement | null;
  imageDataUrl: string | null;
  background?: Background;
  titleColor?: string;
  subheadColor?: string;
  translations?: Record<string, SlideText>;
}

export interface AppState {
  slides: Slide[];
  settings: Settings;
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
