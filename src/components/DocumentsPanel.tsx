"use client";

import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileArchive,
  FileText,
  Loader2,
  Plus,
  Save,
  Settings2,
  UploadCloud,
} from "lucide-react";
import type {
  AppSnapshot,
  DocumentVersion,
  Evidence,
  Package,
  Section,
} from "@/lib/types";
import { api } from "@/lib/client";
import { ErrorNotice, EmptyState, fmtDate, Status } from "./ui";

type Props = {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
};
function unwrap<T>(payload: T | { result?: T }): T {
  return payload && typeof payload === "object" && "result" in payload
    ? ((payload as { result?: T }).result as T)
    : (payload as T);
}
type PendingUpload = { evidence: Evidence; packageSnapshot: Package };

export function DocumentsPanel({ snapshot, onRefresh, setToast }: Props) {
  const [selectedId, setSelectedId] = useState(snapshot.packages[0]?.id || "");
  const [creatingPackage, setCreatingPackage] = useState(
    snapshot.packages.length === 0,
  );
  const selected = creatingPackage
    ? undefined
    : snapshot.packages.find((p) => p.id === selectedId) ||
      snapshot.packages[0];
  const versions = useMemo(
    () =>
      snapshot.versions
        .filter((v) => v.packageId === selected?.id)
        .sort((a, b) => b.number - a.number),
    [snapshot.versions, selected?.id],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    title: "Business Line Review",
    period: new Date().toISOString().slice(0, 7),
    entity: snapshot.principal.entities.find((e) => e !== "*") || "BANK",
    dueAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16),
  });
  const [mappingVersionId, setMappingVersionId] = useState<string>();
  const [mappingSections, setMappingSections] = useState<Section[]>([]);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload>();
  const mappingVersion = mappingVersionId
    ? snapshot.versions.find((v) => v.id === mappingVersionId)
    : undefined;

  const beginNewPackage = () => {
    setCreatingPackage(true);
    setSelectedId("");
    setError("");
    setForm((f) => ({
      ...f,
      title: "Business Line Review",
      period: new Date().toISOString().slice(0, 7),
      entity: snapshot.principal.entities.find((e) => e !== "*") || f.entity,
    }));
  };
  const addDraftVersion = async (pkg: Package, evidence: Evidence) => {
    const previous = pkg.currentVersionId
      ? snapshot.versions.find((v) => v.id === pkg!.currentVersionId)
      : undefined;
    const sections: Section[] = previous?.sections.map((s) => ({
      ...s,
      pages: [...s.pages],
      reviewerIds: [...s.reviewerIds],
      metrics: s.metrics.map((m) => ({ ...m })),
    })) || [
      {
        id: `section-${Date.now()}`,
        name: "Business line review",
        entity: pkg.entity,
        pages: [1],
        reviewerIds: [snapshot.principal.id],
        metrics: [
          "Loans",
          "Deposits",
          "Net interest income",
          "Salary expense",
          "Other operating expense",
        ].map((label) => ({
          id: label.toLowerCase().replaceAll(" ", "-"),
          label,
          required: true,
        })),
      },
    ];
    await api("/api/commands", {
      method: "POST",
      body: JSON.stringify({
        type: "addVersion",
        packageId: pkg.id,
        fileId: evidence.id,
        producedAt: new Date().toISOString(),
        sections,
        expectedRevision: pkg.revision,
      }),
    });
  };
  const checkPendingScan = async () => {
    if (!pendingUpload) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/files/${encodeURIComponent(pendingUpload.evidence.id)}/scan`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || "Unable to check file scan.");
      const checked = unwrap<Evidence>(payload);
      if (checked.scan === "PENDING") {
        setPendingUpload({ ...pendingUpload, evidence: checked });
        setToast("Scan is still pending");
        return;
      }
      if (checked.scan === "REJECTED")
        throw new Error("The file scan rejected this document.");
      await addDraftVersion(pendingUpload.packageSnapshot, checked);
      setPendingUpload(undefined);
      await onRefresh();
      setToast("Scan passed; draft version created");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to check file scan.");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      let pkg = selected;
      if (!pkg) {
        const createdPayload = await api<Package | { result?: Package }>(
          "/api/commands",
          {
            method: "POST",
            body: JSON.stringify({
              type: "createPackage",
              ...form,
              dueAt: new Date(form.dueAt).toISOString(),
            }),
          },
        );
        pkg = unwrap(createdPayload);
        setSelectedId(pkg.id);
        setCreatingPackage(false);
        await onRefresh();
      }
      // The selected package is authoritative. The form entity is only used while creating it.
      const body = new FormData();
      body.append("file", file);
      body.append("entity", pkg.entity);
      const identity =
        typeof window !== "undefined"
          ? localStorage.getItem("workeva-user") || ""
          : "";
      const result = await fetch("/api/files", {
        method: "POST",
        body,
        headers: identity ? { "x-workeva-user": identity } : undefined,
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(payload.error || "File upload failed.");
      const evidence = payload.result || payload;
      if (evidence.scan === "PENDING") {
        setPendingUpload({ evidence, packageSnapshot: pkg });
        setToast("Upload received; scan pending");
        return;
      }
      if (evidence.scan === "REJECTED")
        throw new Error("The file scan rejected this document.");
      await addDraftVersion(pkg, evidence);
      await onRefresh();
      setToast("Draft version uploaded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload document.");
    } finally {
      setBusy(false);
    }
  };
  const publish = async (version: DocumentVersion) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "publishVersion",
          versionId: version.id,
          expectedRevision: version.revision,
        }),
      });
      await onRefresh();
      setToast(`Version ${version.number} published`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to publish version.");
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    if (!selected?.currentVersionId) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "finalizePackage",
          packageId: selected.id,
          expectedRevision: selected.revision,
        }),
      });
      await onRefresh();
      setToast("Final package recorded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to finalize package.");
    } finally {
      setBusy(false);
    }
  };
  const openMapping = (version: DocumentVersion) => {
    setMappingVersionId(version.id);
    setMappingSections(
      version.sections.map((s) => ({
        ...s,
        pages: [...s.pages],
        reviewerIds: [...s.reviewerIds],
        metrics: s.metrics.map((m) => ({ ...m })),
      })),
    );
  };
  const saveMapping = async () => {
    if (!mappingVersion) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "updateVersion",
          versionId: mappingVersion.id,
          sections: mappingSections,
          expectedRevision: mappingVersion.revision,
        }),
      });
      await onRefresh();
      setMappingVersionId(undefined);
      setToast("Page and metric mapping saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save mapping.");
    } finally {
      setBusy(false);
    }
  };
  const patchSection = (index: number, patch: Partial<Section>) =>
    setMappingSections((sections) =>
      sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    );
  const addSection = () =>
    setMappingSections((sections) => [
      ...sections,
      {
        id: `section-${Date.now()}`,
        name: "New section",
        entity: selected?.entity || form.entity,
        pages: [1],
        reviewerIds: [snapshot.principal.id],
        metrics: [],
      },
    ]);

  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>Documents</h1>
          <p>Publish and manage controlled financial report versions</p>
        </div>
        <div className="we-page-actions">
          <button className="we-button" onClick={beginNewPackage}>
            <Plus size={16} /> New package
          </button>
          <button
            className="we-button primary"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <UploadCloud size={16} /> Upload PDF
          </button>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.currentTarget.value = "";
            }}
          />
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {pendingUpload && (
        <div className="we-alert we-scan-pending" style={{ marginBottom: 16 }}>
          <Loader2 size={17} />
          <div>
            <strong>File scan pending</strong>
            <span>
              {pendingUpload.evidence.filename} must pass the configured malware
              scan before a draft version can be created.
            </span>
          </div>
          <button
            className="we-button small"
            onClick={() => void checkPendingScan()}
            disabled={busy}
          >
            Check scan
          </button>
        </div>
      )}
      {creatingPackage && (
        <div className="we-card we-package-form" style={{ marginBottom: 18 }}>
          <div className="we-card-title">
            <div>
              <h2>Start a document package</h2>
              <p>Complete package details, then upload its first PDF.</p>
            </div>
          </div>
          <div className="we-form-grid">
            <div className="we-field">
              <label className="we-label">Report title</label>
              <input
                className="we-input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="we-field">
              <label className="we-label">Period</label>
              <input
                className="we-input"
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
              />
            </div>
            <div className="we-field">
              <label className="we-label">Reporting unit</label>
              <input
                className="we-input"
                value={form.entity}
                onChange={(e) => setForm({ ...form, entity: e.target.value })}
              />
            </div>
            <div className="we-field">
              <label className="we-label">Review deadline</label>
              <input
                className="we-input"
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
      {snapshot.packages.length > 0 && !creatingPackage && (
        <div className="we-card" style={{ marginBottom: 18 }}>
          <div className="we-filterbar">
            <label className="we-label" style={{ margin: 0 }}>
              Package
            </label>
            <select
              className="we-select"
              aria-label="Package"
              value={selected?.id || ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {snapshot.packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.title} · {pkg.period}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="we-doc-grid">
        <section className="we-card we-doc-list">
          <div className="we-card-title">
            <div>
              <h2>{selected?.title || "Document versions"}</h2>
              <p>
                {selected
                  ? `${selected.entity} · deadline ${fmtDate(selected.dueAt)}`
                  : "Upload a PDF to create the first package version"}
              </p>
            </div>
            {selected && <Status value={selected.status} />}
          </div>
          {versions.length === 0 ? (
            <EmptyState
              icon={<FileArchive size={28} />}
              title="No versions yet"
              detail="Upload the first PDF to begin a controlled review cycle."
              action={
                <button
                  className="we-button primary small"
                  onClick={() => input.current?.click()}
                >
                  <Plus size={14} /> Upload version
                </button>
              }
            />
          ) : (
            <div className="we-table-wrap">
              <table className="we-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>File</th>
                    <th>Published</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <tr key={version.id}>
                      <td>
                        <span className="we-table-title">
                          Version {version.number}
                        </span>
                        <div className="we-table-muted">
                          Produced {fmtDate(version.producedAt)}
                        </div>
                      </td>
                      <td>
                        <a
                          href={`/api/files/${version.fileId}`}
                          target="_blank"
                          className="we-table-title"
                          rel="noreferrer"
                        >
                          <FileText
                            size={14}
                            style={{ verticalAlign: "-2px", marginRight: 6 }}
                          />
                          {version.filename}
                        </a>
                        <div className="we-table-muted">
                          {version.pageCount} pages ·{" "}
                          {version.sha256.slice(0, 10)}…
                        </div>
                      </td>
                      <td>{fmtDate(version.publishedAt)}</td>
                      <td>
                        <Status value={version.status} />
                      </td>
                      <td>
                        {version.status === "DRAFT" && (
                          <div className="we-row-actions">
                            <button
                              className="we-button small"
                              onClick={() => openMapping(version)}
                              disabled={busy}
                            >
                              <Settings2 size={14} /> Mapping
                            </button>
                            <button
                              className="we-button primary small"
                              onClick={() => void publish(version)}
                              disabled={busy}
                            >
                              <CheckCircle2 size={14} /> Publish
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <div className="we-doc-side">
          <section className="we-card">
            <div className="we-card-title">
              <div>
                <h2>Upload a new version</h2>
                <p>PDF files are validated before publication</p>
              </div>
            </div>
            <div
              className="we-upload"
              onClick={() => input.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
            >
              <UploadCloud size={29} />
              <strong>Browse to upload a PDF</strong>
              <span>Original bytes, hash and page count are retained.</span>
              {busy && (
                <Loader2
                  className="we-spinner"
                  size={18}
                  style={{ marginTop: 10 }}
                />
              )}
            </div>
          </section>
          {selected && (
            <section className="we-card we-doc-summary">
              <div
                className="we-card-title"
                style={{ padding: 0, border: 0, marginBottom: 17 }}
              >
                <div>
                  <h2>Package details</h2>
                  <p>Publication control</p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Current version</dt>
                  <dd>
                    {selected.currentVersionId
                      ? `Version ${snapshot.versions.find((v) => v.id === selected.currentVersionId)?.number}`
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Reporting scope</dt>
                  <dd>{selected.entity}</dd>
                </div>
                <div>
                  <dt>Review deadline</dt>
                  <dd>{fmtDate(selected.dueAt)}</dd>
                </div>
                <div>
                  <dt>Assignments</dt>
                  <dd>
                    {
                      snapshot.assignments.filter(
                        (a) => a.versionId === selected.currentVersionId,
                      ).length
                    }
                  </dd>
                </div>
              </dl>
              <div className="we-summary-actions">
                {selected.currentVersionId &&
                  selected.status === "IN_REVIEW" && (
                    <button
                      className="we-button primary small"
                      onClick={() => void finalize()}
                      disabled={busy}
                    >
                      <CheckCircle2 size={14} /> Finalize package
                    </button>
                  )}
                {selected.finalVersionId && (
                  <a
                    className="we-button small"
                    href={`/api/export?packageId=${encodeURIComponent(selected.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText size={14} /> Export manifest
                  </a>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
      {mappingVersion && (
        <div className="we-modal-backdrop" role="presentation">
          <section
            className="we-card we-mapping-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit page and metric mapping"
          >
            <div className="we-card-title">
              <div>
                <h2>Version {mappingVersion.number} mapping</h2>
                <p>
                  Validate pages, sections and selected metrics before
                  publication.
                </p>
              </div>
              <button
                className="we-button small"
                onClick={() => setMappingVersionId(undefined)}
              >
                Close
              </button>
            </div>
            <div className="we-mapping-body">
              {mappingSections.map((section, index) => (
                <div className="we-mapping-section" key={section.id}>
                  <div className="we-mapping-section-head">
                    <input
                      className="we-input"
                      value={section.name}
                      onChange={(e) =>
                        patchSection(index, { name: e.target.value })
                      }
                    />
                    <button
                      className="we-button small danger"
                      onClick={() =>
                        setMappingSections((s) =>
                          s.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="we-mapping-fields">
                    <div>
                      <label className="we-label">Reporting unit</label>
                      <input
                        className="we-input"
                        value={section.entity}
                        onChange={(e) =>
                          patchSection(index, { entity: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <label className="we-label">
                        Pages (comma separated)
                      </label>
                      <input
                        className="we-input"
                        value={section.pages.join(", ")}
                        onChange={(e) =>
                          patchSection(index, {
                            pages: e.target.value
                              .split(",")
                              .map((v) => Number(v.trim()))
                              .filter(Number.isInteger),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="we-field">
                    <label className="we-label">Assigned reviewers</label>
                    {snapshot.users
                      .filter(
                        (u) =>
                          u.active &&
                          u.roles.includes("reviewer") &&
                          (u.entities.includes("*") ||
                            u.entities.includes(section.entity)),
                      )
                      .map((u) => (
                        <label
                          key={u.id}
                          style={{ display: "flex", gap: 8, margin: "6px 0" }}
                        >
                          <input
                            type="checkbox"
                            checked={section.reviewerIds.includes(u.id)}
                            onChange={(e) =>
                              patchSection(index, {
                                reviewerIds: e.target.checked
                                  ? [...section.reviewerIds, u.id]
                                  : section.reviewerIds.filter(
                                      (id) => id !== u.id,
                                    ),
                              })
                            }
                          />
                          {u.name}
                        </label>
                      ))}
                  </div>
                  <div className="we-field">
                    <label className="we-label">
                      Roll up to parent sections
                    </label>
                    {mappingSections
                      .filter((s) => s.id !== section.id)
                      .map((parent) => (
                        <label
                          key={parent.id}
                          style={{ display: "flex", gap: 8, margin: "6px 0" }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              section.parentSectionIds?.includes(parent.id) ||
                              false
                            }
                            onChange={(e) =>
                              patchSection(index, {
                                parentSectionIds: e.target.checked
                                  ? [
                                      ...(section.parentSectionIds || []),
                                      parent.id,
                                    ]
                                  : (section.parentSectionIds || []).filter(
                                      (id) => id !== parent.id,
                                    ),
                              })
                            }
                          />
                          {parent.name}
                        </label>
                      ))}
                  </div>
                  <label className="we-label">Metrics</label>
                  {section.metrics.map((metric, mi) => (
                    <div className="we-metric-edit" key={metric.id}>
                      <input
                        className="we-input"
                        value={metric.label}
                        onChange={(e) =>
                          patchSection(index, {
                            metrics: section.metrics.map((m, i) =>
                              i === mi ? { ...m, label: e.target.value } : m,
                            ),
                          })
                        }
                      />
                      <label>
                        <input
                          type="checkbox"
                          checked={metric.required}
                          onChange={(e) =>
                            patchSection(index, {
                              metrics: section.metrics.map((m, i) =>
                                i === mi
                                  ? { ...m, required: e.target.checked }
                                  : m,
                              ),
                            })
                          }
                        />{" "}
                        Required
                      </label>
                    </div>
                  ))}
                  <button
                    className="we-button small"
                    onClick={() =>
                      patchSection(index, {
                        metrics: [
                          ...section.metrics,
                          {
                            id: `metric-${Date.now()}`,
                            label: "New metric",
                            required: true,
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={14} /> Add metric
                  </button>
                </div>
              ))}
              <button className="we-button small" onClick={addSection}>
                <Plus size={14} /> Add section
              </button>
            </div>
            <div className="we-modal-footer">
              <button
                className="we-button"
                onClick={() => setMappingVersionId(undefined)}
              >
                Cancel
              </button>
              <button
                className="we-button primary"
                onClick={() => void saveMapping()}
                disabled={busy}
              >
                <Save size={14} /> Save mapping
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
