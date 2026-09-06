"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Filter,
  Info,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import type { AppSnapshot } from "@/lib/types";
import { api } from "@/lib/client";
import { ErrorNotice } from "./ui";
import { fmtDate, Status } from "./ui";

export function DashboardPanel({
  snapshot,
  onRefresh,
  setToast,
}: {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
}) {
  const [error, setError] = useState("");
  const [reopenId, setReopenId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const reopen = async () => {
    const assignment = snapshot.assignments.find((a) => a.id === reopenId);
    if (!assignment) return;
    setBusy(true);
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "reopenReview",
          assignmentId: assignment.id,
          expectedRevision: assignment.revision,
          reason,
        }),
      });
      await onRefresh();
      setReopenId("");
      setReason("");
      setToast("Review reopened; dependent signatures invalidated");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const [packageId, setPackageId] = useState(snapshot.packages[0]?.id || "");
  const [status, setStatus] = useState("ALL");
  const [reviewer, setReviewer] = useState("ALL");
  const pkg =
    snapshot.packages.find((p) => p.id === packageId) || snapshot.packages[0];
  const version = snapshot.versions.find((v) => v.id === pkg?.currentVersionId);
  const assignments = useMemo(
    () =>
      snapshot.assignments.filter(
        (a) =>
          (!version || a.versionId === version.id) &&
          (status === "ALL" || a.status === status) &&
          (reviewer === "ALL" || a.reviewerId === reviewer),
      ),
    [snapshot.assignments, version, status, reviewer],
  );
  const allRequired = assignments.reduce(
    (sum, a) =>
      sum +
      (version?.sections
        .find((s) => s.id === a.sectionId)
        ?.metrics.filter((m) => m.required).length || 0),
    0,
  );
  const answered = assignments.reduce(
    (sum, a) =>
      sum +
      a.responses.filter((r) =>
        version?.sections
          .find((s) => s.id === a.sectionId)
          ?.metrics.some((m) => m.id === r.metricId && m.required),
      ).length,
    0,
  );
  const signed = assignments.filter((a) => a.status === "SIGNED").length;
  const exceptions = assignments.reduce(
    (sum, a) =>
      sum + a.responses.filter((r) => r.answer === "NEEDS_EXPLANATION").length,
    0,
  );
  const overdue = assignments.filter(
    (a) => a.status !== "SIGNED" && new Date(a.dueAt).getTime() < Date.now(),
  ).length;
  const reviewers = snapshot.users.filter((u) =>
    snapshot.assignments.some((a) => a.reviewerId === u.id),
  );
  return (
    <div className="we-content">
      {error && <ErrorNotice message={error} />}{" "}
      {reopenId && (
        <div className="we-modal-backdrop">
          <section
            className="we-card"
            role="dialog"
            aria-modal="true"
            aria-label="Reopen review"
            style={{ width: 480, maxWidth: "100%", padding: 20 }}
          >
            <h2>Reopen review</h2>
            <p>
              The current signature and dependent attestations will require
              fresh confirmation.
            </p>
            <label>
              Reason
              <textarea
                className="we-textarea"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
              />
            </label>
            <div className="we-modal-footer">
              <button className="we-button" onClick={() => setReopenId("")}>
                Cancel
              </button>
              <button
                className="we-button primary"
                disabled={!reason.trim() || busy}
                onClick={() => void reopen()}
              >
                Reopen review
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="we-page-head">
        <div>
          <h1>Review dashboard</h1>
          <p>
            Management coverage and accountability for the current published
            version
          </p>
        </div>
        <button
          className="we-button"
          onClick={async () => {
            await onRefresh();
            setToast("Dashboard refreshed");
          }}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="we-filterbar we-card" style={{ marginBottom: 18 }}>
        <Filter size={16} color="#6f8095" />
        <select
          className="we-select"
          value={pkg?.id || ""}
          onChange={(e) => setPackageId(e.target.value)}
        >
          {snapshot.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.period}
            </option>
          ))}
        </select>
        <select
          className="we-select"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
        >
          <option value="ALL">All reviewers</option>
          {reviewers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          className="we-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          {[
            "NOT_STARTED",
            "IN_PROGRESS",
            "EXCEPTIONS",
            "SUBMITTED",
            "SIGNED",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <span style={{ color: "#74859a", fontSize: 11, marginLeft: "auto" }}>
          As of {fmtDate(new Date().toISOString(), true)}
        </span>
      </div>
      <div className="we-kpi-grid">
        <div className="we-kpi good">
          <div className="we-kpi-label">Response coverage</div>
          <div className="we-kpi-value">
            {allRequired ? Math.round((answered / allRequired) * 100) : "—"}%
          </div>
          <div className="we-kpi-foot">
            {answered} of {allRequired} required responses
          </div>
        </div>
        <div className="we-kpi good">
          <div className="we-kpi-label">Sign-off coverage</div>
          <div className="we-kpi-value">
            {assignments.length
              ? Math.round((signed / assignments.length) * 100)
              : "—"}
            %
          </div>
          <div className="we-kpi-foot">
            {signed} of {assignments.length} sections signed
          </div>
        </div>
        <div className="we-kpi warn">
          <div className="we-kpi-label">Outstanding exceptions</div>
          <div className="we-kpi-value">{exceptions}</div>
          <div className="we-kpi-foot">Reviewer-reported concerns</div>
        </div>
        <div className="we-kpi warn">
          <div className="we-kpi-label">Overdue assignments</div>
          <div className="we-kpi-value">{overdue}</div>
          <div className="we-kpi-foot">Current baseline deadline</div>
        </div>
      </div>
      <div className="we-dashboard-grid">
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Assignment coverage</h2>
              <p>
                {pkg?.title || "All packages"}{" "}
                {version ? `· Version ${version.number}` : ""}
              </p>
            </div>
            <div className="we-legend">
              <span>
                <i /> Signed
              </span>
              <span>
                <i className="amber" /> In review
              </span>
              <span>
                <i className="red" /> Overdue
              </span>
            </div>
          </div>
          {assignments.length === 0 ? (
            <div className="we-empty">
              <BarChart3 size={28} />
              <strong>No assignments match these filters</strong>
              <span>Try a different reviewer, package, or status.</span>
            </div>
          ) : (
            <div className="we-table-wrap">
              <table className="we-table">
                <thead>
                  <tr>
                    <th>Section / reviewer</th>
                    <th>Responses</th>
                    <th>Exceptions</th>
                    <th>Deadline</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => {
                    const sec = version?.sections.find(
                      (s) => s.id === a.sectionId,
                    );
                    const user = snapshot.users.find(
                      (u) => u.id === a.reviewerId,
                    );
                    const total =
                      sec?.metrics.filter((m) => m.required).length || 0;
                    const ex = a.responses.filter(
                      (r) => r.answer === "NEEDS_EXPLANATION",
                    ).length;
                    return (
                      <tr key={a.id}>
                        <td>
                          <span className="we-table-title">
                            {sec?.name || a.sectionId}
                          </span>
                          <div className="we-table-muted">
                            {user?.name || a.reviewerId} · {a.entity}
                          </div>
                        </td>
                        <td>
                          {a.responses.length} / {total}
                        </td>
                        <td>
                          {ex ? (
                            <span style={{ color: "#a85e00", fontWeight: 600 }}>
                              {ex}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{fmtDate(a.dueAt)}</td>
                        <td>
                          <Status value={a.status} />
                          {a.status === "SIGNED" &&
                            snapshot.principal.roles.some((r) =>
                              ["publisher", "manager", "admin"].includes(r),
                            ) && (
                              <button
                                className="we-button small"
                                style={{ marginTop: 6 }}
                                onClick={() => setReopenId(a.id)}
                              >
                                Reopen
                              </button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Response mix</h2>
              <p>Selected current version</p>
            </div>
          </div>
          <div className="we-chart">
            <MixRow
              label="Okay"
              count={assignments.reduce(
                (n, a) =>
                  n + a.responses.filter((r) => r.answer === "OKAY").length,
                0,
              )}
              total={allRequired}
              color=""
            />
            <MixRow
              label="Needs explanation"
              count={exceptions}
              total={allRequired}
              color="amber"
            />
            <MixRow
              label="Not applicable"
              count={assignments.reduce(
                (n, a) =>
                  n +
                  a.responses.filter((r) => r.answer === "NOT_APPLICABLE")
                    .length,
                0,
              )}
              total={allRequired}
              color=""
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                color: "#75859a",
                fontSize: 11,
                marginTop: 20,
              }}
            >
              <Info size={14} />
              Needs explanation is a reviewer concern, not proof of a financial
              error.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
function MixRow({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  return (
    <div className="we-bar-row">
      <span>{label}</span>
      <div className="we-bar-track">
        <div
          className={`we-bar-fill ${color}`}
          style={{
            width: `${total ? Math.min(100, (count / total) * 100) : 0}%`,
          }}
        />
      </div>
      <strong style={{ color: "#2f425b", textAlign: "right" }}>{count}</strong>
    </div>
  );
}
