// Main App component for Truepane.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import JSZip from "jszip";
import { Sidebar } from "./Sidebar";
import { MobileLayout } from "./MobileLayout";
import { SlidePreview } from "./components";
import { BulkImportDialog, type BulkApplyRow } from "./BulkImportDialog";
import { PreflightDialog } from "./PreflightDialog";
import { bulkSlotKey, mapBulkImport, type BulkImportFile, type BulkImportProposal } from "./core/bulk-import";
import { validateProject, type PreflightIssue } from "./core/preflight";
import {
  applyBrandKit,
  BRAND_KIT_STORAGE_KEY,
  brandKitFromSettings,
  normalizeBrandKit,
  type BrandKit,
} from "./core/brand-kit";
import { compareRelease, createReleaseBaseline } from "./core/release";
import { dimForSettings, getRenderFrame, paintSlide, paintStrip } from "./core/render";
import { mirrorSpannedMedia, spanDeviceAcrossPair, updateSpannedComposition } from "./core/composition";
import { outputForSettings } from "./core/output";
import { FONT_OPTIONS, STORAGE_KEY, defaultState } from "./core/constants";
import { normalizeAppState, serializeTranslations } from "./core/normalize";
import { getImageAsset, serializeMedia, setImageAsset } from "./core/media";
import type { AppState, Background, ReleaseAssetComparison, Settings, Slide, SlideText } from "./core/types";
import { applyTheme, initialTheme, type Theme } from "./theme";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeAppState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function persistState(state: AppState): void {
  try {
    const payload = {
      version: 2,
      settings: state.settings,
      releaseBaseline: state.releaseBaseline,
      slides: state.slides.map((s) => ({
        title: s.title,
        subhead: s.subhead,
        media: serializeMedia(s.media),
        background: s.background,
        composition: s.composition,
        deviceSpan: s.deviceSpan,
        translations: serializeTranslations(s.translations),
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("persist failed", e);
  }
}

function loadBrandKits(): BrandKit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRAND_KIT_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeBrandKit) : [];
  } catch {
    return [];
  }
}

// Return the slide with its title/subhead swapped to the active language's
// translation. `lang === ""` is the source; any blank translated field falls
// back to the source so untranslated slides still render. Render code reads
// slide.title/subhead, so this keeps render.ts language-agnostic.
function resolveSlide(slide: Slide, lang: string, target: string): Slide {
  const asset = getImageAsset(slide, target, lang);
  if (!lang) return { ...slide, image: asset.image ?? null, imageDataUrl: asset.imageDataUrl };
  const t = slide.translations?.[lang];
  if (!t) return { ...slide, image: asset.image ?? null, imageDataUrl: asset.imageDataUrl };
  return {
    ...slide,
    title: t.title?.trim() ? t.title : slide.title,
    subhead: t.subhead?.trim() ? t.subhead : slide.subhead,
    image: asset.image ?? null,
    imageDataUrl: asset.imageDataUrl,
  };
}

// Decode one imageDataUrl to an HTMLImageElement (null-safe).
function decodeImage(dataUrl: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// Convert imageDataUrl strings back to HTMLImageElements for rendering — both
// the base screenshot and any per-locale translation screenshots.
async function hydrateImages(slides: Slide[]): Promise<Slide[]> {
  return Promise.all(
    slides.map(async (s) => {
      const media = s.media ? { ...s.media } : undefined;
      if (media) {
        for (const [target, value] of Object.entries(media)) {
          const sourceImage = value.source ? await decodeImage(value.source.imageDataUrl) : null;
          const source = value.source
            ? {
                ...value.source,
                image: sourceImage,
                width: value.source.width ?? sourceImage?.naturalWidth,
                height: value.source.height ?? sourceImage?.naturalHeight,
              }
            : undefined;
          const locales = value.locales
            ? Object.fromEntries(await Promise.all(Object.entries(value.locales).map(async ([code, asset]) => {
                const image = await decodeImage(asset.imageDataUrl);
                return [code, {
                  ...asset,
                  image,
                  width: asset.width ?? image?.naturalWidth,
                  height: asset.height ?? image?.naturalHeight,
                }];
              })))
            : undefined;
          media[target] = { ...value, source, locales };
        }
      }
      let translations = s.translations;
      if (translations) {
        const entries = await Promise.all(
          Object.entries(translations).map(async ([code, t]) => {
            const timg = t.imageDataUrl ? await decodeImage(t.imageDataUrl) : null;
            return [code, timg ? { ...t, image: timg } : t] as const;
          }),
        );
        translations = Object.fromEntries(entries);
      }
      return { ...s, image: null, imageDataUrl: null, media, translations };
    }),
  );
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
// Mobile detection
// ---------------------------------------------------------------------------
function useMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth <= 960);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth <= 960);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------
export function App() {
  const isMobile = useMobile();
  const stripRef = useRef<HTMLDivElement>(null);
  const revealAddedSlide = useRef(false);
  const stripDrag = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressStripClick = useRef(false);
  const suppressStripClickTimer = useRef<number | null>(null);
  const [state, setState] = useState<AppState>(() => defaultState());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [desktopPreviewWidth, setDesktopPreviewWidth] = useState(300);
  const [hydrated, setHydrated] = useState(false);
  const [, setFontsReady] = useState(0); // bump to trigger rerender on font load
  const [exporting, setExporting] = useState<null | "png" | "strip" | "zip" | "all">(null);
  const [eyedropTarget, setEyedropTarget] = useState<((hex: string) => void) | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  // Active preview/edit language: "" = source, otherwise a LanguageTarget.code.
  const [activeLang, setActiveLang] = useState("");
  const [arranging, setArranging] = useState(false);
  const [bulkImport, setBulkImport] = useState<{
    proposal: BulkImportProposal;
    files: Map<string, { dataUrl: string; image: HTMLImageElement }>;
  } | null>(null);
  const [preflight, setPreflight] = useState<{
    issues: PreflightIssue[];
    pending?: () => void;
  } | null>(null);
  const [brandKits, setBrandKits] = useState<BrandKit[]>(loadBrandKits);
  const [releaseRows, setReleaseRows] = useState<ReleaseAssetComparison[]>([]);
  const [releaseBusy, setReleaseBusy] = useState(false);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      applyTheme(next);
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
  useEffect(() => {
    localStorage.setItem(BRAND_KIT_STORAGE_KEY, JSON.stringify(brandKits));
  }, [brandKits]);

  // Keep selection in bounds
  useEffect(() => {
    if (selectedIndex >= state.slides.length) {
      setSelectedIndex(Math.max(0, state.slides.length - 1));
    }
  }, [state.slides.length, selectedIndex]);

  useEffect(() => {
    setArranging(false);
  }, [selectedIndex, state.settings.platform]);

  useEffect(() => {
    if (isMobile || !hydrated) return;
    const strip = stripRef.current;
    if (!strip) return;
    const dim = dimForSettings(state.settings);
    const aspect = dim.W / dim.H;
    const updateWidth = () => {
      // Strip padding (64px), card padding (20px), and a small safety gap
      // stay visible together with the canvas and horizontal scrollbar.
      const availableCanvasHeight = Math.max(174, strip.clientHeight - 92);
      setDesktopPreviewWidth(Math.min(300, Math.floor(availableCanvasHeight * aspect)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [hydrated, isMobile, state.settings.platform]);

  // --- Mutators --------------------------------------------------------
  const updateSlide = useCallback((idx: number, patch: Partial<Slide>) => {
    setState((s) => {
      let slides: Slide[];
      if (patch.composition) {
        slides = updateSpannedComposition(
          s.slides,
          idx,
          patch.composition,
          getRenderFrame(s.settings.platform, s.settings.output),
        );
      } else {
        slides = s.slides.slice();
      }
      slides[idx] = { ...slides[idx], ...patch };
      if ("media" in patch || "image" in patch || "imageDataUrl" in patch) {
        slides = mirrorSpannedMedia(slides, idx);
      }
      return { ...s, slides };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }, []);

  const spanDeviceWithNext = useCallback((idx: number) => {
    setState((s) => {
      if (idx < 0 || idx >= s.slides.length - 1) return s;
      const slides = s.slides.slice();
      const pair = spanDeviceAcrossPair(
        slides[idx],
        slides[idx + 1],
        s.settings.composition,
        getRenderFrame(s.settings.platform, s.settings.output),
        `span-${Date.now()}-${idx}`,
      );
      slides[idx] = pair[0];
      slides[idx + 1] = pair[1];
      return { ...s, slides };
    });
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

  // Write a partial translation for one slide/language, seeding from the source
  // text so a half-edited pair never loses the untouched field.
  const updateSlideTranslation = useCallback(
    (idx: number, lang: string, patch: Partial<SlideText>) => {
      if (!lang) return;
      setState((s) => {
        const next = s.slides.slice();
        const slide = next[idx];
        const current = slide.translations?.[lang] ?? { title: slide.title, subhead: slide.subhead };
        next[idx] = {
          ...slide,
          translations: { ...slide.translations, [lang]: { ...current, ...patch } },
        };
        return { ...s, slides: next };
      });
    },
    [],
  );

  // Batch-apply a generated translation set (aligned to slide order) for one
  // language across all slides.
  const applyTranslations = useCallback((lang: string, items: SlideText[]) => {
    if (!lang) return;
    setState((s) => {
      const next = s.slides.map((slide, i) =>
        i < items.length
          ? { ...slide, translations: { ...slide.translations, [lang]: items[i] } }
          : slide,
      );
      return { ...s, slides: next };
    });
  }, []);

  const addSlide = useCallback(() => {
    if (!isMobile) revealAddedSlide.current = true;
    setState((s) => {
      const next = s.slides.slice();
      next.push({ title: "New slide", subhead: "Add a subhead.", image: null, imageDataUrl: null });
      return { ...s, slides: next };
    });
    setSelectedIndex(state.slides.length); // about to be the new one
  }, [isMobile, state.slides.length]);

  useEffect(() => {
    if (isMobile || !revealAddedSlide.current) return;
    const strip = stripRef.current;
    const card = strip?.querySelector<HTMLElement>(`[data-slide-index="${selectedIndex}"]`);
    if (!strip || !card) return;
    revealAddedSlide.current = false;
    const left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
    requestAnimationFrame(() => strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" }));
  }, [isMobile, selectedIndex, state.slides.length]);

  const startStripDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      (e.target as HTMLElement).closest("button, input, textarea, select, [data-arranging='true']")
    ) return;
    const strip = stripRef.current;
    if (!strip) return;
    stripDrag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: strip.scrollLeft,
      moved: false,
    };
  };

  const moveStripDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stripDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      e.currentTarget.classList.add("dragging");
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!drag.moved) return;
    e.preventDefault();
    e.currentTarget.scrollLeft = drag.startScrollLeft - dx;
  };

  const endStripDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stripDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.classList.remove("dragging");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag.moved) {
      suppressStripClick.current = true;
      if (suppressStripClickTimer.current !== null) window.clearTimeout(suppressStripClickTimer.current);
      suppressStripClickTimer.current = window.setTimeout(() => {
        suppressStripClick.current = false;
        suppressStripClickTimer.current = null;
      }, 0);
    }
    stripDrag.current = null;
  };

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

  const beginBulkImport = async (selectedFiles: File[]) => {
    const expanded: { file: File; name: string }[] = [];
    for (const file of selectedFiles) {
      const relativeName = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (/\.zip$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(file);
        for (const entry of Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.dir || !/\.(png|jpe?g|webp)$/i.test(entry.name)) continue;
          const blob = await entry.async("blob");
          expanded.push({ file: new File([blob], entry.name, { type: blob.type }), name: entry.name });
        }
      } else {
        expanded.push({ file, name: relativeName });
      }
    }
    const descriptors: BulkImportFile[] = [];
    const decoded = new Map<string, { dataUrl: string; image: HTMLImageElement }>();
    for (let index = 0; index < expanded.length; index++) {
      const item = expanded[index];
      const dataUrl = await blobToDataUrl(item.file);
      const image = await decodeImage(dataUrl);
      if (!image) continue;
      const id = `${index}:${item.name}`;
      descriptors.push({ id, name: item.name, width: image.naturalWidth, height: image.naturalHeight });
      decoded.set(id, { dataUrl, image });
    }
    const targets = state.settings.targets?.length ? state.settings.targets : [state.settings.platform];
    const languages = (state.settings.languages ?? []).map((language) => language.code);
    const occupied = new Set<string>();
    state.slides.forEach((slide, slideIndex) => {
      for (const target of targets) {
        for (const language of ["", ...languages]) {
          if (getImageAsset(slide, target, language).imageDataUrl) {
            occupied.add(bulkSlotKey({ slideIndex, target, language }));
          }
        }
      }
    });
    setBulkImport({
      proposal: mapBulkImport(descriptors, {
        slideCount: state.slides.length,
        targets,
        languages,
        occupied,
      }),
      files: decoded,
    });
  };

  const applyBulkImport = (rows: BulkApplyRow[]) => {
    if (!bulkImport) return;
    setState((current) => {
      let slides = current.slides.slice();
      const targets = new Set(current.settings.targets ?? [current.settings.platform]);
      for (const row of rows) {
        const decoded = bulkImport.files.get(row.fileId);
        const slide = slides[row.slot.slideIndex];
        if (!decoded || !slide) continue;
        slides[row.slot.slideIndex] = setImageAsset(slide, row.slot.target, row.slot.language, {
          image: decoded.image,
          imageDataUrl: decoded.dataUrl,
        });
        slides = mirrorSpannedMedia(slides, row.slot.slideIndex);
        targets.add(row.slot.target);
      }
      return { ...current, slides, settings: { ...current.settings, targets: [...targets] } };
    });
    setBulkImport(null);
  };

  const createBrandKit = (name: string) => {
    setBrandKits((kits) => [...kits, brandKitFromSettings(name, state.settings)]);
  };
  const renameBrandKit = (id: string, name: string) => {
    setBrandKits((kits) => kits.map((kit) => kit.id === id ? { ...kit, name: name.trim() || kit.name } : kit));
  };
  const useBrandKit = (kit: BrandKit, clearOverrides: boolean) => {
    setState((current) => applyBrandKit(current, kit, clearOverrides));
  };
  const deleteBrandKit = (id: string) => setBrandKits((kits) => kits.filter((kit) => kit.id !== id));
  const importBrandKit = (kit: BrandKit) => {
    setBrandKits((kits) => [...kits.filter((item) => item.id !== kit.id), kit]);
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
  const slidePrefix = () => {
    const output = outputForSettings(state.settings);
    return output.id === "play-feature" ? "play-feature" : output.store === "playstore" ? "android" : "ios";
  };
  const stripPrefix = () => (outputForSettings(state.settings).store === "playstore" ? "playstore" : "appstore");

  const downloadCanvas = async (canvas: HTMLCanvasElement, filename: string) => {
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Stable filename slug from the SOURCE title so files line up across languages.
  const slideSlug = (slide: Slide, i: number) =>
    (slide.title || `slide-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // Filename tag for the active language ("" = source, no tag).
  const langTag = () => (activeLang ? `${activeLang}-` : "");

  const exportPng = async () => {
    setExporting("png");
    const slide = state.slides[selectedIndex];
    const c = document.createElement("canvas");
    await paintSlide(c, resolveSlide(slide, activeLang, state.settings.platform), state.settings, selectedIndex, totalSlides);
    const safe = slideSlug(slide, selectedIndex);
    const platformPrefix = slidePrefix();
    await downloadCanvas(
      c,
      `${platformPrefix}-${langTag()}${String(selectedIndex + 1).padStart(2, "0")}-${safe}.png`,
    );
    setExporting(null);
  };

  const exportStrip = async () => {
    setExporting("strip");
    const c = document.createElement("canvas");
    await paintStrip(c, state.slides.map((s) => resolveSlide(s, activeLang, state.settings.platform)), state.settings);
    const platformPrefix = stripPrefix();
    await downloadCanvas(c, `${platformPrefix}-${langTag()}strip-${totalSlides}x.png`);
    setExporting(null);
  };

  const exportZip = async () => {
    setExporting("zip");
    const zip = new JSZip();
    const platformPrefix = slidePrefix();
    for (let i = 0; i < state.slides.length; i++) {
      const slide = state.slides[i];
      const c = document.createElement("canvas");
      await paintSlide(c, resolveSlide(slide, activeLang, state.settings.platform), state.settings, i, totalSlides);
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
      zip.file(`${platformPrefix}-${langTag()}${String(i + 1).padStart(2, "0")}-${slideSlug(slide, i)}.png`, blob);
    }
    const stripCanvas = document.createElement("canvas");
    await paintStrip(stripCanvas, state.slides.map((s) => resolveSlide(s, activeLang, state.settings.platform)), state.settings);
    const stripBlob = await new Promise<Blob>((res) => stripCanvas.toBlob((b) => res(b!), "image/png"));
    zip.file(`${platformPrefix}-${langTag()}strip-${totalSlides}x.png`, stripBlob);
    const out = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${platformPrefix}-${langTag()}strip-${totalSlides}slides.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setExporting(null);
  };

  // One ZIP with a subfolder per language (source/, es/, pt-BR/, …), each holding
  // that language's slide PNGs + strip.
  const exportAllLanguages = async () => {
    setExporting("all");
    const zip = new JSZip();
    const targets = state.settings.targets?.length
      ? state.settings.targets
      : [state.settings.platform];
    const langs: { code: string; folder: string }[] = [
      { code: "", folder: "source" },
      ...(state.settings.languages ?? []).map((l) => ({ code: l.code, folder: l.code })),
    ];
    for (const target of targets) {
      const targetSettings = { ...state.settings, platform: target };
      const platformPrefix = outputForSettings(targetSettings).store === "playstore" ? "android" : "ios";
      for (const { code, folder } of langs) {
        const dir = zip.folder(`${target}/${folder}`)!;
        for (let i = 0; i < state.slides.length; i++) {
          const slide = state.slides[i];
          const c = document.createElement("canvas");
          await paintSlide(c, resolveSlide(slide, code, target), targetSettings, i, totalSlides);
          const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
          dir.file(`${platformPrefix}-${String(i + 1).padStart(2, "0")}-${slideSlug(slide, i)}.png`, blob);
        }
        const stripCanvas = document.createElement("canvas");
        await paintStrip(stripCanvas, state.slides.map((s) => resolveSlide(s, code, target)), targetSettings);
        const stripBlob = await new Promise<Blob>((res) => stripCanvas.toBlob((b) => res(b!), "image/png"));
        dir.file(`${platformPrefix}-strip-${totalSlides}x.png`, stripBlob);
      }
    }
    const out = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url;
    a.download = "truepane-all-targets.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setExporting(null);
  };

  // JSON export/import
  const exportJson = () => {
    const payload = {
      version: 2,
      settings: state.settings,
      releaseBaseline: state.releaseBaseline,
      slides: state.slides.map((s) => ({
        title: s.title,
        subhead: s.subhead,
        media: serializeMedia(s.media),
        background: s.background,
        composition: s.composition,
        deviceSpan: s.deviceSpan,
        translations: serializeTranslations(s.translations),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "truepane-project.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const s = normalizeAppState(JSON.parse(text));
    const slides = await hydrateImages(s.slides);
    setState({ ...s, slides });
    setSelectedIndex(0);
  };

  const openPreflight = (pending?: () => void) => {
    const issues = validateProject(state);
    if (!issues.length && pending) {
      pending();
      return;
    }
    setPreflight({ issues, pending });
  };

  const guardedExport = (action: () => void) => () => openPreflight(action);

  const refreshRelease = async () => {
    setReleaseBusy(true);
    setReleaseRows(await compareRelease(state));
    setReleaseBusy(false);
  };

  const exportChangedRelease = async () => {
    setReleaseBusy(true);
    const rows = (await compareRelease(state)).filter((row) => row.status === "added" || row.status === "changed");
    const zip = new JSZip();
    for (const row of rows) {
      const slide = state.slides[row.slide];
      if (!slide) continue;
      const settings = { ...state.settings, platform: row.target };
      const canvas = document.createElement("canvas");
      await paintSlide(canvas, resolveSlide(slide, row.language, row.target), settings, row.slide, state.slides.length);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
      zip.file(`${row.target}/${row.language || "source"}/slide-${String(row.slide + 1).padStart(2, "0")}.png`, blob);
    }
    const manifest = rows.map(({ key, status }) => ({ key, status }));
    zip.file("release-manifest.json", JSON.stringify(manifest, null, 2));
    const out = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(out);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "truepane-release-changes.zip";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setReleaseRows(await compareRelease(state));
    setReleaseBusy(false);
  };

  const setCurrentReleaseBaseline = async () => {
    setReleaseBusy(true);
    const baseline = await createReleaseBaseline(state);
    setState((current) => ({ ...current, releaseBaseline: baseline }));
    setReleaseRows((await compareRelease({ ...state, releaseBaseline: baseline })));
    setReleaseBusy(false);
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
  const platformDim = dimForSettings(state.settings);
  const overlays = (
    <>
      {bulkImport && (
        <BulkImportDialog
          proposal={bulkImport.proposal}
          slideCount={state.slides.length}
          targets={state.settings.targets?.length ? state.settings.targets : [state.settings.platform]}
          languages={(state.settings.languages ?? []).map((language) => language.code)}
          onApply={applyBulkImport}
          onCancel={() => setBulkImport(null)}
        />
      )}
      {preflight && (
        <PreflightDialog
          issues={preflight.issues}
          canContinue={!!preflight.pending}
          onOpenIssue={(issue) => {
            updateSettings({ platform: issue.target });
            setActiveLang(issue.language);
            setSelectedIndex(issue.slide);
            setPreflight(null);
          }}
          onContinue={() => {
            const pending = preflight.pending;
            setPreflight(null);
            pending?.();
          }}
          onClose={() => setPreflight(null)}
        />
      )}
    </>
  );

  // --- Render ----------------------------------------------------------
  if (!hydrated) {
    return <div className="boot">Loading…</div>;
  }

  if (isMobile) {
    return (
      <>
      <MobileLayout
        state={state}
        selectedIndex={selectedIndex}
        setSelectedIndex={setSelectedIndex}
        setFont={setFont}
        onCustomFont={handleCustomFont}
        updateSettings={updateSettings}
        updateBackground={updateBackground}
        updateSlideBackground={(patch) => updateSlideBackground(selectedIndex, patch)}
        selected={selected}
        updateSlide={(patch) => updateSlide(selectedIndex, patch)}
        deleteSelected={() => deleteSlide(selectedIndex)}
        moveSelected={(dir) => moveSlide(selectedIndex, selectedIndex + dir)}
        addSlide={addSlide}
        exportPng={guardedExport(exportPng)}
        exportStrip={guardedExport(exportStrip)}
        exportZip={guardedExport(exportZip)}
        exportJson={exportJson}
        importJson={importJson}
        exporting={exporting}
        requestEyedrop={requestEyedrop}
        theme={theme}
        onToggleTheme={toggleTheme}
        eyedropTarget={eyedropTarget}
        pickColorFromSlide={pickColorFromSlide}
        arranging={arranging}
        onToggleArrange={() => setArranging((value) => !value)}
        onSpanDevice={() => spanDeviceWithNext(selectedIndex)}
        onBulkFiles={beginBulkImport}
        onRunPreflight={() => openPreflight()}
        brandKits={brandKits}
        onCreateBrandKit={createBrandKit}
        onRenameBrandKit={renameBrandKit}
        onApplyBrandKit={useBrandKit}
        onDeleteBrandKit={deleteBrandKit}
        onImportBrandKit={importBrandKit}
        releaseRows={releaseRows}
        releaseBusy={releaseBusy}
        onCompareRelease={refreshRelease}
        onExportChanged={() => openPreflight(() => void exportChangedRelease())}
        onSetReleaseBaseline={setCurrentReleaseBaseline}
      />
      {overlays}
      </>
    );
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
        activeLang={activeLang}
        setActiveLang={setActiveLang}
        updateSlideTranslation={(lang, patch) => updateSlideTranslation(selectedIndex, lang, patch)}
        applyTranslations={applyTranslations}
        exportPng={guardedExport(exportPng)}
        exportStrip={guardedExport(exportStrip)}
        exportZip={guardedExport(exportZip)}
        exportAllLanguages={guardedExport(exportAllLanguages)}
        exportJson={exportJson}
        importJson={importJson}
        exporting={exporting}
        requestEyedrop={requestEyedrop}
        theme={theme}
        onToggleTheme={toggleTheme}
        arranging={arranging}
        onToggleArrange={() => setArranging((value) => !value)}
        onSpanDevice={() => spanDeviceWithNext(selectedIndex)}
        onBulkFiles={beginBulkImport}
        onRunPreflight={() => openPreflight()}
        brandKits={brandKits}
        onCreateBrandKit={createBrandKit}
        onRenameBrandKit={renameBrandKit}
        onApplyBrandKit={useBrandKit}
        onDeleteBrandKit={deleteBrandKit}
        onImportBrandKit={importBrandKit}
        releaseRows={releaseRows}
        releaseBusy={releaseBusy}
        onCompareRelease={refreshRelease}
        onExportChanged={() => openPreflight(() => void exportChangedRelease())}
        onSetReleaseBaseline={setCurrentReleaseBaseline}
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
            <span className="muted stage__drag-hint">· Drag canvas to navigate</span>
            {eyedropTarget && (
              <span className="muted">· Click a slide to pick a color (Esc to cancel)</span>
            )}
          </div>
          <button className="ghost" onClick={addSlide}>
            + Add slide
          </button>
        </div>
        <div
          ref={stripRef}
          className="strip"
          role="region"
          aria-label="Slide strip. Drag sideways to navigate between slides."
          onPointerDown={startStripDrag}
          onPointerMove={moveStripDrag}
          onPointerUp={endStripDrag}
          onPointerCancel={endStripDrag}
          onClickCapture={(e) => {
            if (!suppressStripClick.current) return;
            e.preventDefault();
            e.stopPropagation();
            suppressStripClick.current = false;
          }}
        >
          {state.slides.map((slide, i) => (
            <SlidePreview
              key={i}
              slide={resolveSlide(slide, activeLang, state.settings.platform)}
              settings={state.settings}
              slideIndex={i}
              totalSlides={totalSlides}
              selected={i === selectedIndex}
              displayWidth={
                i === selectedIndex
                  ? desktopPreviewWidth
                  : Math.max(72, Math.round(desktopPreviewWidth * 0.63))
              }
              onSelect={() => setSelectedIndex(i)}
              onDelete={state.slides.length > 1 ? () => deleteSlide(i) : null}
              eyedropping={!!eyedropTarget}
              onPickColor={pickColorFromSlide}
              arranging={arranging && i === selectedIndex}
              onCompositionChange={(composition) => updateSlide(i, { composition })}
            />
          ))}
          <button className="add-card" onClick={addSlide}>
            ＋<br />
            Add slide
          </button>
        </div>
      </main>
      {overlays}
    </div>
  );
}
