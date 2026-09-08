import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import type {
  AppState,
  Assignment,
  Command,
  Principal,
  Task,
  WorkflowRun,
} from "@/lib/types";
import type {
  NotificationPreference,
  QuietHours,
} from "@/lib/notification-types";
import {
  DomainError,
  audit,
  notify,
  now,
  requireEntity,
  requireText,
} from "./domain";

const DEFAULT_INTERVAL_MINUTES = 24 * 60;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const NUDGE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00" };

function text(value: unknown, label: string, max = 200): string {
  return requireText(value, label, max);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError(422, `${label} is invalid.`);
  return value as Record<string, unknown>;
}
function ensureArrays(state: AppState) {
  state.notificationPreferences ??= [];
  state.notificationReceipts ??= [];
}
function parseTime(value: unknown, label: string): string {
  const result = text(value, label, 5);
  if (!/^\d{2}:\d{2}$/.test(result))
    throw new DomainError(422, `${label} must use HH:mm.`);
  const [hour, minute] = result.split(":").map(Number);
  if (hour > 23 || minute > 59)
    throw new DomainError(422, `${label} must use HH:mm.`);
  return result;
}
function parsePreference(
  state: AppState,
  actor: Principal,
  input: unknown,
): NotificationPreference {
  const value = record(input, "preference");
  const userId =
    value.userId === undefined
      ? actor.id
      : text(value.userId, "preference.userId");
  if (userId !== actor.id)
    throw new DomainError(
      403,
      "You can only change your own notification preferences.",
    );
  if (!state.users.some((user) => user.id === userId))
    throw new DomainError(404, "Notification preference user was not found.");

  const emailEnabled =
    value.emailEnabled === undefined ? true : value.emailEnabled;
  if (typeof emailEnabled !== "boolean")
    throw new DomainError(
      422,
      "preference.emailEnabled must be true or false.",
    );
  const intervalValue = value.reminderIntervalMinutes;
  const reminderIntervalMinutes =
    intervalValue === undefined ? DEFAULT_INTERVAL_MINUTES : intervalValue;
  if (
    typeof reminderIntervalMinutes !== "number" ||
    !Number.isInteger(reminderIntervalMinutes) ||
    reminderIntervalMinutes < MIN_INTERVAL_MINUTES ||
    reminderIntervalMinutes > MAX_INTERVAL_MINUTES
  )
    throw new DomainError(
      422,
      `preference.reminderIntervalMinutes must be an integer from ${MIN_INTERVAL_MINUTES} to ${MAX_INTERVAL_MINUTES}.`,
    );
  const timezone =
    value.timezone === undefined
      ? "UTC"
      : text(value.timezone, "preference.timezone", 100);
  if (!DateTime.now().setZone(timezone).isValid)
    throw new DomainError(422, "preference.timezone is invalid.");
  const quietValue = value.quietHours;
  let quietHours: QuietHours = { ...DEFAULT_QUIET_HOURS };
  if (quietValue !== undefined) {
    const quiet = record(quietValue, "preference.quietHours");
    quietHours = {
      start: parseTime(quiet.start, "preference.quietHours.start"),
      end: parseTime(quiet.end, "preference.quietHours.end"),
    };
  } else if (
    value.quietHoursStart !== undefined ||
    value.quietHoursEnd !== undefined
  ) {
    quietHours = {
      start: parseTime(value.quietHoursStart, "preference.quietHoursStart"),
      end: parseTime(value.quietHoursEnd, "preference.quietHoursEnd"),
    };
  }
  const bypassValue = value.urgentBypassQuietHours ?? false;
  if (typeof bypassValue !== "boolean")
    throw new DomainError(
      422,
      "preference.urgentBypassQuietHours must be true or false.",
    );
  return {
    userId,
    revision: 0,
    emailEnabled,
    reminderIntervalMinutes,
    timezone,
    quietHours,
    urgentBypassQuietHours: bypassValue,
  };
}
function savePreferences(state: AppState, actor: Principal, command: Command) {
  ensureArrays(state);
  const value = command.preference ?? command.preferences;
  const inputs = Array.isArray(value) ? value : [value ?? command];
  if (!inputs.length)
    throw new DomainError(422, "At least one preference is required.");
  const saved: NotificationPreference[] = [];
  for (const input of inputs) {
    const preference = parsePreference(state, actor, input);
    const index = state.notificationPreferences!.findIndex(
      (item) => item.userId === actor.id,
    );
    const previous =
      index >= 0 ? state.notificationPreferences![index] : undefined;
    const expectedRevision =
      input &&
      typeof input === "object" &&
      "expectedRevision" in (input as object)
        ? (input as Record<string, unknown>).expectedRevision
        : command.expectedRevision;
    if (previous) {
      if (
        expectedRevision === undefined ||
        expectedRevision !== (previous.revision ?? 0)
      )
        throw new DomainError(
          409,
          "Notification preferences changed. Refresh and try again.",
        );
    }
    preference.revision = (previous?.revision ?? 0) + 1;
    if (index >= 0) state.notificationPreferences![index] = preference;
    else state.notificationPreferences!.push(preference);
    saved.push(structuredClone(preference));
  }
  audit(state, actor, "NOTIFICATION_PREFERENCES_SAVED", actor.id);
  return Array.isArray(value) ? saved : saved[0];
}
function activeRecipient(
  state: AppState,
  idValue: unknown,
  label: string,
): Principal {
  const recipient = state.users.find((user) => user.id === idValue);
  if (!recipient || !recipient.active)
    throw new DomainError(404, `${label} was not found.`);
  if (!recipient.email)
    throw new DomainError(422, `${label} has no email address.`);
  return recipient;
}
function canNudge(actor: Principal) {
  return actor.roles.some((role) =>
    ["admin", "manager", "publisher"].includes(role as string),
  );
}
function assertNudgeScope(actor: Principal, subjectEntity: string) {
  if (!canNudge(actor))
    throw new DomainError(
      403,
      "Only an administrator, manager, or publisher may send reminders.",
    );
  requireEntity(actor, subjectEntity);
}
function rateLimit(
  state: AppState,
  type: string,
  subjectId: string,
  recipientId: string,
) {
  const nowMs = Date.now();
  const prior = state.outbox
    .filter(
      (event) =>
        event.type === type &&
        event.subjectId === subjectId &&
        event.recipientId === recipientId,
    )
    .map((event) => Date.parse(event.createdAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (prior !== undefined && nowMs - prior < NUDGE_WINDOW_MS)
    throw new DomainError(
      429,
      "A reminder for this person and item was sent recently.",
    );
}
function findAssignment(state: AppState, value: unknown): Assignment {
  const assignmentId = text(value, "assignmentId");
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw new DomainError(404, "Review assignment not found.");
  return assignment;
}
function findTask(
  state: AppState,
  runValue: unknown,
  taskValue: unknown,
): { run: WorkflowRun; task: Task } {
  const runId = text(runValue, "runId");
  const taskId = text(taskValue, "taskId");
  const run = state.runs.find((item) => item.id === runId);
  const task = run?.tasks.find((item) => item.id === taskId);
  if (!run || !task) throw new DomainError(404, "Workflow task was not found.");
  return { run, task };
}
function nudgeReview(state: AppState, actor: Principal, command: Command) {
  const assignment = findAssignment(state, command.assignmentId);
  const version = state.versions.find(
    (item) => item.id === assignment.versionId,
  );
  const pkg =
    version && state.packages.find((item) => item.id === version.packageId);
  if (
    ["SIGNED", "SUPERSEDED"].includes(assignment.status as string) ||
    !version ||
    version.status !== "PUBLISHED" ||
    !pkg ||
    pkg.currentVersionId !== version.id
  )
    throw new DomainError(409, "This review is no longer active.");
  assertNudgeScope(actor, assignment.entity);
  const recipientId = assignment.reviewerId;
  const recipient = activeRecipient(
    state,
    command.recipientId ?? recipientId,
    "Notification recipient",
  );
  requireEntity(recipient, assignment.entity);
  if (command.recipientId !== undefined && command.recipientId !== recipientId)
    throw new DomainError(
      403,
      "The reminder recipient is not assigned to this review.",
    );
  rateLimit(state, "REVIEW_NUDGE", assignment.id, recipientId);
  const message =
    typeof command.message === "string" && command.message.trim()
      ? command.message.trim().slice(0, 500)
      : "A manager sent a reminder for your assigned review.";
  notify(state, "REVIEW_NUDGE", assignment.id, recipientId, message);
  audit(
    state,
    actor,
    "NOTIFICATION_NUDGED",
    assignment.id,
    `recipient=${recipientId};kind=review`,
  );
  return { subjectId: assignment.id, recipientId, type: "REVIEW_NUDGE" };
}
function nudgeTask(state: AppState, actor: Principal, command: Command) {
  const { task } = findTask(state, command.runId, command.taskId);
  if (["COMPLETE", "CANCELLED", "SUPERSEDED"].includes(task.status as string))
    throw new DomainError(409, "This task is already closed.");
  assertNudgeScope(actor, task.entity);
  const recipientId = task.ownerId;
  const recipient = activeRecipient(
    state,
    command.recipientId ?? recipientId,
    "Notification recipient",
  );
  requireEntity(recipient, task.entity);
  if (command.recipientId !== undefined && command.recipientId !== recipientId)
    throw new DomainError(
      403,
      "The reminder recipient is not assigned to this task.",
    );
  rateLimit(state, "TASK_NUDGE", task.id, recipientId);
  const message =
    typeof command.message === "string" && command.message.trim()
      ? command.message.trim().slice(0, 500)
      : `A manager sent a reminder for your workflow task: ${task.title}.`;
  notify(state, "TASK_NUDGE", task.id, recipientId, message);
  audit(
    state,
    actor,
    "NOTIFICATION_NUDGED",
    task.id,
    `recipient=${recipientId};kind=task`,
  );
  return { subjectId: task.id, recipientId, type: "TASK_NUDGE" };
}
function markRead(state: AppState, actor: Principal, command: Command) {
  ensureArrays(state);
  const eventId = text(
    command.eventId ?? command.notificationId ?? command.id,
    "eventId",
  );
  const event = state.outbox.find(
    (item) => item.id === eventId && item.recipientId === actor.id,
  );
  if (!event) throw new DomainError(404, "Notification not found.");
  let receipt = state.notificationReceipts!.find(
    (item) => item.eventId === eventId && item.userId === actor.id,
  );
  if (!receipt) {
    receipt = {
      id: randomUUID(),
      eventId,
      userId: actor.id,
      causeEventId: event.id,
      createdAt: event.createdAt,
    };
    state.notificationReceipts!.push(receipt);
  }
  receipt.readAt ??= now();
  audit(state, actor, "NOTIFICATION_READ", eventId);
  return structuredClone(receipt);
}

/** Command handler used by executeCommand; unrelated commands return null. */
export function handleNotificationCommand(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown | null {
  switch (command.type) {
    case "markNotificationRead":
      return markRead(state, actor, command);
    case "saveNotificationPreferences":
      return savePreferences(state, actor, command);
    case "nudgeReview":
      return nudgeReview(state, actor, command);
    case "nudgeTask":
      return nudgeTask(state, actor, command);
    default:
      return null;
  }
}

export const notificationPreferenceBounds = {
  minReminderIntervalMinutes: MIN_INTERVAL_MINUTES,
  maxReminderIntervalMinutes: MAX_INTERVAL_MINUTES,
};
