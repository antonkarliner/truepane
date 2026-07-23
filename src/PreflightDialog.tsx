import type { PreflightIssue } from "./core/preflight";
import { PLATFORMS } from "./core/render";

export function PreflightDialog({
  issues,
  canContinue,
  onOpenIssue,
  onContinue,
  onClose,
}: {
  issues: PreflightIssue[];
  canContinue: boolean;
  onOpenIssue: (issue: PreflightIssue) => void;
  onContinue: () => void;
  onClose: () => void;
}) {
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="bulk-dialog preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
        <div className="bulk-dialog__header">
          <div>
            <h2 id="preflight-title">Release preflight</h2>
            <p>{warnings} warnings · {issues.length - warnings} notes across targets and locales</p>
          </div>
          <button className="ghost small" onClick={onClose} aria-label="Close preflight">×</button>
        </div>
        <div className="bulk-table-wrap">
          {issues.length ? (
            <table className="bulk-table preflight-table">
              <thead><tr><th>Level</th><th>Target</th><th>Locale</th><th>Slide</th><th>Check</th><th>Message</th></tr></thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr key={`${issue.target}/${issue.language}/${issue.slide}/${issue.code}/${index}`}>
                    <td><span className={`preflight-level preflight-level--${issue.severity}`}>{issue.severity}</span></td>
                    <td>{PLATFORMS.find((platform) => platform.id === issue.target)?.label ?? issue.target}</td>
                    <td>{issue.language || "Source"}</td>
                    <td>
                      <button className="link-button" onClick={() => onOpenIssue(issue)}>
                        {issue.slide + 1}
                      </button>
                    </td>
                    <td><code>{issue.code}</code></td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="preflight-empty">No issues found. This project is ready to export.</div>
          )}
        </div>
        <div className="bulk-dialog__footer">
          <button className="ghost" onClick={onClose}>{canContinue ? "Cancel" : "Close"}</button>
          {canContinue && (
            <button className="primary" onClick={onContinue}>
              Export anyway
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
