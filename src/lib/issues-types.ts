/** A controlled exception raised against one assigned review. */
export type IssueCategory =
  | "DATA"
  | "METHODOLOGY"
  | "DISCLOSURE"
  | "PROCESS"
  | "OTHER";

export type IssueStatus = "OPEN" | "RESOLUTION_PROPOSED" | "RESOLVED";

export type IssueEventType =
  | "CREATED"
  | "COMMENTED"
  | "RESOLUTION_PROPOSED"
  | "RESOLUTION_ACCEPTED"
  | "REOPENED"
  | "CARRIED_FORWARD";

export type IssueEvent = {
  id: string;
  type: IssueEventType;
  by: string;
  at: string;
  body?: string;
  reason?: string;
  status: IssueStatus;
};

export type IssueResolution = {
  explanation: string;
  proposedBy: string;
  proposedAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
};

export type ReviewIssue = {
  id: string;
  assignmentId: string;
  versionId: string;
  packageId: string;
  entity: string;
  sectionId: string;
  metricId?: string;
  category: IssueCategory;
  title: string;
  description: string;
  status: IssueStatus;
  ownerId: string;
  createdBy: string;
  createdAt: string;
  revision: number;
  resolution?: IssueResolution;
  /** Explicit link to the prior issue when context is carried to a new version. */
  linkedFromIssueId?: string;
  events: IssueEvent[];
};
