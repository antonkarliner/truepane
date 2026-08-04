// Sidebar component — all controls for Truepane.
import { useRef, useState } from "react";
import { ColorRow, CompositionControls, CustomShapeControls, Field, ImageDrop, LayoutSlider, Segmented, TextInput } from "./components";
import { BrandKitControls } from "./BrandKitControls";
import { OutputFormatControl } from "./OutputFormatControl";
import { ReleaseUpdateControls } from "./ReleaseUpdateControls";
import { dimForSettings, FILL_OPTIONS, getRenderFrame, PLATFORMS, RING_LAYOUTS, SHAPE_FAMILIES } from "./core/render";
import { normalizeComposition, resolveComposition } from "./core/composition";
import { accentSuggestions, extractPalette } from "./palette";
import { getImageAsset, setImageAsset } from "./core/media";

const DEFAULT_SHAPE_PRESETS = ["#c47c3b", "#1a1612", "#5b6647", "#c4523b", "#5b6cff", "#8a6f4f"];
import { aiConfigured, generateBackground, translateConfigured, translateSlides, type AiProvider } from "./ai";
import { DEFAULT_CUSTOM_SHAPE, FONT_OPTIONS, TRANSLATE_LANGUAGES } from "./core/constants";
import type {
  AppState,
  Background,
  BackgroundFill,
  BackgroundImage,
  Composition,
  LanguageTarget,
  ShapeKind,
  Settings,
  Slide,
  SlideText,
  ReleaseAssetComparison,
  TextAlign,
} from "./core/types";
import type { BrandKit } from "./core/brand-kit";

type SidebarTab = "content" | "background" | "layout" | "export";

// Where a background image applies. Derived from the existing background
// state, not stored: "this" means the image sits on this slide's own
// background override, "all" and "strip" mean it sits on settings.
type BackgroundImageScope = "this" | "all" | "strip";

interface SidebarProps {
  collapsed: boolean;
  state: AppState;
  selectedIndex: number;
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
  activeLang: string;
  setActiveLang: (lang: string) => void;
  updateSlideTranslation: (lang: string, patch: Partial<SlideText>) => void;
  applyTranslations: (lang: string, items: SlideText[]) => void;
  exportPng: () => void;
  exportStrip: () => void;
  exportZip: () => void;
  exportAllLanguages: () => void;
  exportJson: () => void;
  importJson: (file: File) => void;
  exporting: string | null;
  requestEyedrop: (apply: (hex: string) => void) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
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

export function Sidebar(props: SidebarProps) {
  const {
    collapsed,
    state,
    selectedIndex,
    setFont,
    onCustomFont,
    updateSettings,
    updateBackground,
    updateSlideBackground,
    importBackgroundImage,
    selected,
    updateSlide,
    deleteSelected,
    moveSelected,
    activeLang,
    setActiveLang,
    updateSlideTranslation,
    applyTranslations,
    exportPng,
    exportStrip,
    exportZip,
    exportAllLanguages,
    exportJson,
    importJson,
    exporting,
    requestEyedrop,
    theme,
    onToggleTheme,
    arranging,
    onToggleArrange,
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

  const fontFileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const bulkDirectoryRef = useRef<HTMLInputElement>(null);
  const bulkZipRef = useRef<HTMLInputElement>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [lockStyle, setLockStyle] = useState(false);
  const [showByok, setShowByok] = useState(false);
  const [autoAccent, setAutoAccent] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>("content");
  const [showContentOptions, setShowContentOptions] = useState(false);
  const [showTextColors, setShowTextColors] = useState(false);
  const [showLayoutOptions, setShowLayoutOptions] = useState(false);
  const [showBackgroundOptions, setShowBackgroundOptions] = useState(false);
  const [bgImageBusy, setBgImageBusy] = useState(false);
  const [bgImageNote, setBgImageNote] = useState<string | null>(null);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [aiProvider, setAiProvider] = useState<AiProvider>("cerebras");
  const [byokKey, setByokKey] = useState(() => {
    try {
      return localStorage.getItem("groq-byok") || "";
    } catch {
      return "";
    }
  });

  const setByok = (v: string) => {
    setByokKey(v);
    try {
      localStorage.setItem("groq-byok", v);
    } catch {
      /* ignore */
    }
  };

  const runAiPrompt = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiNote(null);
    try {
      const { params, note, text } = await generateBackground(
        aiPrompt.trim(),
        aiProvider,
        aiProvider === "groq" ? byokKey || undefined : undefined,
      );
      setAiNote(note || null);
      // Apply legible text colors derived from the chosen background.
      if (text) updateSettings({ titleColor: text.titleColor, subheadColor: text.subheadColor });
      if (lockStyle) {
        // Recolor only: keep the user's fill/shape, layout, density, and seed.
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

  // --- Translation ----------------------------------------------------
  const languages = state.settings.languages ?? [];
  const [showTranslate, setShowTranslate] = useState(false);
  const [trBusy, setTrBusy] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const [trNote, setTrNote] = useState<string | null>(null);
  const [pickLang, setPickLang] = useState("");
  const [customLang, setCustomLang] = useState("");

  const langName = (code: string) =>
    languages.find((l) => l.code === code)?.name ??
    TRANSLATE_LANGUAGES.find((l) => l.code === code)?.name ??
    code;

  const addLanguage = (target: LanguageTarget) => {
    if (!target.code || languages.some((l) => l.code === target.code)) return;
    updateSettings({ languages: [...languages, target] });
  };
  const addPicked = () => {
    const found = TRANSLATE_LANGUAGES.find((l) => l.code === pickLang);
    if (found) addLanguage(found);
    setPickLang("");
  };
  const addCustom = () => {
    const name = customLang.trim();
    if (!name) return;
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `lang-${languages.length + 1}`;
    addLanguage({ code, name });
    setCustomLang("");
  };
  const removeLanguage = (code: string) => {
    updateSettings({ languages: languages.filter((l) => l.code !== code) });
    if (activeLang === code) setActiveLang("");
  };

  const runTranslate = async () => {
    if (!languages.length || trBusy) return;
    setTrBusy(true);
    setTrError(null);
    setTrNote(null);
    const sourceItems: SlideText[] = state.slides.map((s) => ({ title: s.title, subhead: s.subhead }));
    const context = state.settings.translationContext ?? "";
    const byok = aiProvider === "groq" ? byokKey || undefined : undefined;
    const failures: string[] = [];
    let firstOk = "";
    for (const lang of languages) {
      try {
        const { items, note } = await translateSlides(sourceItems, lang.name, context, aiProvider, byok);
        applyTranslations(lang.code, items);
        if (!firstOk) {
          firstOk = lang.code;
          if (note) setTrNote(note);
        }
      } catch (e) {
        failures.push(`${lang.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    if (failures.length) setTrError(failures.join(" · "));
    if (firstOk) setActiveLang(firstOk);
    setTrBusy(false);
  };

  // Title/subhead the text fields edit: the active language's translation
  // (falling back to source as a starting point) or the source itself.
  const editTitle = activeLang ? selected.translations?.[activeLang]?.title ?? selected.title : selected.title;
  const editSubhead = activeLang
    ? selected.translations?.[activeLang]?.subhead ?? selected.subhead
    : selected.subhead;
  const onTitleChange = (v: string) =>
    activeLang ? updateSlideTranslation(activeLang, { title: v }) : updateSlide({ title: v });
  const onSubheadChange = (v: string) =>
    activeLang ? updateSlideTranslation(activeLang, { subhead: v }) : updateSlide({ subhead: v });
  const availableLangs = TRANSLATE_LANGUAGES.filter((l) => !languages.some((x) => x.code === l.code));

  const setSlideImage = (img: HTMLImageElement, dataUrl: string) => {
    const next = setImageAsset(selected, platform, activeLang, { image: img, imageDataUrl: dataUrl });
    updateSlide({ media: next.media });
  };

  const clearSlideImage = () => {
    const next = setImageAsset(selected, platform, activeLang, { image: null, imageDataUrl: null });
    updateSlide({ media: next.media });
  };

  const hasTextOverride = selected.titleColor !== undefined || selected.subheadColor !== undefined;
  const toggleTextOverride = () => {
    if (hasTextOverride) {
      updateSlide({ titleColor: undefined, subheadColor: undefined });
    } else {
      updateSlide({
        titleColor: state.settings.titleColor,
        subheadColor: state.settings.subheadColor,
      });
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
  const slidesCount = state.slides.length;
  const targetCount = state.settings.targets?.length ?? 1;
  const platform = state.settings.platform || "ios";
  const normalizedComposition = normalizeComposition(composition);
  const resolvedComposition = resolveComposition(
    normalizedComposition,
    getRenderFrame(platform, state.settings.output),
  );
  const activeAsset = getImageAsset(selected, platform, activeLang);
  const shapeMeta = SHAPE_FAMILIES.find((f) => f.id === bg.shape);
  const isGradient = bg.fill !== "solid";
  const hasShape = bg.shape !== "none";
  const accentLabel = bg.shape === "rings" ? "Ring color" : "Shape color";
  // The custom family is driven by its own spec, not by the shared `density`
  // slider. It stays `seeded` so Randomize still reshuffles its jitter.
  const isCustomShape = bg.shape === "custom";
  const customSpec = bg.customShape ?? DEFAULT_CUSTOM_SHAPE;
  const updateCustomShape = (patch: Partial<typeof customSpec>) =>
    handleBgUpdate({ customShape: { ...customSpec, ...patch } });

  // --- Background image ------------------------------------------------
  // The three scopes are one field, not three: an image on settings.background
  // applies to every slide, an image on this slide's background applies to one,
  // and span "strip" is the same global image sliced by slide index.
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
      // Seed a slide override from the current global background rather than
      // an empty one, so moving the image does not reset its colors too.
      if (hasSlideOverride) updateSlideBackground({ image: { ...bgImage, span: "slide" } });
      else updateSlide({ background: { ...state.settings.background, image: { ...bgImage, span: "slide" } } });
      return;
    }
    updateBackground({ image: { ...bgImage, span: scope === "strip" ? "strip" : "slide" } });
    // Clear only the slide's image, leaving its other overrides untouched.
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

  const toggleDerivedBackdrop = (on: boolean) => {
    handleBgUpdate({
      image: on
        ? {
            source: { kind: "screenshot", blur: 0.5 },
            span: "slide",
            fit: "cover",
            opacity: 1,
            scrim: 0,
            scrimColor: "#000000",
            meanLuminance: 0.5,
          }
        : null,
    });
    setBgImageNote(null);
  };

  const outputDim = dimForSettings(state.settings);
  const slideSizeHint = `${outputDim.W} × ${outputDim.H}`;
  const stripSizeHint = `${outputDim.W * Math.max(1, slidesCount)} × ${outputDim.H}`;

  const matchPalette = () => {
    if (!activeAsset.image) return;
    const p = extractPalette(activeAsset.image);
    if (p) handleBgUpdate({ color: p.color, accent: p.accent });
  };
  const randomizeSeed = () => handleBgUpdate({ seed: Math.floor(Math.random() * 1e9) });
  const selectTab = (tab: SidebarTab) => {
    setActiveTab(tab);
    document.querySelector<HTMLElement>(".sidebar")?.scrollTo({ top: 0 });
  };

  // Shape-color preset swatches: harmonized to the background when auto-adjust
  // is on, otherwise a fixed palette.
  const shapePresets = autoAccent ? accentSuggestions(bg.color) : DEFAULT_SHAPE_PRESETS;

  return (
    <aside className="sidebar" aria-hidden={collapsed}>
      <header className="sidebar__head">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="brand">
            <div className="brand__mark">
              <svg viewBox="0 0 32 32" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="bm_g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e07828"/>
                    <stop offset="100%" stopColor="#8840b8"/>
                  </linearGradient>
                </defs>
                <rect x="4" y="8" width="5.5" height="16" rx="1.6" style={{fill: 'var(--brand-left-fill)'}}/>
                <rect x="13.25" y="6" width="5.5" height="20" rx="1.6" fill="url(#bm_g)"/>
                <rect x="22.5" y="8" width="5.5" height="16" rx="1.6" fill="#7060a8"/>
                <circle cx="6.75" cy="10.2" r="0.75" fill="#18141c" opacity="0.45"/>
                <circle cx="16" cy="8.2" r="0.75" fill="#18141c" opacity="0.45"/>
                <circle cx="25.25" cy="10.2" r="0.75" fill="#18141c" opacity="0.45"/>
              </svg>
            </div>
            <div className="brand__name">Truepane</div>
          </div>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>
        <div className="brand__sub">App screenshots</div>
      </header>

      <nav className="sidebar__nav" aria-label="Editor sections">
        {([
          ["content", "Content"],
          ["background", "BG"],
          ["layout", "Layout"],
          ["export", "Export"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            className={activeTab === tab ? "active" : ""}
            aria-pressed={activeTab === tab}
            onClick={() => selectTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="panel" id="sidebar-slide" hidden={activeTab !== "content"}>
        <div className="panel__title">
          Selected slide
          <span className="panel__count">
            {String(selectedIndex + 1).padStart(2, "0")} / {String(slidesCount).padStart(2, "0")}
          </span>
        </div>

        <OutputFormatControl settings={state.settings} updateSettings={updateSettings} />

        <Field label={`Screenshot · ${PLATFORMS.find((p) => p.id === platform)?.label ?? platform}`}>
          <ImageDrop
            image={activeAsset.imageDataUrl ? { dataUrl: activeAsset.imageDataUrl } : null}
            onImage={setSlideImage}
            onClear={clearSlideImage}
          />
        </Field>

        {languages.length > 0 && (
          <Field label="Editing language" hint={activeLang ? "Source text shown below each field." : undefined}>
            <select className="text-input" aria-label="Editing language" value={activeLang} onChange={(e) => setActiveLang(e.target.value)}>
              <option value="">Source</option>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field
          label={activeLang ? `Title · ${langName(activeLang)}` : "Title"}
          hint={activeLang ? `Source: ${selected.title || "—"}` : undefined}
        >
          <TextInput value={editTitle} onChange={onTitleChange} placeholder="Your headline here" />
        </Field>
        <Field
          label={activeLang ? `Subtitle · ${langName(activeLang)}` : "Subtitle"}
          hint={activeLang ? `Source: ${selected.subhead || "—"}` : "Wraps to 2 lines automatically."}
        >
          <TextInput
            multiline
            value={editSubhead}
            onChange={onSubheadChange}
            placeholder="A short, benefit-driven subtitle."
          />
        </Field>
        <div className="row-actions">
          <button className="ghost small" disabled={selectedIndex === 0} onClick={() => moveSelected(-1)}>
            ← Move
          </button>
          <button
            className="ghost small"
            disabled={selectedIndex >= slidesCount - 1}
            onClick={() => moveSelected(1)}
          >
            Move →
          </button>
          <button className="ghost small danger" disabled={slidesCount <= 1} onClick={deleteSelected}>
            Delete
          </button>
        </div>

      </section>

      {translateConfigured && showContentOptions && (
        <section className="panel content-advanced-panel">
          <div className="field__label">Localization</div>
          <div className="field__hint control-group__hint">
            Translate slide titles and subtitles while keeping the source copy available for reference.
          </div>
          <button className="disclosure" onClick={() => setShowTranslate((s) => !s)}>
            <span>{showTranslate ? "▾" : "▸"}</span> Translate
            {languages.length > 0 && <span className="disclosure__count">{languages.length}</span>}
          </button>
          {showTranslate && (
            <>
              <Field
                label="Target languages"
                hint="Localize every slide's title + subtitle. CJK/Arabic need a matching font (e.g. a Noto family)."
              >
                <div className="lang-add">
                  <select className="text-input" aria-label="Target language" value={pickLang} onChange={(e) => setPickLang(e.target.value)}>
                    <option value="">Choose a language…</option>
                    {availableLangs.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <button className="ghost small" disabled={!pickLang} onClick={addPicked}>
                    Add
                  </button>
                </div>
                <div className="lang-add">
                  <input
                    className="text-input"
                    value={customLang}
                    placeholder="Custom language…"
                    onChange={(e) => setCustomLang(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustom();
                      }
                    }}
                  />
                  <button className="ghost small" disabled={!customLang.trim()} onClick={addCustom}>
                    Add
                  </button>
                </div>
              </Field>

              {languages.length > 0 && (
                <div className="lang-chips">
                  {languages.map((l) => (
                    <span key={l.code} className="lang-chip">
                      {l.name}
                      <button
                        className="lang-chip__x"
                        title={`Remove ${l.name}`}
                        onClick={() => removeLanguage(l.code)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <Field label="Context note" hint="Optional. App name, audience, tone, terms to keep untranslated.">
                <TextInput
                  multiline
                  value={state.settings.translationContext ?? ""}
                  onChange={(v) => updateSettings({ translationContext: v })}
                  placeholder="e.g. A calm meditation app. Keep the brand name 'Truepane'."
                />
              </Field>

              <Field label="Generate with AI">
                <Segmented
                  value={aiProvider}
                  onChange={(v) => setAiProvider(v as AiProvider)}
                  options={[
                    { value: "cerebras", label: "Cerebras 120B" },
                    { value: "groq", label: "Groq 70B" },
                  ]}
                />
                <button
                  className="ghost small upload-btn"
                  disabled={trBusy || languages.length === 0}
                  onClick={runTranslate}
                >
                  {trBusy ? "Translating…" : `Generate translations (${languages.length})`}
                </button>
                {aiProvider === "groq" && (
                  <>
                    <button className="ghost small upload-btn" onClick={() => setShowByok((s) => !s)}>
                      {showByok ? "Hide key field" : "Use my own Groq key"}
                    </button>
                    {showByok && (
                      <input
                        className="text-input"
                        type="password"
                        placeholder="gsk_… (stored in this browser only)"
                        value={byokKey}
                        onChange={(e) => setByok(e.target.value)}
                      />
                    )}
                  </>
                )}
                {trError && (
                  <div className="field__hint" style={{ color: "#c4523b" }}>
                    {trError}
                  </div>
                )}
                {trNote && !trError && <div className="ai-note">"{trNote}"</div>}
              </Field>
            </>
          )}
        </section>
      )}

      <section className="panel" id="sidebar-composition" hidden={activeTab !== "layout"}>
        <div className="panel__title">Device layout</div>
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
          canSpanDevice={selectedIndex < slidesCount - 1}
          showAdvanced={showLayoutOptions}
          showTextAlignment={false}
          advancedDisclosure={(
            <button className="disclosure optional-disclosure" onClick={() => setShowLayoutOptions((shown) => !shown)}>
              <span>{showLayoutOptions ? "▾" : "▸"}</span> Advanced
            </button>
          )}
        />
        {showLayoutOptions && (
          <div className="optional-subsection">
            <div className="field__label">Brand kits</div>
            <div className="field__hint">
              Save and reuse typography, colors, background, and composition across projects.
            </div>
            <BrandKitControls
              kits={brandKits}
              onCreate={onCreateBrandKit}
              onRename={onRenameBrandKit}
              onApply={onApplyBrandKit}
              onDelete={onDeleteBrandKit}
              onImport={onImportBrandKit}
            />
          </div>
        )}
      </section>

      <section className="panel" id="sidebar-typography" hidden={activeTab !== "content"}>
        <div className="panel__title">Typography</div>
        <Field label="Font family" hint="Applied to both the title and subtitle.">
          <select
            className="text-input"
            aria-label="Font family"
            value={state.settings.fontFamily}
            onChange={(e) => setFont(e.target.value)}
          >
            {FONT_OPTIONS.map((font) => (
              <option
                key={font.id}
                value={font.id}
                style={{ fontFamily: font.google ? `"${font.id}", sans-serif` : `${font.id}, sans-serif` }}
              >
                {font.label}
              </option>
            ))}
            {state.settings.customFont && (
              <option
                value={state.settings.customFont.name}
                style={{ fontFamily: `"${state.settings.customFont.name}"` }}
              >
                {state.settings.customFont.name} (custom)
              </option>
            )}
          </select>
          <button className="ghost small upload-btn" onClick={() => fontFileRef.current?.click()}>
            Upload custom font
          </button>
          <input
            ref={fontFileRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onCustomFont(file);
              e.target.value = "";
            }}
          />
        </Field>
        <Field label="Text alignment">
          <Segmented
            value={resolvedComposition.text.align}
            onChange={(value) => updateComposition({
              ...normalizedComposition,
              text: { ...normalizedComposition.text, align: value as TextAlign },
            })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
        </Field>
        <Field label={`Title size · ${Math.round((state.settings.titleScale ?? 1) * 100)}%`}>
          <input
            className="slider"
            type="range"
            aria-label="Title size"
            min="0.5"
            max="1.5"
            step="0.05"
            value={state.settings.titleScale ?? 1}
            onChange={(e) => updateSettings({ titleScale: parseFloat(e.target.value) })}
          />
        </Field>
        <Field label={`Subtitle size · ${Math.round((state.settings.subtitleScale ?? 1) * 100)}%`}>
          <input
            className="slider"
            type="range"
            aria-label="Subtitle size"
            min="0.5"
            max="1.5"
            step="0.05"
            value={state.settings.subtitleScale ?? 1}
            onChange={(e) => updateSettings({ subtitleScale: parseFloat(e.target.value) })}
          />
        </Field>

        <button className="disclosure field-disclosure" onClick={() => setShowTextColors((shown) => !shown)}>
          <span>{showTextColors ? "▾" : "▸"}</span> Text colors
        </button>
        <div className="field__hint control-group__hint">
          Set global title and subtitle colors, or override them for only the selected slide.
        </div>
        {showTextColors && (
          <div className="optional-controls compact-controls">
            <ColorRow
              label="Title color"
              value={state.settings.titleColor}
              onChange={(value) => updateSettings({ titleColor: value })}
              onEyedrop={requestEyedrop}
              presets={["#1a1612", "#0a0a0a", "#3b2a1b", "#ffffff", "#f6f3ec", "#c47c3b"]}
            />
            <ColorRow
              label="Subtitle color"
              value={state.settings.subheadColor}
              onChange={(value) => updateSettings({ subheadColor: value })}
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
                  onChange={(value) => updateSlide({ titleColor: value })}
                  onEyedrop={requestEyedrop}
                />
                <ColorRow
                  label="Subtitle (this slide)"
                  value={selected.subheadColor ?? state.settings.subheadColor}
                  onChange={(value) => updateSlide({ subheadColor: value })}
                  onEyedrop={requestEyedrop}
                />
              </>
            )}
          </div>
        )}

        <button className="disclosure optional-disclosure" onClick={() => setShowContentOptions((shown) => !shown)}>
          <span>{showContentOptions ? "▾" : "▸"}</span> Advanced
        </button>
        {showContentOptions && (
          <div className="optional-controls">
            <div className="control-group">
              <div className="field__label">Bulk screenshot import</div>
              <div className="field__hint control-group__hint">
                Fill slides from an image folder or ZIP; files are assigned in filename order.
              </div>
              <div className="bulk-import-actions">
                <button className="ghost small" onClick={() => bulkDirectoryRef.current?.click()}>
                  Import folder
                </button>
                <button className="ghost small" onClick={() => bulkZipRef.current?.click()}>
                  Import ZIP
                </button>
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
          </div>
        )}
      </section>

      <section className="panel" id="sidebar-background" hidden={activeTab !== "background"}>
        <div className="panel__title">Background</div>

        <label className="ai-lock">
          <input type="checkbox" checked={hasSlideOverride} onChange={toggleSlideOverride} />
          Override for this slide only
        </label>

        {/* Fill layer */}
        <Field label="Fill">
          <select
            className="text-input"
            aria-label="Background fill"
            value={bg.fill}
            onChange={(e) => handleBgUpdate({ fill: e.target.value as BackgroundFill })}
          >
            {FILL_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>

        {bg.fill === "linear" && (
          <Field label={`Angle · ${bg.gradientAngle ?? 135}°`}>
            <input
              className="slider"
              type="range"
              aria-label="Gradient angle"
              min="0"
              max="360"
              step="5"
              value={bg.gradientAngle ?? 135}
              onChange={(e) => handleBgUpdate({ gradientAngle: parseInt(e.target.value, 10) })}
            />
          </Field>
        )}

        {/* Fill colors */}
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

        {/* Image layer — between the fill and the shape overlay, matching the
            paint order, so the panel reads top-to-bottom like the render. */}
        <div className="control-group">
          <div className="field__label">Background image</div>
          <div className="field__hint control-group__hint">
            One slide needs {slideSizeHint}px; one image across the whole strip needs {stripSizeHint}px.
            Any size works — it is scaled and cropped to fit.
          </div>
          {!isDerivedBackdrop && (
            <ImageDrop
              image={bgImage?.source.kind === "upload" ? { dataUrl: bgImage.source.dataUrl } : null}
              onImage={(img) => void applyBackgroundImage(img)}
              onClear={() => {
                handleBgUpdate({ image: null });
                setBgImageNote(null);
              }}
            />
          )}
          {bgImageBusy && <div className="field__hint">Preparing image…</div>}
          {bgImageNote && <div className="field__hint bg-image-note">{bgImageNote}</div>}
          <label className="ai-lock">
            <input
              type="checkbox"
              checked={isDerivedBackdrop}
              onChange={(e) => toggleDerivedBackdrop(e.target.checked)}
            />
            Use blurred screenshot
          </label>
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
            {isDerivedBackdrop && bgImage.source.kind === "screenshot" && (
              <Field label={`Blur · ${Math.round(bgImage.source.blur * 100)}%`}>
                <input
                  className="slider"
                  type="range"
                  aria-label="Screenshot blur"
                  min="0"
                  max="1"
                  step="0.05"
                  value={bgImage.source.blur}
                  onChange={(e) =>
                    patchImage({ source: { kind: "screenshot", blur: parseFloat(e.target.value) } })
                  }
                />
              </Field>
            )}
            <Field label={`Image opacity · ${Math.round(bgImage.opacity * 100)}%`}>
              <input
                className="slider"
                type="range"
                aria-label="Background image opacity"
                min="0"
                max="1"
                step="0.05"
                value={bgImage.opacity}
                onChange={(e) => patchImage({ opacity: parseFloat(e.target.value) })}
              />
            </Field>
            <Field
              label={`Scrim · ${Math.round(bgImage.scrim * 100)}%`}
              hint="Washes the image toward the scrim color. This is what keeps titles readable over a photo."
            >
              <input
                className="slider"
                type="range"
                aria-label="Background image scrim"
                min="0"
                max="1"
                step="0.05"
                value={bgImage.scrim}
                onChange={(e) => patchImage({ scrim: parseFloat(e.target.value) })}
              />
            </Field>
          </>
        )}

        {/* Shape overlay */}
        <Field label="Shape">
          <select
            className="text-input"
            aria-label="Background shape"
            value={bg.shape}
            onChange={(e) => handleBgUpdate({ shape: e.target.value as ShapeKind })}
          >
            {SHAPE_FAMILIES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>

        {bg.shape === "rings" && (
          <>
            <Field label="Layout">
              <LayoutSlider
                layouts={RING_LAYOUTS}
                value={bg.ringLayout || "calm"}
                onChange={(v) => handleBgUpdate({ ringLayout: v })}
              />
            </Field>
            <Field label={`Rings per group · ${bg.ringCount ?? 4}`}>
              <input
                className="slider"
                type="range"
                aria-label="Rings per group"
                min="1"
                max="8"
                step="1"
                value={bg.ringCount ?? 4}
                onChange={(e) => handleBgUpdate({ ringCount: parseInt(e.target.value, 10) })}
              />
            </Field>
          </>
        )}

        {isCustomShape && (
          <div className="field__hint">
            Open <strong>Advanced</strong> below to set the primitive, arrangement and spacing.
          </div>
        )}

        {shapeMeta?.seeded && !isCustomShape && (
          <Field label={`Density · ${bg.density ?? 3}`}>
            <input
              className="slider"
              type="range"
              aria-label="Shape density"
              min="1"
              max="8"
              step="1"
              value={bg.density ?? 3}
              onChange={(e) => handleBgUpdate({ density: parseInt(e.target.value, 10) })}
            />
          </Field>
        )}

        {bg.shape === "dots" && (
          <label className="ai-lock">
            <input
              type="checkbox"
              checked={bg.dotsAligned ?? false}
              onChange={(e) => handleBgUpdate({ dotsAligned: e.target.checked })}
            />
            Align to grid
          </label>
        )}

        {bg.shape !== "none" && (
          <Field label={`Opacity · ${(bg.accentOpacity * 100).toFixed(0)}%`}>
            <input
              className="slider"
              type="range"
              aria-label="Shape opacity"
              min="0"
              max="1"
              step="0.05"
              value={bg.accentOpacity}
              onChange={(e) => handleBgUpdate({ accentOpacity: parseFloat(e.target.value) })}
            />
          </Field>
        )}

        {shapeMeta?.seeded && (
          <button className="ghost small randomize-btn" onClick={randomizeSeed}>
            ↻ Randomize
          </button>
        )}

        {/* Shape color */}
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
              <input
                type="checkbox"
                checked={autoAccent}
                onChange={(e) => setAutoAccent(e.target.checked)}
              />
              Suggest shape colors from background
            </label>
          </>
        )}

        <button className="disclosure optional-disclosure" onClick={() => setShowBackgroundOptions((shown) => !shown)}>
          <span>{showBackgroundOptions ? "▾" : "▸"}</span> Advanced
        </button>
        {showBackgroundOptions && (
          <div className="optional-controls">
            {isCustomShape && (
              <CustomShapeControls spec={customSpec} onChange={updateCustomShape} />
            )}
            {bgImage && !isDerivedBackdrop && (
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
            {aiConfigured && (
              <Field label="Generate background style" hint="Describe a visual direction; the generator chooses a fill, shape, and palette.">
                <Segmented
                  value={aiProvider}
                  onChange={(v) => setAiProvider(v as AiProvider)}
                  options={[
                    { value: "cerebras", label: "Cerebras 120B" },
                    { value: "groq", label: "Groq 70B" },
                  ]}
                />
                <TextInput value={aiPrompt} onChange={setAiPrompt} placeholder="e.g. calm, warm, organic" />
                <button
                  className="ghost small upload-btn"
                  disabled={aiBusy || !aiPrompt.trim()}
                  onClick={runAiPrompt}
                >
                  {aiBusy ? "Generating…" : "Generate"}
                </button>
                <label className="ai-lock">
                  <input
                    type="checkbox"
                    checked={lockStyle}
                    onChange={(e) => setLockStyle(e.target.checked)}
                  />
                  Lock style (recolor only)
                </label>
                {aiProvider === "groq" && (
                  <>
                    <button className="ghost small upload-btn" onClick={() => setShowByok((s) => !s)}>
                      {showByok ? "Hide key field" : "Use my own Groq key"}
                    </button>
                    {showByok && (
                      <input
                        className="text-input"
                        type="password"
                        placeholder="gsk_… (stored in this browser only)"
                        value={byokKey}
                        onChange={(e) => setByok(e.target.value)}
                      />
                    )}
                  </>
                )}
                {aiError && (
                  <div className="field__hint" style={{ color: "#c4523b" }}>
                    {aiError}
                  </div>
                )}
                {aiNote && !aiError && <div className="ai-note">"{aiNote}"</div>}
              </Field>
            )}
            <div className="control-group">
              <div className="field__label">Screenshot palette</div>
              <div className="field__hint control-group__hint">
                Samples this slide’s screenshot and replaces the background start color and shape color. Fill, shape, gradient end, and layout stay unchanged.
              </div>
              <button
                className="ghost small upload-btn match-btn"
                disabled={!activeAsset.image}
                onClick={matchPalette}
              >
                Match screenshot palette
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="panel" id="sidebar-export" hidden={activeTab !== "export"}>
        <div className="panel__title">Export</div>
        <div className="export-grid">
          <button className="primary" disabled={!!exporting} onClick={exportPng}>
            {exporting === "png" ? "…" : "Download this slide (PNG)"}
          </button>
          <button className="primary" disabled={!!exporting} onClick={exportStrip}>
            {exporting === "strip" ? "…" : `Download strip (${slidesCount}× horizontal PNG)`}
          </button>
          <button className="primary" disabled={!!exporting} onClick={exportZip}>
            {exporting === "zip" ? "Zipping…" : "Download ZIP (all slides + strip)"}
          </button>
          <button className="primary" disabled={!!exporting} onClick={exportAllLanguages}>
            {exporting === "all"
              ? "Zipping…"
              : `Download all targets${languages.length > 0 ? " + languages" : ""} (ZIP · ${targetCount} ${targetCount === 1 ? "target" : "targets"})`}
          </button>
        </div>
        <button className="disclosure optional-disclosure" onClick={() => setShowExportOptions((shown) => !shown)}>
          <span>{showExportOptions ? "▾" : "▸"}</span> Advanced
        </button>
        {showExportOptions && (
          <div className="optional-controls">
            <Field
              label="Release update mode"
              hint="Compare the current assets with a saved baseline and export only files that changed."
            >
              <ReleaseUpdateControls
                rows={releaseRows}
                baselineDate={state.releaseBaseline?.createdAt}
                busy={releaseBusy}
                onCompare={onCompareRelease}
                onExportChanged={onExportChanged}
                onSetBaseline={onSetReleaseBaseline}
              />
            </Field>
            <div className="control-group">
              <div className="field__label">Release preflight</div>
              <div className="field__hint control-group__hint">
                Check dimensions, missing screenshots, and other release blockers before downloading.
              </div>
              <button className="ghost preflight-button" onClick={onRunPreflight}>Run release preflight</button>
            </div>
            <div className="control-group">
              <div className="field__label">Project file</div>
              <div className="field__hint control-group__hint">
                Save an editable Truepane project or restore one from JSON.
              </div>
              <div className="export-row">
                <button className="ghost small" onClick={exportJson}>
                  Export project (JSON)
                </button>
                <button className="ghost small" onClick={() => jsonFileRef.current?.click()}>
                  Import project
                </button>
                <input
                  ref={jsonFileRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importJson(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>
        )}
        <div className="muted small">Auto-saved to this browser.</div>
        <div className="muted small" style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 12 }}>
          <a href="https://github.com/antonkarliner/truepane" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.468-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.3 1.23A11.51 11.51 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.29-1.552 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 21.796 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
          <a href="https://github.com/sponsors/antonkarliner" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            Sponsor
          </a>
        </div>
      </section>
    </aside>
  );
}
