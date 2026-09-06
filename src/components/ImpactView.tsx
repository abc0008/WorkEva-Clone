"use client";
import { fmtDate, Status } from "./ui";
type Row = {
  taskId: string;
  title: string;
  ownerId: string;
  direct: boolean;
  currentForecastAt?: string;
  baselineDueAt: string;
  unknownForecast: boolean;
  deadlineBreached: boolean;
};
export function ImpactView({ impact }: { impact: Record<string, unknown> }) {
  const rows = Array.isArray(impact.tasks) ? (impact.tasks as Row[]) : [];
  return (
    <div style={{ padding: 17 }}>
      <p>
        {rows.length} downstream task(s) ·{" "}
        {Array.isArray(impact.affectedOwners)
          ? impact.affectedOwners.length
          : 0}{" "}
        affected owner(s)
      </p>
      {rows.length === 0 ? (
        <p className="we-table-muted">
          This task has no downstream dependencies.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.taskId}
            style={{ borderTop: "1px solid #e2e8f0", padding: "13px 0" }}
          >
            <strong>{row.title}</strong>
            <p className="we-table-muted">
              {row.ownerId} ·{" "}
              {row.direct ? "Direct dependency" : "Indirect dependency"}
            </p>
            <div>Baseline: {fmtDate(row.baselineDueAt, true)}</div>
            <div>
              Forecast:{" "}
              {row.unknownForecast
                ? "Awaiting a committed date"
                : fmtDate(row.currentForecastAt, true)}
            </div>
            <div style={{ marginTop: 8 }}>
              <Status
                value={
                  row.unknownForecast
                    ? "UNKNOWN FORECAST"
                    : row.deadlineBreached
                      ? "AT RISK"
                      : "ON TRACK"
                }
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
