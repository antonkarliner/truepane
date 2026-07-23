import { useMemo, useState } from "react";
import type { BulkImportProposal, BulkImportSlot } from "./core/bulk-import";
import { PLATFORMS } from "./core/render";

export interface BulkApplyRow {
  fileId: string;
  slot: BulkImportSlot;
}

export function BulkImportDialog({
  proposal,
  slideCount,
  targets,
  languages,
  onApply,
  onCancel,
}: {
  proposal: BulkImportProposal;
  slideCount: number;
  targets: string[];
  languages: string[];
  onApply: (rows: BulkApplyRow[]) => void;
  onCancel: () => void;
}) {
  const initial = useMemo(() => [
    ...proposal.assignments.map((item) => ({
      fileId: item.file.id,
      name: item.file.name,
      slot: item.slot,
      include: !item.conflict,
      note: item.conflict ?? item.reason,
    })),
    ...proposal.unmapped.map((item) => ({
      fileId: item.file.id,
      name: item.file.name,
      slot: { slideIndex: 0, target: "", language: "" },
      include: false,
      note: item.reason,
    })),
  ], [proposal]);
  const [rows, setRows] = useState(initial);
  const patch = (index: number, value: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((row, i) => i === index ? { ...row, ...value } : row));

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
        <div className="bulk-dialog__header">
          <div>
            <h2 id="bulk-title">Review screenshot mapping</h2>
            <p>Nothing changes until you apply this proposal.</p>
          </div>
          <button className="ghost small" onClick={onCancel} aria-label="Close bulk import">×</button>
        </div>
        <div className="bulk-table-wrap">
          <table className="bulk-table">
            <thead><tr><th>Use</th><th>File</th><th>Target</th><th>Locale</th><th>Slide</th><th>Mapping</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.fileId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include}
                      aria-label={`Import ${row.name}`}
                      onChange={(event) => patch(index, { include: event.target.checked })}
                    />
                  </td>
                  <td title={row.name}>{row.name}</td>
                  <td>
                    <select
                      value={row.slot.target}
                      aria-label={`Target for ${row.name}`}
                      onChange={(event) => patch(index, { slot: { ...row.slot, target: event.target.value } })}
                    >
                      <option value="">Choose…</option>
                      {targets.map((target) => (
                        <option key={target} value={target}>
                          {PLATFORMS.find((platform) => platform.id === target)?.label ?? target}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.slot.language}
                      aria-label={`Locale for ${row.name}`}
                      onChange={(event) => patch(index, { slot: { ...row.slot, language: event.target.value } })}
                    >
                      <option value="">Source</option>
                      {languages.map((language) => <option key={language} value={language}>{language}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.slot.slideIndex}
                      aria-label={`Slide for ${row.name}`}
                      onChange={(event) => patch(index, {
                        slot: { ...row.slot, slideIndex: Number(event.target.value) },
                      })}
                    >
                      {Array.from({ length: slideCount }, (_, slideIndex) => (
                        <option key={slideIndex} value={slideIndex}>{slideIndex + 1}</option>
                      ))}
                    </select>
                  </td>
                  <td><span className={`bulk-reason bulk-reason--${row.note}`}>{row.note}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bulk-dialog__footer">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            onClick={() => onApply(rows
              .filter((row) => row.include && row.slot.target)
              .map((row) => ({ fileId: row.fileId, slot: row.slot })))}
          >
            Apply selected
          </button>
        </div>
      </section>
    </div>
  );
}
