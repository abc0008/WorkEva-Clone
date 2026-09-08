import type { AppState, Assignment, Command, Principal } from "@/lib/types";
import type {
  IssueCategory,
  IssueEvent,
  IssueEventType,
  IssueStatus,
  ReviewIssue,
} from "@/lib/issues-types";
import {
  DomainError,
  audit,
  id,
  invalidateSignature,
  isValidSignature,
  now,
  notify,
  requireEntity,
  requireText,
  revision,
} from "./domain";
import { invalidateDocumentGates } from "./workflow";

type StateWithIssues = AppState & { issues?: ReviewIssue[] };
const categories: IssueCategory[] = [
  "DATA",
  "METHODOLOGY",
  "DISCLOSURE",
  "PROCESS",
  "OTHER",
];

function issuesFor(state: AppState): ReviewIssue[] {
  const mutable = state as StateWithIssues;
  if (!mutable.issues) mutable.issues = [];
  return mutable.issues;
}

function assignmentFor(state: AppState, assignmentId: string): Assignment {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) throw new DomainError(404, "Review assignment not found.");
  return assignment;
}

function context(state: AppState, assignmentId: string) {
  const assignment = assignmentFor(state, assignmentId);
  const version = state.versions.find(
    (item) => item.id === assignment.versionId,
  );
  if (!version) throw new DomainError(404, "Document version not found.");
  const pkg = state.packages.find((item) => item.id === version.packageId);
  if (!pkg) throw new DomainError(404, "Package not found.");
  if (pkg.currentVersionId !== version.id || version.status !== "PUBLISHED")
    throw new DomainError(
      409,
      "This review belongs to a superseded document version.",
    );
  const section = version.sections.find(
    (item) => item.id === assignment.sectionId,
  );
  if (!section)
    throw new DomainError(422, "Section is not part of this document version.");
  const owner = state.users.find((item) => item.id === assignment.reviewerId);
  if (!owner || !owner.active)
    throw new DomainError(422, "The assigned reviewer is not active.");
  requireEntity(owner, assignment.entity);
  return { assignment, version, pkg, section, owner };
}

function issueFor(state: AppState, issueId: string): ReviewIssue {
  const issue = issuesFor(state).find((item) => item.id === issueId);
  if (!issue) throw new DomainError(404, "Issue not found.");
  return issue;
}

function validateBinding(
  issue: ReviewIssue,
  current: ReturnType<typeof context>,
) {
  if (
    issue.versionId !== current.version.id ||
    issue.packageId !== current.pkg.id ||
    issue.entity !== current.assignment.entity ||
    issue.sectionId !== current.section.id
  )
    throw new DomainError(
      409,
      "Issue context no longer matches its review assignment.",
    );
  if (
    issue.metricId &&
    !current.section.metrics.some((metric) => metric.id === issue.metricId)
  )
    throw new DomainError(
      409,
      "Issue metric is no longer part of its review section.",
    );
}

function actorCanScope(actor: Principal, entity: string): boolean {
  return (
    actor.active &&
    (actor.roles.includes("admin") ||
      actor.roles.includes("publisher") ||
      actor.roles.includes("manager")) &&
    (actor.entities.includes("*") || actor.entities.includes(entity))
  );
}

function authorize(
  actor: Principal,
  issue: ReviewIssue,
  assignment: Assignment,
  action: "discuss" | "propose" | "accept",
) {
  const assigned = actor.id === assignment.reviewerId;
  if (action === "accept") {
    if (!assigned || !actor.roles.includes("reviewer"))
      throw new DomainError(
        403,
        "Only the assigned reviewer may accept a resolution.",
      );
    requireEntity(actor, issue.entity);
    return;
  }
  if (assigned && actor.roles.includes("reviewer")) {
    requireEntity(actor, issue.entity);
    return;
  }
  if (actor.id === issue.ownerId) {
    requireEntity(actor, issue.entity);
    return;
  }
  if (actorCanScope(actor, issue.entity)) return;
  throw new DomainError(
    403,
    "This issue is outside your assigned reporting scope.",
  );
}

function event(
  type: IssueEventType,
  actor: Principal,
  status: IssueStatus,
  details: Partial<Pick<IssueEvent, "body" | "reason">> = {},
): IssueEvent {
  return { id: id(), type, by: actor.id, at: now(), status, ...details };
}

function createIssue(
  state: AppState,
  actor: Principal,
  command: Command,
): ReviewIssue {
  const current = context(state, String(command.assignmentId));
  const assigned =
    actor.id === current.assignment.reviewerId &&
    actor.roles.includes("reviewer");
  if (!assigned && !actorCanScope(actor, current.assignment.entity))
    throw new DomainError(
      403,
      "Only the assigned reviewer or scoped management may create an issue.",
    );
  requireEntity(actor, current.assignment.entity);
  const ownerId =
    command.ownerId === undefined
      ? current.assignment.reviewerId
      : requireText(command.ownerId, "Issue owner", 200);
  const issueOwner = state.users.find((user) => user.id === ownerId);
  if (!issueOwner || !issueOwner.active)
    throw new DomainError(422, "Issue owner must be active.");
  requireEntity(issueOwner, current.assignment.entity);
  const category = String(command.category || "OTHER") as IssueCategory;
  if (!categories.includes(category))
    throw new DomainError(422, "Invalid issue category.");
  const metricId =
    command.metricId === undefined
      ? undefined
      : requireText(command.metricId, "Metric", 200);
  if (
    metricId &&
    !current.section.metrics.some((metric) => metric.id === metricId)
  )
    throw new DomainError(422, "Metric is not assigned to this section.");
  let linkedFromIssueId: string | undefined;
  if (command.linkedFromIssueId !== undefined) {
    const source = issueFor(state, String(command.linkedFromIssueId));
    const sourceVersion = state.versions.find(
      (version) => version.id === source.versionId,
    );
    if (!canReadIssue(state, actor, source))
      throw new DomainError(
        403,
        "The linked source issue is outside your access.",
      );
    if (
      source.packageId !== current.pkg.id ||
      source.versionId === current.version.id ||
      !sourceVersion ||
      sourceVersion.number >= current.version.number ||
      source.sectionId !== current.section.id ||
      source.entity !== current.assignment.entity
    )
      throw new DomainError(
        422,
        "Linked issue must be from an earlier version of this package.",
      );
    linkedFromIssueId = source.id;
  }
  const issue: ReviewIssue = {
    id: id(),
    assignmentId: current.assignment.id,
    versionId: current.version.id,
    packageId: current.pkg.id,
    entity: current.assignment.entity,
    sectionId: current.section.id,
    ...(metricId ? { metricId } : {}),
    category,
    title: requireText(command.title, "Issue title", 200),
    description: requireText(command.description, "Issue description", 5000),
    status: "OPEN",
    ownerId,
    createdBy: actor.id,
    createdAt: now(),
    revision: 1,
    ...(linkedFromIssueId ? { linkedFromIssueId } : {}),
    events: [],
  };
  issue.events.push(
    event("CREATED", actor, issue.status, { body: issue.description }),
  );
  issuesFor(state).push(issue);
  if (isValidSignature(state, current.assignment.signatureId))
    invalidateReviewForIssue(
      state,
      actor,
      issue,
      "A new unresolved issue was raised against signed work.",
    );
  if (actor.id !== issue.ownerId)
    notify(
      state,
      "ISSUE_CREATED",
      issue.id,
      issue.ownerId,
      `Review issue raised: ${issue.title}`,
    );
  audit(
    state,
    actor,
    "ISSUE_CREATED",
    issue.id,
    `${issue.category}:${issue.title}`,
  );
  return issue;
}

function commentIssue(
  state: AppState,
  actor: Principal,
  command: Command,
): ReviewIssue {
  const issue = issueFor(state, String(command.issueId));
  const current = context(state, issue.assignmentId);
  validateBinding(issue, current);
  authorize(actor, issue, current.assignment, "discuss");
  revision(issue.revision, command.expectedRevision);
  const body = requireText(command.body, "Comment", 5000);
  issue.events.push(event("COMMENTED", actor, issue.status, { body }));
  issue.revision += 1;
  if (actor.id !== issue.ownerId)
    notify(
      state,
      "ISSUE_COMMENTED",
      issue.id,
      issue.ownerId,
      `A comment was added to review issue: ${issue.title}`,
    );
  audit(state, actor, "ISSUE_COMMENTED", issue.id);
  return issue;
}

function proposeResolution(
  state: AppState,
  actor: Principal,
  command: Command,
): ReviewIssue {
  const issue = issueFor(state, String(command.issueId));
  const current = context(state, issue.assignmentId);
  validateBinding(issue, current);
  authorize(actor, issue, current.assignment, "propose");
  revision(issue.revision, command.expectedRevision);
  if (issue.status !== "OPEN")
    throw new DomainError(
      409,
      "Only an open issue can receive a resolution proposal.",
    );
  const explanation = requireText(
    command.explanation ?? command.resolutionExplanation,
    "Resolution explanation",
    5000,
  );
  issue.status = "RESOLUTION_PROPOSED";
  issue.resolution = { explanation, proposedBy: actor.id, proposedAt: now() };
  issue.events.push(
    event("RESOLUTION_PROPOSED", actor, issue.status, { body: explanation }),
  );
  issue.revision += 1;
  if (actor.id !== issue.createdBy)
    notify(
      state,
      "ISSUE_RESOLUTION_PROPOSED",
      issue.id,
      issue.ownerId,
      `A resolution was proposed for review issue: ${issue.title}`,
    );
  audit(state, actor, "ISSUE_RESOLUTION_PROPOSED", issue.id);
  return issue;
}

function acceptResolution(
  state: AppState,
  actor: Principal,
  command: Command,
): ReviewIssue {
  const issue = issueFor(state, String(command.issueId));
  const current = context(state, issue.assignmentId);
  validateBinding(issue, current);
  authorize(actor, issue, current.assignment, "accept");
  revision(issue.revision, command.expectedRevision);
  if (issue.status !== "RESOLUTION_PROPOSED" || !issue.resolution)
    throw new DomainError(
      409,
      "A proposed resolution is required before acceptance.",
    );
  issue.status = "RESOLVED";
  issue.resolution.acceptedBy = actor.id;
  issue.resolution.acceptedAt = now();
  issue.events.push(
    event("RESOLUTION_ACCEPTED", actor, issue.status, {
      body: issue.resolution.explanation,
    }),
  );
  issue.revision += 1;
  if (actor.id !== issue.createdBy)
    notify(
      state,
      "ISSUE_RESOLUTION_ACCEPTED",
      issue.id,
      issue.createdBy,
      `Resolution accepted for review issue: ${issue.title}`,
    );
  audit(state, actor, "ISSUE_RESOLUTION_ACCEPTED", issue.id);
  return issue;
}

function invalidateReviewForIssue(
  state: AppState,
  actor: Principal,
  issue: ReviewIssue,
  reason: string,
) {
  const current = context(state, issue.assignmentId);
  const invalidate = (assignment: Assignment) => {
    if (!isValidSignature(state, assignment.signatureId)) return;
    invalidateSignature(state, assignment.signatureId, actor, reason);
    assignment.signatureId = undefined;
    assignment.status = assignment.responses.some(
      (response) => response.answer === "NEEDS_EXPLANATION",
    )
      ? "EXCEPTIONS"
      : "IN_PROGRESS";
    assignment.revision += 1;
    audit(state, actor, "REVIEW_INVALIDATED_BY_ISSUE", assignment.id, reason);
  };
  invalidate(current.assignment);
  const byId = new Map(
    current.version.sections.map((section) => [section.id, section]),
  );
  const ancestors = new Set<string>();
  const walk = (sectionId: string) => {
    for (const parentId of byId.get(sectionId)?.parentSectionIds ?? []) {
      if (ancestors.has(parentId)) continue;
      ancestors.add(parentId);
      walk(parentId);
    }
  };
  walk(current.section.id);
  for (const assignment of state.assignments.filter(
    (item) =>
      item.versionId === current.version.id && ancestors.has(item.sectionId),
  ))
    invalidate(assignment);
  if (current.pkg.finalVersionId === current.version.id) {
    current.pkg.finalVersionId = undefined;
    current.pkg.status = "IN_REVIEW";
    current.pkg.revision += 1;
  }
  invalidateDocumentGates(state, actor, current.pkg.id, reason);
}

/** Carry unresolved context onto a replacement version with an explicit link. */
export function carryIssuesForward(
  state: AppState,
  actor: Principal,
  priorVersionId: string,
  currentVersionId: string,
): ReviewIssue[] {
  const priorIssues = issuesFor(state).filter(
    (issue) =>
      issue.versionId === priorVersionId && issue.status !== "RESOLVED",
  );
  const created: ReviewIssue[] = [];
  const replacementVersion = state.versions.find(
    (version) => version.id === currentVersionId,
  );
  if (!replacementVersion)
    throw new DomainError(404, "Replacement document version not found.");
  for (const source of priorIssues) {
    // Keep the carry operation idempotent for callers that retry publication
    // administration after a transient failure.
    if (
      issuesFor(state).some(
        (issue) =>
          issue.versionId === currentVersionId &&
          issue.linkedFromIssueId === source.id,
      )
    )
      continue;
    const priorAssignment = state.assignments.find(
      (assignment) => assignment.id === source.assignmentId,
    );
    const replacement =
      priorAssignment &&
      (state.assignments.find(
        (assignment) =>
          assignment.versionId === currentVersionId &&
          assignment.sectionId === priorAssignment.sectionId &&
          assignment.reviewerId === priorAssignment.reviewerId &&
          assignment.entity === source.entity,
      ) ||
        state.assignments.find(
          (assignment) =>
            assignment.versionId === currentVersionId &&
            assignment.sectionId === priorAssignment.sectionId &&
            assignment.entity === source.entity,
        ));
    // Publication preflight should make this impossible. Keep the guard here
    // so a direct caller cannot silently drop an unresolved exception.
    if (!replacement)
      throw new DomainError(
        409,
        "The unresolved review issue could not be carried to the replacement version.",
      );
    const replacementSection = replacementVersion?.sections.find(
      (section) => section.id === replacement.sectionId,
    );
    const metricStillExists =
      !source.metricId ||
      !!replacementSection?.metrics.some(
        (metric) => metric.id === source.metricId,
      );
    const sourceOwner = state.users.find((user) => user.id === source.ownerId);
    const ownerId =
      sourceOwner?.active &&
      (sourceOwner.entities.includes("*") ||
        sourceOwner.entities.includes(replacement.entity))
        ? source.ownerId
        : replacement.reviewerId;
    const carried: ReviewIssue = {
      ...source,
      id: id(),
      assignmentId: replacement.id,
      versionId: currentVersionId,
      ownerId,
      ...(metricStillExists ? {} : { metricId: undefined }),
      createdAt: now(),
      status: "OPEN",
      revision: 1,
      resolution: undefined,
      linkedFromIssueId: source.id,
      events: [
        ...source.events.map((item) => ({ ...item, id: id() })),
        event("CARRIED_FORWARD", actor, "OPEN", {
          body: `Carried from issue ${source.id} on the replacement document version.`,
        }),
      ],
    };
    issuesFor(state).push(carried);
    created.push(carried);
    audit(
      state,
      actor,
      "ISSUE_CARRIED_FORWARD",
      carried.id,
      `sourceIssue=${source.id}`,
    );
    if (actor.id !== carried.ownerId)
      notify(
        state,
        "ISSUE_CREATED",
        carried.id,
        carried.ownerId,
        `Review issue carried forward: ${carried.title}`,
      );
  }
  return created;
}

/** Validate replacement publication will preserve every unresolved issue. */
export function assertIssuesCarryable(
  state: AppState,
  priorVersionId: string,
  nextSections: Array<{
    id: string;
    entity?: string;
    reviewerIds: string[];
    metrics?: Array<{ required: boolean }>;
    parentSectionIds?: string[];
  }>,
): void {
  const next = new Map(nextSections.map((section) => [section.id, section]));
  for (const issue of issuesFor(state).filter(
    (candidate) =>
      candidate.versionId === priorVersionId && candidate.status !== "RESOLVED",
  )) {
    const section = next.get(issue.sectionId);
    const hasRequiredWork =
      !!section &&
      (!!section.metrics?.some((metric) => metric.required) ||
        nextSections.some((candidate) =>
          candidate.parentSectionIds?.includes(section.id),
        ));
    if (
      !section ||
      (section.entity !== undefined && section.entity !== issue.entity) ||
      !hasRequiredWork ||
      section.reviewerIds.length === 0
    )
      throw new DomainError(
        409,
        "The replacement version would orphan an unresolved review issue.",
      );
  }
}

function reopenIssue(
  state: AppState,
  actor: Principal,
  command: Command,
): ReviewIssue {
  const issue = issueFor(state, String(command.issueId));
  const current = context(state, issue.assignmentId);
  validateBinding(issue, current);
  authorize(actor, issue, current.assignment, "propose");
  revision(issue.revision, command.expectedRevision);
  const reason = requireText(command.reason, "Reopen reason", 2000);
  if (issue.status !== "RESOLVED")
    throw new DomainError(409, "Only a resolved issue can be reopened.");
  issue.status = "OPEN";
  issue.resolution = undefined;
  issue.events.push(event("REOPENED", actor, issue.status, { reason }));
  issue.revision += 1;
  invalidateReviewForIssue(state, actor, issue, reason);
  if (actor.id !== issue.ownerId)
    notify(
      state,
      "ISSUE_REOPENED",
      issue.id,
      issue.ownerId,
      `Review issue reopened: ${issue.title}`,
    );
  audit(state, actor, "ISSUE_REOPENED", issue.id, reason);
  return issue;
}

/** Read boundary used by scopedSnapshot. Issue creators retain their thread access. */
export function canReadIssue(
  state: AppState,
  actor: Principal,
  issue: ReviewIssue,
): boolean {
  if (
    !actor.active ||
    !(actor.entities.includes("*") || actor.entities.includes(issue.entity))
  )
    return false;
  const assignment = state.assignments.find(
    (item) => item.id === issue.assignmentId,
  );
  // Issue history remains readable after a reviewer or issue owner is
  // deactivated. Access is scoped by the active reader and the immutable issue
  // entity; management access is checked independently of historical users.
  return (
    !!assignment &&
    (actor.id === assignment.reviewerId ||
      actor.id === issue.ownerId ||
      actor.id === issue.createdBy ||
      actorCanScope(actor, issue.entity))
  );
}

export function hasUnresolvedIssue(
  state: AppState,
  assignmentId: string,
): boolean {
  return issuesFor(state).some(
    (issue) =>
      issue.assignmentId === assignmentId && issue.status !== "RESOLVED",
  );
}

export function hasUnresolvedIssueForVersion(
  state: AppState,
  versionId: string,
): boolean {
  return issuesFor(state).some(
    (issue) => issue.versionId === versionId && issue.status !== "RESOLVED",
  );
}

export function handleIssueCommand(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown | null {
  if (!command || typeof command.type !== "string") return null;
  switch (command.type) {
    case "createIssue":
      return createIssue(state, actor, command);
    case "commentIssue":
      return commentIssue(state, actor, command);
    case "proposeIssueResolution":
      return proposeResolution(state, actor, command);
    case "acceptIssueResolution":
      return acceptResolution(state, actor, command);
    case "reopenIssue":
      return reopenIssue(state, actor, command);
    default:
      return null;
  }
}
