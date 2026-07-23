import { useMemo, useState } from "react";
import type { ReleaseAssetComparison, ReleaseAssetStatus } from "./core/types";

const STATUSES: ReleaseAssetStatus[] = ["added", "changed", "unchanged", "removed"];

export function ReleaseUpdateControls({
  rows,
  baselineDate,
  busy,
  onCompare,
  onExportChanged,
  onSetBaseline,
}: {
  rows: ReleaseAssetComparison[];
  baselineDate?: string;
  busy: boolean;
  onCompare: () => void;
  onExportChanged: () => void;
  onSetBaseline: () => void;
}) {
  const [filter, setFilter] = useState<ReleaseAssetStatus | "all">("all");
  const counts = useMemo(() => Object.fromEntries(
    STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length]),
  ) as Record<ReleaseAssetStatus, number>, [rows]);
  const visible = filter === "all" ? rows : rows.filter((row) => row.status === filter);
  const changedCount = counts.added + counts.changed;

  return (
    <div className="release-update">
      <div className="release-update__summary">
        {STATUSES.map((status) => (
          <button key={status} className={`release-stat release-stat--${status}`} onClick={() => setFilter(status)}>
            <strong>{counts[status]}</strong><span>{status}</span>
          </button>
        ))}
      </div>
      <div className="brand-kit-actions">
        <button className="ghost small" disabled={busy} onClick={onCompare}>{busy ? "Comparing…" : "Compare release"}</button>
        <button className="primary small" disabled={busy || changedCount === 0} onClick={onExportChanged}>
          Export changed ({changedCount})
        </button>
        <button className="ghost small" disabled={busy} onClick={onSetBaseline}>Set current baseline</button>
      </div>
      <div className="field__hint">
        {baselineDate ? `Baseline: ${new Date(baselineDate).toLocaleString()}` : "No baseline yet; every current asset is new."}
      </div>
      {rows.length > 0 && (
        <>
          <select className="text-input" aria-label="Release status filter" value={filter} onChange={(event) => setFilter(event.target.value as ReleaseAssetStatus | "all")}>
            <option value="all">All assets</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status} ({counts[status]})</option>)}
          </select>
          <div className="release-assets">
            {visible.map((row) => (
              <div className="release-asset" key={`${row.key}/${row.status}`}>
                <span className={`release-dot release-dot--${row.status}`} />
                <code>{row.key}</code>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
