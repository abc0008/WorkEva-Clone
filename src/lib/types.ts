import type { ReviewIssue } from "./issues-types";
import type { AssignmentRule, AssignmentChange } from "./admin-types";
import type {
  NotificationPreference,
  NotificationReceipt,
} from "./notification-types";
export type Role =
  | "admin"
  | "publisher"
  | "reviewer"
  | "designer"
  | "manager"
  | "reader";
export type Principal = {
  revision?: number;
  id: string;
  name: string;
  email: string;
  roles: Role[];
  entities: string[];
  active: boolean;
};
export type Metric = { id: string; label: string; required: boolean };
export type Section = {
  id: string;
  name: string;
  entity: string;
  pages: number[];
  metrics: Metric[];
  reviewerIds: string[];
  parentSectionIds?: string[];
};
export type DocumentVersion = {
  id: string;
  packageId: string;
  number: number;
  fileId: string;
  sha256: string;
  filename: string;
  pageCount: number;
  scan: "PENDING" | "CLEAN" | "REJECTED" | "LOCAL_ONLY";
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  producedAt: string;
  uploadedAt: string;
  publishedAt?: string;
  sections: Section[];
  assignmentRuleSnapshot?: Array<{
    sectionId: string;
    ruleId: string;
    ruleRevision: number;
    effectiveDate: string;
    reviewerIds: string[];
  }>;
  revision: number;
};
export type Package = {
  id: string;
  title: string;
  period: string;
  entity: string;
  dueAt: string;
  currentVersionId?: string;
  finalVersionId?: string;
  status: "DRAFT" | "IN_REVIEW" | "FINAL";
  revision: number;
};
export type Answer = "OKAY" | "NEEDS_EXPLANATION" | "NOT_APPLICABLE";
export type Response = {
  metricId: string;
  answer: Answer;
  comment: string;
  by: string;
  at: string;
  revision: number;
};
export type Assignment = {
  id: string;
  versionId: string;
  sectionId: string;
  reviewerId: string;
  entity: string;
  dueAt: string;
  responses: Response[];
  history: Response[];
  status: "NOT_STARTED" | "IN_PROGRESS" | "EXCEPTIONS" | "SUBMITTED" | "SIGNED";
  revision: number;
  signatureId?: string;
};
export type Signature = {
  id: string;
  subjectType: "assignment" | "task";
  subjectId: string;
  revision: number;
  signerId: string;
  signerName: string;
  at: string;
  statement: string;
  contentHash: string;
  documentVersionId?: string;
  evidenceIds: string[];
  prerequisiteSignatureIds: string[];
  snapshot: unknown;
};
export type SignatureEvent = {
  id: string;
  signatureId: string;
  action: "INVALIDATED";
  reason: string;
  by: string;
  at: string;
};
export type Comment = {
  id: string;
  assignmentId: string;
  versionId: string;
  sectionId: string;
  metricId?: string;
  body: string;
  by: string;
  at: string;
  sourceCommentId?: string;
  sourceVersionId?: string;
  originalAt?: string;
};
export type AuditEvent = {
  id: string;
  action: string;
  subjectId: string;
  by: string;
  at: string;
  detail: string;
};
export type OutboxEvent = {
  id: string;
  type: string;
  subjectId: string;
  recipientId: string;
  message: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "DRY_RUN";
  attempts: number;
  createdAt: string;
  nextAttemptAt?: string;
  leaseUntil?: string;
  error?: string;
  sentAt?: string;
};
export type WorkflowNode = {
  id: string;
  title: string;
  type: "task" | "attestation" | "milestone" | "input" | "document_gate";
  ownerId: string;
  entity: string;
  instructions: string;
  dueOffset: number;
  duration: number;
  evidenceRequired: boolean;
  approverId?: string;
  statement: string;
  position: { x: number; y: number };
  packageId?: string;
  documentVersionId?: string;
};
export type Dependency = {
  id: string;
  source: string;
  target: string;
  hard: boolean;
  lag: number;
};
export type Calendar = {
  timezone: string;
  holidays: string[];
  weekdays: number[];
  cutoff: string;
};
export type WorkflowTemplate = {
  id: string;
  name: string;
  revision: number;
  status: "DRAFT" | "PUBLISHED";
  nodes: WorkflowNode[];
  edges: Dependency[];
  publishedAt?: string;
  sourceTemplateId?: string;
};
export type Task = WorkflowNode & {
  status:
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUBMITTED"
    | "COMPLETE"
    | "CANCELLED";
  revision: number;
  baselineDueAt: string;
  forecastAt?: string;
  actualAt?: string;
  signatureId?: string;
  evidenceIds: string[];
  invalidated?: boolean;
  blocked?: boolean;
};
export type WorkflowRun = {
  id: string;
  name: string;
  templateId: string;
  period: string;
  revision: number;
  calendar: Calendar;
  tasks: Task[];
  edges: Dependency[];
  createdAt: string;
};
export type Evidence = {
  id: string;
  filename: string;
  sha256: string;
  pageCount: number;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
  scan: DocumentVersion["scan"];
  entity: string;
};
export type IdempotencyRecord = {
  key: string;
  actorId: string;
  hash: string;
  result: unknown;
};
export type AppState = {
  issues?: ReviewIssue[];
  assignmentRules?: AssignmentRule[];
  assignmentChanges?: AssignmentChange[];
  notificationPreferences?: NotificationPreference[];
  notificationReceipts?: NotificationReceipt[];
  revision: number;
  users: Principal[];
  packages: Package[];
  versions: DocumentVersion[];
  assignments: Assignment[];
  signatures: Signature[];
  signatureEvents: SignatureEvent[];
  comments: Comment[];
  audit: AuditEvent[];
  outbox: OutboxEvent[];
  templates: WorkflowTemplate[];
  runs: WorkflowRun[];
  evidence: Evidence[];
  idempotency: IdempotencyRecord[];
};
export type Command = { type: string; [key: string]: unknown };
export type AppSnapshot = AppState & {
  principal: Principal;
  localMode: boolean;
};
