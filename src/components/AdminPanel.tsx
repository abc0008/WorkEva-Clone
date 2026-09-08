"use client";

import { useState } from "react";
import {
  Activity,
  Bell,
  Shield,
  Users,
  GitBranch,
  UserRoundCog,
} from "lucide-react";
import type { AppSnapshot } from "@/lib/types";
import { EmptyState, fmtDate, Status } from "./ui";
import { api } from "@/lib/client";

export function AdminPanel({
  snapshot,
  onRefresh,
  setToast,
}: {
  snapshot: AppSnapshot;
  onRefresh?: () => Promise<void>;
  setToast?: (message: string) => void;
}) {
  const emptyRule = {
    id: "",
    entity: "",
    sectionId: "",
    primaryReviewerId: "",
    backupReviewerIds: "",
    additionalRequiredReviewerIds: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
  };
  const emptyUser = {
    id: "",
    name: "",
    email: "",
    roles: "reviewer",
    entities: "",
    active: true,
  };
  const pending = snapshot.outbox.filter((e) => e.status === "PENDING").length;
  const [rule, setRule] = useState(emptyRule);
  const [selectedUser, setSelectedUser] = useState("");
  const [userForm, setUserForm] = useState(emptyUser);
  const [reassign, setReassign] = useState({
    assignmentId: "",
    newReviewerId: "",
    reason: "",
  });
  const [busy, setBusy] = useState(false);
  const users = snapshot.users;
  const assignments = snapshot.assignments;
  const rules = snapshot.assignmentRules ?? [];
  const changes = snapshot.assignmentChanges ?? [];
  const isAdmin = snapshot.principal.roles.includes("admin");
  const runCommand = async (
    command: Record<string, unknown>,
    success: string,
  ) => {
    setBusy(true);
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify(command),
      });
      setToast?.(success);
      await onRefresh?.();
    } catch (error) {
      setToast?.(
        error instanceof Error ? error.message : "Unable to save change.",
      );
    } finally {
      setBusy(false);
    }
  };
  const editUser = (id: string) => {
    setSelectedUser(id);
    const user = users.find((candidate) => candidate.id === id);
    if (user)
      setUserForm({
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles.join(","),
        entities: user.entities.join(","),
        active: user.active,
      });
  };
  const editRule = (id: string) => {
    const item = rules.find((candidate) => candidate.id === id);
    if (item)
      setRule({
        id: item.id,
        entity: item.entity,
        sectionId: item.sectionId ?? "",
        primaryReviewerId: item.primaryReviewerId,
        backupReviewerIds: item.backupReviewerIds?.join(",") ?? "",
        additionalRequiredReviewerIds:
          item.additionalRequiredReviewerIds?.join(",") ?? "",
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo ?? "",
      });
  };
  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>Administration</h1>
          <p>Access, assignments and operational events</p>
        </div>
      </div>
      <div className="we-admin-grid">
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>People and access</h2>
              <p>Scoped finance workspace principals</p>
            </div>
            <Users size={18} color="#168f70" />
          </div>
          <div style={{ padding: "4px 18px 16px" }}>
            {snapshot.users.length === 0 ? (
              <EmptyState title="No users configured" />
            ) : (
              users.map((user) => (
                <div
                  className="we-persona"
                  key={user.id}
                  onClick={() => isAdmin && editUser(user.id)}
                  style={{ cursor: isAdmin ? "pointer" : undefined }}
                >
                  <div className="we-avatar">
                    {user.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div className="we-persona-copy">
                    <strong>{user.name}</strong>
                    <span>
                      {user.email} · {user.roles.join(", ")}
                    </span>
                  </div>
                  <span
                    style={{
                      color: user.active ? "#078364" : "#a72219",
                      fontSize: 11,
                    }}
                  >
                    {user.active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))
            )}
            {isAdmin && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const id =
                    selectedUser ||
                    userForm.id.trim() ||
                    (process.env.NODE_ENV === "production"
                      ? ""
                      : crypto.randomUUID());
                  void runCommand(
                    {
                      type: "upsertUser",
                      ...userForm,
                      id,
                      roles: userForm.roles
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                      entities: userForm.entities
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                      ...(selectedUser
                        ? {
                            expectedRevision:
                              users.find((user) => user.id === selectedUser)
                                ?.revision ?? 0,
                          }
                        : {}),
                    },
                    selectedUser ? "Access updated" : "User added",
                  );
                }}
                style={{
                  borderTop: "1px solid #edf1f4",
                  paddingTop: 14,
                  marginTop: 8,
                }}
              >
                <strong style={{ display: "block", marginBottom: 8 }}>
                  {selectedUser ? "Edit user" : "Add user"}
                </strong>
                <div className="we-form-grid">
                  <label className="we-field">
                    <span className="we-label">
                      User ID{" "}
                      {selectedUser ? "(immutable)" : "(Entra object ID)"}
                    </span>
                    <input
                      className="we-input"
                      aria-label="User ID"
                      value={userForm.id}
                      onChange={(event) =>
                        setUserForm({ ...userForm, id: event.target.value })
                      }
                      disabled={!!selectedUser}
                      required={
                        process.env.NODE_ENV === "production" && !selectedUser
                      }
                      placeholder="Directory object ID"
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Name</span>
                    <input
                      className="we-input"
                      aria-label="Name"
                      value={userForm.name}
                      onChange={(event) =>
                        setUserForm({ ...userForm, name: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Email</span>
                    <input
                      className="we-input"
                      aria-label="Email"
                      type="email"
                      value={userForm.email}
                      onChange={(event) =>
                        setUserForm({ ...userForm, email: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Roles</span>
                    <input
                      className="we-input"
                      aria-label="Roles"
                      placeholder="reviewer, manager"
                      value={userForm.roles}
                      onChange={(event) =>
                        setUserForm({ ...userForm, roles: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Reporting units</span>
                    <input
                      className="we-input"
                      aria-label="Reporting units"
                      placeholder="AL, TX or *"
                      value={userForm.entities}
                      onChange={(event) =>
                        setUserForm({
                          ...userForm,
                          entities: event.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Status</span>
                    <span>
                      <input
                        type="checkbox"
                        checked={userForm.active}
                        onChange={(event) =>
                          setUserForm({
                            ...userForm,
                            active: event.target.checked,
                          })
                        }
                      />{" "}
                      Active
                    </span>
                  </label>
                  <button className="we-button" disabled={busy} type="submit">
                    <UserRoundCog size={14} /> Save access
                  </button>
                  {selectedUser && (
                    <button
                      className="we-button ghost"
                      type="button"
                      onClick={() => {
                        setSelectedUser("");
                        setUserForm(emptyUser);
                      }}
                    >
                      Add another
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </section>
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Notification outbox</h2>
              <p>Durable delivery records</p>
            </div>
            <Bell size={18} color="#168f70" />
          </div>
          <div style={{ padding: "4px 18px 16px" }}>
            {snapshot.outbox.length === 0 ? (
              <EmptyState
                icon={<Bell size={28} />}
                title="No notifications"
                detail="Events created by review and workflow actions appear here."
              />
            ) : (
              snapshot.outbox
                .slice()
                .reverse()
                .slice(0, 8)
                .map((event) => (
                  <div className="we-persona" key={event.id}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        display: "grid",
                        placeItems: "center",
                        background: "#eef5f2",
                        borderRadius: "50%",
                      }}
                    >
                      <Bell size={14} color="#168f70" />
                    </div>
                    <div className="we-persona-copy">
                      <strong>{event.message}</strong>
                      <span>
                        {fmtDate(event.createdAt, true)} · {event.attempts}{" "}
                        attempts
                      </span>
                    </div>
                    <Status value={event.status} />
                  </div>
                ))
            )}
          </div>
        </section>
      </div>
      <div className="we-admin-grid" style={{ marginTop: 18 }}>
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Assignment rules</h2>
              <p>Effective dated ownership by reporting unit and section</p>
            </div>
            <GitBranch size={18} color="#168f70" />
          </div>
          <div style={{ padding: "4px 18px 16px" }}>
            {rules.map((item) => (
              <div
                className="we-persona"
                key={item.id}
                onClick={() => editRule(item.id)}
                style={{ cursor: "pointer" }}
              >
                <div className="we-persona-copy">
                  <strong>
                    {item.entity} · {item.sectionId || "All sections"}
                  </strong>
                  <span>
                    {item.primaryReviewerId} ·{" "}
                    {item.additionalRequiredReviewerIds?.join(", ") ||
                      "No additional reviewer"}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "#75859a" }}>
                  {item.effectiveFrom}
                  {item.effectiveTo ? ` → ${item.effectiveTo}` : " → open"}
                </span>
              </div>
            ))}
            {isAdmin && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void runCommand(
                    {
                      type: "saveAssignmentRule",
                      rule: {
                        ...rule,
                        id: rule.id || crypto.randomUUID(),
                        sectionId: rule.sectionId || undefined,
                        backupReviewerIds: rule.backupReviewerIds
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                        additionalRequiredReviewerIds:
                          rule.additionalRequiredReviewerIds
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        effectiveTo: rule.effectiveTo || undefined,
                      },
                      ...(rule.id
                        ? {
                            expectedRevision:
                              rules.find((item) => item.id === rule.id)
                                ?.revision ?? 0,
                          }
                        : {}),
                    },
                    "Assignment rule saved",
                  );
                }}
              >
                <div className="we-form-grid">
                  <label className="we-field">
                    <span className="we-label">Reporting unit</span>
                    <input
                      className="we-input"
                      aria-label="Reporting unit"
                      value={rule.entity}
                      onChange={(event) =>
                        setRule({ ...rule, entity: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Section</span>
                    <input
                      className="we-input"
                      aria-label="Section"
                      placeholder="Optional section ID"
                      value={rule.sectionId}
                      onChange={(event) =>
                        setRule({ ...rule, sectionId: event.target.value })
                      }
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Primary reviewer</span>
                    <select
                      className="we-select"
                      aria-label="Primary reviewer"
                      value={rule.primaryReviewerId}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          primaryReviewerId: event.target.value,
                        })
                      }
                      required
                    >
                      <option value="">Choose reviewer</option>
                      {users
                        .filter(
                          (user) =>
                            user.roles.includes("reviewer") && user.active,
                        )
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="we-field">
                    <span className="we-label">Backup reviewers</span>
                    <input
                      className="we-input"
                      aria-label="Backup reviewers"
                      placeholder="IDs, comma separated"
                      value={rule.backupReviewerIds}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          backupReviewerIds: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Additional reviewers</span>
                    <input
                      className="we-input"
                      aria-label="Additional reviewers"
                      placeholder="IDs, comma separated"
                      value={rule.additionalRequiredReviewerIds}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          additionalRequiredReviewerIds: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Effective from</span>
                    <input
                      className="we-input"
                      aria-label="Effective from"
                      type="date"
                      value={rule.effectiveFrom}
                      onChange={(event) =>
                        setRule({ ...rule, effectiveFrom: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label className="we-field">
                    <span className="we-label">Effective to</span>
                    <input
                      className="we-input"
                      aria-label="Effective to"
                      type="date"
                      value={rule.effectiveTo}
                      onChange={(event) =>
                        setRule({ ...rule, effectiveTo: event.target.value })
                      }
                    />
                  </label>
                  <button className="we-button" disabled={busy} type="submit">
                    <GitBranch size={14} /> Save rule
                  </button>
                  {rule.id && (
                    <button
                      className="we-button ghost"
                      type="button"
                      onClick={() => setRule(emptyRule)}
                    >
                      New rule
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </section>
        <section className="we-card">
          <div className="we-card-title">
            <div>
              <h2>Reassign review</h2>
              <p>Ownership changes invalidate the prior review decision</p>
            </div>
            <UserRoundCog size={18} color="#168f70" />
          </div>
          <form
            style={{ padding: "4px 18px 16px" }}
            onSubmit={(event) => {
              event.preventDefault();
              void runCommand(
                {
                  type: "reassignReview",
                  ...reassign,
                  expectedRevision: assignments.find(
                    (item) => item.id === reassign.assignmentId,
                  )?.revision,
                },
                "Review reassigned",
              );
            }}
          >
            <div className="we-form-grid">
              <label className="we-field">
                <span className="we-label">Assignment</span>
                <select
                  className="we-select"
                  aria-label="Assignment"
                  value={reassign.assignmentId}
                  onChange={(event) =>
                    setReassign({
                      ...reassign,
                      assignmentId: event.target.value,
                    })
                  }
                  required
                >
                  <option value="">Choose assignment</option>
                  {assignments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id} · {item.reviewerId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="we-field">
                <span className="we-label">New reviewer</span>
                <select
                  className="we-select"
                  aria-label="New reviewer"
                  value={reassign.newReviewerId}
                  onChange={(event) =>
                    setReassign({
                      ...reassign,
                      newReviewerId: event.target.value,
                    })
                  }
                  required
                >
                  <option value="">Choose reviewer</option>
                  {users
                    .filter(
                      (user) => user.active && user.roles.includes("reviewer"),
                    )
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="we-field">
                <span className="we-label">Reason</span>
                <input
                  className="we-input"
                  aria-label="Reason"
                  placeholder="Why is ownership changing?"
                  value={reassign.reason}
                  onChange={(event) =>
                    setReassign({ ...reassign, reason: event.target.value })
                  }
                  required
                />
              </label>
              <button className="we-button" disabled={busy} type="submit">
                <UserRoundCog size={14} /> Reassign
              </button>
            </div>
          </form>
        </section>
      </div>
      <section className="we-card" style={{ marginTop: 18 }}>
        <div className="we-card-title">
          <div>
            <h2>Assignment history</h2>
            <p>Immutable ownership changes</p>
          </div>
          <Activity size={18} color="#168f70" />
        </div>
        {changes.length === 0 ? (
          <EmptyState title="No reassignment history" />
        ) : (
          <div className="we-table-wrap">
            <table className="we-table">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Previous owner</th>
                  <th>New owner</th>
                  <th>When</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {changes
                  .slice()
                  .reverse()
                  .map((change) => (
                    <tr key={change.id}>
                      <td>{change.assignmentId}</td>
                      <td>{change.previousReviewerId}</td>
                      <td>{change.newReviewerId}</td>
                      <td>{fmtDate(change.at, true)}</td>
                      <td className="we-table-muted">{change.reason}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="we-card" style={{ marginTop: 18 }}>
        <div className="we-card-title">
          <div>
            <h2>Audit activity</h2>
            <p>Append-only operational events</p>
          </div>
          <Activity size={18} color="#168f70" />
        </div>
        {snapshot.audit.length === 0 ? (
          <EmptyState icon={<Shield size={28} />} title="No audit events yet" />
        ) : (
          <div className="we-table-wrap">
            <table className="we-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Subject</th>
                  <th>Actor</th>
                  <th>When</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.audit
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((event) => (
                    <tr key={event.id}>
                      <td>
                        <span className="we-table-title">
                          {event.action.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{event.subjectId}</td>
                      <td>
                        {snapshot.users.find((u) => u.id === event.by)?.name ||
                          event.by}
                      </td>
                      <td>{fmtDate(event.at, true)}</td>
                      <td className="we-table-muted">{event.detail || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {pending > 0 && (
        <div style={{ color: "#75859a", fontSize: 11, marginTop: 12 }}>
          {pending} notification{pending === 1 ? "" : "s"} waiting for the
          configured delivery worker.
        </div>
      )}
    </div>
  );
}
