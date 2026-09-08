"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  MessageSquare,
  Minus,
  Plus,
  Send,
} from "lucide-react";
import type {
  Answer,
  AppSnapshot,
  Assignment,
  DocumentVersion,
  Package,
  Response,
  Comment,
} from "@/lib/types";
import { PdfViewer } from "./PdfViewer";
import { api } from "@/lib/client";
import {
  EmptyState,
  ErrorNotice,
  fmtDate,
  initials,
  responseLabel,
  Status,
} from "./ui";

type Props = {
  initialAssignmentId?: string;
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
};
type Draft = { answer?: Answer; comment?: string };

const statement = (
  pkg: Package,
  version: DocumentVersion,
  sectionName: string,
) =>
  `I have reviewed the selected metrics for ${sectionName} in ${pkg.title}, ${pkg.period}, version ${version.number}. My responses and comments reflect my review, and I have identified any outstanding concerns.`;

function unwrap<T>(payload: T | { result?: T }): T {
  if (payload && typeof payload === "object" && "result" in payload)
    return (payload as { result?: T }).result as T;
  return payload as T;
}

function PdfPane({
  version,
  pageCount,
  requestedPage,
}: {
  version: DocumentVersion;
  pageCount: number;
  requestedPage?: number;
}) {
  const [page, setPage] = useState(
    Math.max(1, Math.min(pageCount || 1, requestedPage || 1)),
  );
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    if (requestedPage)
      setPage(Math.max(1, Math.min(pageCount || 1, requestedPage)));
  }, [requestedPage, pageCount]);
  return (
    <section className="we-card we-pdf">
      <div className="we-pdf-toolbar">
        <FileText size={17} aria-hidden="true" />
        <span className="we-pdf-divider" />
        <button
          className="we-icon-btn"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="we-icon-btn"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          <ChevronRight size={18} />
        </button>
        <span className="we-pdf-page-label">
          Page {page} of {pageCount}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="we-icon-btn"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(60, z - 10))}
        >
          <Minus size={16} />
        </button>
        <span className="we-zoom-label">{zoom}%</span>
        <button
          className="we-icon-btn"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(160, z + 10))}
        >
          <Plus size={16} />
        </button>
        <button
          className="we-icon-btn"
          title="Open document"
          aria-label="Open document"
          onClick={() => window.open(`/api/files/${version.fileId}`, "_blank")}
        >
          <Maximize2 size={16} />
        </button>
        <button
          className="we-icon-btn"
          title="Download"
          aria-label="Download document"
          onClick={() =>
            window.open(`/api/files/${version.fileId}?download=1`, "_blank")
          }
        >
          <Download size={16} />
        </button>
      </div>
      <div className="we-pdf-page">
        <PdfViewer fileId={version.fileId} page={page} zoom={zoom} />
      </div>
    </section>
  );
}

function ResponseButton({
  kind,
  selected,
  onClick,
}: {
  kind: Answer;
  selected: boolean;
  onClick: () => void;
}) {
  const cls =
    kind === "OKAY" ? "okay" : kind === "NEEDS_EXPLANATION" ? "needs" : "na";
  return (
    <button
      type="button"
      className={`we-response-btn ${selected ? `selected ${cls}` : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <i className="we-radio" />
      {kind === "NOT_APPLICABLE" ? "N/A" : responseLabel(kind)}
    </button>
  );
}

function MetricRow({
  metric,
  response,
  draft,
  onAnswer,
  onComment,
  onNavigate,
}: {
  metric: DocumentVersion["sections"][number]["metrics"][number];
  response?: Response;
  draft?: Draft;
  onAnswer: (answer: Answer, comment: string) => void;
  onComment: (comment: string) => void;
  onNavigate: () => void;
}) {
  const answer = draft?.answer || response?.answer;
  const comment = draft?.comment ?? response?.comment ?? "";
  const [showOptional, setShowOptional] = useState(false);
  const requiresComment =
    answer === "NEEDS_EXPLANATION" || answer === "NOT_APPLICABLE";
  return (
    <div className="we-metric">
      <div className="we-metric-top">
        <button
          type="button"
          className="we-metric-name we-metric-link"
          onClick={onNavigate}
          title="Navigate to mapped page"
        >
          {metric.label}
          {metric.required && (
            <span style={{ color: "#aa6200", marginLeft: 4 }}>*</span>
          )}
        </button>
        <div className="we-response-grid">
          <ResponseButton
            kind="OKAY"
            selected={answer === "OKAY"}
            onClick={() => onAnswer("OKAY", comment)}
          />
          <ResponseButton
            kind="NEEDS_EXPLANATION"
            selected={answer === "NEEDS_EXPLANATION"}
            onClick={() => onAnswer("NEEDS_EXPLANATION", comment)}
          />
          <ResponseButton
            kind="NOT_APPLICABLE"
            selected={answer === "NOT_APPLICABLE"}
            onClick={() => onAnswer("NOT_APPLICABLE", comment)}
          />
        </div>
      </div>
      {answer === "OKAY" && !comment && !showOptional && (
        <button
          className="we-button small"
          style={{ marginTop: 8 }}
          onClick={() => setShowOptional(true)}
        >
          Add optional comment
        </button>
      )}
      {(requiresComment || comment || showOptional) && (
        <div className="we-comment">
          <label className="we-label">
            Comment {requiresComment ? "(required)" : "(optional)"}
          </label>
          <textarea
            className="we-textarea"
            maxLength={1000}
            value={comment}
            placeholder="Add context for your assessment..."
            onChange={(e) => onComment(e.target.value)}
            onBlur={(e) => onComment(e.currentTarget.value)}
          />
          <div className="we-counter">{comment.length}/1000</div>
        </div>
      )}
    </div>
  );
}

function SourceLabel({
  comment,
  snapshot,
}: {
  comment: Comment;
  snapshot: AppSnapshot;
}) {
  const source = comment.sourceVersionId
    ? snapshot.versions.find((v) => v.id === comment.sourceVersionId)
    : undefined;
  return (
    <span className="we-table-muted">
      {comment.sourceVersionId
        ? `Carried from version ${source?.number ?? "prior"} · original ${fmtDate(comment.originalAt || comment.at, true)}`
        : `Current version · ${fmtDate(comment.at, true)}`}
    </span>
  );
}

export function ReviewPanel({
  snapshot,
  onRefresh,
  setToast,
  initialAssignmentId,
}: Props) {
  const me = snapshot.principal;
  const published = snapshot.versions.filter((v) => v.status === "PUBLISHED");
  const myAssignments = useMemo(
    () =>
      snapshot.assignments.filter(
        (a) =>
          a.reviewerId === me.id &&
          !!snapshot.versions.find((v) => v.id === a.versionId),
      ),
    [snapshot.assignments, snapshot.versions, me.id],
  );
  const initialCurrent = published.find(
    (v) =>
      snapshot.packages.some((p) => p.currentVersionId === v.id) &&
      myAssignments.some((a) => a.versionId === v.id),
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialAssignmentId ||
      (initialCurrent
        ? myAssignments.find((a) => a.versionId === initialCurrent.id)?.id
        : undefined),
  );
  const assignment =
    myAssignments.find((a) => a.id === selectedId) ||
    myAssignments.find((a) => a.versionId === initialCurrent?.id) ||
    myAssignments[0];
  const current = assignment
    ? snapshot.versions.find((v) => v.id === assignment.versionId)
    : undefined;
  const pkg = current
    ? snapshot.packages.find((p) => p.id === current.packageId)
    : undefined;
  const section =
    current && assignment
      ? current.sections.find((s) => s.id === assignment.sectionId)
      : undefined;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [requestedPage, setRequestedPage] = useState<number>();
  const [generalComment, setGeneralComment] = useState("");
  const revisionRef = useRef(assignment?.revision ?? 0);
  const assignmentRef = useRef(assignment?.id);
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    if (assignmentRef.current !== assignment?.id) {
      assignmentRef.current = assignment?.id;
      revisionRef.current = assignment?.revision ?? 0;
      setDrafts({});
      setRequestedPage(section?.pages[0] || 1);
    } else if (assignment) revisionRef.current = assignment.revision;
  }, [assignment?.id, assignment?.revision, section?.pages]);
  useEffect(() => {
    (window as unknown as { workevaHasUnsaved?: boolean }).workevaHasUnsaved =
      dirty;
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "You have unsaved review responses.";
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
      (window as unknown as { workevaHasUnsaved?: boolean }).workevaHasUnsaved =
        false;
    };
  }, [dirty]);

  const persistDrafts = async () => {
    if (!assignment || !section || !dirty) return revisionRef.current;
    const pending = section.metrics
      .map((metric) => ({
        metric,
        draft: drafts[metric.id],
        response: assignment.responses.find((r) => r.metricId === metric.id),
      }))
      .filter(
        (item) => item.draft && (item.draft.answer || item.response?.answer),
      );
    for (const item of pending) {
      const answer = item.draft!.answer || item.response!.answer;
      const comment = item.draft!.comment ?? item.response?.comment ?? "";
      const payload = await api<Assignment | { result?: Assignment }>(
        "/api/commands",
        {
          method: "POST",
          body: JSON.stringify({
            type: "saveResponse",
            assignmentId: assignment.id,
            metricId: item.metric.id,
            answer,
            comment,
            expectedRevision: revisionRef.current,
          }),
        },
      );
      const saved = unwrap(payload);
      if (saved && typeof saved === "object" && "revision" in saved)
        revisionRef.current = (saved as Assignment).revision;
    }
    await onRefresh();
    setDrafts({});
    return revisionRef.current;
  };
  const runMutation = async (
    operation: () => Promise<void>,
    success: string,
  ) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await operation();
      setToast(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save this review.");
    } finally {
      setSaving(false);
    }
  };
  const saveDraft = () =>
    runMutation(async () => {
      if (!dirty) {
        setToast("No unsaved changes");
        return;
      }
      await persistDrafts();
    }, "Draft saved");
  const submit = () =>
    runMutation(async () => {
      const revision = await persistDrafts();
      const payload = await api<Assignment | { result?: Assignment }>(
        "/api/commands",
        {
          method: "POST",
          body: JSON.stringify({
            type: "submitReview",
            assignmentId: assignment!.id,
            expectedRevision: revision,
          }),
        },
      );
      const result = unwrap(payload);
      revisionRef.current = (result as Assignment).revision;
      await onRefresh();
    }, "Review submitted");
  const sign = () =>
    runMutation(async () => {
      const revision = await persistDrafts();
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "signReview",
          assignmentId: assignment!.id,
          expectedRevision: revision,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      await onRefresh();
    }, "Review signed successfully");
  const selectAssignment = (id: string) => {
    if (
      dirty &&
      !window.confirm(
        "You have unsaved responses. Change sections and discard them?",
      )
    )
      return;
    setSelectedId(id);
    setDrafts({});
    setError("");
  };

  if (!pkg || !current || !assignment || !section)
    return (
      <div className="we-content">
        <div className="we-page-head">
          <div>
            <h1>My reviews</h1>
            <p>Assigned financial document reviews</p>
          </div>
        </div>
        <div className="we-card">
          <EmptyState
            icon={<FileText size={30} />}
            title="No assigned reviews"
            detail="There are no active document reviews assigned to this persona."
          />
        </div>
      </div>
    );
  const answered = section.metrics
    .filter((m) => m.required)
    .filter(
      (m) =>
        !!(
          drafts[m.id]?.answer ||
          assignment.responses.find((r) => r.metricId === m.id)?.answer
        ),
    ).length;
  const requiredCount = section.metrics.filter((m) => m.required).length;
  const comments = snapshot.comments.filter(
    (c) => c.assignmentId === assignment.id,
  );
  const priorResponses = assignment.history;
  const exactStatement = statement(pkg, current, section.name);
  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>My reviews</h1>
          <p>
            {pkg.title} · {pkg.period} · Version {current.number} · Due{" "}
            {fmtDate(assignment.dueAt)}
          </p>
        </div>
        <div className="we-page-actions">
          {myAssignments.length > 1 && (
            <select
              className="we-select"
              aria-label="Assigned section"
              value={assignment.id}
              onChange={(e) => selectAssignment(e.target.value)}
            >
              <option value="">Select assigned section</option>
              {myAssignments.map((a) => {
                const v = snapshot.versions.find((x) => x.id === a.versionId);
                const s = v?.sections.find((x) => x.id === a.sectionId);
                return (
                  <option key={a.id} value={a.id}>
                    {s?.name || a.sectionId} · v{v?.number}
                  </option>
                );
              })}
            </select>
          )}
          <Status value={assignment.status} />
        </div>
      </div>
      {current.status === "SUPERSEDED" && (
        <div className="we-alert" style={{ marginBottom: 16 }}>
          <FileText size={18} />
          <div>
            <strong>Superseded version</strong>
            <span>
              You are viewing version {current.number}. Fresh decisions are
              required on the current published version.
            </span>
          </div>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      {(saving || dirty) && (
        <div className={`we-save-state ${dirty ? "pending" : ""}`}>
          {saving
            ? "Saving your latest changes…"
            : "Unsaved responses · save before leaving or signing"}
        </div>
      )}
      <div className="we-review-layout">
        <PdfPane
          version={current}
          pageCount={current.pageCount || 1}
          requestedPage={requestedPage || section.pages[0] || 1}
        />
        <section className="we-card we-checklist">
          <div className="we-checklist-head">
            <div>
              <h2>Review checklist</h2>
              <div style={{ color: "#6f8096", fontSize: 12, marginTop: 4 }}>
                {section.name} · {section.entity} · mapped page
                {section.pages.length === 1 ? "" : "s"}{" "}
                {section.pages.join(", ")}
              </div>
            </div>
            <div className="we-guidance">
              Choose one response per required metric. Track issues through
              resolution and reviewer acceptance in{" "}
              <a
                href={`/issues?assignmentId=${encodeURIComponent(assignment.id)}`}
              >
                Exceptions
              </a>
              .
            </div>
            <div className="we-checklist-meta">
              <span>Metric</span>
              <strong>
                {answered}/{requiredCount} answered
              </strong>
            </div>
          </div>
          <div className="we-metric-list">
            <fieldset
              disabled={
                assignment.status === "SIGNED" ||
                pkg.currentVersionId !== current.id
              }
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              {section.metrics.map((metric) => {
                const response = assignment.responses.find(
                  (r) => r.metricId === metric.id,
                );
                return (
                  <MetricRow
                    key={metric.id}
                    metric={metric}
                    response={response}
                    draft={drafts[metric.id]}
                    onNavigate={() => setRequestedPage(section.pages[0] || 1)}
                    onAnswer={(answer, comment) =>
                      setDrafts((d) => ({
                        ...d,
                        [metric.id]: { answer, comment },
                      }))
                    }
                    onComment={(comment) =>
                      setDrafts((d) => ({
                        ...d,
                        [metric.id]: { ...(d[metric.id] || {}), comment },
                      }))
                    }
                  />
                );
              })}
            </fieldset>
            <div className="we-history">
              <div className="we-history-title">
                <MessageSquare size={15} /> Prior comments and response history
              </div>
              {comments.length === 0 && priorResponses.length === 0 ? (
                <span className="we-table-muted">
                  No prior context for this assignment.
                </span>
              ) : (
                <>
                  {comments.map((comment) => (
                    <div className="we-history-item" key={comment.id}>
                      <strong>
                        {snapshot.users.find((u) => u.id === comment.by)
                          ?.name || comment.by}
                      </strong>
                      <span>{comment.body}</span>
                      <SourceLabel comment={comment} snapshot={snapshot} />
                    </div>
                  ))}
                  {priorResponses.map((response, index) => (
                    <div
                      className="we-history-item"
                      key={`${response.metricId}-${response.at}-${index}`}
                    >
                      <strong>
                        {section.metrics.find((m) => m.id === response.metricId)
                          ?.label || response.metricId}{" "}
                        · {responseLabel(response.answer)}
                      </strong>
                      <span>{response.comment || "No comment"}</span>
                      <span className="we-table-muted">
                        Previous response · {fmtDate(response.at, true)} ·{" "}
                        {snapshot.users.find((u) => u.id === response.by)
                          ?.name || response.by}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="we-general-comment">
              <label className="we-label">
                General comments{" "}
                <span style={{ fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                className="we-textarea"
                placeholder="Add any additional comments for this review…"
                maxLength={1000}
                value={generalComment}
                onChange={(e) => setGeneralComment(e.target.value)}
              />
              <div className="we-counter">{generalComment.length}/1000</div>
              <button
                className="we-button small"
                style={{ marginTop: 9 }}
                disabled={!generalComment.trim() || saving}
                onClick={() =>
                  runMutation(async () => {
                    await api("/api/commands", {
                      method: "POST",
                      body: JSON.stringify({
                        type: "addComment",
                        assignmentId: assignment.id,
                        body: generalComment.trim(),
                      }),
                    });
                    setGeneralComment("");
                    await onRefresh();
                  }, "Comment added")
                }
              >
                <MessageSquare size={14} /> Add comment
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="we-review-footer">
        <div className="we-statement">
          <strong>Attestation statement</strong>
          <br />
          {exactStatement}
        </div>
        <div className="we-footer-actions">
          <button
            className="we-button"
            onClick={saveDraft}
            disabled={saving || assignment.status === "SIGNED"}
          >
            Save draft
          </button>
          {assignment.status !== "SIGNED" &&
            pkg.currentVersionId === current.id && (
              <>
                <button
                  className="we-button"
                  onClick={submit}
                  disabled={saving || answered < requiredCount}
                >
                  <Send size={15} /> Submit review
                </button>
                <button
                  className="we-button primary"
                  onClick={sign}
                  disabled={saving || answered < requiredCount}
                >
                  Sign off
                </button>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
