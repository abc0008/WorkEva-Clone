import type { AppState, Command, Principal } from "@/lib/types";
import {
  DomainError,
  hash,
  requireText,
  requireEntity,
  requireRole,
} from "./domain";
import { handleReviewCommand } from "./review";
import { handleIssueCommand } from "./issues";
import { handleAdministrationCommand } from "./administration";
import { handleNotificationCommand } from "./notification-commands";
import { handleWorkflowCommand, invalidateDocumentGates } from "./workflow";
export function executeCommand(
  state: AppState,
  actor: Principal,
  command: Command,
) {
  if (!actor.active) throw new DomainError(403, "Your account is inactive.");
  const signing =
    command.type === "signReview" ||
    (command.type === "taskAction" && command.action === "attest");
  const key = command.idempotencyKey;
  if (signing) requireText(key, "Idempotency key", 200);
  const payloadHash = hash(command);
  if (key && signing) {
    requireText(key, "Idempotency key", 200);
    const prior = state.idempotency.find(
      (r) => r.actorId === actor.id && r.key === key,
    );
    if (prior) {
      if (command.type === "signReview") {
        const assignment = state.assignments.find(
          (a) => a.id === command.assignmentId,
        );
        if (!assignment || assignment.reviewerId !== actor.id)
          throw new DomainError(
            403,
            "This review is no longer assigned to you.",
          );
        requireRole(actor, "reviewer");
        requireEntity(actor, assignment.entity);
      } else if (command.type === "taskAction") {
        const task = state.runs
          .find((r) => r.id === command.runId)
          ?.tasks.find((t) => t.id === command.taskId);
        if (
          !task ||
          (task.ownerId !== actor.id && task.approverId !== actor.id)
        )
          throw new DomainError(403, "This task is no longer assigned to you.");
        requireEntity(actor, task.entity);
      }
      if (prior.hash !== payloadHash)
        throw new DomainError(
          409,
          "Idempotency key was reused for a different request.",
        );
      return prior.result;
    }
  }
  let result = handleIssueCommand(state, actor, command);
  if (result === null)
    result = handleAdministrationCommand(state, actor, command);
  if (result === null)
    result = handleNotificationCommand(state, actor, command);
  if (result === null) result = handleReviewCommand(state, actor, command);
  if (result === null) result = handleWorkflowCommand(state, actor, command);
  if (result === null) throw new DomainError(422, "Unknown operation.");
  if (["publishVersion", "reopenReview"].includes(command.type)) {
    const versionId =
      command.type === "publishVersion"
        ? command.versionId
        : state.assignments.find((a) => a.id === command.assignmentId)
            ?.versionId;
    const version = state.versions.find((v) => v.id === versionId);
    if (version)
      invalidateDocumentGates(
        state,
        actor,
        version.packageId,
        command.type === "publishVersion"
          ? "A replacement document was published."
          : "A required review was reopened.",
      );
  }
  if (key && signing)
    state.idempotency.push({
      key: String(key),
      actorId: actor.id,
      hash: payloadHash,
      result: structuredClone(result),
    });
  return result;
}
