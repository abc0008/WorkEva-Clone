/** Per-user controls for the notification worker and inbox. */
export type QuietHours = {
  /** Local wall-clock time in HH:mm. */
  start: string;
  /** Local wall-clock time in HH:mm. An end earlier than start crosses midnight. */
  end: string;
};

export type NotificationPreference = {
  userId: string;
  revision?: number;
  emailEnabled?: boolean;
  reminderIntervalMinutes?: number;
  timezone?: string;
  quietHours?: QuietHours;
  /** Flat names are accepted for state migrated from the notification table. */
  quietHoursStart?: string;
  quietHoursEnd?: string;
  /** An explicit opt-in allowing urgent notifications through quiet hours. */
  urgentBypassQuietHours?: boolean;
};

/** A receipt belongs to one user and one durable outbox event. */
export type NotificationReceipt = {
  id?: string;
  userId: string;
  eventId: string;
  readAt?: string;
  resolvedAt?: string;
  /** Event which caused an alert to appear, retained for recovery evidence. */
  causeEventId?: string;
  resolution?: string;
  snoozedUntil?: string;
  createdAt?: string;
};

export type NotificationCategory =
  | "assignment"
  | "alert"
  | "mention"
  | "digest";

export function notificationCategory(type: string): NotificationCategory {
  const value = type.toUpperCase();
  if (value.includes("MENTION")) return "mention";
  if (value.includes("DIGEST")) return "digest";
  if (
    value.includes("LATE") ||
    value.includes("BLOCKED") ||
    value.includes("ALERT") ||
    value.includes("BREACH") ||
    value.includes("DELAY") ||
    value.includes("RECOVER")
  )
    return "alert";
  return "assignment";
}

export function isUrgentNotification(type: string): boolean {
  const value = type.toUpperCase();
  return (
    value.startsWith("URGENT_") ||
    value.startsWith("CRITICAL_") ||
    value.includes("DEADLINE_BREACH")
  );
}
