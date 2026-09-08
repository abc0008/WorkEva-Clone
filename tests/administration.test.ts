import { describe, expect, it } from "vitest";
import { seedState } from "@/lib/seed";
import {
  handleAdministrationCommand,
  applyAssignmentRules,
} from "@/server/administration";
import { handleReviewCommand } from "@/server/review";
import type { Principal } from "@/lib/types";

const admin: Principal = {
  id: "admin",
  name: "Casey Rivera",
  email: "casey@example.invalid",
  roles: ["admin"],
  entities: ["*"],
  active: true,
};

describe("assignment administration", () => {
  it("validates dated rule scope and rejects overlapping ownership windows", () => {
    const state = seedState();
    const saved = handleAdministrationCommand(state, admin, {
      type: "saveAssignmentRule",
      rule: {
        id: "al-rule",
        entity: "AL",
        sectionId: "al",
        primaryReviewerId: "avery",
        effectiveFrom: "2026-09-01",
      },
    }) as { revision: number };
    expect(saved.revision).toBe(0);
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "saveAssignmentRule",
        rule: {
          id: "al-rule-2",
          entity: "AL",
          sectionId: "al",
          primaryReviewerId: "avery",
          effectiveFrom: "2026-09-15",
        },
      }),
    ).toThrow(/overlap/i);
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "saveAssignmentRule",
        rule: {
          id: "tn-rule",
          entity: "TN",
          sectionId: "tn",
          primaryReviewerId: "avery",
          effectiveFrom: "2026-09-01",
        },
      }),
    ).toThrow(/scope/i);
  });

  it("uses the dated rule for matching publication sections and keeps manual fallback", () => {
    const state = seedState();
    handleAdministrationCommand(state, admin, {
      type: "saveAssignmentRule",
      rule: {
        id: "al-rule",
        entity: "AL",
        sectionId: "al",
        primaryReviewerId: "publisher",
        effectiveFrom: "2026-01-01",
      },
    });
    const version = structuredClone(state.versions[0]);
    version.status = "DRAFT";
    applyAssignmentRules(state, admin, version);
    expect(
      version.sections.find((section) => section.id === "al")?.reviewerIds,
    ).toEqual(["publisher"]);
    expect(
      version.sections.find((section) => section.id === "tn")?.reviewerIds,
    ).toEqual(["jordan"]);
  });

  it("rejects stale user edits and prevents removing the last administrator", () => {
    const state = seedState();
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "upsertUser",
        user: {
          id: "admin",
          name: admin.name,
          email: admin.email,
          roles: ["admin"],
          entities: ["*"],
          active: true,
        },
        expectedRevision: 99,
      }),
    ).toThrow(/changed|refresh/i);
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "upsertUser",
        user: {
          id: "admin",
          name: admin.name,
          email: admin.email,
          roles: ["reviewer"],
          entities: ["*"],
          active: true,
        },
        expectedRevision: 0,
      }),
    ).toThrow(/lock yourself|administrator/i);
  });

  it("moves prior responses to immutable ownership history and invalidates signatures", () => {
    const state = seedState();
    const assignment = state.assignments[0];
    for (const metricId of ["loans", "deposits", "nii", "salary", "opex"]) {
      handleReviewCommand(state, state.users[0], {
        type: "saveResponse",
        assignmentId: assignment.id,
        metricId,
        answer: "OKAY",
        comment: "",
        expectedRevision: state.assignments[0].revision,
      });
    }
    const saved = state.assignments[0];
    handleReviewCommand(state, state.users[0], {
      type: "submitReview",
      assignmentId: assignment.id,
      expectedRevision: saved.revision,
    });
    const submitted = state.assignments[0];
    handleReviewCommand(state, state.users[0], {
      type: "signReview",
      assignmentId: assignment.id,
      expectedRevision: submitted.revision,
      idempotencyKey: "sign-1",
    });
    const before = state.assignments[0];
    const reassigned = handleAdministrationCommand(state, admin, {
      type: "reassignReview",
      assignmentId: before.id,
      newReviewerId: "publisher",
      reason: "Coverage change",
      expectedRevision: before.revision,
    }) as typeof before;
    expect(reassigned.reviewerId).toBe("publisher");
    expect(reassigned.responses).toEqual([]);
    expect(reassigned.history.some((response) => response.by === "avery")).toBe(
      true,
    );
    expect(state.assignmentChanges?.[0].previousResponses).toHaveLength(5);
    expect(state.signatureEvents.length).toBeGreaterThan(0);
    expect(
      state.outbox.some(
        (event) =>
          event.type === "REVIEW_REASSIGNED" &&
          event.recipientId === "publisher",
      ),
    ).toBe(true);
  });

  it("uses real calendar dates and treats effective-to as inclusive", () => {
    const state = seedState();
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "saveAssignmentRule",
        rule: {
          id: "bad-date",
          entity: "AL",
          primaryReviewerId: "avery",
          effectiveFrom: "2026-02-30",
        },
      }),
    ).toThrow(/valid YYYY-MM-DD/i);

    handleAdministrationCommand(state, admin, {
      type: "saveAssignmentRule",
      rule: {
        id: "al-through-september",
        entity: "AL",
        primaryReviewerId: "avery",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-09-30",
      },
    });
    const version = structuredClone(state.versions[0]);
    version.producedAt = "2026-09-30T23:59:59.000Z";
    applyAssignmentRules(state, admin, version);
    expect(
      version.sections.find((section) => section.id === "al")?.reviewerIds,
    ).toEqual(["avery"]);

    state.assignmentRules!.push({
      id: "corrupt",
      entity: "AL",
      primaryReviewerId: "avery",
      effectiveFrom: "2026-09-31",
      revision: 0,
    });
    expect(() =>
      applyAssignmentRules(state, admin, structuredClone(version)),
    ).toThrow(/valid YYYY-MM-DD/i);
  });

  it("does not let a scoped administrator edit foreign old scope or grant wildcard access", () => {
    const state = seedState();
    const scopedAdmin: Principal = {
      id: "al-admin",
      name: "AL Admin",
      email: "al-admin@example.invalid",
      roles: ["admin"],
      entities: ["AL"],
      active: true,
      revision: 0,
    };
    state.users.push(scopedAdmin, {
      id: "al-user",
      name: "AL User",
      email: "al-user@example.invalid",
      roles: ["reviewer"],
      entities: ["AL"],
      active: true,
      revision: 0,
    });
    expect(() =>
      handleAdministrationCommand(state, scopedAdmin, {
        type: "upsertUser",
        user: {
          id: "publisher",
          name: "Taylor",
          email: "taylor@example.invalid",
          roles: ["reviewer"],
          entities: ["AL"],
          active: true,
        },
        expectedRevision: 0,
      }),
    ).toThrow(/outside|access/i);
    expect(() =>
      handleAdministrationCommand(state, scopedAdmin, {
        type: "upsertUser",
        user: {
          id: "new-user",
          name: "New User",
          email: "new@example.invalid",
          roles: ["reviewer"],
          entities: ["*"],
          active: true,
        },
      }),
    ).toThrow(/global|scope/i);
    expect(() =>
      handleAdministrationCommand(state, scopedAdmin, {
        type: "saveAssignmentRule",
        rule: {
          id: "foreign",
          entity: "TN",
          primaryReviewerId: "jordan",
          effectiveFrom: "2026-01-01",
        },
      }),
    ).toThrow(/outside|scope/i);
    expect(() =>
      handleAdministrationCommand(state, admin, {
        type: "saveAssignmentRule",
        rule: {
          id: "wildcard-rule",
          entity: "*",
          primaryReviewerId: "avery",
          effectiveFrom: "2026-01-01",
        },
      }),
    ).toThrow(/wildcard|reporting unit/i);
  });

  it("fails an effective rule with no usable required reviewer", () => {
    const state = seedState();
    handleAdministrationCommand(state, admin, {
      type: "saveAssignmentRule",
      rule: {
        id: "al-rule",
        entity: "AL",
        primaryReviewerId: "avery",
        effectiveFrom: "2026-01-01",
        additionalRequiredReviewerIds: ["publisher"],
      },
    });
    state.users.find((user) => user.id === "publisher")!.active = false;
    const version = structuredClone(state.versions[0]);
    expect(() => applyAssignmentRules(state, admin, version)).toThrow(
      /active|reviewer/i,
    );
  });
});
