"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { AppSnapshot, Assignment } from "@/lib/types";
import type { IssueCategory, ReviewIssue } from "@/lib/issues-types";
import { api } from "@/lib/client";
import { EmptyState, ErrorNotice, fmtDate, Status } from "./ui";

type Props = {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
  initialIssueId?: string;
  initialAssignmentId?: string;
};

const categories: IssueCategory[] = [
  "DATA",
  "METHODOLOGY",
  "DISCLOSURE",
  "PROCESS",
  "OTHER",
];

function unwrap<T>(value: T | { result?: T }): T {
  return value && typeof value === "object" && "result" in value
    ? ((value as { result?: T }).result as T)
    : (value as T);
}

function assignmentLabel(snapshot: AppSnapshot, assignment: Assignment) {
  const version = snapshot.versions.find(
    (item) => item.id === assignment.versionId,
  );
  const section = version?.sections.find(
    (item) => item.id === assignment.sectionId,
  );
  const pkg =
    version && snapshot.packages.find((item) => item.id === version.packageId);
  const reviewer = snapshot.users.find(
    (item) => item.id === assignment.reviewerId,
  );
  return `${pkg?.title || "Package"} · v${version?.number || "?"} · ${section?.name || assignment.sectionId} · ${reviewer?.name || assignment.reviewerId}`;
}

export function IssuesPanel({
  snapshot,
  onRefresh,
  setToast,
  initialIssueId,
  initialAssignmentId,
}: Props) {
  const issues = snapshot.issues || [];
  const initialAssignment =
    snapshot.assignments.find(
      (assignment) => assignment.id === initialAssignmentId,
    ) || snapshot.assignments[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialIssueId,
  );
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [comment, setComment] = useState("");
  const [explanation, setExplanation] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newIssue, setNewIssue] = useState({
    assignmentId: initialAssignmentId || snapshot.assignments[0]?.id || "",
    ownerId: initialAssignment?.reviewerId || "",
    metricId: "",
    category: "DATA" as IssueCategory,
    title: "",
    description: "",
  });
  const visibleIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (statusFilter === "ALL" || issue.status === statusFilter) &&
          (categoryFilter === "ALL" || issue.category === categoryFilter),
      ),
    [issues, statusFilter, categoryFilter],
  );
  const selected =
    issues.find((issue) => issue.id === selectedId) ||
    (initialIssueId
      ? undefined
      : initialAssignmentId
        ? visibleIssues.find(
            (issue) => issue.assignmentId === initialAssignmentId,
          )
        : visibleIssues[0]);
  const selectedAssignment =
    selected &&
    snapshot.assignments.find((item) => item.id === selected.assignmentId);
  const canAccept =
    !!selectedAssignment &&
    selectedAssignment.reviewerId === snapshot.principal.id &&
    snapshot.principal.roles.includes("reviewer");
  const canManage = snapshot.principal.roles.some(
    (role) => role === "publisher" || role === "manager",
  );

  const command = async (body: Record<string, unknown>, success: string) => {
    setSaving(true);
    setError("");
    try {
      const result = unwrap(
        await api<ReviewIssue | { result?: ReviewIssue }>("/api/commands", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      if (result && typeof result === "object" && "id" in result)
        setSelectedId((result as ReviewIssue).id);
      await onRefresh();
      setToast(success);
      return result as ReviewIssue;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update issue.");
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!newIssue.assignmentId) return;
    const created = await command(
      {
        type: "createIssue",
        ...newIssue,
        ...(newIssue.metricId ? {} : { metricId: undefined }),
      },
      "Issue created",
    );
    if (created) {
      setShowCreate(false);
      setNewIssue((value) => ({
        ...value,
        title: "",
        description: "",
        metricId: "",
      }));
    }
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    const result = await command(
      {
        type: "commentIssue",
        issueId: selected.id,
        body: comment,
        expectedRevision: selected.revision,
      },
      "Comment added",
    );
    if (result) setComment("");
  };

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !explanation.trim()) return;
    const result = await command(
      {
        type: "proposeIssueResolution",
        issueId: selected.id,
        explanation,
        expectedRevision: selected.revision,
      },
      "Resolution proposed",
    );
    if (result) setExplanation("");
  };

  const reopen = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    const result = await command(
      {
        type: "reopenIssue",
        issueId: selected.id,
        reason,
        expectedRevision: selected.revision,
      },
      "Issue reopened",
    );
    if (result) setReason("");
  };

  const metrics = newIssue.assignmentId
    ? snapshot.versions
        .find(
          (version) =>
            version.id ===
            snapshot.assignments.find(
              (assignment) => assignment.id === newIssue.assignmentId,
            )?.versionId,
        )
        ?.sections.find(
          (section) =>
            section.id ===
            snapshot.assignments.find(
              (assignment) => assignment.id === newIssue.assignmentId,
            )?.sectionId,
        )?.metrics || []
    : [];
  const selectedCreateAssignment = snapshot.assignments.find(
    (assignment) => assignment.id === newIssue.assignmentId,
  );
  const selectedCreateEntity = selectedCreateAssignment?.entity;
  const issueOwners = snapshot.users.filter(
    (user) =>
      user.active &&
      !!selectedCreateEntity &&
      (user.entities.includes("*") ||
        user.entities.includes(selectedCreateEntity)),
  );
  const assignmentIssues = initialAssignmentId
    ? visibleIssues.filter(
        (issue) => issue.assignmentId === initialAssignmentId,
      )
    : visibleIssues;
  const displayedSelected =
    selected || (initialAssignmentId ? assignmentIssues[0] : undefined);

  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>Exceptions</h1>
          <p>Track review issues, resolutions and decision history</p>
        </div>
        <button
          className="we-button primary"
          onClick={() => setShowCreate((value) => !value)}
        >
          <Plus size={16} /> Raise issue
        </button>
      </div>
      {error && <ErrorNotice message={error} />}
      {showCreate && (
        <section className="we-card" style={{ marginBottom: 18 }}>
          <div className="we-card-title">
            <div>
              <h2>Raise an issue</h2>
              <p>Issues stay linked to this assignment and document version.</p>
            </div>
            <AlertTriangle size={18} color="#aa6200" />
          </div>
          <form
            onSubmit={create}
            style={{ padding: "4px 18px 18px", display: "grid", gap: 12 }}
          >
            <label className="we-label">
              Review assignment
              <select
                className="we-select"
                value={newIssue.assignmentId}
                onChange={(event) => {
                  const assignmentId = event.target.value;
                  const assignment = snapshot.assignments.find(
                    (item) => item.id === assignmentId,
                  );
                  setNewIssue({
                    ...newIssue,
                    assignmentId,
                    ownerId: assignment?.reviewerId || "",
                    metricId: "",
                  });
                }}
                required
              >
                <option value="">Select assignment</option>
                {snapshot.assignments.map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>
                    {assignmentLabel(snapshot, assignment)}
                  </option>
                ))}
              </select>
            </label>
            <div className="we-form-grid">
              <label className="we-label">
                Category
                <select
                  className="we-select"
                  value={newIssue.category}
                  onChange={(event) =>
                    setNewIssue({
                      ...newIssue,
                      category: event.target.value as IssueCategory,
                    })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label className="we-label">
                Metric (optional)
                <select
                  className="we-select"
                  value={newIssue.metricId}
                  onChange={(event) =>
                    setNewIssue({ ...newIssue, metricId: event.target.value })
                  }
                >
                  <option value="">Section level</option>
                  {metrics.map((metric) => (
                    <option key={metric.id} value={metric.id}>
                      {metric.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="we-label">
              Issue owner
              <select
                className="we-select"
                value={
                  newIssue.ownerId || selectedCreateAssignment?.reviewerId || ""
                }
                onChange={(event) =>
                  setNewIssue({ ...newIssue, ownerId: event.target.value })
                }
                required
              >
                <option value="">Select owner</option>
                {issueOwners.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.roles[0] || "user"}
                  </option>
                ))}
              </select>
              <span className="we-table-muted">
                The owner can discuss and propose a resolution; the assigned
                reviewer accepts it.
              </span>
            </label>
            <label className="we-label">
              Title
              <input
                className="we-input"
                value={newIssue.title}
                onChange={(event) =>
                  setNewIssue({ ...newIssue, title: event.target.value })
                }
                maxLength={200}
                required
              />
            </label>
            <label className="we-label">
              Description
              <textarea
                className="we-textarea"
                value={newIssue.description}
                onChange={(event) =>
                  setNewIssue({ ...newIssue, description: event.target.value })
                }
                maxLength={5000}
                rows={3}
                required
              />
            </label>
            <div>
              <button className="we-button primary" disabled={saving}>
                Create issue
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="we-filterbar">
        <select
          className="we-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="RESOLUTION_PROPOSED">Resolution proposed</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <select
          className="we-select"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="ALL">All categories</option>
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 18,
          alignItems: "start",
        }}
      >
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Issue register</h2>
              <p>
                {visibleIssues.length} visible issue
                {visibleIssues.length === 1 ? "" : "s"}
              </p>
            </div>
            <AlertTriangle size={18} color="#aa6200" />
          </div>
          {visibleIssues.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={28} />}
              title="No issues found"
              detail="Raise an issue when a review needs tracked resolution."
            />
          ) : (
            <div>
              {visibleIssues.map((issue) => (
                <button
                  type="button"
                  key={issue.id}
                  onClick={() => setSelectedId(issue.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 18px",
                    border: 0,
                    borderTop: "1px solid #e8efeb",
                    background:
                      selected?.id === issue.id ? "#f1f8f5" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 5,
                    }}
                  >
                    <strong style={{ flex: 1 }}>{issue.title}</strong>
                    <Status value={issue.status} />
                  </div>
                  <div className="we-table-muted">
                    {issue.category} · {fmtDate(issue.createdAt)} ·{" "}
                    {issue.entity}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        {displayedSelected ? (
          <section className="we-card">
            <div className="we-card-title">
              <div>
                <h2>{displayedSelected.title}</h2>
                <p>
                  {displayedSelected.category} · {displayedSelected.entity} ·
                  owned by{" "}
                  {snapshot.users.find(
                    (user) => user.id === displayedSelected.ownerId,
                  )?.name || displayedSelected.ownerId}
                </p>
              </div>
              <Status value={displayedSelected.status} />
            </div>
            <div style={{ padding: "4px 18px 18px" }}>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {displayedSelected.description}
              </p>
              <div className="we-table-muted">
                {assignmentLabel(
                  snapshot,
                  snapshot.assignments.find(
                    (assignment) =>
                      assignment.id === displayedSelected.assignmentId,
                  ) ||
                    ({
                      id: displayedSelected.assignmentId,
                      versionId: displayedSelected.versionId,
                      sectionId: displayedSelected.sectionId,
                      reviewerId: displayedSelected.ownerId,
                      entity: displayedSelected.entity,
                    } as Assignment),
                )}
              </div>
              {displayedSelected.linkedFromIssueId && (
                <div className="we-table-muted" style={{ marginTop: 6 }}>
                  Linked from prior issue {displayedSelected.linkedFromIssueId}
                </div>
              )}
              {displayedSelected.resolution && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 12,
                    background: "#f1f8f5",
                    borderRadius: 6,
                  }}
                >
                  <strong>Resolution explanation</strong>
                  <p style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>
                    {displayedSelected.resolution.explanation}
                  </p>
                  <span className="we-table-muted">
                    Proposed by{" "}
                    {snapshot.users.find(
                      (user) =>
                        user.id === displayedSelected.resolution?.proposedBy,
                    )?.name || displayedSelected.resolution.proposedBy}
                    {displayedSelected.resolution.acceptedAt
                      ? ` · accepted by ${snapshot.users.find((user) => user.id === displayedSelected.resolution?.acceptedBy)?.name || displayedSelected.resolution.acceptedBy}`
                      : ""}
                  </span>
                </div>
              )}
              <div style={{ marginTop: 18 }}>
                <strong>Discussion and history</strong>
                {displayedSelected.events
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: "11px 0",
                        borderBottom: "1px solid #e8efeb",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <MessageSquare size={14} color="#168f70" />
                        <strong>{item.type.replaceAll("_", " ")}</strong>
                        <span className="we-table-muted">
                          {snapshot.users.find((user) => user.id === item.by)
                            ?.name || item.by}{" "}
                          · {fmtDate(item.at, true)}
                        </span>
                      </div>
                      {(item.body || item.reason) && (
                        <div
                          style={{
                            margin: "5px 0 0 22px",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {item.body || item.reason}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
              {displayedSelected.status !== "RESOLVED" && (
                <form
                  onSubmit={submitComment}
                  style={{
                    marginTop: 16,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <input
                    className="we-input"
                    style={{ flex: "1 1 220px" }}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a comment to the issue"
                    maxLength={5000}
                  />
                  <button
                    className="we-button"
                    disabled={saving || !comment.trim()}
                  >
                    Comment
                  </button>
                </form>
              )}
              {displayedSelected.status === "OPEN" &&
                (canManage || canAccept) && (
                  <form
                    onSubmit={propose}
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <input
                      className="we-input"
                      style={{ flex: "1 1 220px" }}
                      value={explanation}
                      onChange={(event) => setExplanation(event.target.value)}
                      placeholder="Explain the proposed resolution"
                      maxLength={5000}
                    />
                    <button
                      className="we-button"
                      disabled={saving || !explanation.trim()}
                    >
                      Propose resolution
                    </button>
                  </form>
                )}
              {displayedSelected.status === "RESOLUTION_PROPOSED" &&
                canAccept && (
                  <button
                    className="we-button primary"
                    style={{ marginTop: 12 }}
                    disabled={saving}
                    onClick={() =>
                      void command(
                        {
                          type: "acceptIssueResolution",
                          issueId: displayedSelected.id,
                          expectedRevision: displayedSelected.revision,
                        },
                        "Resolution accepted",
                      )
                    }
                  >
                    Accept resolution
                  </button>
                )}
              {displayedSelected.status === "RESOLVED" &&
                (canManage || canAccept) && (
                  <form
                    onSubmit={reopen}
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <input
                      className="we-input"
                      style={{ flex: "1 1 220px" }}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Reason to reopen"
                      maxLength={2000}
                    />
                    <button
                      className="we-button"
                      disabled={saving || !reason.trim()}
                    >
                      <RotateCcw size={14} /> Reopen
                    </button>
                  </form>
                )}
            </div>
          </section>
        ) : (
          <section className="we-card">
            <EmptyState
              title={initialIssueId ? "Issue unavailable" : "Select an issue"}
              detail={
                initialIssueId
                  ? "This linked issue is unavailable or outside your current access."
                  : undefined
              }
            />
          </section>
        )}
      </div>
    </div>
  );
}
