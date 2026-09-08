import { describe, expect, it } from "vitest";
import { seedState } from "@/lib/seed";
import { executeCommand } from "@/server/commands";
import { scopedSnapshot, canReadVersion } from "@/server/access";

describe("operational access boundaries", () => {
  it("applies dated rules during publication and pins the ownership decision", () => {
    const state = seedState();
    const admin = state.users.find((user) => user.id === "admin")!;
    const publisher = state.users.find((user) => user.id === "publisher")!;
    const draft = structuredClone(state.versions[0]);
    Object.assign(draft, {
      id: "replacement",
      number: 2,
      status: "DRAFT",
      scan: "CLEAN",
      producedAt: "2026-09-08T23:59:00Z",
    });
    state.versions.push(draft);
    executeCommand(state, admin, {
      type: "saveAssignmentRule",
      rule: {
        id: "september-owner",
        entity: "AL",
        primaryReviewerId: publisher.id,
        effectiveFrom: "2026-09-01",
        effectiveTo: "2026-09-08",
      },
    });
    executeCommand(state, publisher, {
      type: "publishVersion",
      versionId: draft.id,
      expectedRevision: draft.revision,
    });
    expect(
      state.assignments.find(
        (item) => item.versionId === draft.id && item.sectionId === "al",
      )?.reviewerId,
    ).toBe(publisher.id);
    expect(draft.assignmentRuleSnapshot?.[0]).toMatchObject({
      ruleId: "september-owner",
      effectiveDate: "2026-09-08",
      reviewerIds: [publisher.id],
    });
    state.assignmentRules![0].primaryReviewerId = "avery";
    expect(draft.assignmentRuleSnapshot?.[0].reviewerIds).toEqual([
      publisher.id,
    ]);
  });
  it("scopes issues, ownership rules and personal inbox state independently", () => {
    const state = seedState();
    const reviewer = state.users.find((user) => user.id === "avery")!;
    const publisher = state.users.find((user) => user.id === "publisher")!;
    const assignment = state.assignments.find(
      (item) => item.reviewerId === reviewer.id,
    )!;
    const issue = executeCommand(state, reviewer, {
      type: "createIssue",
      assignmentId: assignment.id,
      category: "DATA",
      title: "Reconcile source",
      description: "The source balance needs explanation.",
      ownerId: publisher.id,
    }) as { id: string };
    executeCommand(state, reviewer, {
      type: "saveNotificationPreferences",
      preference: { emailEnabled: false },
    });
    executeCommand(state, publisher, {
      type: "saveNotificationPreferences",
      preference: { emailEnabled: true },
    });
    executeCommand(state, state.users.find((user) => user.id === "admin")!, {
      type: "saveAssignmentRule",
      rule: {
        entity: "AL",
        primaryReviewerId: "avery",
        effectiveFrom: "2026-01-01",
      },
    });
    const own = scopedSnapshot(state, reviewer, false);
    expect(own.issues?.map((item) => item.id)).toContain(issue.id);
    expect(own.notificationPreferences?.map((item) => item.userId)).toEqual([
      reviewer.id,
    ]);
    expect(own.assignmentRules).toEqual([]);
    const scopedManager = { ...publisher, entities: ["TN"] };
    expect(scopedSnapshot(state, scopedManager, false).assignmentRules).toEqual(
      [],
    );
    const other = state.users.find((user) => user.id === "jordan")!;
    expect(scopedSnapshot(state, other, false).issues).toEqual([]);
    expect(scopedSnapshot(state, other, false).notificationPreferences).toEqual(
      [],
    );
    expect(canReadVersion(state, other, assignment.versionId)).toBe(true);
    // Whole-PDF access does not grant access to another reporting unit's issues.
    expect(
      scopedSnapshot(state, other, false).assignments.some(
        (item) => item.id === assignment.id,
      ),
    ).toBe(false);
  });

  it("rechecks administration authorization instead of replaying cached mutations", () => {
    const state = seedState();
    const admin = state.users.find((user) => user.id === "admin")!;
    const command = {
      type: "saveAssignmentRule",
      idempotencyKey: "reused",
      rule: {
        entity: "AL",
        primaryReviewerId: "avery",
        effectiveFrom: "2026-01-01",
      },
    };
    executeCommand(state, admin, command);
    admin.roles = ["reviewer"];
    expect(() => executeCommand(state, admin, command)).toThrow();
  });
});
