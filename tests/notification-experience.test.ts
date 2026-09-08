import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AppState, OutboxEvent, Principal } from "@/lib/types";
import {
  notificationDeepLink,
  notificationQuietUntil,
  processOutboxOnce,
} from "@/server/notifications";
import { handleNotificationCommand } from "@/server/notification-commands";
import { DomainError } from "@/server/domain";

const manager: Principal = {
  id: "manager",
  name: "Manager",
  email: "manager@example.test",
  roles: ["manager"],
  entities: ["NA"],
  active: true,
};
const reviewer: Principal = {
  id: "reviewer",
  name: "Reviewer",
  email: "reviewer@example.test",
  roles: ["reviewer"],
  entities: ["NA"],
  active: true,
};
const other: Principal = {
  id: "other",
  name: "Other",
  email: "other@example.test",
  roles: ["reviewer"],
  entities: ["NA"],
  active: true,
};
function state(): AppState {
  return {
    revision: 0,
    users: [manager, reviewer, other],
    packages: [
      {
        id: "package-1",
        title: "Review",
        period: "2026-09",
        entity: "NA",
        dueAt: "2026-09-10T00:00:00Z",
        currentVersionId: "v",
        status: "IN_REVIEW",
        revision: 0,
      },
    ],
    versions: [
      {
        id: "v",
        packageId: "package-1",
        number: 1,
        fileId: "file",
        sha256: "",
        filename: "review.pdf",
        pageCount: 1,
        scan: "CLEAN",
        status: "PUBLISHED",
        producedAt: "2026-09-01T00:00:00Z",
        uploadedAt: "2026-09-01T00:00:00Z",
        publishedAt: "2026-09-01T00:00:00Z",
        sections: [],
        revision: 0,
      },
    ],
    assignments: [
      {
        id: "assignment-1",
        versionId: "v",
        sectionId: "s",
        reviewerId: reviewer.id,
        entity: "NA",
        dueAt: "2026-09-10T00:00:00Z",
        responses: [],
        history: [],
        status: "NOT_STARTED",
        revision: 0,
      },
    ],
    signatures: [],
    signatureEvents: [],
    comments: [],
    audit: [],
    outbox: [],
    templates: [],
    runs: [],
    evidence: [],
    idempotency: [],
    notificationPreferences: [],
    notificationReceipts: [],
  };
}
function event(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: "event-1",
    type: "REVIEW_LATE",
    subjectId: "assignment-1",
    recipientId: reviewer.id,
    message: "Late",
    status: "FAILED",
    attempts: 6,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}
function expectStatus(fn: () => unknown, status: number) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).status).toBe(status);
    return;
  }
  throw new Error("Expected DomainError");
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.WORKEVA_LOCAL_MODE;
  delete process.env.WORKEVA_STATE_FILE;
  delete process.env.WORKEVA_NOTIFICATION_SEND;
  delete process.env.WORKEVA_NOTIFICATION_PROVIDER;
});

describe("notification experience", () => {
  it("handles normal and overnight quiet-hour boundaries", () => {
    const preference = {
      userId: reviewer.id,
      timezone: "UTC",
      quietHours: { start: "22:00", end: "07:00" },
    };
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-01T21:59:00Z")),
    ).toBeUndefined();
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-01T22:00:00Z")),
    ).toBe(Date.parse("2026-09-02T07:00:00Z"));
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-02T06:59:00Z")),
    ).toBe(Date.parse("2026-09-02T07:00:00Z"));
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-02T07:00:00Z")),
    ).toBeUndefined();
  });

  it("evaluates quiet hours in the saved timezone", () => {
    const preference = {
      userId: reviewer.id,
      timezone: "America/New_York",
      quietHours: { start: "22:00", end: "07:00" },
    };
    // 02:00 UTC is 22:00 in New York during daylight saving time.
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-02T02:00:00Z")),
    ).toBe(Date.parse("2026-09-02T11:00:00Z"));
    expect(
      notificationQuietUntil(preference, Date.parse("2026-09-02T11:00:00Z")),
    ).toBeUndefined();
  });

  it("builds issue, review, and task deep links without losing the subject id", () => {
    expect(
      notificationDeepLink(
        { type: "ISSUE_COMMENTED", subjectId: "issue/1" },
        "https://workeva.test",
      ),
    ).toBe("https://workeva.test/issues?issueId=issue%2F1");
    expect(
      notificationDeepLink(
        { type: "REVIEW_LATE", subjectId: "assignment-1" },
        "https://workeva.test/",
      ),
    ).toBe("https://workeva.test/reviews?assignmentId=assignment-1");
    expect(
      notificationDeepLink(
        { type: "TASK_LATE", subjectId: "task-1" },
        "https://workeva.test",
      ),
    ).toBe("https://workeva.test/tasks?taskId=task-1");
    expect(
      notificationDeepLink(
        { type: "DUE_SOON", subjectId: "task-1" },
        "https://workeva.test",
      ),
    ).toBe("https://workeva.test/tasks?taskId=task-1");
  });

  it("requires the current preference revision for edits", () => {
    const s = state();
    handleNotificationCommand(s, reviewer, {
      type: "saveNotificationPreferences",
      preference: {
        emailEnabled: true,
        reminderIntervalMinutes: 60,
        timezone: "UTC",
      },
    });
    expect(s.notificationPreferences?.[0]).toMatchObject({
      revision: 1,
      reminderIntervalMinutes: 60,
    });
    expectStatus(
      () =>
        handleNotificationCommand(s, reviewer, {
          type: "saveNotificationPreferences",
          preference: {
            emailEnabled: false,
            reminderIntervalMinutes: 120,
            timezone: "UTC",
          },
        }),
      409,
    );
    handleNotificationCommand(s, reviewer, {
      type: "saveNotificationPreferences",
      expectedRevision: 1,
      preference: {
        emailEnabled: false,
        reminderIntervalMinutes: 120,
        timezone: "UTC",
      },
    });
    expect(s.notificationPreferences?.[0]).toMatchObject({
      revision: 2,
      emailEnabled: false,
      reminderIntervalMinutes: 120,
    });
  });

  it("restricts nudges and rate-limits the same recipient and subject", () => {
    const s = state();
    expectStatus(
      () =>
        handleNotificationCommand(s, reviewer, {
          type: "nudgeReview",
          assignmentId: "assignment-1",
        }),
      403,
    );
    expect(
      handleNotificationCommand(s, manager, {
        type: "nudgeReview",
        assignmentId: "assignment-1",
      }),
    ).toMatchObject({ type: "REVIEW_NUDGE", recipientId: reviewer.id });
    expectStatus(
      () =>
        handleNotificationCommand(s, manager, {
          type: "nudgeReview",
          assignmentId: "assignment-1",
        }),
      429,
    );
    expect(s.audit.at(-1)).toMatchObject({
      action: "NOTIFICATION_NUDGED",
      subjectId: "assignment-1",
    });
  });

  it("rejects nudges for superseded work and for a caller supplied recipient", () => {
    const s = state();
    expectStatus(
      () =>
        handleNotificationCommand(s, manager, {
          type: "nudgeReview",
          assignmentId: "assignment-1",
          recipientId: other.id,
        }),
      403,
    );
    s.versions[0].status = "SUPERSEDED";
    expectStatus(
      () =>
        handleNotificationCommand(s, manager, {
          type: "nudgeReview",
          assignmentId: "assignment-1",
        }),
      409,
    );

    const active = state();
    active.runs = [
      {
        id: "run-1",
        name: "Close",
        templateId: "template",
        period: "2026-09",
        revision: 0,
        calendar: {
          timezone: "UTC",
          holidays: [],
          weekdays: [1, 2, 3, 4, 5],
          cutoff: "17:00",
        },
        edges: [],
        createdAt: "2026-09-01T00:00:00Z",
        tasks: [
          {
            id: "task-1",
            title: "Task",
            type: "task",
            ownerId: reviewer.id,
            entity: "NA",
            instructions: "",
            dueOffset: 1,
            duration: 1,
            evidenceRequired: false,
            statement: "I attest",
            position: { x: 0, y: 0 },
            status: "IN_PROGRESS",
            revision: 1,
            baselineDueAt: "2026-09-01T00:00:00Z",
            evidenceIds: [],
            invalidated: true,
          },
        ],
      },
    ];
    expect(
      handleNotificationCommand(active, manager, {
        type: "nudgeTask",
        runId: "run-1",
        taskId: "task-1",
      }),
    ).toMatchObject({ type: "TASK_NUDGE", recipientId: reviewer.id });
    active.outbox = [];
    active.runs[0].tasks[0].invalidated = false;
    expectStatus(
      () =>
        handleNotificationCommand(active, manager, {
          type: "nudgeTask",
          runId: "run-1",
          taskId: "task-1",
          recipientId: other.id,
        }),
      403,
    );
    active.runs[0].tasks[0].status = "COMPLETE";
    expectStatus(
      () =>
        handleNotificationCommand(active, manager, {
          type: "nudgeTask",
          runId: "run-1",
          taskId: "task-1",
        }),
      409,
    );
  });

  it("does not allow one recipient to read another recipient's event", () => {
    const s = state();
    s.outbox.push(event());
    expectStatus(
      () =>
        handleNotificationCommand(s, other, {
          type: "markNotificationRead",
          eventId: "event-1",
        }),
      404,
    );
    handleNotificationCommand(s, reviewer, {
      type: "markNotificationRead",
      eventId: "event-1",
    });
    expect(s.notificationReceipts).toHaveLength(1);
    expect(s.notificationReceipts?.[0]).toMatchObject({
      userId: reviewer.id,
      eventId: "event-1",
      readAt: expect.any(String),
    });
  });

  it("marks an alert resolved after the underlying task recovers while preserving delivery history", async () => {
    const s = state();
    s.runs = [
      {
        id: "run-1",
        name: "Close",
        templateId: "template",
        period: "2026-09",
        revision: 0,
        calendar: {
          timezone: "UTC",
          holidays: [],
          weekdays: [1, 2, 3, 4, 5],
          cutoff: "17:00",
        },
        edges: [],
        createdAt: "2026-09-01T00:00:00Z",
        tasks: [
          {
            id: "task-1",
            title: "Task",
            type: "task",
            ownerId: reviewer.id,
            entity: "NA",
            instructions: "",
            dueOffset: 1,
            duration: 1,
            evidenceRequired: false,
            statement: "I attest",
            position: { x: 0, y: 0 },
            status: "COMPLETE",
            revision: 1,
            baselineDueAt: "2026-09-01T00:00:00Z",
            evidenceIds: [],
          },
        ],
      },
    ];
    s.outbox.push(
      event({
        id: "late-1",
        type: "TASK_LATE",
        subjectId: "task-1",
        status: "PENDING",
        attempts: 0,
      }),
    );
    s.notificationReceipts?.push({
      id: "receipt-1",
      userId: reviewer.id,
      eventId: "late-1",
      causeEventId: "late-1",
    });
    const path = join(process.cwd(), `.notification-test-${process.pid}.json`);
    await writeFile(path, JSON.stringify(s), "utf8");
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = path;
    const result = await processOutboxOnce();
    expect(result.processed).toBe(true);
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    ) as AppState;
    expect(saved.notificationReceipts?.[0].resolvedAt).toEqual(
      expect.any(String),
    );
    expect(saved.outbox.find((item) => item.id === "late-1")?.status).toBe(
      "DRY_RUN",
    );
    await rm(path, { force: true });
  });

  it("defers an email during quiet hours without consuming a retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-01T12:00:00.000Z"));
    const s = state();
    s.notificationPreferences?.push({
      userId: reviewer.id,
      emailEnabled: true,
      timezone: "UTC",
      quietHours: { start: "00:00", end: "23:59" },
      reminderIntervalMinutes: 60,
    });
    s.outbox.push(event({ id: "quiet-1", status: "PENDING", attempts: 0 }));
    const path = join(process.cwd(), `.notification-quiet-${process.pid}.json`);
    await writeFile(path, JSON.stringify(s), "utf8");
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = path;
    const result = await processOutboxOnce();
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    ) as AppState;
    expect(result.processed).toBe(false);
    expect(saved.outbox.find((item) => item.id === "quiet-1")).toMatchObject({
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: "2026-09-01T23:59:00.000Z",
    });
    await rm(path, { force: true });
  });

  it("records an email opt-out as a local dry run and never sends mail", async () => {
    const s = state();
    s.notificationPreferences?.push({
      userId: reviewer.id,
      emailEnabled: false,
      timezone: "UTC",
      reminderIntervalMinutes: 60,
    });
    s.outbox.push(event({ id: "opt-out-1", status: "PENDING", attempts: 0 }));
    const path = join(
      process.cwd(),
      `.notification-optout-${process.pid}.json`,
    );
    await writeFile(path, JSON.stringify(s), "utf8");
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = path;
    const result = await processOutboxOnce();
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    ) as AppState;
    expect(result.status).toBe("DRY_RUN");
    expect(saved.outbox.find((item) => item.id === "opt-out-1")).toMatchObject({
      status: "DRY_RUN",
      error: "Email notifications are disabled by the recipient.",
    });
    await rm(path, { force: true });
  });

  it("suppresses a queued review reminder after reassignment", async () => {
    const s = state();
    s.packages[0].dueAt = "2030-09-10T00:00:00Z";
    s.outbox.push(
      event({
        id: "stale-1",
        recipientId: other.id,
        status: "PENDING",
        attempts: 0,
      }),
    );
    const path = join(process.cwd(), `.notification-stale-${process.pid}.json`);
    await writeFile(path, JSON.stringify(s), "utf8");
    process.env.WORKEVA_LOCAL_MODE = "true";
    process.env.WORKEVA_STATE_FILE = path;
    const result = await processOutboxOnce();
    const saved = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    ) as AppState;
    expect(result.processed).toBe(false);
    expect(saved.outbox.find((item) => item.id === "stale-1")).toMatchObject({
      status: "DRY_RUN",
      error: expect.stringContaining("no longer owns"),
    });
    expect(
      saved.notificationReceipts?.some(
        (receipt) =>
          receipt.eventId === "stale-1" && receipt.userId === other.id,
      ),
    ).toBe(true);
    await rm(path, { force: true });
  });
});
