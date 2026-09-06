"use client";
import { useState } from "react";
import type { AppSnapshot, Evidence, Task, WorkflowRun } from "@/lib/types";
import { api } from "@/lib/client";
import { ErrorNotice, fmtDate } from "./ui";
export type TaskAction =
  | "start"
  | "submit"
  | "attest"
  | "reopen"
  | "forecast"
  | "rebind"
  | "evidence";
type Props = {
  task: Task;
  run: WorkflowRun;
  action: TaskAction;
  snapshot: AppSnapshot;
  onClose: () => void;
  onDone: () => Promise<void>;
};
export function TaskDialog({
  task,
  run,
  action,
  snapshot,
  onClose,
  onDone,
}: Props) {
  const [reason, setReason] = useState("");
  const [forecast, setForecast] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<Evidence>();
  const [evidenceId, setEvidenceId] = useState("");
  const [versionId, setVersionId] = useState(
    snapshot.packages.find((p) => p.id === task.packageId)?.currentVersionId ||
      "",
  );
  const eligible = snapshot.evidence.filter(
    (e) =>
      e.entity === task.entity &&
      ["CLEAN", ...(snapshot.localMode ? ["LOCAL_ONLY"] : [])].includes(e.scan),
  );
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("entity", task.entity);
      const result = await api<Evidence>("/api/files", {
        method: "POST",
        body,
      });
      setUploaded(result);
      if (["CLEAN", "LOCAL_ONLY"].includes(result.scan))
        setEvidenceId(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function scan() {
    if (!uploaded) return;
    setBusy(true);
    try {
      const result = await api<Evidence>(`/api/files/${uploaded.id}/scan`, {
        method: "POST",
      });
      setUploaded(result);
      if (result.scan === "CLEAN") setEvidenceId(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify(
          action === "evidence"
            ? {
                type: "attachEvidence",
                runId: run.id,
                taskId: task.id,
                evidenceId,
                expectedRevision: task.revision,
              }
            : {
                type: "taskAction",
                runId: run.id,
                taskId: task.id,
                action,
                expectedRevision: task.revision,
                reason,
                documentVersionId: versionId,
                ...(action === "forecast"
                  ? { forecastAt: new Date(forecast).toISOString() }
                  : {}),
                ...(action === "attest"
                  ? { idempotencyKey: crypto.randomUUID() }
                  : {}),
              },
        ),
      });
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const valid =
    action === "attest"
      ? confirmed
      : action === "reopen"
        ? reason.trim().length > 0
        : action === "rebind"
          ? !!versionId && !!reason.trim()
          : action === "forecast"
            ? !!forecast
            : action === "evidence"
              ? !!evidenceId
              : true;
  return (
    <div className="we-modal-backdrop">
      <section
        className="we-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        style={{
          width: "min(580px,100%)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        <div className="we-card-title">
          <div>
            <h2 id="task-dialog-title">
              {action === "evidence"
                ? "Attach evidence"
                : action[0].toUpperCase() + action.slice(1)}
              : {task.title}
            </h2>
            <p>
              {run.name} · {task.entity}
            </p>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          {error && <ErrorNotice message={error} />}
          <p>
            {task.instructions ||
              "Complete the assigned work before recording an attestation."}
          </p>
          <p className="we-table-muted">
            Baseline due {fmtDate(task.baselineDueAt, true)} ·{" "}
            {run.calendar.timezone}
          </p>
          {action === "attest" && (
            <>
              <blockquote
                style={{
                  margin: "20px 0",
                  padding: 16,
                  background: "#f0f8f5",
                  borderLeft: "3px solid #087a5d",
                }}
              >
                {task.statement}
              </blockquote>
              <p>
                {task.evidenceIds.length} evidence file(s) will be bound to this
                signature with the current prerequisite attestations.
              </p>
              <label style={{ display: "flex", gap: 10, marginTop: 15 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I confirm this statement and intend to record my signature.
              </label>
            </>
          )}
          {(action === "reopen" || action === "rebind") && (
            <label className="we-field">
              Reason
              <textarea
                className="we-textarea"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
              />
            </label>
          )}
          {action === "rebind" && (
            <label className="we-field">
              Current published version
              <select
                className="we-select"
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
              >
                <option value="">Choose version</option>
                {snapshot.versions
                  .filter(
                    (v) =>
                      v.packageId === task.packageId &&
                      snapshot.packages.some(
                        (p) => p.currentVersionId === v.id,
                      ),
                  )
                  .map((v) => (
                    <option value={v.id} key={v.id}>
                      Version {v.number}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {action === "forecast" && (
            <label className="we-field">
              Expected completion (your browser time zone)
              <input
                className="we-input"
                type="datetime-local"
                required
                value={forecast}
                onChange={(e) => setForecast(e.target.value)}
              />
            </label>
          )}
          {action === "evidence" && (
            <>
              <label className="we-field">
                Existing cleared PDF
                <select
                  className="we-select"
                  value={evidenceId}
                  onChange={(e) => setEvidenceId(e.target.value)}
                >
                  <option value="">Select evidence</option>
                  {eligible.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.filename}
                    </option>
                  ))}
                  {uploaded &&
                    ["CLEAN", "LOCAL_ONLY"].includes(uploaded.scan) && (
                      <option value={uploaded.id}>{uploaded.filename}</option>
                    )}
                </select>
              </label>
              <label className="we-field">
                Upload PDF
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={busy}
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </label>
              {uploaded && (
                <p>
                  {uploaded.filename}: {uploaded.scan}
                  {uploaded.scan === "PENDING" &&
                    snapshot.principal.roles.some((r) =>
                      ["publisher", "manager", "admin"].includes(r),
                    ) && (
                      <button
                        className="we-button small"
                        disabled={busy}
                        onClick={() => void scan()}
                      >
                        Check scan
                      </button>
                    )}
                </p>
              )}
              <p className="we-table-muted">
                Production uploads remain unavailable until the malware scanner
                clears them.
              </p>
            </>
          )}
        </div>
        <div className="we-modal-footer">
          <button className="we-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="we-button primary"
            disabled={busy || !valid}
            onClick={() => void submit()}
          >
            {busy
              ? "Saving…"
              : action === "attest"
                ? "Confirm attestation"
                : "Confirm"}
          </button>
        </div>
      </section>
    </div>
  );
}
