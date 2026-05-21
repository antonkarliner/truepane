// Main App component for the App Store strip generator.
import { useCallback, useEffect, useState } from "react";
import JSZip from "jszip";
import { Sidebar } from "./Sidebar";
import { SlidePreview } from "./components";
import { dimFor, getFrame, paintSlide, paintStrip } from "./render";
import { FONT_OPTIONS, STORAGE_KEY, defaultState } from "./constants";
import type { AppState, Background, Settings, Slide } from "./types";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// Merge a persisted/imported background onto current defaults, and migrate the
// old single `pattern` field to the new fill + shape split.
function normalizeBackground(raw: unknown): Background {
  const base = defaultState().settings.background;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b = { ...base, ...src } as unknown as Background & { pattern?: string };
  if (b.pattern) {
    if (b.pattern === "linear" || b.pattern === "radial") {
      b.fill = b.pattern;
      b.shape = "none";
    } else if (b.pattern === "solid") {
      b.fill = "solid";
      b.shape = "none";
    } else {
      b.fill = "solid";
      b.shape = b.pattern as Background["shape"];
    }
    delete b.pattern;
  }
  return b;
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const s = defaultState();
    if (parsed.settings) Object.assign(s.settings, parsed.settings);
    s.settings.background = normalizeBackground(parsed.settings?.background);
    if (parsed.slides) {
      s.slides = parsed.slides.map((sl: Partial<Slide>) => ({
        title: sl.title || "",
        subhead: sl.subhead || "",
        image: null,
        imageDataUrl: sl.imageDataUrl || null,
        background: sl.background ? normalizeBackground(sl.background) : undefined,
      }));
    }
    return s;
  } catch {
    return defaultState();
  }
}

function persistState(state: AppState): void {
  try {
    const payload = {
      settings: state.settings,
      slides: state.slides.map((s) => ({
        title: s.title,
        subhead: s.subhead,
        imageDataUrl: s.imageDataUrl || null,
        background: s.background,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("persist failed", e);
  }
}

// Convert imageDataUrl strings back to HTMLImageElements for rendering.
async function hydrateImages(slides: Slide[]): Promise<Slide[]> {
  return Promise.all(
    slides.map(
      (s) =>
        new Promise<Slide>((resolve) => {
          if (!s.imageDataUrl) {
            resolve(s);
            return;
          }
          const img = new Image();
          img.onload = () => resolve({ ...s, image: img });
          img.onerror = () => resolve(s);
          img.src = s.imageDataUrl;
        }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const THEME_KEY = "appstore-theme";

function applyFavicon(theme: "light" | "dark") {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = theme === "dark" ? "/favicon-dark.svg" : "/favicon-light.svg";
}

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  const theme =
    stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = theme;
  applyFavicon(theme);
  return theme;
}

// ---------------------------------------------------------------------------
// Font loading helper — load a Google Font on demand.
// ---------------------------------------------------------------------------
const loadedGoogleFonts = new Set<string>();
function ensureGoogleFont(family: string): void {
  const meta = FONT_OPTIONS.find((f) => f.id === family);
  if (!meta) return;
  if (!meta.google) return; // system font — already on the device, nothing to load
  if (loadedGoogleFonts.has(meta.id)) return;
  loadedGoogleFonts.add(meta.id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${meta.google}&display=swap`;
  document.head.appendChild(link);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export function App() {
  const [state, setState] = useState<AppState>(() => defaultState());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [, setFontsReady] = useState(0); // bump to trigger rerender on font load
  const [exporting, setExporting] = useState<null | "png" | "strip" | "zip">(null);
  const [eyedropTarget, setEyedropTarget] = useState<((hex: string) => void) | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      applyFavicon(next);
      return next;
    });
  }, []);

  // Initial load + hydrate
  useEffect(() => {
    void (async () => {
      const loaded = loadState();
      const slides = await hydrateImages(loaded.slides);
      setState({ ...loaded, slides });
      setHydrated(true);
      // Preload the curated fonts so previews look right — but skip heavy
      // (CJK) families, which load only when the user actually picks them.
      FONT_OPTIONS.filter((f) => !f.heavy).forEach((f) => ensureGoogleFont(f.id));
      await document.fonts.ready;
      setFontsReady((x) => x + 1);
    })();
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hydrated) return;
    persistState(state);
  }, [state, hydrated]);

  // Keep selection in bounds
  useEffect(() => {
    if (selectedIndex >= state.slides.length) {
      setSelectedIndex(Math.max(0, state.slides.length - 1));
    }
  }, [state.slides.length, selectedIndex]);

  // --- Mutators --------------------------------------------------------
  const updateSlide = useCallback((idx: number, patch: Partial<Slide>) => {
    setState((s) => {
      const next = s.slides.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...s, slides: next };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const updateBackground = useCallback((patch: Partial<Background>) => {
    setState((s) => ({
      ...s,
      settings: { ...s.settings, background: { ...s.settings.background, ...patch } },
    }));
  }, []);

  const updateSlideBackground = useCallback(
    (idx: number, patch: Partial<Background>) => {
      setState((s) => {
        const next = s.slides.slice();
        const slide = next[idx];
        const current = slide.background ?? s.settings.background;
        next[idx] = { ...slide, background: { ...current, ...patch } };
        return { ...s, slides: next };
      });
    },
    [],
  );

  const addSlide = useCallback(() => {
    setState((s) => {
      const next = s.slides.slice();
      next.push({ title: "New slide", subhead: "Add a subhead.", image: null, imageDataUrl: null });
      return { ...s, slides: next };
    });
    setSelectedIndex(state.slides.length); // about to be the new one
  }, [state.slides.length]);

  const deleteSlide = useCallback(
    (idx: number) => {
      setState((s) => {
        const next = s.slides.slice();
        next.splice(idx, 1);
        return { ...s, slides: next.length ? next : defaultState().slides.slice(0, 1) };
      });
      if (selectedIndex >= idx) setSelectedIndex(Math.max(0, selectedIndex - 1));
    },
    [selectedIndex],
  );

  const moveSlide = useCallback((from: number, to: number) => {
    setState((s) => {
      if (to < 0 || to >= s.slides.length) return s;
      const next = s.slides.slice();
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return { ...s, slides: next };
    });
    setSelectedIndex(to);
  }, []);

  // Font change
  const setFont = (family: string) => {
    ensureGoogleFont(family);
    updateSettings({ fontFamily: family });
  };

  const handleCustomFont = async (file: File) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const name = file.name.replace(/\.[^.]+$/, "");
    const face = new FontFace(name, buf);
    await face.load();
    document.fonts.add(face);
    updateSettings({ fontFamily: name, customFont: { name, dataUrl: await blobToDataUrl(file) } });
    setFontsReady((x) => x + 1);
  };

  // Re-register a custom font if loaded from storage
  useEffect(() => {
    const cf = state.settings.customFont;
    if (!cf || !cf.dataUrl) return;
    void (async () => {
      try {
        const blob = await (await fetch(cf.dataUrl)).blob();
        const buf = await blob.arrayBuffer();
        const face = new FontFace(cf.name, buf);
        await face.load();
        document.fonts.add(face);
        setFontsReady((x) => x + 1);
      } catch {
        /* ignore */
      }
    })();
  }, [state.settings.customFont?.name]);

  // --- Export -----------------------------------------------------------
  const totalSlides = state.slides.length;

  // Filename prefixes follow the frame's target store, not the exact device.
  const slidePrefix = () => (getFrame(state.settings.platform).store === "playstore" ? "android" : "ios");
  const stripPrefix = () => (getFrame(state.settings.platform).store === "playstore" ? "playstore" : "appstore");

  const downloadCanvas = async (canvas: HTMLCanvasElement, filename: string) => {
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportPng = async () => {
    setExporting("png");
    const slide = state.slides[selectedIndex];
    const c = document.createElement("canvas");
    await paintSlide(c, slide, state.settings, selectedIndex, totalSlides);
    const safe = (slide.title || `slide-${selectedIndex + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const platformPrefix = slidePrefix();
    await downloadCanvas(c, `${platformPrefix}-${String(selectedIndex + 1).padStart(2, "0")}-${safe}.png`);
    setExporting(null);
  };

  const exportStrip = async () => {
    setExporting("strip");
    const c = document.createElement("canvas");
    await paintStrip(c, state.slides, state.settings);
    const platformPrefix = stripPrefix();
    await downloadCanvas(c, `${platformPrefix}-strip-${totalSlides}x.png`);
    setExporting(null);
  };

  const exportZip = async () => {
    setExporting("zip");
    const zip = new JSZip();
    const platformPrefix = slidePrefix();
    for (let i = 0; i < state.slides.length; i++) {
      const slide = state.slides[i];
      const c = document.createElement("canvas");
      await paintSlide(c, slide, state.settings, i, totalSlides);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
      const safe = (slide.title || `slide-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      zip.file(`${platformPrefix}-${String(i + 1).padStart(2, "0")}-${safe}.png`, blob);
    }
    const stripCanvas = document.createElement("canvas");
    await paintStrip(stripCanvas, state.slides, state.settings);
    const stripBlob = await new Promise<Blob>((res) => stripCanvas.toBlob((b) => res(b!), "image/png"));
    zip.file(`${platformPrefix}-strip-${totalSlides}x.png`, stripBlob);
    const out = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${platformPrefix}-strip-${totalSlides}slides.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setExporting(null);
  };

  // JSON export/import
  const exportJson = () => {
    const payload = {
      settings: state.settings,
      slides: state.slides.map((s) => ({
        title: s.title,
        subhead: s.subhead,
        imageDataUrl: s.imageDataUrl || null,
        background: s.background,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "appstore-strip-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const s = defaultState();
    if (parsed.settings) Object.assign(s.settings, parsed.settings);
    s.settings.background = normalizeBackground(parsed.settings?.background);
    if (parsed.slides) {
      s.slides = parsed.slides.map((sl: Partial<Slide>) => ({
        title: sl.title || "",
        subhead: sl.subhead || "",
        image: null,
        imageDataUrl: sl.imageDataUrl || null,
        background: sl.background ? normalizeBackground(sl.background) : undefined,
      }));
    }
    const slides = await hydrateImages(s.slides);
    setState({ ...s, slides });
    setSelectedIndex(0);
  };

  // --- Eyedropper -------------------------------------------------------
  // Prefer the native EyeDropper API (Chromium, screen-wide). Where it's
  // missing (Safari/Firefox), fall back to "click a slide to pick a color",
  // sampling from the rendered preview canvas.
  const requestEyedrop = useCallback(async (apply: (hex: string) => void) => {
    if (window.EyeDropper) {
      try {
        const res = await new window.EyeDropper().open();
        apply(res.sRGBHex);
      } catch {
        /* cancelled */
      }
      return;
    }
    setEyedropTarget(() => apply);
  }, []);

  const pickColorFromSlide = useCallback(
    (hex: string) => {
      if (eyedropTarget) eyedropTarget(hex);
      setEyedropTarget(null);
    },
    [eyedropTarget],
  );

  useEffect(() => {
    if (!eyedropTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEyedropTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [eyedropTarget]);

  const selected = state.slides[selectedIndex];
  const platformDim = dimFor(state.settings.platform || "ios");

  // --- Render ----------------------------------------------------------
  if (!hydrated) {
    return <div className="boot">Loading…</div>;
  }

  return (
    <div className="app">
      <Sidebar
        state={state}
        selectedIndex={selectedIndex}
        setFont={setFont}
        onCustomFont={handleCustomFont}
        updateSettings={updateSettings}
        updateBackground={updateBackground}
        selected={selected}
        updateSlide={(patch) => updateSlide(selectedIndex, patch)}
        updateSlideBackground={(patch) => updateSlideBackground(selectedIndex, patch)}
        deleteSelected={() => deleteSlide(selectedIndex)}
        moveSelected={(dir) => moveSlide(selectedIndex, selectedIndex + dir)}
        exportPng={exportPng}
        exportStrip={exportStrip}
        exportZip={exportZip}
        exportJson={exportJson}
        importJson={importJson}
        exporting={exporting}
        requestEyedrop={requestEyedrop}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="stage">
        <div className="stage__bar">
          <div className="stage__label">
            <span className="badge">
              {totalSlides} slide{totalSlides === 1 ? "" : "s"}
            </span>
            <span className="muted">
              {platformDim.storeLabel} · {platformDim.W} × {platformDim.H}
            </span>
            {eyedropTarget && (
              <span className="muted">· Click a slide to pick a color (Esc to cancel)</span>
            )}
          </div>
          <button className="ghost" onClick={addSlide}>
            + Add slide
          </button>
        </div>
        <div className="strip">
          {state.slides.map((slide, i) => (
            <SlidePreview
              key={i}
              slide={slide}
              settings={state.settings}
              slideIndex={i}
              totalSlides={totalSlides}
              selected={i === selectedIndex}
              onSelect={() => setSelectedIndex(i)}
              onDelete={state.slides.length > 1 ? () => deleteSlide(i) : null}
              eyedropping={!!eyedropTarget}
              onPickColor={pickColorFromSlide}
            />
          ))}
          <button className="add-card" onClick={addSlide}>
            ＋<br />
            Add slide
          </button>
        </div>
      </main>
    </div>
  );
}
