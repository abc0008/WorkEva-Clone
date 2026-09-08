import type { AssignmentRule, AssignmentChange } from "@/lib/admin-types";
import type {
  AppState,
  Assignment,
  Command,
  DocumentVersion,
  Principal,
  Role,
} from "@/lib/types";
import {
  DomainError,
  audit,
  id,
  invalidateSignature,
  isValidSignature,
  notify,
  now,
  requireEntity,
  requireRole,
  requireText,
  revision,
} from "./domain";
import { invalidateDocumentGates } from "./workflow";
import { handleReviewCommand } from "./review";

const roles: Role[] = [
  "admin",
  "publisher",
  "reviewer",
  "designer",
  "manager",
  "reader",
];

function rules(state: AppState): AssignmentRule[] {
  return state.assignmentRules ?? (state.assignmentRules = []);
}

function changes(state: AppState): AssignmentChange[] {
  return state.assignmentChanges ?? (state.assignmentChanges = []);
}

function validDate(value: unknown, label: string): string {
  const text = requireText(value, label, 100);
  // Date.parse accepts values such as 2026-02-31 by normalising them into
  // March. Rules are persisted as calendar dates, so validate each component
  // instead of relying on the host parser.
  if (
    typeof value !== "string" ||
    value !== text ||
    !/^\d{4}-\d{2}-\d{2}$/.test(text)
  )
    throw new DomainError(422, `${label} must be a valid YYYY-MM-DD date.`);
  const [year, month, day] = text.split("-").map(Number);
  // Construct from a neutral leap year then set the full year; Date.UTC maps
  // years 0..99 to 1900..1999.
  const parsed = new Date(Date.UTC(2000, month - 1, day));
  parsed.setUTCFullYear(year);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    throw new DomainError(422, `${label} must be a valid YYYY-MM-DD date.`);
  return text;
}

function producedDate(value: unknown): string {
  const text = requireText(value, "Produced date", 100);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp))
    throw new DomainError(422, "Produced date must be an ISO timestamp.");
  return new Date(timestamp).toISOString().slice(0, 10);
}

function list(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new DomainError(422, `${label} must be a list of people.`);
  const result = value.map((item) => item.trim());
  if (result.some((item) => !item) || new Set(result).size !== result.length)
    throw new DomainError(422, `${label} must contain unique people.`);
  return result;
}

function activePerson(
  state: AppState,
  personId: string,
  entity: string,
): Principal {
  const person = state.users.find((candidate) => candidate.id === personId);
  if (!person || !person.active)
    throw new DomainError(422, "Assignment owners must be active people.");
  if (!person.roles.includes("reviewer"))
    throw new DomainError(422, "Assignment owners need reviewer access.");
  if (!(person.entities.includes("*") || person.entities.includes(entity)))
    throw new DomainError(
      422,
      "Assignment owner is outside the section scope.",
    );
  return person;
}

function overlaps(a: AssignmentRule, b: AssignmentRule): boolean {
  const aEnd = a.effectiveTo ?? "9999-12-31";
  const bEnd = b.effectiveTo ?? "9999-12-31";
  // The end date is inclusive. Comparing canonical YYYY-MM-DD strings also
  // avoids timezone-dependent midnight behaviour.
  return a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd;
}

function normaliseRule(
  state: AppState,
  actor: Principal,
  raw: unknown,
  existing?: AssignmentRule,
): AssignmentRule {
  if (!raw || typeof raw !== "object")
    throw new DomainError(422, "Assignment rule is required.");
  const input = raw as Partial<AssignmentRule>;
  const entity = requireText(input.entity, "Reporting unit", 100);
  if (entity === "*")
    throw new DomainError(
      422,
      "Assignment rules must target a reporting unit, not a wildcard.",
    );
  const sectionId =
    input.sectionId === undefined || input.sectionId === ""
      ? undefined
      : requireText(input.sectionId, "Section", 200);
  if (sectionId === "*")
    throw new DomainError(
      422,
      "Assignment rules must target a section or omit section scope.",
    );
  const primaryReviewerId = requireText(
    input.primaryReviewerId,
    "Primary reviewer",
    200,
  );
  const backupReviewerIds = list(input.backupReviewerIds, "Backup reviewers");
  const additionalRequiredReviewerIds = list(
    input.additionalRequiredReviewerIds,
    "Additional required reviewers",
  );
  const effectiveFrom = validDate(input.effectiveFrom, "Effective from");
  const effectiveTo =
    input.effectiveTo === undefined
      ? undefined
      : validDate(input.effectiveTo, "Effective to");
  if (effectiveTo && effectiveTo < effectiveFrom)
    throw new DomainError(
      422,
      "Effective to must be on or after effective from.",
    );
  requireEntity(actor, entity);
  const ids = [
    primaryReviewerId,
    ...backupReviewerIds,
    ...additionalRequiredReviewerIds,
  ];
  if (new Set(ids).size !== ids.length)
    throw new DomainError(
      422,
      "Primary, backup, and additional reviewers must be distinct.",
    );
  for (const personId of ids) activePerson(state, personId, entity);
  const result: AssignmentRule = {
    id: requireText(input.id ?? existing?.id ?? id(), "Rule id", 200),
    entity,
    ...(sectionId ? { sectionId } : {}),
    primaryReviewerId,
    ...(backupReviewerIds.length ? { backupReviewerIds } : {}),
    ...(additionalRequiredReviewerIds.length
      ? { additionalRequiredReviewerIds }
      : {}),
    effectiveFrom,
    ...(effectiveTo ? { effectiveTo } : {}),
    revision: existing?.revision ?? input.revision ?? 0,
  };
  return result;
}

function saveAssignmentRule(
  state: AppState,
  actor: Principal,
  command: Command,
): AssignmentRule {
  requireRole(actor, "admin");
  const raw = command.rule ?? command;
  const input = raw as Partial<AssignmentRule>;
  const current = rules(state).find((candidate) => candidate.id === input.id);
  if (current) revision(current.revision, command.expectedRevision);
  if (current) requireEntity(actor, current.entity);
  const rule = normaliseRule(state, actor, raw, current);
  for (const other of rules(state)) {
    if (
      other.id === rule.id ||
      other.entity !== rule.entity ||
      other.sectionId !== rule.sectionId
    )
      continue;
    if (overlaps(rule, other))
      throw new DomainError(
        409,
        "Assignment rule dates overlap an existing rule.",
      );
  }
  rule.revision = (current?.revision ?? -1) + 1;
  if (current) Object.assign(current, rule);
  else rules(state).push(rule);
  audit(
    state,
    actor,
    "ASSIGNMENT_RULE_SAVED",
    rule.id,
    `${rule.entity}:${rule.sectionId ?? "*"}`,
  );
  return rule;
}

function unresolvedAssignment(
  state: AppState,
  userId: string,
): Assignment | undefined {
  return state.assignments.find((assignment) => {
    if (assignment.reviewerId !== userId) return false;
    if (
      assignment.status === "SIGNED" &&
      isValidSignature(state, assignment.signatureId)
    )
      return false;
    const version = state.versions.find(
      (candidate) => candidate.id === assignment.versionId,
    );
    const pkg =
      version &&
      state.packages.find((candidate) => candidate.id === version.packageId);
    return !!version && !!pkg && pkg.currentVersionId === version.id;
  });
}

function unresolvedTask(
  state: AppState,
  userId: string,
): AppState["runs"][number]["tasks"][number] | undefined {
  return state.runs
    .flatMap((run) => run.tasks)
    .find(
      (task) =>
        (task.ownerId === userId || task.approverId === userId) &&
        (task.status !== "COMPLETE" || !!task.invalidated) &&
        task.status !== "CANCELLED",
    );
}

function inScope(entities: string[], entity: string): boolean {
  return entities.includes("*") || entities.includes(entity);
}

function scopeReduced(current: Principal, nextEntities: string[]): boolean {
  return (
    current.entities.some((entity) => !inScope(nextEntities, entity)) ||
    (current.entities.includes("*") && !nextEntities.includes("*"))
  );
}

function workOutsideScope(
  state: AppState,
  userId: string,
  retainedEntities: string[],
): boolean {
  const assignment = state.assignments.find(
    (item) =>
      item.reviewerId === userId &&
      !inScope(retainedEntities, item.entity) &&
      !(
        item.status === "SIGNED" && isValidSignature(state, item.signatureId)
      ) &&
      state.versions.some(
        (version) =>
          version.id === item.versionId &&
          state.packages.some(
            (pkg) =>
              pkg.id === version.packageId &&
              pkg.currentVersionId === version.id,
          ),
      ),
  );
  if (assignment) return true;
  const task = state.runs
    .flatMap((run) => run.tasks)
    .find(
      (item) =>
        (item.ownerId === userId || item.approverId === userId) &&
        !inScope(retainedEntities, item.entity) &&
        (item.status !== "COMPLETE" || !!item.invalidated) &&
        item.status !== "CANCELLED",
    );
  if (task) return true;
  return (state.issues ?? []).some(
    (issue) =>
      issue.ownerId === userId &&
      !inScope(retainedEntities, issue.entity) &&
      issue.status !== "RESOLVED" &&
      currentIssue(state, issue),
  );
}

function hasActiveWork(state: AppState, userId: string): boolean {
  return (
    !!unresolvedAssignment(state, userId) ||
    !!unresolvedTask(state, userId) ||
    (state.issues ?? []).some(
      (issue) =>
        issue.ownerId === userId &&
        issue.status !== "RESOLVED" &&
        currentIssue(state, issue),
    )
  );
}

function currentIssue(
  state: AppState,
  issue: NonNullable<AppState["issues"]>[number],
): boolean {
  const version = state.versions.find(
    (candidate) => candidate.id === issue.versionId,
  );
  const pkg =
    version &&
    state.packages.find((candidate) => candidate.id === version.packageId);
  return (
    !!version &&
    !!pkg &&
    version.status === "PUBLISHED" &&
    pkg.currentVersionId === version.id
  );
}

function upsertUser(
  state: AppState,
  actor: Principal,
  command: Command,
): Principal {
  requireRole(actor, "admin");
  const raw = (command.user ?? command) as Partial<Principal>;
  const userId = requireText(raw.id, "User id", 200);
  const current = state.users.find((candidate) => candidate.id === userId);
  if (current) revision(current.revision ?? 0, command.expectedRevision);
  const name = requireText(raw.name, "Name", 200);
  const email = requireText(raw.email, "Email", 320);
  const nextRoles = list(raw.roles, "Roles") as Role[];
  if (nextRoles.some((role) => !roles.includes(role)))
    throw new DomainError(422, "Unknown role.");
  if (!nextRoles.length)
    throw new DomainError(422, "At least one role is required.");
  const entities = list(raw.entities, "Reporting units");
  if (!entities.length)
    throw new DomainError(422, "At least one reporting unit is required.");
  const active = raw.active;
  if (typeof active !== "boolean")
    throw new DomainError(422, "Active status is required.");
  if (!actor.entities.includes("*")) {
    if (nextRoles.includes("admin") || entities.includes("*"))
      throw new DomainError(
        403,
        "Scoped administrators cannot grant global access.",
      );
    // A scoped administrator must be able to justify both sides of an access
    // change. Checking only the new set permits editing a foreign user's old
    // scope (or laundering a wildcard through a replacement request).
    for (const entity of current?.entities ?? []) requireEntity(actor, entity);
    for (const entity of entities) requireEntity(actor, entity);
  }
  const next: Principal = {
    id: userId,
    name,
    email,
    roles: nextRoles,
    entities,
    active,
    revision: (current?.revision ?? -1) + 1,
  };
  const reviewerAccessRemoved =
    current?.roles.includes("reviewer") && !nextRoles.includes("reviewer");
  const accessRemoved =
    !!current &&
    ((current.active && !next.active) ||
      current.roles.some((role) => !nextRoles.includes(role)) ||
      scopeReduced(current, entities));
  if (current && accessRemoved) {
    const blocked =
      !next.active || !!reviewerAccessRemoved || scopeReduced(current, entities)
        ? !next.active || !!reviewerAccessRemoved
          ? hasActiveWork(state, userId)
          : workOutsideScope(state, userId, entities)
        : false;
    if (blocked)
      throw new DomainError(
        409,
        "Reassign active work before changing this person’s access.",
      );
  }
  const actorLockout =
    actor.id === userId &&
    (!active || !nextRoles.includes("admin") || !entities.length);
  if (actorLockout)
    throw new DomainError(
      409,
      "You cannot lock yourself out of administration.",
    );
  const resultingActiveAdmins = state.users.filter((candidate) =>
    candidate.id === userId
      ? active && nextRoles.includes("admin")
      : candidate.active && candidate.roles.includes("admin"),
  ).length;
  if (resultingActiveAdmins === 0)
    throw new DomainError(
      409,
      "At least one active administrator is required.",
    );
  if (current) Object.assign(current, next);
  else state.users.push(next);
  audit(
    state,
    actor,
    "USER_ACCESS_UPDATED",
    userId,
    `${active ? "active" : "inactive"};${nextRoles.join(",")}`,
  );
  return next;
}

function reassignReview(
  state: AppState,
  actor: Principal,
  command: Command,
): Assignment {
  requireRole(actor, "admin", "manager", "publisher");
  const assignmentId = requireText(command.assignmentId, "Assignment", 200);
  const newReviewerId = requireText(command.newReviewerId, "New reviewer", 200);
  const reason = requireText(command.reason, "Reassignment reason", 2000);
  const assignment = state.assignments.find(
    (candidate) => candidate.id === assignmentId,
  );
  if (!assignment) throw new DomainError(404, "Review assignment not found.");
  revision(assignment.revision, command.expectedRevision);
  requireEntity(actor, assignment.entity);
  const nextReviewer = activePerson(state, newReviewerId, assignment.entity);
  if (assignment.reviewerId === nextReviewer.id)
    throw new DomainError(409, "Review is already assigned to this person.");
  if (
    state.assignments.some(
      (candidate) =>
        candidate.id !== assignment.id &&
        candidate.versionId === assignment.versionId &&
        candidate.sectionId === assignment.sectionId &&
        candidate.reviewerId === nextReviewer.id,
    )
  )
    throw new DomainError(
      409,
      "That reviewer already owns this section assignment.",
    );
  const oldReviewerId = assignment.reviewerId;
  const oldResponses = assignment.responses.map((response) => ({
    ...response,
  }));
  const oldSignatureId = assignment.signatureId;
  const oldStatus = assignment.status;
  // Reuse the review aggregate's reopen path. It invalidates the assignment
  // signature and all ancestor signatures before ownership changes.
  handleReviewCommand(state, actor, {
    type: "reopenReview",
    assignmentId,
    reason,
    expectedRevision: assignment.revision,
  });
  invalidateDocumentGates(
    state,
    actor,
    state.versions.find((version) => version.id === assignment.versionId)
      ?.packageId ?? "",
    `Review reassigned: ${reason}`,
  );
  assignment.history.push(...oldResponses);
  assignment.responses = [];
  assignment.reviewerId = nextReviewer.id;
  assignment.status = "IN_PROGRESS";
  assignment.revision += 1;
  const version = state.versions.find(
    (candidate) => candidate.id === assignment.versionId,
  );
  const section = version?.sections.find(
    (candidate) => candidate.id === assignment.sectionId,
  );
  if (section) {
    const mapped = section.reviewerIds.flatMap((id) =>
      id === oldReviewerId ? [nextReviewer.id] : [id],
    );
    if (!mapped.includes(nextReviewer.id)) mapped.push(nextReviewer.id);
    section.reviewerIds = [...new Set(mapped)];
  }
  const change: AssignmentChange = {
    id: id(),
    assignmentId,
    versionId: assignment.versionId,
    sectionId: assignment.sectionId,
    entity: assignment.entity,
    previousReviewerId: oldReviewerId,
    newReviewerId: nextReviewer.id,
    reason,
    previousResponses: oldResponses,
    previousSignatureId: oldSignatureId,
    previousStatus: oldStatus,
    by: actor.id,
    at: now(),
  };
  changes(state).push(change);
  audit(
    state,
    actor,
    "ASSIGNMENT_REASSIGNED",
    assignmentId,
    `${oldReviewerId}->${nextReviewer.id};${reason}`,
  );
  notify(
    state,
    "REVIEW_REASSIGNED",
    assignmentId,
    nextReviewer.id,
    `Review assignment requires your attention: ${section?.name ?? assignment.sectionId}.`,
  );
  return assignment;
}

/** Apply the most specific dated rule to each section of a version. */
export function applyAssignmentRules(
  state: AppState,
  actor: Principal,
  version: DocumentVersion,
): DocumentVersion {
  const target = producedDate(version.producedAt);
  const reviewerIdsBySection = new Map<string, string[]>();
  const snapshot: NonNullable<DocumentVersion["assignmentRuleSnapshot"]> = [];
  for (const section of version.sections) {
    requireEntity(actor, section.entity);
    const matching = rules(state).filter(
      (rule) =>
        rule.entity === section.entity &&
        (!rule.sectionId || rule.sectionId === section.id),
    );
    // A stale/malformed rule in the matching scope is an unsafe publication
    // configuration. Silently ignoring it would fall back to hand-entered
    // reviewers and defeat the effective-dated control.
    for (const rule of matching) {
      const from = validDate(
        rule.effectiveFrom,
        `Assignment rule ${rule.id} effective from`,
      );
      const to =
        rule.effectiveTo === undefined
          ? undefined
          : validDate(
              rule.effectiveTo,
              `Assignment rule ${rule.id} effective to`,
            );
      if (to && to < from)
        throw new DomainError(
          422,
          `Assignment rule ${rule.id} has an invalid effective date range.`,
        );
    }
    const effective = matching.filter(
      (rule) =>
        rule.effectiveFrom <= target &&
        (!rule.effectiveTo || rule.effectiveTo >= target),
    );
    effective.sort(
      (a, b) =>
        Number(!!b.sectionId) - Number(!!a.sectionId) ||
        b.effectiveFrom.localeCompare(a.effectiveFrom),
    );
    if (
      effective.some((rule, index) =>
        effective
          .slice(index + 1)
          .some((other) => rule.sectionId === other.sectionId),
      )
    )
      throw new DomainError(
        409,
        `Assignment rules for section ${section.id} overlap at publication.`,
      );
    const rule = effective[0];
    if (!rule) continue;
    const candidates = [
      rule.primaryReviewerId,
      ...(rule.backupReviewerIds ?? []),
    ];
    const primary = candidates.find((personId) => {
      const person = state.users.find((candidate) => candidate.id === personId);
      return (
        !!person?.active &&
        person.roles.includes("reviewer") &&
        (person.entities.includes("*") ||
          person.entities.includes(section.entity))
      );
    });
    if (!primary)
      throw new DomainError(
        422,
        `No active reviewer is available for rule ${rule.id}.`,
      );
    const additional = rule.additionalRequiredReviewerIds ?? [];
    for (const reviewerId of additional)
      activePerson(state, reviewerId, section.entity);
    reviewerIdsBySection.set(section.id, [
      ...new Set([primary, ...additional]),
    ]);
    snapshot.push({
      sectionId: section.id,
      ruleId: rule.id,
      ruleRevision: rule.revision,
      effectiveDate: target,
      reviewerIds: [...new Set([primary, ...additional])],
    });
  }
  for (const section of version.sections) {
    const reviewerIds = reviewerIdsBySection.get(section.id);
    if (reviewerIds) section.reviewerIds = reviewerIds;
  }
  version.assignmentRuleSnapshot = snapshot;
  return version;
}

export function canReadAssignmentRule(
  actor: Principal,
  rule: AssignmentRule,
): boolean;
export function canReadAssignmentRule(
  state: AppState,
  actor: Principal,
  rule: AssignmentRule,
): boolean;
export function canReadAssignmentRule(
  first: Principal | AppState,
  second: Principal | AssignmentRule,
  third?: AssignmentRule,
): boolean {
  const actor = third ? (second as Principal) : (first as Principal);
  const rule = third ?? (second as AssignmentRule);
  return (
    actor.active &&
    (actor.entities.includes("*") || actor.entities.includes(rule.entity))
  );
}

export function canReadAssignmentChange(
  actor: Principal,
  change: AssignmentChange,
): boolean;
export function canReadAssignmentChange(
  state: AppState,
  actor: Principal,
  change: AssignmentChange,
): boolean;
export function canReadAssignmentChange(
  first: Principal | AppState,
  second: Principal | AssignmentChange,
  third?: AssignmentChange,
): boolean {
  const actor = third ? (second as Principal) : (first as Principal);
  const change = third ?? (second as AssignmentChange);
  return (
    actor.active &&
    (actor.entities.includes("*") || actor.entities.includes(change.entity))
  );
}

export function handleAdministrationCommand(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown | null {
  if (!command || typeof command.type !== "string") return null;
  switch (command.type) {
    case "saveAssignmentRule":
      return saveAssignmentRule(state, actor, command);
    case "upsertUser":
      return upsertUser(state, actor, command);
    case "reassignReview":
      return reassignReview(state, actor, command);
    default:
      return null;
  }
}
