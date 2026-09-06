import { describe, it, expect } from "vitest";
import { seedState } from "@/lib/seed";
import { executeCommand } from "@/server/commands";
import { isValidSignature } from "@/server/domain";
import type {
  AppState,
  Principal,
  WorkflowTemplate,
  WorkflowRun,
  DocumentVersion,
} from "@/lib/types";
function signAll(s: AppState) {
  for (const assignment of s.assignments.filter(
    (a) => a.versionId === s.packages[0].currentVersionId,
  )) {
    const actor = s.users.find((u) => u.id === assignment.reviewerId)!;
    const section = s.versions
      .find((v) => v.id === assignment.versionId)!
      .sections.find((x) => x.id === assignment.sectionId)!;
    for (const metric of section.metrics)
      executeCommand(s, actor, {
        type: "saveResponse",
        assignmentId: assignment.id,
        metricId: metric.id,
        answer: "OKAY",
        comment: "",
        expectedRevision: assignment.revision,
      });
    executeCommand(s, actor, {
      type: "signReview",
      assignmentId: assignment.id,
      expectedRevision: assignment.revision,
      idempotencyKey: `sign-${assignment.id}`,
    });
  }
}
describe("cross-feature contracts", () => {
  it("retries the same sign without duplicate records and rejects changed key payload", () => {
    const s = seedState();
    signAll(s);
    const a = s.assignments[0];
    const key = s.idempotency.find((i) => i.key === `sign-${a.id}`)!;
    const signedRevision = s.signatures.find(
      (x) => x.id === a.signatureId,
    )!.revision;
    const cmd = {
      type: "signReview",
      assignmentId: a.id,
      expectedRevision: signedRevision,
      idempotencyKey: key.key,
    };
    const count = s.signatures.length;
    executeCommand(s, s.users[0], cmd);
    expect(s.signatures).toHaveLength(count);
    expect(() =>
      executeCommand(s, s.users[0], { ...cmd, expectedRevision: 999 }),
    ).toThrow("different request");
  });
  it("retains the original idempotent response after reopening and rechecks current scope", () => {
    const s = seedState();
    signAll(s);
    const a = s.assignments[0];
    const key = s.idempotency.find((i) => i.key === `sign-${a.id}`)!;
    const signedRevision = s.signatures.find(
      (x) => x.id === a.signatureId,
    )!.revision;
    const cmd = {
      type: "signReview",
      assignmentId: a.id,
      expectedRevision: signedRevision,
      idempotencyKey: key.key,
    };
    const original = structuredClone(key.result);
    expect(key.result).not.toBe(
      s.signatures.find((x) => x.id === a.signatureId),
    );
    executeCommand(s, s.users[2], {
      type: "reopenReview",
      assignmentId: a.id,
      expectedRevision: a.revision,
      reason: "New evidence",
    });
    expect(key.result).toEqual(original);
    expect(a.status).not.toBe("SIGNED");
    expect(() =>
      executeCommand(s, { ...s.users[0], entities: ["TN"] }, cmd),
    ).toThrow();
  });
  it("new document publication removes final designation, invalidates old signatures and resets decisions", () => {
    const s = seedState();
    signAll(s);
    const p = s.packages[0],
      actor = s.users[2],
      old = s.versions[0];
    executeCommand(s, actor, {
      type: "finalizePackage",
      packageId: p.id,
      expectedRevision: p.revision,
    });
    const signatureIds = s.assignments.map((a) => a.signatureId!);
    const created = executeCommand(s, actor, {
      type: "addVersion",
      packageId: p.id,
      fileId: "sample-blr",
      sections: old.sections,
      producedAt: new Date().toISOString(),
      expectedRevision: p.revision,
    }) as DocumentVersion;
    executeCommand(s, actor, {
      type: "publishVersion",
      versionId: created.id,
      expectedRevision: created.revision,
    });
    expect(p.finalVersionId).toBeUndefined();
    expect(signatureIds.every((id) => !isValidSignature(s, id))).toBe(true);
    expect(
      s.assignments
        .filter((a) => a.versionId === created.id)
        .every((a) => a.responses.length === 0 && !a.signatureId),
    ).toBe(true);
  });
  it("binds each period to unique task identities", () => {
    const s = seedState(),
      actor = s.users[2],
      template = s.templates[0];
    executeCommand(s, actor, {
      type: "publishTemplate",
      templateId: template.id,
      expectedRevision: template.revision,
    });
    const a = executeCommand(s, actor, {
      type: "createRun",
      templateId: template.id,
      period: "2026-08",
    }) as WorkflowRun;
    const b = executeCommand(s, actor, {
      type: "createRun",
      templateId: template.id,
      period: "2026-09",
    }) as WorkflowRun;
    expect(
      a.tasks.some((t) => b.tasks.some((other) => other.id === t.id)),
    ).toBe(false);
    expect(
      a.edges.every(
        (e) =>
          a.tasks.some((t) => t.id === e.source) &&
          a.tasks.some((t) => t.id === e.target),
      ),
    ).toBe(true);
  });
});
