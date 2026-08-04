// Mobile layout for Truepane — preview-first workflow with bottom sheet tabs.
import { useEffect, useRef, useState } from "react";
import { ColorRow, CompositionControls, CustomShapeControls, Field, ImageDrop, LayoutSlider, Segmented, SlidePreview, TextInput } from "./components";
import { BrandKitControls } from "./BrandKitControls";
import { OutputFormatControl } from "./OutputFormatControl";
import { ReleaseUpdateControls } from "./ReleaseUpdateControls";
import { FILL_OPTIONS, PLATFORMS, RING_LAYOUTS, SHAPE_FAMILIES, dimForSettings } from "./core/render";
import { accentSuggestions, extractPalette } from "./palette";
import { aiConfigured, generateBackground, type AiProvider } from "./ai";
import { BG_PRESETS, DEFAULT_CUSTOM_SHAPE, FONT_OPTIONS } from "./core/constants";
import { getImageAsset, setImageAsset } from "./core/media";
import type { AppState, Background, BackgroundFill, BackgroundImage, Composition, ReleaseAssetComparison, ShapeKind, Settings, Slide } from "./core/types";

// Where a background image applies. Derived from the background state, not
// stored — mirrors the same type in src/Sidebar.tsx.
type BackgroundImageScope = "this" | "all" | "strip";
import type { BrandKit } from "./core/brand-kit";

const DEFAULT_SHAPE_PRESETS = ["#c47c3b", "#1a1612", "#5b6647", "#c4523b", "#5b6cff", "#8a6f4f"];
type MobileTab = "content" | "style" | "background" | "export";

export interface MobileLayoutProps {
  state: AppState;
  selectedIndex: number;
  setSelectedIndex: (idx: number) => void;
  setFont: (family: string) => void;
  onCustomFont: (file: File) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateBackground: (patch: Partial<Background>) => void;
  updateSlideBackground: (patch: Partial<Background>) => void;
  importBackgroundImage: (
    source: HTMLImageElement,
    span: BackgroundImage["span"],
  ) => Promise<{ image: BackgroundImage; warning: string | null }>;
  selected: Slide;
  updateSlide: (patch: Partial<Slide>) => void;
  deleteSelected: () => void;
  moveSelected: (dir: number) => void;
  addSlide: () => void;
  exportPng: () => void;
  exportStrip: () => void;
  exportZip: () => void;
  exportJson: () => void;
  importJson: (file: File) => void;
  exporting: string | null;
  requestEyedrop: (apply: (hex: string) => void) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  eyedropTarget: ((hex: string) => void) | null;
  pickColorFromSlide: (hex: string) => void;
  arranging: boolean;
  onToggleArrange: () => void;
  onSpanDevice: () => void;
  onBulkFiles: (files: File[]) => void;
  onRunPreflight: () => void;
  brandKits: BrandKit[];
  onCreateBrandKit: (name: string) => void;
  onRenameBrandKit: (id: string, name: string) => void;
  onApplyBrandKit: (kit: BrandKit, clearOverrides: boolean) => void;
  onDeleteBrandKit: (id: string) => void;
  onImportBrandKit: (kit: BrandKit) => void;
  releaseRows: ReleaseAssetComparison[];
  releaseBusy: boolean;
  onCompareRelease: () => void;
  onExportChanged: () => void;
  onSetReleaseBaseline: () => void;
}

export function MobileLayout(props: MobileLayoutProps) {
  const {
    state, selectedIndex, setSelectedIndex, setFont, onCustomFont,
    updateSettings, updateBackground, updateSlideBackground, importBackgroundImage,
    selected, updateSlide, deleteSelected, moveSelected,
    addSlide,
    exportPng, exportStrip, exportZip, exportJson, importJson, exporting,
    requestEyedrop, theme, onToggleTheme,
    canUndo, canRedo, onUndo, onRedo,
    eyedropTarget, pickColorFromSlide,
    arranging, onToggleArrange,
    onSpanDevice,
    onBulkFiles,
    onRunPreflight,
    brandKits,
    onCreateBrandKit,
    onRenameBrandKit,
    onApplyBrandKit,
    onDeleteBrandKit,
    onImportBrandKit,
    releaseRows,
    releaseBusy,
    onCompareRelease,
    onExportChanged,
    onSetReleaseBaseline,
  } = props;

  const [activeTab, setActiveTab] = useState<MobileTab>("content");
  const [fullPreview, setFullPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => Math.min(window.innerWidth - 32, 380));
  const [innerHeight, setInnerHeight] = useState(() => window.innerHeight * 0.35);
  const innerRef = useRef<HTMLDivElement>(null);

  const fontFileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const bulkDirectoryRef = useRef<HTMLInputElement>(null);
  const bulkZipRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef(0);

  // AI state — mirrors Sidebar
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [lockStyle, setLockStyle] = useState(false);
  const [showByok, setShowByok] = useState(false);
  const [autoAccent, setAutoAccent] = useState(true);
  const [showPresets, setShowPresets] = useState(false);
  const [bgImageBusy, setBgImageBusy] = useState(false);
  const [bgImageNote, setBgImageNote] = useState<string | null>(null);
  const [showContentOptions, setShowContentOptions] = useState(false);
  const [showStyleOptions, setShowStyleOptions] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("cerebras");
  const [byokKey, setByokKey] = useState(() => {
    try { return localStorage.getItem("groq-byok") || ""; } catch { return ""; }
  });

  useEffect(() => {
    const fn = () => setPreviewWidth(Math.min(window.innerWidth - 32, 380));
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // Track the inner preview container's height so we can scale the slide to
  // always fit fully — no cropping when the bottom panel is open.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setInnerHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setByok = (v: string) => {
    setByokKey(v);
    try { localStorage.setItem("groq-byok", v); } catch { /* ignore */ }
  };

  const totalSlides = state.slides.length;
  const platform = state.settings.platform || "ios";
  const activeAsset = getImageAsset(selected, platform);
  const previewSlide = { ...selected, image: activeAsset.image ?? null, imageDataUrl: activeAsset.imageDataUrl };
  const dim = dimForSettings(state.settings);

  // Scale slide to fit within available width AND height — whichever is tighter.
  // dim.W/dim.H is the slide aspect ratio (portrait ≈ 0.46 for iPhone).
  const slideAspect = dim.W / dim.H;
  const displayWidth = Math.max(60, Math.floor(Math.min(
    previewWidth,
    (innerHeight - 8) * slideAspect,
  )));

  const hasTextOverride = selected.titleColor !== undefined || selected.subheadColor !== undefined;
  const toggleTextOverride = () => {
    if (hasTextOverride) {
      updateSlide({ titleColor: undefined, subheadColor: undefined });
    } else {
      updateSlide({ titleColor: state.settings.titleColor, subheadColor: state.settings.subheadColor });
    }
  };

  const hasSlideOverride = !!selected.background;
  const bg = selected.background ?? state.settings.background;
  const handleBgUpdate = hasSlideOverride ? updateSlideBackground : updateBackground;
  const toggleSlideOverride = () => {
    if (hasSlideOverride) {
      updateSlide({ background: undefined });
    } else {
      updateSlide({ background: { ...state.settings.background } });
    }
  };
  const hasCompositionOverride = !!selected.composition;
  const composition = selected.composition ?? state.settings.composition;
  const updateComposition = (next: Composition) => {
    updateSlide({ composition: next });
  };
  const toggleCompositionOverride = () => {
    if (hasCompositionOverride) updateSlide({ composition: undefined });
    else updateSlide({ composition: { ...(state.settings.composition ?? { preset: "classic" }) } });
  };

  // Background image — the same one field the desktop sidebar edits. "this"
  // means the image sits on this slide's own background override; "all" and
  // "strip" mean it sits on settings.
  const bgImage = bg.image ?? null;
  const isDerivedBackdrop = bgImage?.source.kind === "screenshot";
  const imageScope: BackgroundImageScope =
    bgImage?.span === "strip" ? "strip" : hasSlideOverride && selected.background?.image ? "this" : "all";

  const patchImage = (patch: Partial<BackgroundImage>) => {
    if (!bgImage) return;
    handleBgUpdate({ image: { ...bgImage, ...patch } });
  };

  const setImageScope = (scope: BackgroundImageScope) => {
    if (!bgImage) return;
    if (scope === "this") {
      if (hasSlideOverride) updateSlideBackground({ image: { ...bgImage, span: "slide" } });
      else updateSlide({ background: { ...state.settings.background, image: { ...bgImage, span: "slide" } } });
      return;
    }
    updateBackground({ image: { ...bgImage, span: scope === "strip" ? "strip" : "slide" } });
    if (selected.background?.image) updateSlideBackground({ image: null });
  };

  const applyBackgroundImage = async (source: HTMLImageElement) => {
    setBgImageBusy(true);
    setBgImageNote(null);
    try {
      const { image, warning } = await importBackgroundImage(
        source,
        imageScope === "strip" ? "strip" : "slide",
      );
      handleBgUpdate({ image });
      setBgImageNote(warning);
    } catch (error) {
      setBgImageNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBgImageBusy(false);
    }
  };

  const slideSizeHint = `${dim.W} × ${dim.H}`;
  const stripSizeHint = `${dim.W * Math.max(1, totalSlides)} × ${dim.H}`;

  const shapeMeta = SHAPE_FAMILIES.find((f) => f.id === bg.shape);
  const isGradient = bg.fill !== "solid";
  const hasShape = bg.shape !== "none";
  const accentLabel = bg.shape === "rings" ? "Ring color" : "Shape color";
  const shapePresets = autoAccent ? accentSuggestions(bg.color) : DEFAULT_SHAPE_PRESETS;
  // Mirrors the sidebar: the custom family has its own spec instead of the
  // shared `density` slider, but stays seeded so Randomize still reshuffles it.
  const isCustomShape = bg.shape === "custom";
  const customSpec = bg.customShape ?? DEFAULT_CUSTOM_SHAPE;
  const updateCustomShape = (patch: Partial<typeof customSpec>) =>
    handleBgUpdate({ customShape: { ...customSpec, ...patch } });

  const matchPalette = () => {
    if (!activeAsset.image) return;
    const p = extractPalette(activeAsset.image);
    if (p) handleBgUpdate({ color: p.color, accent: p.accent });
  };
  const randomizeSeed = () => handleBgUpdate({ seed: Math.floor(Math.random() * 1e9) });

  const runAiPrompt = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const { params, note, text } = await generateBackground(
        aiPrompt.trim(), aiProvider,
        aiProvider === "groq" ? byokKey || undefined : undefined,
      );
      setAiNote(note || null);
      if (text) updateSettings({ titleColor: text.titleColor, subheadColor: text.subheadColor });
      if (lockStyle) {
        const recolor: Partial<Background> = {};
        if (params.color !== undefined) recolor.color = params.color;
        if (params.gradientColor !== undefined) recolor.gradientColor = params.gradientColor;
        if (params.accent !== undefined) recolor.accent = params.accent;
        if (params.accentOpacity !== undefined) recolor.accentOpacity = params.accentOpacity;
        handleBgUpdate(recolor);
      } else {
        handleBgUpdate(params);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setAiBusy(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 40) return;
    if (dx < 0 && selectedIndex < totalSlides - 1) setSelectedIndex(selectedIndex + 1);
    if (dx > 0 && selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
  };

  return (
    <div className="mobile-layout">

      {/* ── Header ── */}
      <header className="mobile-header">
        <div className="brand">
          <div className="brand__mark">
            <svg viewBox="0 0 32 32" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="bm_g_m" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e07828" />
                  <stop offset="100%" stopColor="#8840b8" />
                </linearGradient>
              </defs>
              <rect x="4" y="8" width="5.5" height="16" rx="1.6" style={{ fill: "var(--brand-left-fill)" }} />
              <rect x="13.25" y="6" width="5.5" height="20" rx="1.6" fill="url(#bm_g_m)" />
              <rect x="22.5" y="8" width="5.5" height="16" rx="1.6" fill="#7060a8" />
              <circle cx="6.75" cy="10.2" r="0.75" fill="#18141c" opacity="0.45" />
              <circle cx="16" cy="8.2" r="0.75" fill="#18141c" opacity="0.45" />
              <circle cx="25.25" cy="10.2" r="0.75" fill="#18141c" opacity="0.45" />
            </svg>
          </div>
          <div className="brand__name">Truepane</div>
        </div>
        <span className="badge mobile-header__badge">{selectedIndex + 1} / {totalSlides}</span>
        <div className="history-controls" role="group" aria-label="Edit history">
          <button
            className="history-button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo"
            aria-label="Undo"
            aria-keyshortcuts="Control+Z Meta+Z"
          >
            ↶
          </button>
          <button
            className="history-button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo"
            aria-label="Redo"
            aria-keyshortcuts="Control+Y Meta+Shift+Z"
          >
            ↷
          </button>
        </div>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </header>

      {/* ── Preview zone ── */}
      <div className={"mobile-preview" + (fullPreview ? " mobile-preview--full" : "")}>
        {eyedropTarget && !fullPreview && (
          <div className="mobile-eyedrop-hint">Tap slide to pick a color</div>
        )}
        <div
          ref={innerRef}
          className="mobile-preview__inner"
          onTouchStart={arranging ? undefined : handleTouchStart}
          onTouchEnd={arranging ? undefined : handleTouchEnd}
          onClick={fullPreview && !eyedropTarget ? () => setFullPreview(false) : undefined}
          style={{ pointerEvents: eyedropTarget && !fullPreview ? "none" : undefined }}
        >
          <SlidePreview
            slide={previewSlide}
            settings={state.settings}
            slideIndex={selectedIndex}
            totalSlides={totalSlides}
            displayWidth={displayWidth}
            selected={arranging}
            onSelect={() => {}}
            onDelete={null}
            eyedropping={!!eyedropTarget}
            onPickColor={pickColorFromSlide}
            arranging={arranging}
            onCompositionChange={(next) => updateSlide({ composition: next })}
          />
        </div>

        {/* Slide nav: prev arrow, dots, next arrow, add */}
        {!fullPreview && (
          <div className="mobile-nav">
            <button
              className="mobile-nav__arrow"
              disabled={selectedIndex === 0}
              onClick={() => setSelectedIndex(selectedIndex - 1)}
              aria-label="Previous slide"
            >
              ‹
            </button>
            <div className="mobile-dots">
              {state.slides.map((_, i) => (
                <button
                  key={i}
                  className={"mobile-dot" + (i === selectedIndex ? " active" : "")}
                  onClick={() => setSelectedIndex(i)}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              className="mobile-nav__arrow"
              disabled={selectedIndex >= totalSlides - 1}
              onClick={() => setSelectedIndex(selectedIndex + 1)}
              aria-label="Next slide"
            >
              ›
            </button>
            <button className="mobile-nav__add" onClick={addSlide} aria-label="Add slide">
              +
            </button>
          </div>
        )}

        {/* Full-preview toggle */}
        <button
          className="mobile-full-btn"
          onClick={(e) => { e.stopPropagation(); setFullPreview((f) => !f); }}
          title={fullPreview ? "Exit full preview" : "Full preview"}
          aria-label={fullPreview ? "Exit full preview" : "Full preview"}
        >
          {fullPreview ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
              <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>

        {/* Dimension badge */}
        {!fullPreview && (
          <div className="mobile-dim-badge">{dim.storeLabel} · {dim.W}×{dim.H}</div>
        )}

        {/* Full-preview tap-to-exit hint */}
        {fullPreview && (
          <div className="mobile-full-hint">Tap to exit</div>
        )}
      </div>

      {/* ── Bottom panel ── */}
      {!fullPreview && (
        <div className="mobile-panel">
          <div className="mobile-tabs">
            {(["content", "style", "background", "export"] as MobileTab[]).map((tab) => (
              <button
                key={tab}
                className={"mobile-tab" + (activeTab === tab ? " active" : "")}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "content" ? "Content" : tab === "style" ? "Layout" : tab === "background" ? "BG" : "Export"}
              </button>
            ))}
          </div>

          <div className="mobile-panel__body">

            {/* ── Content tab ── */}
            {activeTab === "content" && (
              <>
                <OutputFormatControl settings={state.settings} updateSettings={updateSettings} />

                <Field label={`Screenshot · ${PLATFORMS.find((p) => p.id === platform)?.label ?? platform}`}>
                  <ImageDrop
                    image={activeAsset.imageDataUrl ? { dataUrl: activeAsset.imageDataUrl } : null}
                    onImage={(img, dataUrl) => updateSlide({
                      media: setImageAsset(selected, platform, "", { image: img, imageDataUrl: dataUrl }).media,
                    })}
                    onClear={() => updateSlide({
                      media: setImageAsset(selected, platform, "", { image: null, imageDataUrl: null }).media,
                    })}
                  />
                </Field>

                <Field label="Title">
                  <TextInput
                    value={selected.title}
                    onChange={(v) => updateSlide({ title: v })}
                    placeholder="Your headline here"
                  />
                </Field>

                <Field label="Subtitle" hint="Wraps to 2 lines automatically.">
                  <TextInput
                    multiline
                    value={selected.subhead}
                    onChange={(v) => updateSlide({ subhead: v })}
                    placeholder="A short, benefit-driven subtitle."
                  />
                </Field>

                <div className="row-actions" style={{ marginBottom: 14 }}>
                  <button className="ghost small" disabled={selectedIndex === 0} onClick={() => moveSelected(-1)}>
                    ← Move
                  </button>
                  <button className="ghost small" disabled={selectedIndex >= totalSlides - 1} onClick={() => moveSelected(1)}>
                    Move →
                  </button>
                  <button className="ghost small danger" disabled={totalSlides <= 1} onClick={deleteSelected}>
                    Delete
                  </button>
                </div>

                <button className="mobile-add-slide" onClick={addSlide}>+ Add slide</button>

                <button className="disclosure optional-disclosure" onClick={() => setShowContentOptions((shown) => !shown)}>
                  <span>{showContentOptions ? "▾" : "▸"}</span> Advanced
                </button>
                {showContentOptions && (
                  <div className="control-group">
                    <div className="field__label">Bulk screenshot import</div>
                    <div className="field__hint control-group__hint">
                      Fill slides from an image folder or ZIP; files are assigned in filename order.
                    </div>
                    <div className="bulk-import-actions">
                      <button className="ghost small" onClick={() => bulkDirectoryRef.current?.click()}>Import folder</button>
                      <button className="ghost small" onClick={() => bulkZipRef.current?.click()}>Import ZIP</button>
                      <input
                        ref={bulkDirectoryRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        style={{ display: "none" }}
                        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                        onChange={(event) => {
                          onBulkFiles(Array.from(event.target.files ?? []));
                          event.target.value = "";
                        }}
                      />
                      <input
                        ref={bulkZipRef}
                        type="file"
                        accept=".zip,application/zip"
                        style={{ display: "none" }}
                        onChange={(event) => {
                          onBulkFiles(Array.from(event.target.files ?? []));
                          event.target.value = "";
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Style tab ── */}
            {activeTab === "style" && (
              <>
                <CompositionControls
                  platform={platform}
                  output={state.settings.output}
                  composition={composition}
                  hasOverride={hasCompositionOverride}
                  arranging={arranging}
                  onChange={updateComposition}
                  onToggleOverride={toggleCompositionOverride}
                  onToggleArrange={onToggleArrange}
                  onSpanDevice={onSpanDevice}
                  canSpanDevice={selectedIndex < totalSlides - 1}
                  showAdvanced={showStyleOptions}
                  advancedDisclosure={(
                    <button className="disclosure optional-disclosure" onClick={() => setShowStyleOptions((shown) => !shown)}>
                      <span>{showStyleOptions ? "▾" : "▸"}</span> Advanced
                    </button>
                  )}
                />
                <Field label={`Title size · ${Math.round((state.settings.titleScale ?? 1) * 100)}%`}>
                  <input
                    className="slider" type="range" min="0.5" max="1.5" step="0.05"
                    value={state.settings.titleScale ?? 1}
                    onChange={(e) => updateSettings({ titleScale: parseFloat(e.target.value) })}
                  />
                </Field>
                <Field label={`Subtitle size · ${Math.round((state.settings.subtitleScale ?? 1) * 100)}%`}>
                  <input
                    className="slider" type="range" min="0.5" max="1.5" step="0.05"
                    value={state.settings.subtitleScale ?? 1}
                    onChange={(e) => updateSettings({ subtitleScale: parseFloat(e.target.value) })}
                  />
                </Field>

                <Field label="Font family">
                  <select
                    className="text-input"
                    value={state.settings.fontFamily}
                    onChange={(e) => setFont(e.target.value)}
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.id} value={f.id} style={{ fontFamily: f.google ? `"${f.id}", sans-serif` : `${f.id}, sans-serif` }}>
                        {f.label}
                      </option>
                    ))}
                    {state.settings.customFont && (
                      <option value={state.settings.customFont.name} style={{ fontFamily: `"${state.settings.customFont.name}"` }}>
                        {state.settings.customFont.name} (custom)
                      </option>
                    )}
                  </select>
                  {showStyleOptions && (
                    <>
                      <button className="ghost small upload-btn" onClick={() => fontFileRef.current?.click()}>
                        Upload .ttf / .otf / .woff(2)
                      </button>
                      <input
                        ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*"
                        style={{ display: "none" }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) onCustomFont(f); e.target.value = ""; }}
                      />
                    </>
                  )}
                </Field>

                {showStyleOptions && (
                  <>
                    <ColorRow
                      label="Title color"
                      value={state.settings.titleColor}
                      onChange={(v) => updateSettings({ titleColor: v })}
                      onEyedrop={requestEyedrop}
                      presets={["#1a1612", "#0a0a0a", "#3b2a1b", "#ffffff", "#f6f3ec", "#c47c3b"]}
                    />
                    <ColorRow
                      label="Subtitle color"
                      value={state.settings.subheadColor}
                      onChange={(v) => updateSettings({ subheadColor: v })}
                      onEyedrop={requestEyedrop}
                      presets={["rgba(26,22,18,0.62)", "rgba(26,22,18,0.85)", "rgba(255,255,255,0.72)", "#5b6647", "#c47c3b", "#666666"]}
                    />
                    <label className="ai-lock">
                      <input type="checkbox" checked={hasTextOverride} onChange={toggleTextOverride} />
                      Override text colors for this slide only
                    </label>
                    {hasTextOverride && (
                      <>
                        <ColorRow
                          label="Title (this slide)"
                          value={selected.titleColor ?? state.settings.titleColor}
                          onChange={(v) => updateSlide({ titleColor: v })}
                          onEyedrop={requestEyedrop}
                        />
                        <ColorRow
                          label="Subtitle (this slide)"
                          value={selected.subheadColor ?? state.settings.subheadColor}
                          onChange={(v) => updateSlide({ subheadColor: v })}
                          onEyedrop={requestEyedrop}
                        />
                      </>
                    )}
                    <Field label="Brand kits">
                      <BrandKitControls
                        kits={brandKits}
                        onCreate={onCreateBrandKit}
                        onRename={onRenameBrandKit}
                        onApply={onApplyBrandKit}
                        onDelete={onDeleteBrandKit}
                        onImport={onImportBrandKit}
                      />
                    </Field>
                  </>
                )}
              </>
            )}

            {/* ── Background tab ── */}
            {activeTab === "background" && (
              <>
                <label className="ai-lock" style={{ marginBottom: 14 }}>
                  <input type="checkbox" checked={hasSlideOverride} onChange={toggleSlideOverride} />
                  Override background for this slide only
                </label>

                {aiConfigured && (
                  <Field label="Generate with AI" hint="Describe a vibe; AI picks a style + palette.">
                    <Segmented
                      value={aiProvider}
                      onChange={(v) => setAiProvider(v as AiProvider)}
                      options={[{ value: "cerebras", label: "Cerebras 120B" }, { value: "groq", label: "Groq 70B" }]}
                    />
                    <TextInput value={aiPrompt} onChange={setAiPrompt} placeholder="e.g. calm, warm, organic" />
                    <button className="ghost small upload-btn" disabled={aiBusy || !aiPrompt.trim()} onClick={runAiPrompt}>
                      {aiBusy ? "Generating…" : "Generate"}
                    </button>
                    <label className="ai-lock">
                      <input type="checkbox" checked={lockStyle} onChange={(e) => setLockStyle(e.target.checked)} />
                      Lock style (recolor only)
                    </label>
                    {aiProvider === "groq" && (
                      <>
                        <button className="ghost small upload-btn" onClick={() => setShowByok((s) => !s)}>
                          {showByok ? "Hide key field" : "Use my own Groq key"}
                        </button>
                        {showByok && (
                          <input
                            className="text-input" type="password"
                            placeholder="gsk_… (stored in this browser only)"
                            value={byokKey}
                            onChange={(e) => setByok(e.target.value)}
                          />
                        )}
                      </>
                    )}
                    {aiError && <div className="field__hint" style={{ color: "#c4523b" }}>{aiError}</div>}
                    {aiNote && !aiError && <div className="ai-note">"{aiNote}"</div>}
                  </Field>
                )}

                <Field label="Fill">
                  <select
                    className="text-input" value={bg.fill}
                    onChange={(e) => handleBgUpdate({ fill: e.target.value as BackgroundFill })}
                  >
                    {FILL_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>

                {bg.fill === "linear" && (
                  <Field label={`Angle · ${bg.gradientAngle ?? 135}°`}>
                    <input
                      className="slider" type="range" min="0" max="360" step="5"
                      value={bg.gradientAngle ?? 135}
                      onChange={(e) => handleBgUpdate({ gradientAngle: parseInt(e.target.value, 10) })}
                    />
                  </Field>
                )}

                <ColorRow
                  label={isGradient ? "Gradient start" : "Background color"}
                  value={bg.color}
                  onChange={(v) => handleBgUpdate({ color: v })}
                  onEyedrop={requestEyedrop}
                />
                {isGradient && (
                  <ColorRow
                    label="Gradient end"
                    value={bg.gradientColor}
                    onChange={(v) => handleBgUpdate({ gradientColor: v })}
                    onEyedrop={requestEyedrop}
                    presets={DEFAULT_SHAPE_PRESETS}
                  />
                )}

                {/* Image layer — painted between the fill and the shapes. */}
                <div className="control-group">
                  <div className="field__label">Background image</div>
                  <div className="field__hint control-group__hint">
                    One slide needs {slideSizeHint}px; one image across the whole strip needs {stripSizeHint}px.
                    Any size works — it is scaled and cropped to fit.
                  </div>
                  {isDerivedBackdrop && (
                    <div className="field__hint bg-image-note">
                      This older project uses its app screenshot as the backdrop. Upload an image to replace it.
                    </div>
                  )}
                  <ImageDrop
                    image={bgImage?.source.kind === "upload" ? { dataUrl: bgImage.source.dataUrl } : null}
                    onImage={(img) => void applyBackgroundImage(img)}
                    onClear={() => {
                      handleBgUpdate({ image: null });
                      setBgImageNote(null);
                    }}
                  />
                  {bgImageBusy && <div className="field__hint">Preparing image…</div>}
                  {bgImageNote && <div className="field__hint bg-image-note">{bgImageNote}</div>}
                </div>

                {bgImage && (
                  <>
                    {!isDerivedBackdrop && (
                      <Field label="Image applies to">
                        <Segmented
                          value={imageScope}
                          onChange={(value) => setImageScope(value as BackgroundImageScope)}
                          options={[
                            { value: "this", label: "This slide" },
                            { value: "all", label: "All slides" },
                            { value: "strip", label: "Across strip" },
                          ]}
                        />
                      </Field>
                    )}
                    <Field label={`Blur · ${Math.round((bgImage.blur ?? 0) * 100)}%`}>
                      <input
                        className="slider" type="range" min="0" max="1" step="0.05"
                        aria-label="Background image blur"
                        value={bgImage.blur ?? 0}
                        onChange={(e) => patchImage({ blur: parseFloat(e.target.value) })}
                      />
                    </Field>
                    <Field label={`Image opacity · ${Math.round(bgImage.opacity * 100)}%`}>
                      <input
                        className="slider" type="range" min="0" max="1" step="0.05"
                        value={bgImage.opacity}
                        onChange={(e) => patchImage({ opacity: parseFloat(e.target.value) })}
                      />
                    </Field>
                    <Field
                      label={`Scrim · ${Math.round(bgImage.scrim * 100)}%`}
                      hint="Washes the image toward the scrim color. This is what keeps titles readable over a photo."
                    >
                      <input
                        className="slider" type="range" min="0" max="1" step="0.05"
                        value={bgImage.scrim}
                        onChange={(e) => patchImage({ scrim: parseFloat(e.target.value) })}
                      />
                    </Field>
                    {!isDerivedBackdrop && (
                      <>
                        <Field label="Image fit">
                          <Segmented
                            value={bgImage.fit}
                            onChange={(value) => patchImage({ fit: value as BackgroundImage["fit"] })}
                            options={[
                              { value: "cover", label: "Fill" },
                              { value: "contain", label: "Fit" },
                            ]}
                          />
                        </Field>
                        <ColorRow
                          label="Scrim color"
                          value={bgImage.scrimColor}
                          onChange={(value) => patchImage({ scrimColor: value })}
                          onEyedrop={requestEyedrop}
                        />
                      </>
                    )}
                  </>
                )}

                <Field label="Shape">
                  <select
                    className="text-input" value={bg.shape}
                    onChange={(e) => handleBgUpdate({ shape: e.target.value as ShapeKind })}
                  >
                    {SHAPE_FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>

                {bg.shape === "rings" && (
                  <>
                    <Field label="Layout">
                      <LayoutSlider layouts={RING_LAYOUTS} value={bg.ringLayout || "calm"} onChange={(v) => handleBgUpdate({ ringLayout: v })} />
                    </Field>
                    <Field label={`Rings per group · ${bg.ringCount ?? 4}`}>
                      <input
                        className="slider" type="range" min="1" max="8" step="1"
                        value={bg.ringCount ?? 4}
                        onChange={(e) => handleBgUpdate({ ringCount: parseInt(e.target.value, 10) })}
                      />
                    </Field>
                  </>
                )}

                {/* The mobile background tab shows relevant controls inline
                    rather than behind a disclosure, so the custom family's
                    parameters follow its picker entry directly. */}
                {isCustomShape && (
                  <CustomShapeControls spec={customSpec} onChange={updateCustomShape} />
                )}

                {shapeMeta?.seeded && !isCustomShape && (
                  <Field label={`Density · ${bg.density ?? 3}`}>
                    <input
                      className="slider" type="range" min="1" max="8" step="1"
                      value={bg.density ?? 3}
                      onChange={(e) => handleBgUpdate({ density: parseInt(e.target.value, 10) })}
                    />
                  </Field>
                )}

                {bg.shape === "dots" && (
                  <label className="ai-lock">
                    <input type="checkbox" checked={bg.dotsAligned ?? false} onChange={(e) => handleBgUpdate({ dotsAligned: e.target.checked })} />
                    Align to grid
                  </label>
                )}

                {bg.shape !== "none" && (
                  <Field label={`Opacity · ${(bg.accentOpacity * 100).toFixed(0)}%`}>
                    <input
                      className="slider" type="range" min="0" max="1" step="0.05"
                      value={bg.accentOpacity}
                      onChange={(e) => handleBgUpdate({ accentOpacity: parseFloat(e.target.value) })}
                    />
                  </Field>
                )}

                {shapeMeta?.seeded && (
                  <button className="ghost small randomize-btn" onClick={randomizeSeed}>↻ Randomize</button>
                )}

                {hasShape && (
                  <>
                    <ColorRow
                      label={accentLabel}
                      value={bg.accent}
                      onChange={(v) => handleBgUpdate({ accent: v })}
                      onEyedrop={requestEyedrop}
                      presets={shapePresets}
                    />
                    <label className="ai-lock">
                      <input type="checkbox" checked={autoAccent} onChange={(e) => setAutoAccent(e.target.checked)} />
                      Suggest shape colors from background
                    </label>
                  </>
                )}

                <button className="ghost small upload-btn match-btn" disabled={!activeAsset.image} onClick={matchPalette}>
                  Match screenshot palette
                </button>

                <button className="disclosure" onClick={() => setShowPresets((s) => !s)}>
                  <span>{showPresets ? "▾" : "▸"}</span> Color presets
                </button>
                {showPresets && (
                  <div className="bg-presets">
                    {BG_PRESETS.map((p) => (
                      <button
                        key={p.name}
                        className={"bg-preset" + (bg.color === p.color ? " active" : "")}
                        onClick={() => handleBgUpdate({ color: p.color, accent: p.accent })}
                        title={p.name}
                      >
                        <span className="bg-preset__chip" style={{ background: p.color }}>
                          <span className="bg-preset__ring" style={{ borderColor: p.accent }} />
                        </span>
                        <span className="bg-preset__name">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Export tab ── */}
            {activeTab === "export" && (
              <>
                <Field label="Release update mode">
                  <ReleaseUpdateControls
                    rows={releaseRows}
                    baselineDate={state.releaseBaseline?.createdAt}
                    busy={releaseBusy}
                    onCompare={onCompareRelease}
                    onExportChanged={onExportChanged}
                    onSetBaseline={onSetReleaseBaseline}
                  />
                </Field>
                <button className="ghost preflight-button" onClick={onRunPreflight}>Run release preflight</button>
                <div className="export-grid" style={{ marginBottom: 14 }}>
                  <button className="primary" disabled={!!exporting} onClick={exportPng}>
                    {exporting === "png" ? "…" : "Download this slide (PNG)"}
                  </button>
                  <button className="primary" disabled={!!exporting} onClick={exportStrip}>
                    {exporting === "strip" ? "…" : `Download strip (${totalSlides}× horizontal PNG)`}
                  </button>
                  <button className="primary" disabled={!!exporting} onClick={exportZip}>
                    {exporting === "zip" ? "Zipping…" : "Download ZIP (all slides + strip)"}
                  </button>
                </div>
                <div className="export-row">
                  <button className="ghost small" onClick={exportJson}>Export project (JSON)</button>
                  <button className="ghost small" onClick={() => jsonFileRef.current?.click()}>Import project</button>
                  <input
                    ref={jsonFileRef} type="file" accept="application/json,.json"
                    style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }}
                  />
                </div>
                <div className="muted small" style={{ marginTop: 10 }}>Auto-saved to this browser.</div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  <a href="https://github.com/antonkarliner/truepane" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.468-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.3 1.23A11.51 11.51 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 21.796 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                    </svg>
                    GitHub
                  </a>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
