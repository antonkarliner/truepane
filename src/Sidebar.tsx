// Sidebar component — all controls for the App Store strip generator.
import { useRef, useState } from "react";
import { ColorRow, Field, ImageDrop, LayoutSlider, Segmented, TextInput } from "./components";
import { FILL_OPTIONS, PLATFORMS, RING_LAYOUTS, SHAPE_FAMILIES, dimFor } from "./render";
import { accentSuggestions, extractPalette } from "./palette";

const DEFAULT_SHAPE_PRESETS = ["#c47c3b", "#1a1612", "#5b6647", "#c4523b", "#5b6cff", "#8a6f4f"];
import { aiConfigured, generateBackground } from "./ai";
import { BG_PRESETS, FONT_OPTIONS } from "./constants";
import type { AppState, Background, BackgroundFill, ShapeKind, Settings, Slide, StoreId } from "./types";

const STORE_LABELS: Record<StoreId, string> = {
  appstore: "App Store",
  playstore: "Google Play",
};

interface SidebarProps {
  state: AppState;
  selectedIndex: number;
  setFont: (family: string) => void;
  onCustomFont: (file: File) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateBackground: (patch: Partial<Background>) => void;
  updateSlideBackground: (patch: Partial<Background>) => void;
  selected: Slide;
  updateSlide: (patch: Partial<Slide>) => void;
  deleteSelected: () => void;
  moveSelected: (dir: number) => void;
  exportPng: () => void;
  exportStrip: () => void;
  exportZip: () => void;
  exportJson: () => void;
  importJson: (file: File) => void;
  exporting: string | null;
  requestEyedrop: (apply: (hex: string) => void) => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    state,
    selectedIndex,
    setFont,
    onCustomFont,
    updateSettings,
    updateBackground,
    updateSlideBackground,
    selected,
    updateSlide,
    deleteSelected,
    moveSelected,
    exportPng,
    exportStrip,
    exportZip,
    exportJson,
    importJson,
    exporting,
    requestEyedrop,
  } = props;

  const fontFileRef = useRef<HTMLInputElement>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [lockStyle, setLockStyle] = useState(false);
  const [showByok, setShowByok] = useState(false);
  const [autoAccent, setAutoAccent] = useState(true);
  const [showPresets, setShowPresets] = useState(false);
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
      const { params, note, text } = await generateBackground(aiPrompt.trim(), byokKey || undefined);
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

  const setSlideImage = (img: HTMLImageElement, dataUrl: string) => {
    updateSlide({ image: img, imageDataUrl: dataUrl });
  };

  const clearSlideImage = () => {
    updateSlide({ image: null, imageDataUrl: null });
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
  const slidesCount = state.slides.length;
  const platform = state.settings.platform || "ios";
  const dim = dimFor(platform);
  const stores: StoreId[] = ["appstore", "playstore"];
  const shapeMeta = SHAPE_FAMILIES.find((f) => f.id === bg.shape);
  const isGradient = bg.fill !== "solid";
  const hasShape = bg.shape !== "none";
  const accentLabel = bg.shape === "rings" ? "Ring color" : "Shape color";

  const matchPalette = () => {
    if (!selected.image) return;
    const p = extractPalette(selected.image);
    if (p) handleBgUpdate({ color: p.color, accent: p.accent });
  };
  const randomizeSeed = () => handleBgUpdate({ seed: Math.floor(Math.random() * 1e9) });

  // Shape-color preset swatches: harmonized to the background when auto-adjust
  // is on, otherwise a fixed palette.
  const shapePresets = autoAccent ? accentSuggestions(bg.color) : DEFAULT_SHAPE_PRESETS;

  return (
    <aside className="sidebar">
      <header className="sidebar__head">
        <div className="brand">
          <div className="brand__mark">▢</div>
          <div className="brand__name">Store Strip</div>
        </div>
        <div className="brand__sub">Generator</div>
      </header>

      <section className="panel">
        <div className="panel__title">Device</div>
        {stores.map((store) => (
          <div key={store} className="device-group">
            <div className="muted small device-group__label">{STORE_LABELS[store]}</div>
            <Segmented
              value={PLATFORMS.some((p) => p.id === platform && p.store === store) ? platform : ""}
              onChange={(v) => updateSettings({ platform: v })}
              options={PLATFORMS.filter((p) => p.store === store).map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </div>
        ))}
        <div className="muted small" style={{ marginTop: 8 }}>
          {dim.storeLabel} · {dim.W} × {dim.H}
        </div>
      </section>

      <section className="panel">
        <div className="panel__title">
          Selected slide
          <span className="panel__count">
            {String(selectedIndex + 1).padStart(2, "0")} / {String(slidesCount).padStart(2, "0")}
          </span>
        </div>

        <Field label="Title">
          <TextInput
            value={selected.title}
            onChange={(v) => updateSlide({ title: v })}
            placeholder="Your headline here"
          />
        </Field>
        <Field label="Subhead" hint="Wraps to 2 lines automatically.">
          <TextInput
            multiline
            value={selected.subhead}
            onChange={(v) => updateSlide({ subhead: v })}
            placeholder="A short, benefit-driven subhead."
          />
        </Field>

        <Field label="Font family">
          <select
            className="text-input"
            value={state.settings.fontFamily}
            onChange={(e) => setFont(e.target.value)}
          >
            {FONT_OPTIONS.map((f) => (
              <option
                key={f.id}
                value={f.id}
                style={{ fontFamily: f.google ? `"${f.id}", sans-serif` : `${f.id}, sans-serif` }}
              >
                {f.label}
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
            Upload .ttf / .otf / .woff(2)
          </button>
          <input
            ref={fontFileRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCustomFont(f);
              e.target.value = "";
            }}
          />
        </Field>

        <ColorRow
          label="Title color"
          value={state.settings.titleColor}
          onChange={(v) => updateSettings({ titleColor: v })}
          onEyedrop={requestEyedrop}
          presets={["#1a1612", "#0a0a0a", "#3b2a1b", "#ffffff", "#f6f3ec", "#c47c3b"]}
        />
        <ColorRow
          label="Subhead color"
          value={state.settings.subheadColor}
          onChange={(v) => updateSettings({ subheadColor: v })}
          onEyedrop={requestEyedrop}
          presets={[
            "rgba(26,22,18,0.62)",
            "rgba(26,22,18,0.85)",
            "rgba(255,255,255,0.72)",
            "#5b6647",
            "#c47c3b",
            "#666666",
          ]}
        />

        <Field label="Screenshot">
          <ImageDrop
            image={selected.imageDataUrl ? { dataUrl: selected.imageDataUrl } : null}
            onImage={setSlideImage}
            onClear={clearSlideImage}
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

      <section className="panel">
        <div className="panel__title">Background</div>

        <label className="ai-lock">
          <input type="checkbox" checked={hasSlideOverride} onChange={toggleSlideOverride} />
          Override for this slide only
        </label>

        {aiConfigured && (
          <Field label="Generate with AI" hint="Describe a vibe; AI picks a style + palette.">
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
            {aiError && (
              <div className="field__hint" style={{ color: "#c4523b" }}>
                {aiError}
              </div>
            )}
            {aiNote && !aiError && <div className="ai-note">“{aiNote}”</div>}
          </Field>
        )}

        {/* Fill layer */}
        <Field label="Fill">
          <select
            className="text-input"
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

        {/* Shape overlay */}
        <Field label="Shape">
          <select
            className="text-input"
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
                min="1"
                max="8"
                step="1"
                value={bg.ringCount ?? 4}
                onChange={(e) => handleBgUpdate({ ringCount: parseInt(e.target.value, 10) })}
              />
            </Field>
          </>
        )}

        {shapeMeta?.seeded && (
          <Field label={`Density · ${bg.density ?? 3}`}>
            <input
              className="slider"
              type="range"
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

        <button
          className="ghost small upload-btn match-btn"
          disabled={!selected.image}
          onClick={matchPalette}
        >
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
      </section>

      <section className="panel">
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
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="muted small">Auto-saved to this browser.</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          <a href="https://github.com/antonkarliner/appstore-strip-generator" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
            GitHub
          </a>
        </div>
      </section>
    </aside>
  );
}
