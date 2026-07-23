// UI components for Truepane.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { dimForSettings, getRenderFrame, paintSlide } from "./core/render";
import {
  clampDevicePosition,
  COMPOSITION_PRESETS,
  devicePolygon,
  normalizeComposition,
  pointInPolygon,
  resolveComposition,
  snapDevicePosition,
} from "./core/composition";
import type { Composition, OutputSpec, RingLayout, Settings, Slide, TextAlign } from "./core/types";

declare global {
  interface Window {
    EyeDropper?: { new (): { open: () => Promise<{ sRGBHex: string }> } };
  }
}

// ---------------------------------------------------------------------------
// SlidePreview: renders one slide to canvas and displays scaled down.
// ---------------------------------------------------------------------------
export function SlidePreview({
  slide,
  settings,
  slideIndex,
  totalSlides,
  displayWidth = 300,
  selected,
  onSelect,
  onDelete,
  eyedropping = false,
  onPickColor,
  arranging = false,
  onCompositionChange,
}: {
  slide: Slide;
  settings: Settings;
  slideIndex: number;
  totalSlides: number;
  displayWidth?: number;
  selected: boolean;
  onSelect: () => void;
  onDelete: (() => void) | null;
  eyedropping?: boolean;
  onPickColor?: (hex: string) => void;
  arranging?: boolean;
  onCompositionChange?: (composition: Composition) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reqRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    deviceX: number;
    deviceY: number;
    base: Composition;
  } | null>(null);
  const [dragComposition, setDragComposition] = useState<Composition | null>(null);
  const dragCompositionRef = useRef<Composition | null>(null);

  // In eyedrop mode a click samples the pixel under the cursor (cross-browser
  // fallback for the native EyeDropper API); otherwise it selects the slide.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const c = canvasRef.current;
    if (eyedropping && onPickColor && c) {
      const rect = c.getBoundingClientRect();
      const x = Math.max(0, Math.min(c.width - 1, Math.round(((e.clientX - rect.left) / rect.width) * c.width)));
      const y = Math.max(0, Math.min(c.height - 1, Math.round(((e.clientY - rect.top) / rect.height) * c.height)));
      const ctx = c.getContext("2d");
      if (ctx) {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        onPickColor("#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""));
      }
      return;
    }
    if (!arranging) onSelect();
  };

  const effectiveSlide = dragComposition ? { ...slide, composition: dragComposition } : slide;
  const dim = dimForSettings(settings);
  const aspect = dim.W / dim.H;
  const displayHeight = displayWidth / aspect;
  const renderScale = Math.min(1, (displayWidth * Math.min(window.devicePixelRatio || 1, 2)) / dim.W);

  useEffect(() => {
    const cur = ++reqRef.current;
    void (async () => {
      const c = canvasRef.current;
      if (!c) return;
      await paintSlide(c, effectiveSlide, settings, slideIndex, totalSlides, renderScale);
      if (cur !== reqRef.current) return; // stale render
    })();
  }, [effectiveSlide, settings, slideIndex, totalSlides, renderScale]);

  const pointOnCanvas = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * dim.W,
      y: ((e.clientY - rect.top) / rect.height) * dim.H,
    };
  };

  const startArrange = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!arranging || !selected || e.button !== 0 || !onCompositionChange) return;
    const frame = getRenderFrame(settings.platform || "ios", settings.output);
    const base = normalizeComposition(slide.composition ?? settings.composition);
    const resolved = resolveComposition(base, frame);
    if (!pointInPolygon(pointOnCanvas(e), devicePolygon(resolved, frame))) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      deviceX: resolved.device.x,
      deviceY: resolved.device.y,
      base,
    };
  };

  const moveArrange = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current!.getBoundingClientRect();
    const frame = getRenderFrame(settings.platform || "ios", settings.output);
    const current = resolveComposition(drag.base, frame);
    let next = clampDevicePosition(
      drag.deviceX + (e.clientX - drag.startX) / rect.width,
      drag.deviceY + (e.clientY - drag.startY) / rect.height,
      current,
      frame,
    );
    if (!e.altKey) next = snapDevicePosition(next.x, next.y);
    const composition = {
      ...drag.base,
      device: { ...drag.base.device, x: next.x, y: next.y },
    };
    dragCompositionRef.current = composition;
    setDragComposition(composition);
  };

  const endArrange = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragCompositionRef.current) onCompositionChange?.(dragCompositionRef.current);
    dragCompositionRef.current = null;
    dragRef.current = null;
    setDragComposition(null);
  };

  const nudge = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!arranging || !selected || !onCompositionChange) return;
    const delta = e.shiftKey ? 10 : 1;
    const frame = getRenderFrame(settings.platform || "ios", settings.output);
    const base = normalizeComposition(slide.composition ?? settings.composition);
    const resolved = resolveComposition(base, frame);
    let x = resolved.device.x;
    let y = resolved.device.y;
    if (e.key === "ArrowLeft") x -= delta / frame.W;
    else if (e.key === "ArrowRight") x += delta / frame.W;
    else if (e.key === "ArrowUp") y -= delta / frame.H;
    else if (e.key === "ArrowDown") y += delta / frame.H;
    else return;
    e.preventDefault();
    e.stopPropagation();
    const next = clampDevicePosition(x, y, resolved, frame);
    onCompositionChange({ ...base, device: { ...base.device, ...next } });
  };

  return (
    <div
      className={"slide-card" + (selected ? " selected" : "")}
      style={{ width: displayWidth }}
      data-slide-index={slideIndex}
    >
      <div
        className="slide-card__select"
        style={{ cursor: eyedropping ? "crosshair" : arranging && selected ? "grab" : undefined }}
        onClick={handleClick}
        onPointerDown={startArrange}
        onPointerMove={moveArrange}
        onPointerUp={endArrange}
        onPointerCancel={endArrange}
        data-arranging={arranging && selected ? "true" : undefined}
        role="button"
        tabIndex={0}
        aria-label={`Select slide ${slideIndex + 1}${selected ? ", selected" : ""}`}
        aria-pressed={selected}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          nudge(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        <div className="slide-card__index">{String(slideIndex + 1).padStart(2, "0")}</div>
        <canvas
          ref={canvasRef}
          style={{ width: displayWidth, height: displayHeight, display: "block", borderRadius: 12 }}
        />
        {arranging && selected && (
          <div className="arrange-guides" aria-hidden="true">
            <span className="arrange-guide arrange-guide--x" />
            <span className="arrange-guide arrange-guide--y" />
          </div>
        )}
      </div>
      {onDelete && (
        <button
          className="slide-card__delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete slide"
          aria-label={`Delete slide ${slideIndex + 1}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function CompositionControls({
  platform,
  output,
  composition,
  hasOverride,
  arranging,
  onChange,
  onToggleOverride,
  onToggleArrange,
  onSpanDevice,
  canSpanDevice,
}: {
  platform: string;
  output?: OutputSpec;
  composition: Composition | undefined;
  hasOverride: boolean;
  arranging: boolean;
  onChange: (composition: Composition) => void;
  onToggleOverride: () => void;
  onToggleArrange: () => void;
  onSpanDevice: () => void;
  canSpanDevice: boolean;
}) {
  const normalized = normalizeComposition(composition);
  const resolved = resolveComposition(normalized, getRenderFrame(platform, output));
  const patchDevice = (patch: Partial<typeof resolved.device>) =>
    onChange({ ...normalized, device: { ...normalized.device, ...patch } });
  const patchText = (patch: Partial<typeof resolved.text>) =>
    onChange({ ...normalized, text: { ...normalized.text, ...patch } });

  return (
    <div className="composition-controls">
      <Field label="Layout preset">
        <select
          className="text-input"
          aria-label="Composition preset"
          value={normalized.preset}
          onChange={(e) => onChange({ preset: e.target.value as Composition["preset"] })}
        >
          {COMPOSITION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
      </Field>
      <button className={"ghost small arrange-btn" + (arranging ? " active" : "")} onClick={onToggleArrange}>
        {arranging ? "Done arranging" : "Arrange on canvas"}
      </button>
      <button className="ghost small" disabled={!canSpanDevice} onClick={onSpanDevice}>
        Span device across next slide
      </button>
      <Field label={`Device horizontal · ${Math.round(resolved.device.x * 100)}%`}>
        <input className="slider" type="range" min="-0.4" max="1.4" step="0.005"
          value={resolved.device.x} onChange={(e) => patchDevice({ x: Number(e.target.value) })} />
      </Field>
      <Field label={`Device vertical · ${Math.round(resolved.device.y * 100)}%`}>
        <input className="slider" type="range" min="-0.4" max="1.4" step="0.005"
          value={resolved.device.y} onChange={(e) => patchDevice({ y: Number(e.target.value) })} />
      </Field>
      <Field label={`Device size · ${Math.round(resolved.device.scale * 100)}%`}>
        <input className="slider" type="range" min="0.4" max="1.6" step="0.01"
          value={resolved.device.scale} onChange={(e) => patchDevice({ scale: Number(e.target.value) })} />
      </Field>
      <Field label={`Device angle · ${resolved.device.rotation.toFixed(0)}°`}>
        <input className="slider" type="range" min="-20" max="20" step="1"
          value={resolved.device.rotation} onChange={(e) => patchDevice({ rotation: Number(e.target.value) })} />
      </Field>
      <Field label="Text alignment">
        <Segmented
          value={resolved.text.align}
          onChange={(value) => patchText({ align: value as TextAlign })}
          options={[
            { value: "left", label: "Left" },
            { value: "center", label: "Center" },
            { value: "right", label: "Right" },
          ]}
        />
      </Field>
      <button className="ghost small" onClick={() => onChange({ preset: normalized.preset })}>Reset preset</button>
      <label className="ai-lock">
        <input type="checkbox" checked={hasOverride} onChange={onToggleOverride} />
        Override composition for this slide only
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageDrop: a drop / click target that loads an image and returns it.
// ---------------------------------------------------------------------------
export function ImageDrop({
  image,
  onImage,
  onClear,
}: {
  image: { dataUrl: string } | null;
  onImage: (img: HTMLImageElement, dataUrl: string) => void;
  onClear: () => void;
}) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null | undefined) => {
    if (!files || !files.length) return;
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result as string;
      const img = new Image();
      img.onload = () => onImage(img, result);
      img.src = result;
    };
    fr.readAsDataURL(file);
  };

  return (
    <div
      className={"image-drop" + (hover ? " hover" : "") + (image ? " filled" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      onPaste={(e) => handleFiles(e.clipboardData?.files)}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {image ? (
        <div className="image-drop__preview">
          <img src={image.dataUrl} alt="screenshot preview" />
          <button
            className="image-drop__clear"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="image-drop__empty">
          <div className="image-drop__icon">↑</div>
          <div className="image-drop__title">Drop or click to upload</div>
          <div className="image-drop__hint">PNG / JPG — app screen (any size)</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atomic controls
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <div className="field__label">{label}</div>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  if (multiline) {
    return (
      <textarea
        className="text-input multiline"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />
    );
  }
  return (
    <input
      className="text-input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={"segmented__btn" + (value === opt.value ? " active" : "")}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ColorRow({
  label,
  value,
  onChange,
  presets,
  onEyedrop,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
  /** Activates color picking (native EyeDropper or click-a-slide fallback). */
  onEyedrop?: (apply: (hex: string) => void) => void;
}) {
  return (
    <div className="color-row">
      <div className="color-row__label">{label}</div>
      <div className="color-row__main">
        <label className="swatch">
          <input aria-label={`${label} color picker`} type="color" value={normalizeHex(value)} onChange={(e) => onChange(e.target.value)} />
          <span className="swatch__chip" style={{ background: value }} />
        </label>
        <input
          className="color-row__text"
          aria-label={`${label} value`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {onEyedrop && (
          <button
            type="button"
            className="eyedropper"
            title="Pick a colour from the screen or a slide"
            aria-label="Pick a colour"
            onClick={() => onEyedrop(onChange)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m2 22 1-1h3l9-9" />
              <path d="M3 21v-3l9-9" />
              <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
            </svg>
          </button>
        )}
      </div>
      {presets && (
        <div className="color-row__presets">
          {presets.map((p) => (
            <button
              key={p}
              className="preset-swatch"
              style={{ background: p, outline: p === value ? "2px solid var(--ink)" : "" }}
              onClick={() => onChange(p)}
              title={p}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function normalizeHex(v: string): string {
  if (!v) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  // For rgba/named: dump a guess
  const tmp = document.createElement("div");
  tmp.style.color = v;
  document.body.appendChild(tmp);
  const cs = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m = cs.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#000000";
  return "#" + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// LayoutSlider — a snap-to-preset slider for ring layouts. Shows the active
// preset name and lets the user drag/scrub through named arrangements.
// ---------------------------------------------------------------------------
export function LayoutSlider({
  layouts,
  value,
  onChange,
}: {
  layouts: RingLayout[];
  value: string;
  onChange: (v: string) => void;
}) {
  const idx = Math.max(0, layouts.findIndex((l) => l.id === value));
  const last = layouts.length - 1;
  const current = layouts[idx] || layouts[0];

  return (
    <div className="layout-slider">
      <div className="layout-slider__head">
        <div className="layout-slider__name">{current.name}</div>
        <div className="layout-slider__step">
          {idx + 1} / {layouts.length}
        </div>
      </div>
      <input
        className="slider"
        type="range"
        aria-label="Ring layout"
        min={0}
        max={last}
        step={1}
        value={idx}
        onChange={(e) => onChange(layouts[parseInt(e.target.value, 10)].id)}
      />
      <div className="layout-slider__ticks">
        {layouts.map((l, i) => (
          <button
            key={l.id}
            className={"layout-slider__tick" + (i === idx ? " active" : "")}
            onClick={() => onChange(l.id)}
            title={l.name}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
