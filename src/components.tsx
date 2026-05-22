// UI components for Truepane.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { dimFor, paintSlide } from "./render";
import type { RingLayout, Settings, Slide } from "./types";

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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reqRef = useRef(0);

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
    onSelect();
  };

  useEffect(() => {
    const cur = ++reqRef.current;
    void (async () => {
      const c = canvasRef.current;
      if (!c) return;
      await paintSlide(c, slide, settings, slideIndex, totalSlides);
      if (cur !== reqRef.current) return; // stale render
    })();
  }, [slide, settings, slideIndex, totalSlides]);

  const dim = dimFor(settings.platform || "ios");
  const aspect = dim.W / dim.H;
  const displayHeight = displayWidth / aspect;

  return (
    <div
      className={"slide-card" + (selected ? " selected" : "")}
      style={{ width: displayWidth, cursor: eyedropping ? "crosshair" : undefined }}
      onClick={handleClick}
    >
      <div className="slide-card__index">{String(slideIndex + 1).padStart(2, "0")}</div>
      <canvas
        ref={canvasRef}
        style={{ width: displayWidth, height: displayHeight, display: "block", borderRadius: 12 }}
      />
      {onDelete && (
        <button
          className="slide-card__delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete slide"
        >
          ×
        </button>
      )}
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
          <input type="color" value={normalizeHex(value)} onChange={(e) => onChange(e.target.value)} />
          <span className="swatch__chip" style={{ background: value }} />
        </label>
        <input
          className="color-row__text"
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
