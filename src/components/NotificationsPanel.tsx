"use client";

import { useMemo, useState } from "react";
import { Bell, Check, Clock3, Mail, Settings2 } from "lucide-react";
import type { AppSnapshot, OutboxEvent } from "@/lib/types";
import {
  notificationCategory,
  type NotificationPreference,
} from "@/lib/notification-types";
import { api } from "@/lib/client";
import { EmptyState, fmtDate } from "./ui";

type Props = {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
};

type Tab = "all" | "mention" | "alert" | "assignment";
const tabs: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "mention", label: "Mentions" },
  { id: "alert", label: "Alerts" },
  { id: "assignment", label: "Assignments" },
];

function href(event: OutboxEvent) {
  const id = encodeURIComponent(event.subjectId);
  return event.type.startsWith("ISSUE_")
    ? `/issues?issueId=${id}`
    : event.type.startsWith("REVIEW_")
      ? `/reviews?assignmentId=${id}`
      : event.type === "DUE_SOON" ||
          event.type.startsWith("TASK_") ||
          event.type.startsWith("WORKFLOW_") ||
          event.type.startsWith("DOCUMENT_GATE_")
        ? `/tasks?taskId=${id}`
        : `/dashboard?subjectId=${id}`;
}
function deliveryLabel(event: OutboxEvent) {
  if (event.status === "SENT") return "Delivered";
  if (event.status === "PENDING") return "Queued";
  if (event.status === "PROCESSING") return "Sending";
  if (event.status === "FAILED") return "Failed to deliver";
  return "Recorded";
}
function prefFor(snapshot: AppSnapshot): NotificationPreference {
  return (
    snapshot.notificationPreferences?.find(
      (item) => item.userId === snapshot.principal.id,
    ) ?? {
      userId: snapshot.principal.id,
      emailEnabled: true,
      reminderIntervalMinutes: 1440,
      timezone: "UTC",
      quietHours: { start: "22:00", end: "07:00" },
      urgentBypassQuietHours: false,
      revision: 0,
    }
  );
}

export function NotificationsPanel({ snapshot, onRefresh, setToast }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const preference = prefFor(snapshot);
  const [emailEnabled, setEmailEnabled] = useState(
    preference.emailEnabled !== false,
  );
  const [interval, setInterval] = useState(
    String(preference.reminderIntervalMinutes ?? 1440),
  );
  const [timezone, setTimezone] = useState(preference.timezone ?? "UTC");
  const [quietStart, setQuietStart] = useState(
    preference.quietHours?.start ?? "22:00",
  );
  const [quietEnd, setQuietEnd] = useState(
    preference.quietHours?.end ?? "07:00",
  );
  const [urgentBypass, setUrgentBypass] = useState(
    preference.urgentBypassQuietHours === true,
  );
  const [nudgeTarget, setNudgeTarget] = useState("");
  const [nudgeReason, setNudgeReason] = useState("");

  const receipts = snapshot.notificationReceipts ?? [];
  const events = useMemo(() => {
    const own = snapshot.outbox.filter(
      (event) => event.recipientId === snapshot.principal.id,
    );
    return own
      .filter(
        (event) => tab === "all" || notificationCategory(event.type) === tab,
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [snapshot.outbox, snapshot.principal.id, tab]);
  const unreadCount = snapshot.outbox.filter(
    (event) =>
      event.recipientId === snapshot.principal.id &&
      !receipts.some(
        (receipt) =>
          receipt.userId === snapshot.principal.id &&
          receipt.eventId === event.id &&
          receipt.readAt,
      ),
  ).length;

  async function markRead(eventId: string) {
    setBusy(eventId);
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({ type: "markNotificationRead", eventId }),
      });
      await onRefresh();
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Unable to mark notification read.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function savePreferences() {
    setBusy("preferences");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "saveNotificationPreferences",
          expectedRevision: preference.revision ?? 0,
          preference: {
            userId: snapshot.principal.id,
            emailEnabled,
            reminderIntervalMinutes: Number(interval),
            timezone,
            quietHours: { start: quietStart, end: quietEnd },
            urgentBypassQuietHours: urgentBypass,
          },
        }),
      });
      setToast("Notification preferences saved.");
      setShowSettings(false);
      await onRefresh();
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Unable to save notification preferences.",
      );
    } finally {
      setBusy(null);
    }
  }

  const canNudge = snapshot.principal.roles.some((role) =>
    ["admin", "manager", "publisher"].includes(role),
  );

  const nudgeTargets = useMemo(() => {
    if (!canNudge)
      return [] as Array<{
        value: string;
        label: string;
        type: "review" | "task";
        assignmentId?: string;
        runId?: string;
        taskId?: string;
      }>;
    const reviews = snapshot.assignments.flatMap((assignment) => {
      const version = snapshot.versions.find(
        (item) => item.id === assignment.versionId,
      );
      const pkg =
        version &&
        snapshot.packages.find((item) => item.id === version.packageId);
      if (
        assignment.status === "SIGNED" ||
        !version ||
        version.status !== "PUBLISHED" ||
        !pkg ||
        pkg.currentVersionId !== version.id
      )
        return [];
      const reviewer = snapshot.users.find(
        (user) => user.id === assignment.reviewerId,
      );
      return [
        {
          value: `review:${assignment.id}`,
          type: "review" as const,
          assignmentId: assignment.id,
          label: `Review · ${reviewer?.name ?? assignment.reviewerId} · ${assignment.sectionId}`,
        },
      ];
    });
    const tasks = snapshot.runs.flatMap((run) =>
      run.tasks.flatMap((task) => {
        if (["COMPLETE", "CANCELLED"].includes(task.status)) return [];
        const owner = snapshot.users.find((user) => user.id === task.ownerId);
        return [
          {
            value: `task:${run.id}:${task.id}`,
            type: "task" as const,
            runId: run.id,
            taskId: task.id,
            label: `Task · ${owner?.name ?? task.ownerId} · ${task.title}`,
          },
        ];
      }),
    );
    return [...reviews, ...tasks];
  }, [
    canNudge,
    snapshot.assignments,
    snapshot.packages,
    snapshot.runs,
    snapshot.users,
    snapshot.versions,
  ]);

  async function sendNudge() {
    const target = nudgeTargets.find((item) => item.value === nudgeTarget);
    if (!target) {
      setToast("Choose an assignment or task to remind.");
      return;
    }
    setBusy("manual-nudge");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: target.type === "review" ? "nudgeReview" : "nudgeTask",
          ...(target.type === "review"
            ? { assignmentId: target.assignmentId }
            : { runId: target.runId, taskId: target.taskId }),
          ...(nudgeReason.trim() ? { message: nudgeReason.trim() } : {}),
        }),
      });
      setNudgeTarget("");
      setNudgeReason("");
      setToast("Reminder queued.");
      await onRefresh();
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Unable to send reminder.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>
            Notifications{" "}
            {unreadCount > 0 && (
              <span className="we-nav-badge">{unreadCount}</span>
            )}
          </h1>
          <p>Your durable inbox for assignments, alerts and workflow updates</p>
        </div>
        <button
          type="button"
          className="we-button secondary"
          onClick={() => setShowSettings((value) => !value)}
        >
          <Settings2 size={15} /> Preferences
        </button>
      </div>
      {showSettings && (
        <section className="we-card" style={{ padding: 18, marginBottom: 18 }}>
          <div className="we-card-title">
            <div>
              <h2>Notification preferences</h2>
              <p>Email delivery and quiet hours use your local timezone.</p>
            </div>
            <Mail size={18} color="#168f70" />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 12,
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(event) => setEmailEnabled(event.target.checked)}
              />{" "}
              Email enabled
            </label>
            <label>
              Reminder interval (minutes)
              <input
                className="we-input"
                type="number"
                min={5}
                max={10080}
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              />
            </label>
            <label>
              Timezone
              <input
                className="we-input"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </label>
            <label>
              Quiet start
              <input
                className="we-input"
                type="time"
                value={quietStart}
                onChange={(event) => setQuietStart(event.target.value)}
              />
            </label>
            <label>
              Quiet end
              <input
                className="we-input"
                type="time"
                value={quietEnd}
                onChange={(event) => setQuietEnd(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={urgentBypass}
                onChange={(event) => setUrgentBypass(event.target.checked)}
              />{" "}
              Urgent alerts may bypass quiet hours
            </label>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 14,
            }}
          >
            <button
              type="button"
              className="we-button"
              disabled={busy === "preferences"}
              onClick={() => void savePreferences()}
            >
              {busy === "preferences" ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </section>
      )}
      {canNudge && (
        <section className="we-card" style={{ padding: 18, marginBottom: 18 }}>
          <div className="we-card-title">
            <div>
              <h2>Send reminder</h2>
              <p>
                Prompt an active reviewer or task owner in your reporting-unit
                scope.
              </p>
            </div>
            <Bell size={18} color="#168f70" />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <label>
              Reminder target
              <select
                aria-label="Reminder target"
                className="we-select"
                value={nudgeTarget}
                onChange={(event) => setNudgeTarget(event.target.value)}
              >
                <option value="">Select assignment or task</option>
                {nudgeTargets.map((target) => (
                  <option value={target.value} key={target.value}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reason (optional)
              <input
                aria-label="Reason"
                className="we-input"
                value={nudgeReason}
                maxLength={500}
                placeholder="Add context for the recipient"
                onChange={(event) => setNudgeReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="we-button"
              disabled={busy === "manual-nudge" || nudgeTargets.length === 0}
              onClick={() => void sendNudge()}
            >
              Send reminder
            </button>
          </div>
        </section>
      )}
      <div
        style={{ display: "flex", gap: 6, marginBottom: 14 }}
        role="tablist"
        aria-label="Notification type"
      >
        {tabs.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            key={item.id}
            className={`we-button ${tab === item.id ? "" : "secondary"}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {events.length === 0 ? (
        <div className="we-card">
          <EmptyState
            icon={<Bell size={28} />}
            title="No notifications"
            detail="New assignments and workflow alerts will appear here."
          />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {events.map((event) => {
            const receipt = receipts.find(
              (item) =>
                item.userId === snapshot.principal.id &&
                item.eventId === event.id,
            );
            const unread = !receipt?.readAt;
            return (
              <article
                className="we-card"
                key={event.id}
                style={{
                  padding: 16,
                  borderLeft: unread
                    ? "3px solid #168f70"
                    : "3px solid transparent",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: "50%",
                      background: unread ? "#e7f6f0" : "#f1f4f8",
                      color: unread ? "#078364" : "#718096",
                    }}
                  >
                    <Bell size={16} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <strong>{event.message}</strong>
                      <span
                        style={{
                          color: "#7c8ba0",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtDate(event.createdAt, true)}
                      </span>
                    </div>
                    <div
                      style={{ color: "#718096", fontSize: 11, marginTop: 6 }}
                    >
                      {event.type.replaceAll("_", " ")} · {deliveryLabel(event)}
                      {receipt?.resolvedAt
                        ? " · Resolved"
                        : unread
                          ? " · Unread"
                          : " · Read"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 11,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <a className="we-button secondary" href={href(event)}>
                        Open item
                      </a>
                      {unread && (
                        <button
                          type="button"
                          className="we-button secondary"
                          disabled={busy === event.id}
                          onClick={() => void markRead(event.id)}
                        >
                          <Check size={14} /> Mark read
                        </button>
                      )}
                      {receipt?.resolvedAt && (
                        <span style={{ color: "#078364", fontSize: 11 }}>
                          <Clock3 size={12} style={{ verticalAlign: "-2px" }} />{" "}
                          Recovered
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
