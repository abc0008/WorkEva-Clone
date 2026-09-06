"use client";

import { Activity, Bell, Shield, Users } from "lucide-react";
import type { AppSnapshot } from "@/lib/types";
import { EmptyState, fmtDate, Status } from "./ui";

export function AdminPanel({ snapshot }: { snapshot: AppSnapshot }) {
  const pending = snapshot.outbox.filter((e) => e.status === "PENDING").length;
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
              snapshot.users.map((user) => (
                <div className="we-persona" key={user.id}>
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
