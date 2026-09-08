import type { Response } from "./types";

/**
 * A dated ownership rule.  Rules are deliberately independent of document
 * versions: the same rule can be used when a later version is published.
 * `sectionId` is optional, which makes an entity rule a useful default.
 */
export type AssignmentRule = {
  id: string;
  entity: string;
  sectionId?: string;
  primaryReviewerId: string;
  backupReviewerIds?: string[];
  additionalRequiredReviewerIds?: string[];
  effectiveFrom: string;
  effectiveTo?: string;
  revision: number;
};

/** Immutable ownership history for an assignment. */
export type AssignmentChange = {
  id: string;
  assignmentId: string;
  versionId: string;
  sectionId: string;
  entity: string;
  previousReviewerId: string;
  newReviewerId: string;
  reason: string;
  /** Snapshot captured before reopen + ownership change. */
  previousResponses: Response[];
  previousSignatureId?: string;
  previousStatus:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "EXCEPTIONS"
    | "SUBMITTED"
    | "SIGNED";
  by: string;
  at: string;
};
