import type {
  AppState,
  Answer,
  Assignment,
  Command,
  DocumentVersion,
  Package,
  Principal,
  Section,
} from "@/lib/types";
import {
  DomainError,
  addSignature,
  audit,
  hash,
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
import {
  carryIssuesForward,
  assertIssuesCarryable,
  hasUnresolvedIssue,
  hasUnresolvedIssueForVersion,
} from "./issues";
import { applyAssignmentRules } from "./administration";

const answers: Answer[] = ["OKAY", "NEEDS_EXPLANATION", "NOT_APPLICABLE"];
function localScanAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function user(state: AppState, userId: string): Principal {
  const found = state.users.find((candidate) => candidate.id === userId);
  if (!found || !found.active)
    throw new DomainError(422, "The assigned reviewer is not active.");
  return found;
}

function packageFor(state: AppState, packageId: string): Package {
  const found = state.packages.find((candidate) => candidate.id === packageId);
  if (!found) throw new DomainError(404, "Package not found.");
  return found;
}

function versionFor(state: AppState, versionId: string): DocumentVersion {
  const found = state.versions.find((candidate) => candidate.id === versionId);
  if (!found) throw new DomainError(404, "Document version not found.");
  return found;
}

function sectionFor(version: DocumentVersion, sectionId: string): Section {
  const found = version.sections.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!found)
    throw new DomainError(422, "Section is not part of this document version.");
  return found;
}

function assignmentFor(state: AppState, assignmentId: string): Assignment {
  const found = state.assignments.find(
    (candidate) => candidate.id === assignmentId,
  );
  if (!found) throw new DomainError(404, "Review assignment not found.");
  return found;
}

function currentAssignment(
  state: AppState,
  assignmentId: string,
): {
  assignment: Assignment;
  version: DocumentVersion;
  package: Package;
  section: Section;
} {
  const assignment = assignmentFor(state, assignmentId);
  const version = versionFor(state, assignment.versionId);
  const pkg = packageFor(state, version.packageId);
  if (pkg.currentVersionId !== version.id || version.status !== "PUBLISHED") {
    throw new DomainError(
      409,
      "This review belongs to a superseded document version.",
    );
  }
  return {
    assignment,
    version,
    package: pkg,
    section: sectionFor(version, assignment.sectionId),
  };
}

function canManage(actor: Principal): boolean {
  return actor.roles.some((role) => role === "admin" || role === "publisher");
}

function authorizeAssignment(
  actor: Principal,
  assignment: Assignment,
  pkg: Package,
  allowManager = false,
): void {
  requireEntity(actor, assignment.entity || pkg.entity);
  if (actor.id === assignment.reviewerId) return;
  if (allowManager && (actor.roles.includes("manager") || canManage(actor)))
    return;
  throw new DomainError(
    403,
    "Only the assigned reviewer may change this review.",
  );
}

function expectedRevision(command: Command): unknown {
  return command.expectedRevision;
}

function validateSections(
  state: AppState,
  sections: unknown,
  pageCount: number,
  packageEntity: string,
): Section[] {
  if (!Array.isArray(sections) || sections.length === 0)
    throw new DomainError(422, "At least one section is required.");
  const ids = new Set<string>();
  const result: Section[] = [];
  for (const raw of sections) {
    if (!raw || typeof raw !== "object")
      throw new DomainError(422, "Invalid section mapping.");
    const value = raw as Partial<Section>;
    if (typeof value.id !== "string" || !value.id.trim() || ids.has(value.id))
      throw new DomainError(422, "Section identifiers must be unique.");
    if (typeof value.name !== "string" || !value.name.trim())
      throw new DomainError(422, "Section name is required.");
    if (typeof value.entity !== "string" || !value.entity.trim())
      throw new DomainError(422, "Section reporting unit is required.");
    if (
      !Array.isArray(value.pages) ||
      value.pages.some(
        (page) => !Number.isInteger(page) || page < 1 || page > pageCount,
      )
    )
      throw new DomainError(422, "Section pages must be within the document.");
    if (!Array.isArray(value.metrics))
      throw new DomainError(422, "Section metrics are required.");
    const metricIds = new Set<string>();
    const metrics = value.metrics.map((metric) => {
      if (!metric || typeof metric !== "object")
        throw new DomainError(422, "Invalid metric mapping.");
      const candidate = metric as Partial<Section["metrics"][number]>;
      if (
        typeof candidate.id !== "string" ||
        !candidate.id.trim() ||
        metricIds.has(candidate.id)
      )
        throw new DomainError(
          422,
          "Metric identifiers must be unique within a section.",
        );
      if (
        typeof candidate.label !== "string" ||
        !candidate.label.trim() ||
        typeof candidate.required !== "boolean"
      )
        throw new DomainError(
          422,
          "Metric label and required flag are required.",
        );
      metricIds.add(candidate.id);
      return {
        id: candidate.id,
        label: candidate.label.trim(),
        required: candidate.required,
      };
    });
    if (metrics.some((metric) => metric.required) && value.pages.length === 0)
      throw new DomainError(
        422,
        "Review sections must map to at least one document page.",
      );
    const reviewerIds = Array.isArray(value.reviewerIds)
      ? value.reviewerIds
      : [];
    if (
      reviewerIds.some(
        (reviewerId) => typeof reviewerId !== "string" || !reviewerId.trim(),
      ) ||
      new Set(reviewerIds).size !== reviewerIds.length
    )
      throw new DomainError(422, "Reviewer assignments must be unique.");
    const parentSectionIds = Array.isArray(value.parentSectionIds)
      ? value.parentSectionIds
      : undefined;
    if (
      parentSectionIds?.some(
        (parentId) =>
          typeof parentId !== "string" ||
          !parentId.trim() ||
          parentId === value.id,
      ) ||
      (parentSectionIds &&
        new Set(parentSectionIds).size !== parentSectionIds.length)
    )
      throw new DomainError(422, "Invalid parent section.");
    for (const reviewerId of reviewerIds) {
      const reviewer = user(state, reviewerId);
      requireEntity(reviewer, value.entity);
    }
    ids.add(value.id);
    result.push({
      id: value.id,
      name: value.name.trim(),
      entity: value.entity,
      pages: [...value.pages],
      metrics,
      reviewerIds: [...reviewerIds],
      ...(parentSectionIds ? { parentSectionIds: [...parentSectionIds] } : {}),
    });
  }
  for (const section of result)
    for (const parentId of section.parentSectionIds ?? [])
      if (!ids.has(parentId))
        throw new DomainError(422, "Parent section does not exist.");
  for (const section of result) {
    const isParent = result.some((candidate) =>
      candidate.parentSectionIds?.includes(section.id),
    );
    if (
      (section.metrics.some((metric) => metric.required) || isParent) &&
      section.reviewerIds.length === 0
    ) {
      throw new DomainError(
        422,
        `Section ${section.name} has no reviewer assigned.`,
      );
    }
  }
  return result;
}

function hasRequiredWork(section: Section, version: DocumentVersion): boolean {
  const hasChildren = version.sections.some((candidate) =>
    candidate.parentSectionIds?.includes(section.id),
  );
  return section.metrics.some((metric) => metric.required) || hasChildren;
}

function ancestorSections(
  version: DocumentVersion,
  sectionId: string,
): Section[] {
  const byId = new Map(
    version.sections.map((section) => [section.id, section]),
  );
  const result: Section[] = [];
  const seen = new Set<string>();
  const walk = (idToVisit: string) => {
    const section = byId.get(idToVisit);
    for (const parentId of section?.parentSectionIds ?? []) {
      if (seen.has(parentId)) continue;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (parent) result.push(parent);
      walk(parentId);
    }
  };
  walk(sectionId);
  return result;
}

function invalidateParents(
  state: AppState,
  actor: Principal,
  version: DocumentVersion,
  sectionId: string,
  reason: string,
): void {
  const parentIds = new Set(
    ancestorSections(version, sectionId).map((section) => section.id),
  );
  for (const assignment of state.assignments.filter(
    (candidate) =>
      candidate.versionId === version.id && parentIds.has(candidate.sectionId),
  )) {
    if (isValidSignature(state, assignment.signatureId)) {
      invalidateSignature(state, assignment.signatureId, actor, reason);
      assignment.signatureId = undefined;
      assignment.status = "IN_PROGRESS";
      assignment.revision += 1;
      audit(state, actor, "REVIEW_PARENT_INVALIDATED", assignment.id, reason);
    }
  }
}

function validSignaturesForSection(
  state: AppState,
  versionId: string,
  sectionId: string,
): boolean {
  const assignments = state.assignments.filter(
    (candidate) =>
      candidate.versionId === versionId && candidate.sectionId === sectionId,
  );
  return (
    assignments.length > 0 &&
    assignments.every(
      (assignment) =>
        assignment.status === "SIGNED" &&
        isValidSignature(state, assignment.signatureId),
    )
  );
}

function responseComplete(assignment: Assignment, section: Section): boolean {
  return section.metrics
    .filter((metric) => metric.required)
    .every((metric) =>
      assignment.responses.some(
        (response) => response.metricId === metric.id && !!response.answer,
      ),
    );
}

function hasBlockingException(assignment: Assignment): boolean {
  return assignment.responses.some(
    (response) => response.answer === "NEEDS_EXPLANATION",
  );
}

function validateNoCycleInParents(sections: Section[]): void {
  const state = new Map(
    sections.map((section) => [section.id, section.parentSectionIds ?? []]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string) => {
    if (visiting.has(node))
      throw new DomainError(422, "Section parent mapping contains a cycle.");
    if (visited.has(node)) return;
    visiting.add(node);
    for (const parent of state.get(node) ?? []) visit(parent);
    visiting.delete(node);
    visited.add(node);
  };
  for (const section of sections) visit(section.id);
}

function createPackage(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  requireRole(actor, "admin", "publisher");
  const title = requireText(command.title, "Title", 200);
  const period = requireText(command.period, "Period", 100);
  const entity = requireText(command.entity, "Reporting unit", 100);
  requireEntity(actor, entity);
  const dueAt = requireText(command.dueAt, "Due date", 100);
  if (Number.isNaN(Date.parse(dueAt)))
    throw new DomainError(422, "Due date must be an ISO timestamp.");
  const pkg: Package = {
    id: id(),
    title,
    period,
    entity,
    dueAt,
    status: "DRAFT",
    revision: 1,
  };
  state.packages.push(pkg);
  audit(state, actor, "PACKAGE_CREATED", pkg.id, `${period} ${entity}`);
  return pkg;
}

function addVersion(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  requireRole(actor, "admin", "publisher");
  const pkg = packageFor(state, String(command.packageId));
  requireEntity(actor, pkg.entity);
  revision(pkg.revision, expectedRevision(command));
  const evidence = state.evidence.find(
    (candidate) => candidate.id === command.fileId,
  );
  if (!evidence)
    throw new DomainError(422, "A validated document file is required.");
  if (evidence.entity !== pkg.entity || evidence.scan === "REJECTED")
    throw new DomainError(
      422,
      "Document evidence is not valid for this package.",
    );
  const sections = validateSections(
    state,
    command.sections,
    evidence.pageCount,
    pkg.entity,
  );
  for (const section of sections) requireEntity(actor, section.entity);
  validateNoCycleInParents(sections);
  const version: DocumentVersion = {
    id: id(),
    packageId: pkg.id,
    number:
      Math.max(
        0,
        ...state.versions
          .filter((candidate) => candidate.packageId === pkg.id)
          .map((candidate) => candidate.number),
      ) + 1,
    fileId: evidence.id,
    sha256: evidence.sha256,
    filename: evidence.filename,
    pageCount: evidence.pageCount,
    scan: evidence.scan,
    status: "DRAFT",
    producedAt: requireText(command.producedAt, "Produced date", 100),
    uploadedAt: evidence.uploadedAt,
    sections,
    revision: 1,
  };
  if (Number.isNaN(Date.parse(version.producedAt)))
    throw new DomainError(422, "Produced date must be an ISO timestamp.");
  state.versions.push(version);
  pkg.revision += 1;
  audit(state, actor, "VERSION_ADDED", version.id, `v${version.number}`);
  return version;
}

function updateVersion(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  requireRole(actor, "admin", "publisher");
  const version = versionFor(state, String(command.versionId));
  const pkg = packageFor(state, version.packageId);
  requireEntity(actor, pkg.entity);
  revision(version.revision, expectedRevision(command));
  if (version.status !== "DRAFT")
    throw new DomainError(409, "Only a draft version can be edited.");
  const sections = validateSections(
    state,
    command.sections,
    version.pageCount,
    pkg.entity,
  );
  for (const section of sections) requireEntity(actor, section.entity);
  validateNoCycleInParents(sections);
  version.sections = sections;
  version.revision += 1;
  audit(state, actor, "VERSION_UPDATED", version.id);
  return version;
}

function publishVersion(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  requireRole(actor, "admin", "publisher");
  const version = versionFor(state, String(command.versionId));
  const pkg = packageFor(state, version.packageId);
  requireEntity(actor, pkg.entity);
  revision(version.revision, expectedRevision(command));
  if (version.status !== "DRAFT")
    throw new DomainError(409, "Only a draft version can be published.");
  if (
    version.scan !== "CLEAN" &&
    !(version.scan === "LOCAL_ONLY" && localScanAllowed())
  )
    throw new DomainError(
      422,
      "Document scan must be clean before publication.",
    );
  validateNoCycleInParents(version.sections);
  const publication = applyAssignmentRules(
    state,
    actor,
    structuredClone(version),
  );
  // Recheck the publication snapshot because users and access can change while a
  // draft is waiting for publication. Do this before changing the prior current
  // version so a failed publication leaves the aggregate untouched.
  for (const section of publication.sections) {
    requireEntity(actor, section.entity);
    for (const reviewerId of section.reviewerIds) {
      const reviewer = user(state, reviewerId);
      requireEntity(reviewer, section.entity);
    }
    if (hasRequiredWork(section, version) && section.reviewerIds.length === 0)
      throw new DomainError(
        422,
        `Section ${section.name} has no reviewer assigned.`,
      );
  }
  const prior = pkg.currentVersionId
    ? versionFor(state, pkg.currentVersionId)
    : undefined;
  if (prior) assertIssuesCarryable(state, prior.id, publication.sections);
  version.sections = publication.sections;
  version.assignmentRuleSnapshot = publication.assignmentRuleSnapshot;
  if (prior) {
    prior.status = "SUPERSEDED";
    for (const oldAssignment of state.assignments.filter(
      (assignment) => assignment.versionId === prior.id,
    )) {
      invalidateSignature(
        state,
        oldAssignment.signatureId,
        actor,
        "Document version superseded.",
      );
    }
  }
  version.status = "PUBLISHED";
  version.publishedAt = now();
  version.revision += 1;
  pkg.currentVersionId = version.id;
  pkg.finalVersionId = undefined;
  pkg.status = "IN_REVIEW";
  pkg.revision += 1;
  const newAssignments: Assignment[] = [];
  for (const section of version.sections) {
    if (!hasRequiredWork(section, version)) continue;
    for (const reviewerId of section.reviewerIds) {
      const reviewer = user(state, reviewerId);
      const assignment: Assignment = {
        id: id(),
        versionId: version.id,
        sectionId: section.id,
        reviewerId,
        entity: section.entity,
        dueAt: pkg.dueAt,
        responses: [],
        history: [],
        status: "NOT_STARTED",
        revision: 1,
      };
      const old =
        prior &&
        state.assignments.find(
          (candidate) =>
            candidate.versionId === prior.id &&
            candidate.sectionId === section.id &&
            candidate.reviewerId === reviewerId,
        );
      if (old) {
        assignment.history = old.responses.map((response) => ({ ...response }));
        for (const comment of state.comments.filter(
          (candidate) => candidate.assignmentId === old.id,
        )) {
          const carried = {
            ...comment,
            id: id(),
            assignmentId: assignment.id,
            versionId: version.id,
            at: now(),
            sourceCommentId: comment.sourceCommentId ?? comment.id,
            sourceVersionId: comment.sourceVersionId ?? prior?.id,
            originalAt: comment.originalAt ?? comment.at,
          };
          state.comments.push(carried);
          audit(
            state,
            actor,
            "COMMENT_CARRIED_FORWARD",
            carried.id,
            `sourceVersion=${prior?.id}`,
          );
        }
      } else if (prior) {
        // A changed owner still receives historical context. The source version
        // and original thread remain available through the copied comment's
        // audit trail; no prior response or signature becomes current.
        const oldAssignments = state.assignments.filter(
          (candidate) =>
            candidate.versionId === prior.id &&
            candidate.sectionId === section.id,
        );
        for (const oldAssignment of oldAssignments)
          for (const comment of state.comments.filter(
            (candidate) => candidate.assignmentId === oldAssignment.id,
          )) {
            const carried = {
              ...comment,
              id: id(),
              assignmentId: assignment.id,
              versionId: version.id,
              at: now(),
              sourceCommentId: comment.sourceCommentId ?? comment.id,
              sourceVersionId: comment.sourceVersionId ?? prior.id,
              originalAt: comment.originalAt ?? comment.at,
            };
            state.comments.push(carried);
            audit(
              state,
              actor,
              "COMMENT_CARRIED_FORWARD",
              carried.id,
              `sourceVersion=${prior.id}`,
            );
          }
      }
      state.assignments.push(assignment);
      newAssignments.push(assignment);
      notify(
        state,
        "REVIEW_ASSIGNED",
        assignment.id,
        reviewer.id,
        `Review ${pkg.title} ${pkg.period} v${version.number} is assigned.`,
      );
    }
  }
  if (prior) carryIssuesForward(state, actor, prior.id, version.id);
  audit(
    state,
    actor,
    "VERSION_PUBLISHED",
    version.id,
    `v${version.number}; ${newAssignments.length} assignments`,
  );
  return { version, assignments: newAssignments };
}

function saveResponse(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const current = currentAssignment(state, String(command.assignmentId));
  requireRole(actor, "reviewer");
  authorizeAssignment(actor, current.assignment, current.package);
  revision(current.assignment.revision, expectedRevision(command));
  if (
    current.assignment.signatureId ||
    current.assignment.status === "SIGNED" ||
    current.assignment.status === "SUBMITTED"
  )
    throw new DomainError(409, "Reopen this review before changing responses.");
  if (!answers.includes(command.answer as Answer))
    throw new DomainError(
      422,
      "Answer must be OKAY, NEEDS_EXPLANATION or NOT_APPLICABLE.",
    );
  const metricId = requireText(command.metricId, "Metric", 200);
  const metric = current.section.metrics.find(
    (candidate) => candidate.id === metricId,
  );
  if (!metric)
    throw new DomainError(422, "Metric is not assigned to this section.");
  const comment =
    typeof command.comment === "string" ? command.comment.trim() : "";
  if (
    (command.answer === "NEEDS_EXPLANATION" ||
      command.answer === "NOT_APPLICABLE") &&
    !comment
  )
    throw new DomainError(
      422,
      "A comment or reason is required for this answer.",
    );
  const previous = current.assignment.responses.find(
    (response) => response.metricId === metricId,
  );
  if (previous) current.assignment.history.push({ ...previous });
  const response = {
    metricId,
    answer: command.answer as Answer,
    comment,
    by: actor.id,
    at: now(),
    revision: (previous?.revision ?? 0) + 1,
  };
  current.assignment.responses = current.assignment.responses.filter(
    (candidate) => candidate.metricId !== metricId,
  );
  current.assignment.responses.push(response);
  current.assignment.status = hasBlockingException(current.assignment)
    ? "EXCEPTIONS"
    : "IN_PROGRESS";
  current.assignment.revision += 1;
  audit(state, actor, "RESPONSE_SAVED", current.assignment.id, metricId);
  return current.assignment;
}

function submitReview(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const current = currentAssignment(state, String(command.assignmentId));
  requireRole(actor, "reviewer");
  authorizeAssignment(actor, current.assignment, current.package);
  revision(current.assignment.revision, expectedRevision(command));
  if (current.assignment.status === "SIGNED")
    throw new DomainError(409, "This review is already signed.");
  if (!responseComplete(current.assignment, current.section))
    throw new DomainError(
      422,
      "Every required metric must be answered before submission.",
    );
  current.assignment.status = hasBlockingException(current.assignment)
    ? "EXCEPTIONS"
    : "SUBMITTED";
  current.assignment.revision += 1;
  audit(
    state,
    actor,
    "REVIEW_SUBMITTED",
    current.assignment.id,
    hasBlockingException(current.assignment) ? "with exceptions" : "clean",
  );
  return current.assignment;
}

function signReview(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const current = currentAssignment(state, String(command.assignmentId));
  const hasChildren = current.version.sections.some((section) =>
    section.parentSectionIds?.includes(current.section.id),
  );
  if (hasChildren) requireRole(actor, "reviewer", "manager");
  else requireRole(actor, "reviewer");
  authorizeAssignment(actor, current.assignment, current.package);
  revision(current.assignment.revision, expectedRevision(command));
  if (
    current.assignment.signatureId &&
    isValidSignature(state, current.assignment.signatureId)
  )
    throw new DomainError(409, "This review is already signed.");
  if (!responseComplete(current.assignment, current.section))
    throw new DomainError(
      422,
      "Every required metric must be answered before signing.",
    );
  if (hasBlockingException(current.assignment))
    throw new DomainError(
      422,
      "Resolve all explanation exceptions before signing.",
    );
  if (hasUnresolvedIssue(state, current.assignment.id))
    throw new DomainError(
      422,
      "Resolve all open review issues before signing.",
    );
  const childSections =
    state.versions
      .find((candidate) => candidate.id === current.version.id)
      ?.sections.filter((section) =>
        section.parentSectionIds?.includes(current.section.id),
      ) ?? [];
  for (const child of childSections)
    if (!validSignaturesForSection(state, current.version.id, child.id))
      throw new DomainError(
        422,
        "Every child section must have a valid sign-off first.",
      );
  const statement = `I have reviewed the selected metrics for ${current.section.name} in ${current.package.title}, ${current.package.period}, version ${current.version.number}. My responses and comments reflect my review, and I have identified any outstanding concerns.`;
  const snapshot = {
    packageId: current.package.id,
    documentVersionId: current.version.id,
    documentSha256: current.version.sha256,
    sectionId: current.section.id,
    assignmentId: current.assignment.id,
    responses: current.assignment.responses.map((response) => ({
      ...response,
    })),
    statement,
  };
  const signature = addSignature(state, {
    subjectType: "assignment",
    subjectId: current.assignment.id,
    revision: current.assignment.revision,
    signerId: actor.id,
    signerName: actor.name,
    statement,
    contentHash: hash(snapshot),
    documentVersionId: current.version.id,
    evidenceIds: [],
    prerequisiteSignatureIds: childSections.flatMap((child) =>
      state.assignments
        .filter(
          (assignment) =>
            assignment.versionId === current.version.id &&
            assignment.sectionId === child.id,
        )
        .map((assignment) => assignment.signatureId)
        .filter((signatureId): signatureId is string =>
          isValidSignature(state, signatureId),
        ),
    ),
    snapshot,
  });
  current.assignment.signatureId = signature.id;
  current.assignment.status = "SIGNED";
  current.assignment.revision += 1;
  audit(
    state,
    actor,
    "REVIEW_SIGNED",
    current.assignment.id,
    signature.contentHash,
  );
  return signature;
}

function reopenReview(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const current = currentAssignment(state, String(command.assignmentId));
  authorizeAssignment(actor, current.assignment, current.package, true);
  revision(current.assignment.revision, expectedRevision(command));
  const reason = requireText(command.reason, "Reopen reason", 2000);
  invalidateSignature(state, current.assignment.signatureId, actor, reason);
  current.assignment.signatureId = undefined;
  current.assignment.status = hasBlockingException(current.assignment)
    ? "EXCEPTIONS"
    : "IN_PROGRESS";
  current.assignment.revision += 1;
  if (current.package.finalVersionId === current.version.id) {
    current.package.finalVersionId = undefined;
    current.package.status = "IN_REVIEW";
    current.package.revision += 1;
  }
  invalidateParents(state, actor, current.version, current.section.id, reason);
  audit(state, actor, "REVIEW_REOPENED", current.assignment.id, reason);
  return current.assignment;
}

function finalizePackage(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  requireRole(actor, "admin", "publisher");
  const pkg = packageFor(state, String(command.packageId));
  requireEntity(actor, pkg.entity);
  revision(pkg.revision, expectedRevision(command));
  if (!pkg.currentVersionId)
    throw new DomainError(409, "Publish a document version before finalizing.");
  const version = versionFor(state, pkg.currentVersionId);
  if (version.status !== "PUBLISHED")
    throw new DomainError(409, "Current document version is not published.");
  const currentAssignments = state.assignments.filter(
    (assignment) =>
      assignment.versionId === version.id &&
      hasRequiredWork(sectionFor(version, assignment.sectionId), version),
  );
  if (
    currentAssignments.some(
      (assignment) =>
        !isValidSignature(state, assignment.signatureId) ||
        assignment.status !== "SIGNED",
    )
  )
    throw new DomainError(
      422,
      "All required section and parent sign-offs must be valid before finalization.",
    );
  if (currentAssignments.some((assignment) => hasBlockingException(assignment)))
    throw new DomainError(
      422,
      "Blocking exceptions must be resolved before finalization.",
    );
  if (hasUnresolvedIssueForVersion(state, version.id))
    throw new DomainError(
      422,
      "Resolve all open review issues before finalization.",
    );
  pkg.finalVersionId = version.id;
  pkg.status = "FINAL";
  pkg.revision += 1;
  audit(state, actor, "PACKAGE_FINALIZED", pkg.id, `v${version.number}`);
  return {
    package: pkg,
    version,
    signatures: state.signatures.filter(
      (signature) =>
        signature.documentVersionId === version.id &&
        isValidSignature(state, signature.id),
    ),
  };
}

function addComment(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const current = currentAssignment(state, String(command.assignmentId));
  authorizeAssignment(actor, current.assignment, current.package, true);
  const body = requireText(command.body, "Comment", 5000);
  let metricId: string | undefined;
  if (command.metricId !== undefined) {
    metricId = requireText(command.metricId, "Metric", 200);
    if (!current.section.metrics.some((metric) => metric.id === metricId))
      throw new DomainError(422, "Metric is not assigned to this section.");
  }
  const comment = {
    id: id(),
    assignmentId: current.assignment.id,
    versionId: current.version.id,
    sectionId: current.section.id,
    ...(metricId ? { metricId } : {}),
    body,
    by: actor.id,
    at: now(),
  };
  state.comments.push(comment);
  audit(
    state,
    actor,
    "COMMENT_ADDED",
    current.assignment.id,
    metricId ?? "section",
  );
  return comment;
}

export function handleReviewCommand(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  if (!command || typeof command.type !== "string") return null;
  switch (command.type) {
    case "createPackage":
      return createPackage(state, actor, command);
    case "addVersion":
      return addVersion(state, actor, command);
    case "updateVersion":
      return updateVersion(state, actor, command);
    case "publishVersion":
      return publishVersion(state, actor, command);
    case "saveResponse":
      return saveResponse(state, actor, command);
    case "submitReview":
      return submitReview(state, actor, command);
    case "signReview":
      return signReview(state, actor, command);
    case "reopenReview":
      return reopenReview(state, actor, command);
    case "finalizePackage":
      return finalizePackage(state, actor, command);
    case "addComment":
      return addComment(state, actor, command);
    default:
      return null;
  }
}
