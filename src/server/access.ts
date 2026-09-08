import type { AppState, Principal, Evidence, AppSnapshot } from "@/lib/types";
import { taskBlocked } from "./workflow";
import { DomainError, isValidSignature } from "./domain";
import { canReadIssue } from "./issues";
export const hasEntity = (actor: Principal, entity: string) =>
  actor.active &&
  (actor.entities.includes("*") || actor.entities.includes(entity));
export const canManage = (actor: Principal) =>
  actor.roles.some((r) => ["publisher", "manager", "admin"].includes(r));
export function canReadVersion(
  state: AppState,
  actor: Principal,
  versionId: string,
) {
  const version = state.versions.find((v) => v.id === versionId);
  if (!version) return false;
  const pkg = state.packages.find((p) => p.id === version.packageId);
  if (!pkg) return false;
  if (hasEntity(actor, pkg.entity) && canManage(actor)) return true;
  // Pilot policy grants complete PDF to assigned readers, not write access to other sections.
  return state.assignments.some(
    (a) =>
      a.versionId === versionId &&
      a.reviewerId === actor.id &&
      hasEntity(actor, a.entity),
  );
}
export function canReadEvidence(
  state: AppState,
  actor: Principal,
  evidence: Evidence,
) {
  return (
    (evidence.uploadedBy === actor.id && hasEntity(actor, evidence.entity)) ||
    (canManage(actor) && hasEntity(actor, evidence.entity)) ||
    state.versions.some(
      (v) => v.fileId === evidence.id && canReadVersion(state, actor, v.id),
    ) ||
    state.runs.some((run) =>
      run.tasks.some(
        (t) =>
          t.evidenceIds.includes(evidence.id) &&
          hasEntity(actor, t.entity) &&
          (t.ownerId === actor.id ||
            t.approverId === actor.id ||
            canManage(actor)),
      ),
    )
  );
}
export function scopedSnapshot(
  state: AppState,
  actor: Principal,
  localMode: boolean,
): AppSnapshot {
  const versions = state.versions.filter((v) =>
    canReadVersion(state, actor, v.id),
  );
  const versionIds = new Set(versions.map((v) => v.id));
  const packages = state.packages.filter(
    (p) =>
      versions.some((v) => v.packageId === p.id) ||
      (canManage(actor) && hasEntity(actor, p.entity)),
  );
  const assignments = state.assignments.filter(
    (a) =>
      versionIds.has(a.versionId) &&
      hasEntity(actor, a.entity) &&
      (canManage(actor) || a.reviewerId === actor.id),
  );
  const assignmentIds = new Set(assignments.map((a) => a.id));
  const runs = state.runs.filter(
    (r) =>
      r.tasks.every((t) => hasEntity(actor, t.entity)) &&
      (canManage(actor) ||
        r.tasks.some(
          (t) => t.ownerId === actor.id || t.approverId === actor.id,
        )),
  );
  const taskIds = new Set(runs.flatMap((r) => r.tasks.map((t) => t.id)));
  const signatures = state.signatures.filter((s) =>
    s.subjectType === "assignment"
      ? assignmentIds.has(s.subjectId)
      : taskIds.has(s.subjectId),
  );
  const signatureIds = new Set(signatures.map((s) => s.id));
  const issues = (state.issues ?? []).filter((issue) =>
    canReadIssue(state, actor, issue),
  );
  const assignmentRules = (state.assignmentRules ?? []).filter(
    (rule) => canManage(actor) && hasEntity(actor, rule.entity),
  );
  const users = localMode
    ? state.users
    : state.users.filter(
        (u) =>
          u.id === actor.id ||
          (canManage(actor) && u.entities.some((e) => hasEntity(actor, e))),
      );
  const subjectIds = new Set([
    ...assignmentIds,
    ...taskIds,
    ...packages.map((p) => p.id),
    ...versionIds,
    ...runs.map((r) => r.id),
    ...issues.map((issue) => issue.id),
    ...assignmentRules.map((rule) => rule.id),
    ...users
      .filter(
        (user) =>
          user.id === actor.id ||
          (canManage(actor) &&
            user.entities.every((entity) => hasEntity(actor, entity))),
      )
      .map((user) => user.id),
  ]);
  return {
    ...state,
    principal: actor,
    localMode,
    issues,
    assignmentRules,
    assignmentChanges: (state.assignmentChanges ?? []).filter((change) =>
      assignmentIds.has(change.assignmentId),
    ),
    notificationPreferences: (state.notificationPreferences ?? []).filter(
      (preference) => preference.userId === actor.id,
    ),
    notificationReceipts: (state.notificationReceipts ?? []).filter(
      (receipt) => receipt.userId === actor.id,
    ),
    packages,
    versions,
    assignments,
    runs: runs.map((run) => ({
      ...run,
      tasks: run.tasks.map((task) => ({
        ...task,
        blocked: taskBlocked(state, run, task),
      })),
    })),
    signatures,
    users,
    templates: state.templates.filter(
      (t) =>
        t.nodes.every((n) => hasEntity(actor, n.entity)) &&
        actor.roles.some((r) => ["designer", "manager", "admin"].includes(r)),
    ),
    comments: state.comments.filter(
      (c) =>
        assignmentIds.has(c.assignmentId) ||
        (versionIds.has(c.versionId) &&
          assignments.some(
            (a) => a.versionId === c.versionId && a.sectionId === c.sectionId,
          )),
    ),
    signatureEvents: state.signatureEvents.filter((e) =>
      signatureIds.has(e.signatureId),
    ),
    evidence: state.evidence.filter((e) => canReadEvidence(state, actor, e)),
    audit: state.audit.filter(
      (e) =>
        subjectIds.has(e.subjectId) && (canManage(actor) || e.by === actor.id),
    ),
    outbox: state.outbox.filter(
      (e) =>
        e.recipientId === actor.id ||
        (canManage(actor) && subjectIds.has(e.subjectId)),
    ),
    idempotency: [],
  };
}
export function exportPackage(
  state: AppState,
  actor: Principal,
  packageId: string,
) {
  const pkg = state.packages.find((p) => p.id === packageId);
  if (!pkg) throw new DomainError(404, "Package not found");
  if (!canManage(actor) || !hasEntity(actor, pkg.entity))
    throw new DomainError(
      403,
      "Package export requires scoped management access.",
    );
  const version = state.versions.find(
    (v) => v.id === (pkg.finalVersionId || pkg.currentVersionId),
  );
  if (!version)
    throw new DomainError(422, "Publish a document before exporting.");
  const assignments = state.assignments.filter(
    (a) => a.versionId === version.id,
  );
  const signatures = state.signatures.filter((s) =>
    assignments.some((a) => a.id === s.subjectId),
  );
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: actor.id,
    package: pkg,
    document: version,
    assignments,
    signatures: signatures.map((s) => ({
      ...s,
      currentValid: isValidSignature(state, s.id),
    })),
    signatureEvents: state.signatureEvents.filter((e) =>
      signatures.some((s) => s.id === e.signatureId),
    ),
    comments: state.comments.filter((c) => c.versionId === version.id),
    issues: (state.issues ?? []).filter(
      (issue) =>
        issue.packageId === packageId && canReadIssue(state, actor, issue),
    ),
    assignmentChanges: (state.assignmentChanges ?? []).filter(
      (change) =>
        change.versionId === version.id && hasEntity(actor, change.entity),
    ),
    originalDocumentUrl: `/api/files/${version.fileId}`,
  };
}
