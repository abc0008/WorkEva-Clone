import { describe, expect, it } from "vitest";
import type { AppState, Principal } from "@/lib/types";
import { DomainError } from "@/server/domain";
import { handleIssueCommand } from "@/server/issues";
import { handleReviewCommand } from "@/server/review";
import { canReadVersion, scopedSnapshot } from "@/server/access";

const publisher: Principal = {
  id: "pub",
  name: "Publisher",
  email: "pub@example.com",
  roles: ["publisher", "manager"],
  entities: ["NA"],
  active: true,
};
const reviewer: Principal = {
  id: "rev",
  name: "Reviewer",
  email: "rev@example.com",
  roles: ["reviewer"],
  entities: ["NA"],
  active: true,
};
const otherReviewer: Principal = {
  id: "other",
  name: "Other",
  email: "other@example.com",
  roles: ["reviewer"],
  entities: ["NA"],
  active: true,
};
const owner: Principal = {
  id: "owner",
  name: "Issue Owner",
  email: "owner@example.com",
  roles: ["reader"],
  entities: ["NA"],
  active: true,
};

function state(): AppState {
  return {
    revision: 0,
    users: [publisher, reviewer, otherReviewer, owner],
    packages: [
      {
        id: "pkg",
        title: "Close",
        period: "2026-08",
        entity: "NA",
        dueAt: "2026-09-10T00:00:00Z",
        currentVersionId: "v1",
        status: "IN_REVIEW",
        revision: 1,
      },
    ],
    versions: [
      {
        id: "v1",
        packageId: "pkg",
        number: 1,
        fileId: "file",
        sha256: "x",
        filename: "close.pdf",
        pageCount: 1,
        scan: "CLEAN",
        status: "PUBLISHED",
        producedAt: "2026-09-01T00:00:00Z",
        uploadedAt: "2026-09-01T00:00:00Z",
        sections: [
          {
            id: "s1",
            name: "North America",
            entity: "NA",
            pages: [1],
            metrics: [{ id: "sales", label: "Sales", required: true }],
            reviewerIds: ["rev"],
          },
        ],
        revision: 1,
      },
    ],
    assignments: [
      {
        id: "a1",
        versionId: "v1",
        sectionId: "s1",
        reviewerId: "rev",
        entity: "NA",
        dueAt: "2026-09-10T00:00:00Z",
        responses: [],
        history: [],
        status: "NOT_STARTED",
        revision: 1,
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
    issues: [],
  };
}

describe("review issues", () => {
  it("allows a separate scoped owner to discuss and propose without granting PDF access", () => {
    const s = state();
    const issue = handleIssueCommand(s, reviewer, {
      type: "createIssue",
      assignmentId: "a1",
      ownerId: owner.id,
      category: "DATA",
      title: "Owner follow-up",
      description: "Needs source support.",
    }) as { id: string; revision: number };
    expect(canReadVersion(s, owner, "v1")).toBe(false);
    expect(
      scopedSnapshot(s, owner, false).issues?.map((item) => item.id),
    ).toContain(issue.id);
    const commented = handleIssueCommand(s, owner, {
      type: "commentIssue",
      issueId: issue.id,
      body: "I will provide the source detail.",
      expectedRevision: issue.revision,
    }) as { revision: number };
    const proposed = handleIssueCommand(s, owner, {
      type: "proposeIssueResolution",
      issueId: issue.id,
      explanation: "Source detail attached.",
      expectedRevision: commented.revision,
    }) as { revision: number };
    expect(() =>
      handleIssueCommand(s, owner, {
        type: "acceptIssueResolution",
        issueId: issue.id,
        expectedRevision: proposed.revision,
      }),
    ).toThrow(DomainError);
    expect(
      (
        handleIssueCommand(s, reviewer, {
          type: "acceptIssueResolution",
          issueId: issue.id,
          expectedRevision: proposed.revision,
        }) as { status: string }
      ).status,
    ).toBe("RESOLVED");
  });

  it("invalidates the assignment signature and final designation when created after sign-off", () => {
    const s = state();
    handleReviewCommand(s, reviewer, {
      type: "saveResponse",
      assignmentId: "a1",
      metricId: "sales",
      answer: "OKAY",
      comment: "",
      expectedRevision: 1,
    });
    const signature = handleReviewCommand(s, reviewer, {
      type: "signReview",
      assignmentId: "a1",
      expectedRevision: 2,
    }) as { id: string };
    s.packages[0].finalVersionId = "v1";
    s.packages[0].status = "FINAL";
    const issue = handleIssueCommand(s, reviewer, {
      type: "createIssue",
      assignmentId: "a1",
      category: "PROCESS",
      title: "Post-sign exception",
      description: "A new exception was found.",
    }) as { status: string };
    expect(issue.status).toBe("OPEN");
    expect(s.assignments[0].signatureId).toBeUndefined();
    expect(
      s.signatureEvents.some((event) => event.signatureId === signature.id),
    ).toBe(true);
    expect(s.packages[0].finalVersionId).toBeUndefined();
    expect(s.packages[0].status).toBe("IN_REVIEW");
  });

  it("keeps an append-only discussion and requires assigned reviewer acceptance", () => {
    const s = state();
    const issue = handleIssueCommand(s, reviewer, {
      type: "createIssue",
      assignmentId: "a1",
      category: "DATA",
      title: "Sales tie out",
      description: "Source total needs reconciliation.",
    }) as { id: string; revision: number; events: unknown[] };
    expect(issue.events).toHaveLength(1);
    const commented = handleIssueCommand(s, publisher, {
      type: "commentIssue",
      issueId: issue.id,
      body: "Please attach the source detail.",
      expectedRevision: issue.revision,
    }) as { revision: number };
    const proposed = handleIssueCommand(s, publisher, {
      type: "proposeIssueResolution",
      issueId: issue.id,
      explanation: "Reconciled to the signed ledger extract.",
      expectedRevision: commented.revision,
    }) as { revision: number };
    const proposedRevision = proposed.revision;
    expect(() =>
      handleIssueCommand(s, otherReviewer, {
        type: "acceptIssueResolution",
        issueId: issue.id,
        expectedRevision: proposedRevision,
      }),
    ).toThrow(DomainError);
    const resolved = handleIssueCommand(s, reviewer, {
      type: "acceptIssueResolution",
      issueId: issue.id,
      expectedRevision: proposedRevision,
    }) as { status: string; events: unknown[] };
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.events).toHaveLength(4);
    expect(() =>
      handleIssueCommand(s, publisher, {
        type: "commentIssue",
        issueId: issue.id,
        body: "stale",
        expectedRevision: proposedRevision,
      }),
    ).toThrow(/changed|refresh/i);
  });

  it("blocks signing while unresolved even after the response is changed to okay", () => {
    const s = state();
    const issue = handleIssueCommand(s, reviewer, {
      type: "createIssue",
      assignmentId: "a1",
      category: "PROCESS",
      title: "Evidence gap",
      description: "Need source support.",
    }) as { id: string };
    handleReviewCommand(s, reviewer, {
      type: "saveResponse",
      assignmentId: "a1",
      metricId: "sales",
      answer: "OKAY",
      comment: "",
      expectedRevision: 1,
    });
    expect(() =>
      handleReviewCommand(s, reviewer, {
        type: "signReview",
        assignmentId: "a1",
        expectedRevision: 2,
      }),
    ).toThrow(/open review issues/i);
    const current = s.issues!.find((item) => item.id === issue.id)!;
    handleIssueCommand(s, publisher, {
      type: "proposeIssueResolution",
      issueId: issue.id,
      explanation: "Support attached.",
      expectedRevision: current.revision,
    });
    const proposed = s.issues!.find((item) => item.id === issue.id)!;
    handleIssueCommand(s, reviewer, {
      type: "acceptIssueResolution",
      issueId: issue.id,
      expectedRevision: proposed.revision,
    });
    const signed = handleReviewCommand(s, reviewer, {
      type: "signReview",
      assignmentId: "a1",
      expectedRevision: 2,
    }) as { id: string };
    expect(signed.id).toBeTruthy();
  });

  it("reopening a resolved issue invalidates the signed review and retains the reason", () => {
    const s = state();
    const issue = handleIssueCommand(s, reviewer, {
      type: "createIssue",
      assignmentId: "a1",
      category: "DISCLOSURE",
      title: "Footnote",
      description: "Footnote needs review.",
    }) as { id: string };
    handleReviewCommand(s, reviewer, {
      type: "saveResponse",
      assignmentId: "a1",
      metricId: "sales",
      answer: "OKAY",
      comment: "",
      expectedRevision: 1,
    });
    const current = s.issues!.find((item) => item.id === issue.id)!;
    handleIssueCommand(s, publisher, {
      type: "proposeIssueResolution",
      issueId: issue.id,
      explanation: "Footnote updated.",
      expectedRevision: current.revision,
    });
    const proposed = s.issues!.find((item) => item.id === issue.id)!;
    handleIssueCommand(s, reviewer, {
      type: "acceptIssueResolution",
      issueId: issue.id,
      expectedRevision: proposed.revision,
    });
    const signed = handleReviewCommand(s, reviewer, {
      type: "signReview",
      assignmentId: "a1",
      expectedRevision: 2,
    }) as { id: string };
    const resolved = s.issues!.find((item) => item.id === issue.id)!;
    const reopened = handleIssueCommand(s, publisher, {
      type: "reopenIssue",
      issueId: issue.id,
      reason: "New source changed the footnote.",
      expectedRevision: resolved.revision,
    }) as { status: string; events: { type: string; reason?: string }[] };
    expect(reopened.status).toBe("OPEN");
    expect(reopened.events.at(-1)).toMatchObject({
      type: "REOPENED",
      reason: "New source changed the footnote.",
    });
    expect(
      s.signatureEvents.some((event) => event.signatureId === signed.id),
    ).toBe(true);
    expect(s.assignments[0].signatureId).toBeUndefined();
  });
});
