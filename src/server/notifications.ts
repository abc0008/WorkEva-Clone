import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { OutboxEvent, Principal } from "@/lib/types";
import {
  isUrgentNotification,
  type NotificationPreference,
} from "@/lib/notification-types";
import { DomainError, now } from "./domain";
import { readState, transact } from "./store";
import { taskBlocked } from "./workflow";

const LEASE_MS = 60_000;
const SEND_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];
const DEFAULT_REMINDER_INTERVAL_MINUTES = 24 * 60;
const REPEATING_REMINDERS = new Set([
  "REVIEW_DUE_SOON",
  "REVIEW_LATE",
  "DUE_SOON",
  "TASK_LATE",
  "TASK_BLOCKED",
]);
type LeasedEvent = OutboxEvent & { leaseToken?: string };
let graphCredential: DefaultAzureCredential | undefined;
let graphAccessToken: { value: string; expiresAt: number } | undefined;
let graphTokenRequest: Promise<string> | undefined;

function configuredSend() {
  return (
    process.env.WORKEVA_NOTIFICATION_SEND === "true" &&
    process.env.WORKEVA_NOTIFICATION_PROVIDER === "graph"
  );
}
function graphSender() {
  const value = process.env.WORKEVA_NOTIFICATION_SENDER;
  if (!value)
    throw new DomainError(503, "Notification sender is not configured.");
  return value;
}
function parseDate(value?: string) {
  return value ? Date.parse(value) : 0;
}

function preferenceFor(
  state: import("@/lib/types").AppState,
  userId: string,
): NotificationPreference {
  const preference = state.notificationPreferences?.find(
    (item) => item.userId === userId,
  );
  return {
    userId,
    emailEnabled: preference?.emailEnabled ?? true,
    reminderIntervalMinutes:
      preference?.reminderIntervalMinutes ?? DEFAULT_REMINDER_INTERVAL_MINUTES,
    timezone: preference?.timezone ?? "UTC",
    quietHours: preference?.quietHours,
    urgentBypassQuietHours: preference?.urgentBypassQuietHours ?? false,
  };
}

function timeParts(value: string): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return [0, 0];
  return [Number(match[1]), Number(match[2])];
}

/** Return the instant at which an event may leave quiet hours, if it is quiet now. */
export function notificationQuietUntil(
  preference: NotificationPreference,
  at = Date.now(),
): number | undefined {
  const timezone = preference.timezone || "UTC";
  const zoneNow = DateTime.fromMillis(at, { zone: timezone });
  if (!zoneNow.isValid) return undefined;
  const quiet = preference.quietHours;
  if (!quiet) return undefined;
  const [startHour, startMinute] = timeParts(quiet.start);
  const [endHour, endMinute] = timeParts(quiet.end);
  const start = zoneNow
    .startOf("day")
    .set({ hour: startHour, minute: startMinute });
  const endSameDay = zoneNow
    .startOf("day")
    .set({ hour: endHour, minute: endMinute });
  const overnight = endSameDay <= start;
  let end = endSameDay;
  let inside: boolean;
  if (overnight) {
    // The post-midnight part belongs to yesterday's quiet window.
    if (zoneNow >= start) {
      end = endSameDay.plus({ days: 1 });
      inside = true;
    } else {
      inside = zoneNow < endSameDay;
    }
  } else {
    inside = zoneNow >= start && zoneNow < end;
  }
  if (!inside) return undefined;
  return end.toMillis();
}

function deferredUntil(
  state: import("@/lib/types").AppState,
  event: OutboxEvent,
  at = Date.now(),
): number | undefined {
  const preference = preferenceFor(state, event.recipientId);
  if (!preference.emailEnabled) return undefined;
  if (isUrgentNotification(event.type) && preference.urgentBypassQuietHours)
    return undefined;
  return notificationQuietUntil(preference, at);
}

function ensureNotificationReceipt(
  state: import("@/lib/types").AppState,
  event: OutboxEvent,
) {
  state.notificationReceipts ??= [];
  if (
    !state.notificationReceipts.some(
      (receipt) =>
        receipt.eventId === event.id && receipt.userId === event.recipientId,
    )
  )
    state.notificationReceipts.push({
      id: randomUUID(),
      userId: event.recipientId,
      eventId: event.id,
      causeEventId: event.id,
      createdAt: event.createdAt,
    });
}

function recipientHasScope(
  state: import("@/lib/types").AppState,
  recipientId: string,
  entity: string,
) {
  const recipient = state.users.find((user) => user.id === recipientId);
  return (
    !!recipient &&
    recipient.active &&
    !!recipient.email &&
    (recipient.entities.includes("*") || recipient.entities.includes(entity))
  );
}

/** Keep queued work details from being delivered after ownership or access changes. */
function eventRecipientStillAuthorized(
  state: import("@/lib/types").AppState,
  event: OutboxEvent,
): boolean {
  if (event.type.startsWith("REVIEW_")) {
    const assignment = state.assignments.find(
      (item) => item.id === event.subjectId,
    );
    if (!assignment) return true;
    const version = state.versions.find(
      (item) => item.id === assignment.versionId,
    );
    const pkg =
      version && state.packages.find((item) => item.id === version.packageId);
    return (
      assignment.reviewerId === event.recipientId &&
      !!version &&
      version.status === "PUBLISHED" &&
      !!pkg &&
      pkg.currentVersionId === version.id &&
      recipientHasScope(state, event.recipientId, assignment.entity)
    );
  }
  const taskEvent =
    event.type === "DUE_SOON" ||
    event.type.startsWith("TASK_") ||
    event.type.startsWith("WORKFLOW_") ||
    event.type.startsWith("DOCUMENT_GATE_");
  if (taskEvent) {
    const task = state.runs
      .flatMap((run) => run.tasks)
      .find((candidate) => candidate.id === event.subjectId);
    if (!task) return true;
    return (
      task.ownerId === event.recipientId &&
      recipientHasScope(state, event.recipientId, task.entity)
    );
  }
  if (event.type.startsWith("ISSUE_")) {
    const issue = state.issues?.find((item) => item.id === event.subjectId);
    if (!issue) return true;
    const expectedRecipient =
      event.type === "ISSUE_RESOLUTION_ACCEPTED"
        ? issue.createdBy
        : issue.ownerId;
    return (
      expectedRecipient === event.recipientId &&
      recipientHasScope(state, event.recipientId, issue.entity)
    );
  }
  return true;
}

function subjectRecovered(
  state: import("@/lib/types").AppState,
  event: OutboxEvent,
): boolean {
  if (event.type.startsWith("ISSUE_"))
    return !!state.issues?.some(
      (issue) => issue.id === event.subjectId && issue.status === "RESOLVED",
    );
  if (event.type.startsWith("REVIEW_")) {
    return state.assignments.some(
      (assignment) =>
        assignment.id === event.subjectId && assignment.status === "SIGNED",
    );
  }
  const task = state.runs
    .flatMap((run) => run.tasks)
    .find((candidate) => candidate.id === event.subjectId);
  if (!task) return false;
  if (["TASK_LATE", "DUE_SOON"].includes(event.type))
    return ["COMPLETE", "CANCELLED"].includes(task.status);
  if (event.type === "TASK_BLOCKED") {
    const run = state.runs.find((candidate) =>
      candidate.tasks.some((item) => item.id === task.id),
    );
    return !!run && !taskBlocked(state, run, task);
  }
  return false;
}

function resolveRecoveredAlerts(state: import("@/lib/types").AppState) {
  const at = now();
  for (const event of state.outbox) {
    ensureNotificationReceipt(state, event);
    if (!subjectRecovered(state, event)) continue;
    const receipt = state.notificationReceipts?.find(
      (candidate) =>
        candidate.eventId === event.id &&
        candidate.userId === event.recipientId,
    );
    if (receipt && !receipt.resolvedAt) {
      receipt.resolvedAt = at;
      receipt.resolution = "The underlying work recovered.";
    }
  }
}

function appBaseUrl(): string {
  const configured = process.env.WORKEVA_BASE_URL?.trim();
  if (!configured)
    throw new DomainError(503, "WorkEva base URL is not configured.");
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new DomainError(503, "WorkEva base URL is invalid.");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production")
    throw new DomainError(503, "WorkEva base URL must use HTTPS.");
  return parsed.toString().replace(/\/$/, "");
}

export function notificationDeepLink(
  event: Pick<OutboxEvent, "type" | "subjectId">,
  base = appBaseUrl(),
): string {
  const encoded = encodeURIComponent(event.subjectId);
  const path = event.type.startsWith("ISSUE_")
    ? `/issues?issueId=${encoded}`
    : event.type.startsWith("REVIEW_")
      ? `/reviews?assignmentId=${encoded}`
      : event.type === "DUE_SOON" ||
          event.type.startsWith("TASK_") ||
          event.type.startsWith("WORKFLOW_") ||
          event.type.startsWith("DOCUMENT_GATE_")
        ? `/tasks?taskId=${encoded}`
        : `/dashboard?subjectId=${encoded}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

async function graphToken(): Promise<string> {
  if (graphAccessToken && graphAccessToken.expiresAt > Date.now() + 60_000)
    return graphAccessToken.value;
  if (graphTokenRequest) return graphTokenRequest;
  graphCredential ??= new DefaultAzureCredential();
  graphTokenRequest = (async () => {
    try {
      const result = await graphCredential!.getToken(
        "https://graph.microsoft.com/.default",
      );
      if (!result?.token)
        throw new DomainError(
          503,
          "Microsoft Graph workload identity is unavailable.",
        );
      graphAccessToken = {
        value: result.token,
        expiresAt: Number(result.expiresOnTimestamp) || Date.now() + 5 * 60_000,
      };
      return result.token;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        503,
        "Microsoft Graph workload identity is unavailable.",
      );
    }
  })();
  try {
    return await graphTokenRequest;
  } finally {
    graphTokenRequest = undefined;
  }
}

async function within<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new DomainError(504, "Notification provider timed out.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function graphSend(event: OutboxEvent, recipient: Principal) {
  const deadline = Date.now() + SEND_TIMEOUT_MS;
  const accessToken = await within(graphToken(), SEND_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(Math.max(1, deadline - Date.now()), LEASE_MS - 1_000),
  );
  try {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graphSender())}/sendMail`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: `WorkEva: ${event.type.replaceAll("_", " ").toLowerCase()}`,
            body: {
              contentType: "Text",
              content: `${event.message}\n\nOpen WorkEva: ${notificationDeepLink(event)}`,
            },
            toRecipients: [{ emailAddress: { address: recipient.email } }],
          },
          saveToSentItems: false,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok)
      throw new DomainError(
        502,
        `Microsoft Graph rejected the notification (${response.status}).`,
      );
  } catch (error) {
    if ((error as Error).name === "AbortError")
      throw new DomainError(504, "Notification provider timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function claimOne(): Promise<
  { event: OutboxEvent; recipient?: Principal } | undefined
> {
  return transact((state) => {
    const current = Date.now();
    let event: OutboxEvent | undefined;
    for (const candidate of state.outbox) {
      const due =
        (candidate.status === "PENDING" &&
          parseDate(candidate.nextAttemptAt) <= current) ||
        (candidate.status === "PROCESSING" &&
          !!candidate.leaseUntil &&
          Number.isFinite(parseDate(candidate.leaseUntil)) &&
          parseDate(candidate.leaseUntil) <= current);
      if (!due) continue;
      if (!eventRecipientStillAuthorized(state, candidate)) {
        ensureNotificationReceipt(state, candidate);
        candidate.status = "DRY_RUN";
        candidate.error =
          "Notification suppressed because the recipient no longer owns or can access this work.";
        delete candidate.leaseUntil;
        continue;
      }
      const quietUntil = deferredUntil(state, candidate, current);
      if (quietUntil !== undefined) {
        // Deferral does not consume an attempt. This avoids an exhausted retry
        // budget merely because a worker ran during a user's quiet hours.
        candidate.status = "PENDING";
        delete candidate.leaseUntil;
        candidate.nextAttemptAt = new Date(quietUntil).toISOString();
        continue;
      }
      event = candidate;
      break;
    }
    if (!event) return undefined;
    ensureNotificationReceipt(state, event);
    const leaseToken = randomUUID();
    event.status = "PROCESSING";
    event.leaseUntil = new Date(current + LEASE_MS).toISOString();
    event.attempts += 1;
    (event as LeasedEvent).leaseToken = leaseToken;
    return {
      event: structuredClone(event),
      recipient: state.users.find((user) => user.id === event.recipientId),
    };
  });
}

async function finish(
  claimed: LeasedEvent,
  outcome: { sent: boolean; error?: string; dryRun?: boolean },
): Promise<boolean> {
  return transact((state) => {
    const event = state.outbox.find((item) => item.id === claimed.id);
    const current = event as LeasedEvent | undefined;
    if (
      !current ||
      current.status !== "PROCESSING" ||
      current.leaseToken !== claimed.leaseToken ||
      current.attempts !== claimed.attempts
    )
      return false;
    delete current.leaseUntil;
    delete current.leaseToken;
    if (outcome.dryRun) {
      current.status = "DRY_RUN";
      current.error = outcome.error;
      return true;
    }
    if (outcome.sent) {
      current.status = "SENT";
      current.sentAt = now();
      delete current.error;
      return true;
    }
    current.error = outcome.error || "Notification provider failed.";
    if (current.attempts >= MAX_ATTEMPTS) current.status = "FAILED";
    else {
      current.status = "PENDING";
      current.nextAttemptAt = new Date(
        Date.now() +
          BACKOFF_MS[Math.min(current.attempts - 1, BACKOFF_MS.length - 1)],
      ).toISOString();
    }
    return true;
  });
}

async function enqueueDueNotifications() {
  await transact((state) => {
    resolveRecoveredAlerts(state);
    const nowMs = Date.now();
    const soonMs = nowMs + 24 * 60 * 60 * 1000;
    const enqueue = (
      type: string,
      subjectId: string,
      recipientId: string,
      message: string,
    ) => {
      if (!recipientId) return;
      const priorEvents = state.outbox
        .filter(
          (event) =>
            event.type === type &&
            event.subjectId === subjectId &&
            event.recipientId === recipientId,
        )
        .sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));
      const active = priorEvents.some((event) =>
        ["PENDING", "PROCESSING"].includes(event.status),
      );
      if (active) return;
      const latest = priorEvents[0];
      const intervalMs =
        preferenceFor(state, recipientId).reminderIntervalMinutes! * 60_000;
      if (
        latest &&
        (!REPEATING_REMINDERS.has(type) ||
          parseDate(latest.createdAt) + intervalMs > nowMs)
      )
        return;
      const event: OutboxEvent = {
        id: randomUUID(),
        type,
        subjectId,
        recipientId,
        message,
        status: "PENDING",
        attempts: 0,
        createdAt: now(),
      };
      state.outbox.push(event);
      ensureNotificationReceipt(state, event);
    };
    for (const assignment of state.assignments) {
      if (assignment.status === "SIGNED") continue;
      const version = state.versions.find(
        (item) => item.id === assignment.versionId,
      );
      const pkg =
        version && state.packages.find((item) => item.id === version.packageId);
      // Reminders belong only to the current published review cycle. Historical
      // assignments otherwise keep generating reminders after supersession.
      if (
        !version ||
        version.status !== "PUBLISHED" ||
        !pkg ||
        pkg.currentVersionId !== version.id
      )
        continue;
      const due = Date.parse(assignment.dueAt);
      if (!Number.isFinite(due)) continue;
      if (due < nowMs)
        enqueue(
          "REVIEW_LATE",
          assignment.id,
          assignment.reviewerId,
          "An assigned review is past its deadline.",
        );
      else if (due <= soonMs)
        enqueue(
          "REVIEW_DUE_SOON",
          assignment.id,
          assignment.reviewerId,
          "An assigned review is due soon.",
        );
    }
    for (const run of state.runs)
      for (const task of run.tasks) {
        if (["COMPLETE", "CANCELLED"].includes(task.status)) continue;
        if (
          run.edges.some((edge) => edge.hard && edge.target === task.id) &&
          !taskBlocked(state, run, task)
        )
          enqueue(
            "TASK_UNBLOCKED",
            task.id,
            task.ownerId,
            "All hard prerequisites and waiting periods are satisfied. Review and attest your work.",
          );
        const due = Date.parse(task.baselineDueAt);
        if (!Number.isFinite(due)) continue;
        const blockedBy = run.edges
          .filter((edge) => edge.target === task.id && edge.hard)
          .map((edge) =>
            run.tasks.find((candidate) => candidate.id === edge.source),
          )
          .filter(
            (candidate): candidate is typeof task =>
              !!candidate &&
              !(candidate.status === "COMPLETE" && !candidate.invalidated),
          );
        const overdueBlockers = blockedBy.filter(
          (candidate) => Date.parse(candidate.baselineDueAt) < nowMs,
        );
        if (overdueBlockers.length)
          enqueue(
            "TASK_BLOCKED",
            task.id,
            task.ownerId,
            `This task is blocked by overdue prerequisite work (${overdueBlockers.map((item) => item.title).join(", ")}).`,
          );
        else if (due < nowMs)
          enqueue(
            "TASK_LATE",
            task.id,
            task.ownerId,
            taskBlocked(state, run, task)
              ? "An assigned workflow task is overdue and blocked by prerequisite work."
              : "An assigned workflow task is past its deadline.",
          );
        else if (due <= soonMs)
          enqueue(
            "DUE_SOON",
            task.id,
            task.ownerId,
            "An assigned workflow task is due soon.",
          );
      }
  });
}

export type WorkerResult = {
  processed: boolean;
  eventId?: string;
  status?: OutboxEvent["status"];
};

/** Claims and processes one outbox item. At-least-once delivery is explicit; business mutations remain idempotent. */
export async function processOutboxOnce(): Promise<WorkerResult> {
  await enqueueDueNotifications();
  const claimed = await claimOne();
  if (!claimed) return { processed: false };
  const { event, recipient } = claimed;
  const preference = (await readState()).notificationPreferences?.find(
    (item) => item.userId === event.recipientId,
  );
  if (preference?.emailEnabled === false) {
    const accepted = await finish(event as LeasedEvent, {
      sent: false,
      dryRun: true,
      error: "Email notifications are disabled by the recipient.",
    });
    const state = await readState();
    return {
      processed: true,
      eventId: event.id,
      status: accepted
        ? "DRY_RUN"
        : state.outbox.find((item) => item.id === event.id)?.status,
    };
  }
  if (!configuredSend()) {
    const accepted = await finish(event as LeasedEvent, {
      sent: false,
      dryRun: true,
      error: "Notification sending is disabled; dry run recorded.",
    });
    const state = await readState();
    return {
      processed: true,
      eventId: event.id,
      status: accepted
        ? "DRY_RUN"
        : state.outbox.find((item) => item.id === event.id)?.status,
    };
  }
  try {
    if (!recipient?.active || !recipient.email)
      throw new DomainError(422, "Notification recipient is not provisioned.");
    await graphSend(event, recipient);
    const accepted = await finish(event as LeasedEvent, { sent: true });
    const state = accepted ? undefined : await readState();
    return {
      processed: true,
      eventId: event.id,
      status: accepted
        ? "SENT"
        : state?.outbox.find((item) => item.id === event.id)?.status,
    };
  } catch (error) {
    const accepted = await finish(event as LeasedEvent, {
      sent: false,
      error:
        error instanceof Error
          ? error.message
          : "Notification provider failed.",
    });
    const state = await readState();
    return {
      processed: true,
      eventId: event.id,
      status: state.outbox.find((item) => item.id === event.id)?.status,
    };
  }
}

export async function processOutboxUntilEmpty(maxItems = 100) {
  const results: WorkerResult[] = [];
  for (let i = 0; i < maxItems; i++) {
    const result = await processOutboxOnce();
    results.push(result);
    if (!result.processed) break;
  }
  return results;
}
