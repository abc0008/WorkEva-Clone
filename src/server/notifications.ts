import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import type { OutboxEvent, Principal } from "@/lib/types";
import { DomainError, now } from "./domain";
import { readState, transact } from "./store";
import { taskBlocked } from "./workflow";

const LEASE_MS = 60_000;
const SEND_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];
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

function deepLink(event: OutboxEvent): string {
  const encoded = encodeURIComponent(event.subjectId);
  const path = event.type.startsWith("REVIEW_")
    ? `/reviews?assignmentId=${encoded}`
    : event.type.startsWith("TASK_") ||
        event.type.startsWith("WORKFLOW_") ||
        event.type.startsWith("DOCUMENT_GATE_")
      ? `/tasks?taskId=${encoded}`
      : `/dashboard?subjectId=${encoded}`;
  return `${appBaseUrl()}${path}`;
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
              content: `${event.message}\n\nOpen WorkEva: ${deepLink(event)}`,
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
    const event = state.outbox.find(
      (item) =>
        (item.status === "PENDING" &&
          parseDate(item.nextAttemptAt) <= current) ||
        (item.status === "PROCESSING" &&
          !!item.leaseUntil &&
          Number.isFinite(parseDate(item.leaseUntil)) &&
          parseDate(item.leaseUntil) <= current),
    );
    if (!event) return undefined;
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
    const nowMs = Date.now();
    const soonMs = nowMs + 24 * 60 * 60 * 1000;
    const enqueue = (
      type: string,
      subjectId: string,
      recipientId: string,
      message: string,
    ) => {
      if (
        !recipientId ||
        state.outbox.some(
          (event) =>
            event.type === type &&
            event.subjectId === subjectId &&
            event.recipientId === recipientId &&
            ["PENDING", "PROCESSING", "SENT", "DRY_RUN", "FAILED"].includes(
              event.status,
            ),
        )
      )
        return;
      state.outbox.push({
        id: randomUUID(),
        type,
        subjectId,
        recipientId,
        message,
        status: "PENDING",
        attempts: 0,
        createdAt: now(),
      });
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
