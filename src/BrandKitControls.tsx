import { useEffect, useRef, useState } from "react";
import { MAX_BRAND_KIT_BYTES, normalizeBrandKit, type BrandKit } from "./core/brand-kit";

export function BrandKitControls({
  kits,
  onCreate,
  onRename,
  onApply,
  onDelete,
  onImport,
}: {
  kits: BrandKit[];
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onApply: (kit: BrandKit, clearOverrides: boolean) => void;
  onDelete: (id: string) => void;
  onImport: (kit: BrandKit) => void;
}) {
  const [selectedId, setSelectedId] = useState(kits[0]?.id ?? "");
  const selected = kits.find((kit) => kit.id === selectedId);
  const [name, setName] = useState(selected?.name ?? "");
  const [clearOverrides, setClearOverrides] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!kits.some((kit) => kit.id === selectedId)) setSelectedId(kits[0]?.id ?? "");
  }, [kits, selectedId]);
  useEffect(() => setName(selected?.name ?? ""), [selected?.id, selected?.name]);

  const exportKit = () => {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selected.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "brand"}.truepane-brand.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="brand-kit-controls">
      <select aria-label="Brand kit" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        <option value="">No saved kits</option>
        {kits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
      </select>
      <input
        className="text-input"
        aria-label="Brand kit name"
        placeholder="Brand kit name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="brand-kit-actions">
        <button className="ghost small" onClick={() => onCreate(name || "New brand")}>Save current</button>
        <button className="ghost small" disabled={!selected} onClick={() => selected && onRename(selected.id, name)}>Rename</button>
        <button
          className="primary small"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            if (clearOverrides && !window.confirm("Clear per-slide style and composition overrides before applying this kit?")) return;
            onApply(selected, clearOverrides);
          }}
        >
          Apply
        </button>
      </div>
      <label className="ai-lock">
        <input type="checkbox" checked={clearOverrides} onChange={(event) => setClearOverrides(event.target.checked)} />
        Clear per-slide overrides
      </label>
      <div className="brand-kit-actions">
        <button className="ghost small" disabled={!selected} onClick={exportKit}>Export file</button>
        <button className="ghost small" onClick={() => inputRef.current?.click()}>Import file</button>
        <button
          className="ghost small danger"
          disabled={!selected}
          onClick={() => {
            if (selected && window.confirm(`Delete brand kit "${selected.name}"?`)) onDelete(selected.id);
          }}
        >
          Delete
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".truepane-brand.json,application/json"
          style={{ display: "none" }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              if (file.size > MAX_BRAND_KIT_BYTES) throw new Error("Brand kit file is too large.");
              onImport(normalizeBrandKit(JSON.parse(await file.text())));
              setError("");
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Could not import brand kit.");
            }
          }}
        />
      </div>
      {error && <div className="field__hint brand-kit-error">{error}</div>}
    </div>
  );
}
