import { describe, expect, it } from "vitest";
import type { AppState, Principal, Section } from "@/lib/types";
import { DomainError } from "@/server/domain";
import { handleReviewCommand } from "@/server/review";

const publisher: Principal = {
  id: "pub",
  name: "Publisher",
  email: "pub@example.com",
  roles: ["publisher"],
  entities: ["*"],
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
const manager: Principal = {
  id: "mgr",
  name: "Senior reviewer",
  email: "mgr@example.com",
  roles: ["manager"],
  entities: ["NA"],
  active: true,
};
const admin: Principal = {
  id: "admin",
  name: "Administrator",
  email: "admin@example.com",
  roles: ["admin"],
  entities: ["*"],
  active: true,
};

function state(): AppState {
  return {
    revision: 0,
    users: [publisher, reviewer, manager, admin],
    packages: [],
    versions: [],
    assignments: [],
    signatures: [],
    signatureEvents: [],
    comments: [],
    audit: [],
    outbox: [],
    templates: [],
    runs: [],
    evidence: [
      {
        id: "file-1",
        filename: "blr.pdf",
        sha256: "a".repeat(64),
        pageCount: 5,
        size: 100,
        contentType: "application/pdf",
        uploadedBy: publisher.id,
        uploadedAt: "2026-09-01T00:00:00.000Z",
        scan: "CLEAN",
        entity: "NA",
      },
    ],
    idempotency: [],
  };
}

const sections = (withParent = false): Section[] => [
  {
    id: "child",
    name: "North America",
    entity: "NA",
    pages: [1],
    metrics: [{ id: "sales", label: "Sales", required: true }],
    reviewerIds: ["rev"],
    ...(withParent ? { parentSectionIds: ["root"] } : {}),
  },
  ...(withParent
    ? [
        {
          id: "root",
          name: "Senior review",
          entity: "NA",
          pages: [3],
          metrics: [],
          reviewerIds: ["mgr"],
        } as Section,
      ]
    : []),
];

function createPublished(withParent = false) {
  const s = state();
  const pkg = handleReviewCommand(s, publisher, {
    type: "createPackage",
    title: "BLR",
    period: "2026-08",
    entity: "NA",
    dueAt: "2026-09-10T00:00:00.000Z",
  }) as { id: string; revision: number };
  const version = handleReviewCommand(s, publisher, {
    type: "addVersion",
    packageId: pkg.id,
    fileId: "file-1",
    producedAt: "2026-09-01T00:00:00.000Z",
    sections: withParent ? sections(true) : sections(false),
    expectedRevision: pkg.revision,
  }) as { id: string; revision: number };
  handleReviewCommand(s, publisher, {
    type: "publishVersion",
    versionId: version.id,
    expectedRevision: version.revision,
  });
  return { s, pkg: s.packages[0], version: s.versions[0] };
}

function answerAndSign(s: AppState, assignmentId: string, actor = reviewer) {
  const assignment = s.assignments.find(
    (candidate) => candidate.id === assignmentId,
  )!;
  handleReviewCommand(s, actor, {
    type: "saveResponse",
    assignmentId,
    metricId: "sales",
    answer: "OKAY",
    comment: "",
    expectedRevision: assignment.revision,
  });
  const afterSave = s.assignments.find(
    (candidate) => candidate.id === assignmentId,
  )!;
  return handleReviewCommand(s, actor, {
    type: "signReview",
    assignmentId,
    expectedRevision: afterSave.revision,
  });
}

describe("document review domain", () => {
  it("returns null for unknown commands and enforces publication scope", () => {
    const s = state();
    expect(handleReviewCommand(s, reviewer, { type: "unknown" })).toBeNull();
    expect(() =>
      handleReviewCommand(s, reviewer, {
        type: "createPackage",
        title: "x",
        period: "p",
        entity: "NA",
        dueAt: "2026-09-10T00:00:00Z",
      }),
    ).toThrow(DomainError);
  });

  it("requires explanations, captures immutable signatures, and invalidates on reopen", () => {
    const { s } = createPublished();
    const assignment = s.assignments[0];
    expect(() =>
      handleReviewCommand(s, publisher, {
        type: "saveResponse",
        assignmentId: assignment.id,
        metricId: "sales",
        answer: "OKAY",
        comment: "",
        expectedRevision: assignment.revision,
      }),
    ).toThrow(DomainError);
    expect(() =>
      handleReviewCommand(s, reviewer, {
        type: "saveResponse",
        assignmentId: assignment.id,
        metricId: "sales",
        answer: "NEEDS_EXPLANATION",
        comment: "",
        expectedRevision: 1,
      }),
    ).toThrow(/comment|reason/i);
    handleReviewCommand(s, reviewer, {
      type: "saveResponse",
      assignmentId: assignment.id,
      metricId: "sales",
      answer: "OKAY",
      comment: "",
      expectedRevision: 1,
    });
    expect(
      handleReviewCommand(s, reviewer, {
        type: "submitReview",
        assignmentId: assignment.id,
        expectedRevision: 2,
      }),
    ).toMatchObject({ status: "SUBMITTED" });
    const signed = handleReviewCommand(s, reviewer, {
      type: "signReview",
      assignmentId: assignment.id,
      expectedRevision: 3,
    }) as { id: string; contentHash: string };
    expect(signed.contentHash).toHaveLength(64);
    expect(() =>
      handleReviewCommand(s, reviewer, {
        type: "signReview",
        assignmentId: assignment.id,
        expectedRevision: 4,
      }),
    ).toThrow(/already signed/i);
    const reopened = handleReviewCommand(s, reviewer, {
      type: "reopenReview",
      assignmentId: assignment.id,
      reason: "Recheck source",
      expectedRevision: 4,
    }) as { status: string; signatureId?: string };
    expect(reopened.signatureId).toBeUndefined();
    expect(s.signatureEvents).toHaveLength(1);
    expect(s.signatureEvents[0].signatureId).toBe(signed.id);
    expect(s.signatures[0].statement).toContain("North America");
  });

  it("does not let administrative roles sign or change an assigned review", () => {
    const { s } = createPublished();
    const assignment = s.assignments[0];
    expect(() =>
      handleReviewCommand(s, admin, {
        type: "saveResponse",
        assignmentId: assignment.id,
        metricId: "sales",
        answer: "OKAY",
        comment: "",
        expectedRevision: assignment.revision,
      }),
    ).toThrow(DomainError);
    expect(() =>
      handleReviewCommand(s, admin, {
        type: "submitReview",
        assignmentId: assignment.id,
        expectedRevision: assignment.revision,
      }),
    ).toThrow(DomainError);
    expect(() =>
      handleReviewCommand(s, admin, {
        type: "signReview",
        assignmentId: assignment.id,
        expectedRevision: assignment.revision,
      }),
    ).toThrow(DomainError);
  });

  it("blocks parent signoff until children sign, then invalidates parent on child reopen", () => {
    const { s } = createPublished(true);
    const child = s.assignments.find(
      (assignment) => assignment.sectionId === "child",
    )!;
    const parent = s.assignments.find(
      (assignment) => assignment.sectionId === "root",
    )!;
    expect(() =>
      handleReviewCommand(s, manager, {
        type: "signReview",
        assignmentId: parent.id,
        expectedRevision: parent.revision,
      }),
    ).toThrow(/child/i);
    answerAndSign(s, child.id);
    const parentSignature = handleReviewCommand(s, manager, {
      type: "signReview",
      assignmentId: parent.id,
      expectedRevision: parent.revision,
    }) as { id: string };
    const currentChild = s.assignments.find(
      (assignment) => assignment.id === child.id,
    )!;
    handleReviewCommand(s, reviewer, {
      type: "reopenReview",
      assignmentId: child.id,
      reason: "Correct source",
      expectedRevision: currentChild.revision,
    });
    expect(
      s.signatureEvents.some(
        (event) => event.signatureId === parentSignature.id,
      ),
    ).toBe(true);
    expect(
      s.assignments.find((assignment) => assignment.id === parent.id)
        ?.signatureId,
    ).toBeUndefined();
  });

  it("publishes a replacement with fresh assignments, carries comments, and rejects stale signing", () => {
    const { s, pkg, version } = createPublished();
    const old = s.assignments[0];
    handleReviewCommand(s, reviewer, {
      type: "addComment",
      assignmentId: old.id,
      body: "Please retain this context",
      metricId: "sales",
    });
    answerAndSign(s, old.id);
    const next = handleReviewCommand(s, publisher, {
      type: "addVersion",
      packageId: pkg.id,
      fileId: "file-1",
      producedAt: "2026-09-02T00:00:00.000Z",
      sections: sections(false),
      expectedRevision: pkg.revision,
    }) as { id: string; revision: number };
    handleReviewCommand(s, publisher, {
      type: "publishVersion",
      versionId: next.id,
      expectedRevision: next.revision,
    });
    const fresh = s.assignments.find(
      (assignment) => assignment.versionId === next.id,
    )!;
    expect(fresh.status).toBe("NOT_STARTED");
    expect(fresh.history).toHaveLength(1);
    const carried = s.comments.find(
      (comment) =>
        comment.versionId === next.id &&
        comment.body === "Please retain this context",
    );
    expect(carried?.sourceVersionId).toBe(version.id);
    expect(carried?.sourceCommentId).toBeDefined();
    expect(carried?.originalAt).toBeDefined();
    expect(() =>
      handleReviewCommand(s, reviewer, {
        type: "signReview",
        assignmentId: old.id,
        expectedRevision: old.revision,
      }),
    ).toThrow(/superseded/i);
    expect(
      s.versions.find((candidate) => candidate.id === version.id)?.status,
    ).toBe("SUPERSEDED");
  });

  it("retains original provenance when carried comments roll forward repeatedly", () => {
    const { s, pkg, version } = createPublished();
    const old = s.assignments[0];
    const original = handleReviewCommand(s, reviewer, {
      type: "addComment",
      assignmentId: old.id,
      body: "Original context",
      metricId: "sales",
    }) as { id: string; at: string };
    const v2 = handleReviewCommand(s, publisher, {
      type: "addVersion",
      packageId: pkg.id,
      fileId: "file-1",
      producedAt: "2026-09-02T00:00:00.000Z",
      sections: sections(false),
      expectedRevision: pkg.revision,
    }) as { id: string; revision: number };
    handleReviewCommand(s, publisher, {
      type: "publishVersion",
      versionId: v2.id,
      expectedRevision: v2.revision,
    });
    const v3 = handleReviewCommand(s, publisher, {
      type: "addVersion",
      packageId: pkg.id,
      fileId: "file-1",
      producedAt: "2026-09-03T00:00:00.000Z",
      sections: sections(false),
      expectedRevision: pkg.revision,
    }) as { id: string; revision: number };
    handleReviewCommand(s, publisher, {
      type: "publishVersion",
      versionId: v3.id,
      expectedRevision: v3.revision,
    });
    const carried = s.comments.find(
      (comment) =>
        comment.versionId === v3.id && comment.body === "Original context",
    )!;
    expect(carried.sourceCommentId).toBe(original.id);
    expect(carried.sourceVersionId).toBe(version.id);
    expect(carried.originalAt).toBe(original.at);
  });

  it("finalizes only a fully signed current version", () => {
    const { s, pkg } = createPublished();
    expect(() =>
      handleReviewCommand(s, publisher, {
        type: "finalizePackage",
        packageId: pkg.id,
        expectedRevision: pkg.revision,
      }),
    ).toThrow(/sign-off/i);
    answerAndSign(s, s.assignments[0].id);
    const result = handleReviewCommand(s, publisher, {
      type: "finalizePackage",
      packageId: pkg.id,
      expectedRevision: pkg.revision,
    }) as { package: { status: string; finalVersionId?: string } };
    expect(result.package.status).toBe("FINAL");
    expect(result.package.finalVersionId).toBe(pkg.currentVersionId);
  });

  it("clears finalization when a package is reopened or replaced", () => {
    const { s, pkg } = createPublished();
    answerAndSign(s, s.assignments[0].id);
    handleReviewCommand(s, publisher, {
      type: "finalizePackage",
      packageId: pkg.id,
      expectedRevision: pkg.revision,
    });
    const signed = s.assignments[0];
    handleReviewCommand(s, reviewer, {
      type: "reopenReview",
      assignmentId: signed.id,
      reason: "Recheck source",
      expectedRevision: signed.revision,
    });
    expect(pkg.status).toBe("IN_REVIEW");
    expect(pkg.finalVersionId).toBeUndefined();

    answerAndSign(s, signed.id);
    handleReviewCommand(s, publisher, {
      type: "finalizePackage",
      packageId: pkg.id,
      expectedRevision: pkg.revision,
    });
    const next = handleReviewCommand(s, publisher, {
      type: "addVersion",
      packageId: pkg.id,
      fileId: "file-1",
      producedAt: "2026-09-02T00:00:00.000Z",
      sections: sections(false),
      expectedRevision: pkg.revision,
    }) as { id: string; revision: number };
    handleReviewCommand(s, publisher, {
      type: "publishVersion",
      versionId: next.id,
      expectedRevision: next.revision,
    });
    expect(pkg.status).toBe("IN_REVIEW");
    expect(pkg.finalVersionId).toBeUndefined();
  });

  it("rejects local-only evidence when publishing in production", () => {
    const s = state();
    s.evidence[0].scan = "LOCAL_ONLY";
    const pkg = handleReviewCommand(s, publisher, {
      type: "createPackage",
      title: "BLR",
      period: "2026-08",
      entity: "NA",
      dueAt: "2026-09-10T00:00:00.000Z",
    }) as { id: string; revision: number };
    const version = handleReviewCommand(s, publisher, {
      type: "addVersion",
      packageId: pkg.id,
      fileId: "file-1",
      producedAt: "2026-09-01T00:00:00.000Z",
      sections: sections(false),
      expectedRevision: pkg.revision,
    }) as { id: string; revision: number };
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() =>
        handleReviewCommand(s, publisher, {
          type: "publishVersion",
          versionId: version.id,
          expectedRevision: version.revision,
        }),
      ).toThrow(/scan|clean/i);
      expect(s.versions[0].status).toBe("DRAFT");
    } finally {
      if (previous === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previous;
    }
  });
});
