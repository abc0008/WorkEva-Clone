import { DateTime } from "luxon";
import type {
  AppState,
  Assignment,
  Calendar,
  Dependency,
  DocumentVersion,
  Evidence,
  Principal,
  Signature,
  Task,
  WorkflowNode,
  WorkflowRun,
  WorkflowTemplate,
  Command,
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
import { validateWorkflowDefinition } from "@/lib/workflow-definition";

const DEFAULT_CALENDAR: Calendar = {
  timezone: "America/Chicago",
  holidays: [],
  weekdays: [1, 2, 3, 4, 5],
  cutoff: "17:00",
};
const TASK_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "COMPLETE",
  "CANCELLED",
] as const;
const NODE_TYPES = [
  "task",
  "attestation",
  "milestone",
  "input",
  "document_gate",
] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type WorkflowAction =
  | "start"
  | "submit"
  | "attest"
  | "reopen"
  | "forecast"
  | "rebind";
type ImpactRow = {
  taskId: string;
  ownerId: string;
  title: string;
  direct: boolean;
  previousForecastAt: string | null;
  currentForecastAt: string | null;
  baselineDueAt: string;
  deadlineBreached: boolean;
  unknownForecast: boolean;
  rootCauseIds: string[];
};

function fail(message: string, status = 422): never {
  throw new DomainError(status, message);
}
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is invalid.`);
  return value as Record<string, unknown>;
}
function asString(value: unknown, label: string, max = 5000): string {
  return requireText(value, label, max);
}
function asTextAllowEmpty(value: unknown, label: string, max = 5000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max)
    fail(`${label} must be under ${max} characters.`);
  return value.trim();
}
function asOptionalString(
  value: unknown,
  label: string,
  max = 5000,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return asString(value, label, max);
}
function asInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    fail(`${label} must be an integer of at least ${minimum}.`);
  return value;
}
function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}
function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function commandType(command: Command): string | null {
  return command && typeof command.type === "string" ? command.type : null;
}
function activeUser(state: AppState, userId: string, label: string): Principal {
  const user = state.users.find((candidate) => candidate.id === userId);
  if (!user || !user.active) fail(`${label} is not an active user.`);
  return user;
}
function userCanEntity(
  state: AppState,
  userId: string,
  entity: string,
): boolean {
  const user = state.users.find((candidate) => candidate.id === userId);
  return (
    !!user?.active &&
    (user.entities.includes("*") || user.entities.includes(entity))
  );
}
function isAction(value: unknown): value is WorkflowAction {
  return (
    typeof value === "string" &&
    ["start", "submit", "attest", "reopen", "forecast", "rebind"].includes(
      value,
    )
  );
}
function parseIso(value: unknown, label: string): DateTime {
  if (typeof value !== "string" || !value.trim()) fail(`${label} is required.`);
  const dt = DateTime.fromISO(value, { setZone: true });
  if (!dt.isValid) fail(`${label} must be a valid ISO date/time.`);
  return dt;
}
function parsePeriodEnd(period: string, zone: string): DateTime {
  const raw = period.trim();
  let dt: DateTime;
  if (/^\d{4}-\d{2}$/.test(raw))
    dt = DateTime.fromISO(`${raw}-01`, { zone }).endOf("month");
  else if (ISO_DATE_RE.test(raw)) dt = DateTime.fromISO(raw, { zone });
  else dt = DateTime.fromISO(raw, { zone });
  if (!dt.isValid) fail("period must be an ISO date or YYYY-MM period.");
  return dt.startOf("day");
}
function calendarForRun(run: WorkflowRun): Calendar {
  return run.calendar;
}
function parseCalendar(value: unknown): Calendar {
  if (value === undefined) return clone(DEFAULT_CALENDAR);
  const input = asRecord(value, "calendar");
  const timezone = asString(input.timezone, "calendar.timezone", 100);
  const zoneProbe = DateTime.now().setZone(timezone);
  if (!zoneProbe.isValid) fail("calendar.timezone is invalid.");
  const holidays = asArray(input.holidays, "calendar.holidays").map(
    (holiday, index) => {
      const date = asString(holiday, `calendar.holidays[${index}]`, 20);
      if (
        !ISO_DATE_RE.test(date) ||
        !DateTime.fromISO(date, { zone: timezone }).isValid
      )
        fail(`calendar.holidays[${index}] must be an ISO date.`);
      return date;
    },
  );
  const weekdays = asArray(input.weekdays, "calendar.weekdays").map(
    (weekday, index) => asInteger(weekday, `calendar.weekdays[${index}]`, 1),
  );
  if (
    weekdays.length === 0 ||
    weekdays.some((weekday) => weekday > 7) ||
    new Set(weekdays).size !== weekdays.length
  )
    fail(
      "calendar.weekdays must contain at least one unique value from 1 through 7.",
    );
  const cutoff = asString(input.cutoff, "calendar.cutoff", 10);
  if (!/^\d{1,2}:\d{2}$/.test(cutoff)) fail("calendar.cutoff must use HH:mm.");
  const [hour, minute] = cutoff.split(":").map(Number);
  if (hour > 23 || minute > 59) fail("calendar.cutoff must use HH:mm.");
  return { timezone, holidays: [...new Set(holidays)], weekdays, cutoff };
}
function dateKey(dt: DateTime): string {
  return dt.toISODate() ?? "";
}
function isBusinessDay(dt: DateTime, calendar: Calendar): boolean {
  return (
    calendar.weekdays.includes(dt.weekday) &&
    !calendar.holidays.includes(dateKey(dt))
  );
}
function cutoffParts(calendar: Calendar): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(calendar.cutoff);
  if (!match) fail("Calendar cutoff must use HH:mm.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) fail("Calendar cutoff must use HH:mm.");
  return [hour, minute];
}
function cutoffUtc(day: DateTime, calendar: Calendar): string {
  const [hour, minute] = cutoffParts(calendar);
  const result = day.set({ hour, minute, second: 0, millisecond: 0 }).toUTC();
  if (!result.isValid) fail("Unable to resolve calendar cutoff.");
  return result.toISO()!;
}
/** Resolve BD+0 on/before period end, and BD+n strictly after period end for n > 0. */
function resolveBusinessDay(
  periodEnd: DateTime,
  offset: number,
  calendar: Calendar,
): string {
  asInteger(offset, "dueOffset");
  let cursor = periodEnd.startOf("day");
  if (offset === 0) {
    while (!isBusinessDay(cursor, calendar)) cursor = cursor.minus({ days: 1 });
    return cutoffUtc(cursor, calendar);
  }
  let count = 0;
  while (count < offset) {
    cursor = cursor.plus({ days: 1 });
    if (isBusinessDay(cursor, calendar)) count += 1;
  }
  return cutoffUtc(cursor, calendar);
}
function addBusinessDays(
  value: DateTime,
  days: number,
  calendar: Calendar,
): DateTime {
  asInteger(days, "business-day lag");
  let cursor = workingDayAtOrAfter(value, calendar);
  let count = 0;
  while (count < days) {
    cursor = cursor.plus({ days: 1 });
    if (isBusinessDay(cursor, calendar)) count += 1;
  }
  return cursor;
}
function workingDayAtOrAfter(value: DateTime, calendar: Calendar): DateTime {
  let cursor = value.setZone(calendar.timezone);
  while (!isBusinessDay(cursor, calendar)) cursor = cursor.plus({ days: 1 });
  return cursor;
}
function graphOrder(
  nodes: WorkflowNode[],
  edges: Dependency[],
): WorkflowNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      fail("Dependency references an unknown node.");
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    ordered.push(nodes.find((node) => node.id === current)!);
    for (const target of outgoing.get(current)!) {
      const value = indegree.get(target)! - 1;
      indegree.set(target, value);
      if (value === 0) queue.push(target);
    }
  }
  if (ordered.length !== nodes.length)
    fail("Workflow dependencies must form a directed acyclic graph.");
  return ordered;
}
function validateNode(
  state: AppState,
  actor: Principal,
  value: unknown,
  seenIds: Set<string>,
): WorkflowNode {
  const input = asRecord(value, "node");
  const nodeId = asString(input.id, "node.id", 200);
  if (seenIds.has(nodeId)) fail(`Duplicate workflow node: ${nodeId}.`);
  seenIds.add(nodeId);
  const type = input.type;
  if (
    typeof type !== "string" ||
    !(NODE_TYPES as readonly string[]).includes(type)
  )
    fail(`Invalid node type for ${nodeId}.`);
  const ownerId = asString(input.ownerId, `${nodeId}.ownerId`, 200);
  const owner = activeUser(state, ownerId, `${nodeId} owner`);
  const entity = asString(input.entity, `${nodeId}.entity`, 200);
  if (!userCanEntity(state, owner.id, entity))
    fail(`${nodeId} owner is outside the node entity scope.`);
  requireEntity(actor, entity);
  const position = asRecord(input.position, `${nodeId}.position`);
  if (
    typeof position.x !== "number" ||
    !Number.isFinite(position.x) ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.y)
  )
    fail(`${nodeId}.position is invalid.`);
  const approverId = asOptionalString(
    input.approverId,
    `${nodeId}.approverId`,
    200,
  );
  if (approverId) {
    const approver = activeUser(state, approverId, `${nodeId} approver`);
    if (approver.id === owner.id)
      fail(`${nodeId} approver must differ from owner.`);
    if (!userCanEntity(state, approver.id, entity))
      fail(`${nodeId} approver is outside the node entity scope.`);
  }
  const dueOffset = asInteger(input.dueOffset, `${nodeId}.dueOffset`);
  const duration = asInteger(input.duration, `${nodeId}.duration`);
  const packageId = asOptionalString(
    input.packageId,
    `${nodeId}.packageId`,
    200,
  );
  const documentVersionId = asOptionalString(
    input.documentVersionId,
    `${nodeId}.documentVersionId`,
    200,
  );
  if (
    type === "document_gate" &&
    (!packageId || documentVersionId === undefined)
  )
    fail(`${nodeId} document gate requires packageId and documentVersionId.`);
  if (packageId && !state.packages.some((item) => item.id === packageId))
    fail(`${nodeId} references an unknown package.`);
  if (documentVersionId) {
    const version = state.versions.find(
      (item) => item.id === documentVersionId,
    );
    if (!version) fail(`${nodeId} references an unknown document version.`);
    if (!packageId || version.packageId !== packageId)
      fail(`${nodeId} document version does not belong to its package.`);
  }
  return {
    id: nodeId,
    title: asString(input.title, `${nodeId}.title`, 500),
    type: type as WorkflowNode["type"],
    ownerId,
    entity,
    instructions: asTextAllowEmpty(
      input.instructions,
      `${nodeId}.instructions`,
      10000,
    ),
    dueOffset,
    duration,
    evidenceRequired: asBoolean(
      input.evidenceRequired,
      `${nodeId}.evidenceRequired`,
    ),
    ...(approverId ? { approverId } : {}),
    statement: asString(input.statement, `${nodeId}.statement`, 10000),
    position: { x: position.x as number, y: position.y as number },
    ...(packageId ? { packageId } : {}),
    ...(documentVersionId ? { documentVersionId } : {}),
  };
}
function validateEdges(nodes: WorkflowNode[], values: unknown): Dependency[] {
  const edgesInput = asArray(values, "edges");
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges = edgesInput.map((value) => {
    const input = asRecord(value, "edge");
    const source = asString(input.source, "edge.source", 200);
    const target = asString(input.target, "edge.target", 200);
    if (source === target) fail("A workflow node cannot depend on itself.");
    if (!nodeIds.has(source) || !nodeIds.has(target))
      fail("Dependency references an unknown node.");
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) fail("Duplicate workflow dependency.");
    seen.add(key);
    return {
      id: asOptionalString(input.id, "edge.id", 200) ?? id(),
      source,
      target,
      hard: asBoolean(input.hard, "edge.hard"),
      lag: asInteger(input.lag, "edge.lag"),
    };
  });
  graphOrder(nodes, edges);
  return edges;
}
function findTemplate(state: AppState, templateId: unknown): WorkflowTemplate {
  const idValue = asString(templateId, "templateId", 200);
  const template = state.templates.find((item) => item.id === idValue);
  if (!template) fail("Workflow template was not found.", 404);
  return template;
}
function findRunTask(
  state: AppState,
  runId: unknown,
  taskId: unknown,
): { run: WorkflowRun; task: Task } {
  const run = state.runs.find(
    (item) => item.id === asString(runId, "runId", 200),
  );
  if (!run) fail("Workflow run was not found.", 404);
  const task = run.tasks.find(
    (item) => item.id === asString(taskId, "taskId", 200),
  );
  if (!task) fail("Workflow task was not found.", 404);
  return { run, task };
}
function runEdges(
  run: WorkflowRun,
  taskId: string,
  direction: "in" | "out",
): Dependency[] {
  return run.edges.filter((edge) =>
    direction === "in" ? edge.target === taskId : edge.source === taskId,
  );
}
function validTaskSignature(state: AppState, task: Task): boolean {
  return !task.invalidated && isValidSignature(state, task.signatureId);
}
function taskById(run: WorkflowRun, taskId: string): Task | undefined {
  return run.tasks.find((task) => task.id === taskId);
}
function prerequisiteSatisfied(
  state: AppState,
  run: WorkflowRun,
  sourceId: string,
): boolean {
  const source = taskById(run, sourceId);
  return (
    !!source &&
    source.status !== "CANCELLED" &&
    source.status === "COMPLETE" &&
    validTaskSignature(state, source)
  );
}
export function taskBlocked(
  state: AppState,
  run: WorkflowRun,
  task: Task,
): boolean {
  return runEdges(run, task.id, "in").some((edge) => {
    if (!edge.hard) return false;
    if (!prerequisiteSatisfied(state, run, edge.source)) return true;
    if (edge.lag === 0) return false;
    const source = taskById(run, edge.source)!;
    if (!source.actualAt) return true;
    return (
      addBusinessDays(
        DateTime.fromISO(source.actualAt, { setZone: true }),
        edge.lag,
        run.calendar,
      ).toMillis() > Date.now()
    );
  });
}
function notifyReadySuccessors(
  state: AppState,
  run: WorkflowRun,
  source: Task,
) {
  if (source.status !== "COMPLETE") return;
  for (const edge of runEdges(run, source.id, "out").filter(
    (edge) => edge.hard,
  )) {
    const target = taskById(run, edge.target);
    if (
      target &&
      !["COMPLETE", "CANCELLED"].includes(target.status) &&
      !taskBlocked(state, run, target)
    ) {
      notify(
        state,
        "TASK_UNBLOCKED",
        target.id,
        target.ownerId,
        `All hard prerequisites for ${target.title} are satisfied. Review and attest your work.`,
      );
    }
  }
}
function unmetHard(run: WorkflowRun, task: Task): Task[] {
  return runEdges(run, task.id, "in")
    .filter((edge) => edge.hard)
    .map((edge) => taskById(run, edge.source))
    .filter(
      (item): item is Task =>
        !!item && !(item.status === "COMPLETE" && !item.invalidated),
    );
}
function gateSatisfied(state: AppState, task: Task): boolean {
  if (
    task.type !== "document_gate" ||
    !task.packageId ||
    !task.documentVersionId
  )
    return false;
  const pkg = state.packages.find((item) => item.id === task.packageId);
  const version = state.versions.find(
    (item) => item.id === task.documentVersionId,
  );
  if (
    !pkg ||
    !version ||
    version.status !== "PUBLISHED" ||
    pkg.currentVersionId !== version.id
  )
    return false;
  const relevant = state.assignments.filter(
    (assignment) =>
      assignment.versionId === version.id &&
      assignment.sectionId &&
      version.sections.some((section) => section.id === assignment.sectionId),
  );
  const requiredSections = version.sections.filter(
    (section) =>
      section.metrics.some((metric) => metric.required) ||
      version.sections.some((candidate) =>
        candidate.parentSectionIds?.includes(section.id),
      ),
  );
  return requiredSections.every((section) => {
    const sectionAssignments = relevant.filter(
      (assignment) => assignment.sectionId === section.id,
    );
    return (
      sectionAssignments.length > 0 &&
      sectionAssignments.every(
        (assignment) =>
          assignment.status === "SIGNED" &&
          isValidSignature(state, assignment.signatureId),
      )
    );
  });
}
function gatePrerequisiteSignatureIds(state: AppState, task: Task): string[] {
  if (task.type !== "document_gate" || !task.documentVersionId) return [];
  return state.assignments
    .filter(
      (assignment) =>
        assignment.versionId === task.documentVersionId &&
        assignment.signatureId &&
        assignment.status === "SIGNED" &&
        isValidSignature(state, assignment.signatureId),
    )
    .map((assignment) => assignment.signatureId!)
    .sort();
}
function validEvidence(
  state: AppState,
  ids: string[],
  entity: string,
): Evidence[] {
  const evidence = ids.map((evidenceId) =>
    state.evidence.find((item) => item.id === evidenceId),
  );
  if (evidence.some((item) => !item))
    fail("Attached evidence was not found.", 404);
  const values = evidence as Evidence[];
  if (
    values.some(
      (item) =>
        item.entity !== entity ||
        (item.scan !== "CLEAN" && item.scan !== "LOCAL_ONLY"),
    )
  )
    fail("Evidence is not validated for this task.");
  if (
    process.env.NODE_ENV === "production" &&
    values.some((item) => item.scan === "LOCAL_ONLY")
  )
    fail("Local-only evidence cannot be used in production.");
  return values;
}
function taskSignatureRows(state: AppState, task: Task): Signature[] {
  return state.signatures.filter(
    (signature) =>
      signature.subjectType === "task" && signature.subjectId === task.id,
  );
}
function ownerSignature(state: AppState, task: Task): Signature | undefined {
  return taskSignatureRows(state, task).find(
    (signature) =>
      signature.signerId === task.ownerId &&
      isValidSignature(state, signature.id),
  );
}
function invalidateTaskSignatures(
  state: AppState,
  actor: Principal,
  task: Task,
  reason: string,
): boolean {
  let hadValidSignature = false;
  for (const signature of taskSignatureRows(state, task)) {
    if (!isValidSignature(state, signature.id)) continue;
    hadValidSignature = true;
    invalidateSignature(state, signature.id, actor, reason);
  }
  return hadValidSignature;
}
function projectForecasts(
  state: AppState,
  run: WorkflowRun,
): Map<string, string | null> {
  const ordered = graphOrder(run.tasks, run.edges);
  const forecasts = new Map<string, string | null>();
  const calendar = calendarForRun(run);
  const baseline = new Map(
    run.tasks.map((task) => [task.id, task.baselineDueAt]),
  );
  for (const taskNode of ordered) {
    const task = taskById(run, taskNode.id)!;
    const validActual = !!task.actualAt && validTaskSignature(state, task);
    // A valid completion is the authoritative current finish. A committed
    // forecast only applies while the task has not completed validly.
    const prior = validActual ? task.actualAt : task.forecastAt;
    let candidate: DateTime<boolean> = prior
      ? DateTime.fromISO(prior, { setZone: true })
      : DateTime.fromISO(baseline.get(task.id)!, { setZone: true });
    const upstream = runEdges(run, task.id, "in");
    let unknown = false;
    for (const edge of upstream) {
      const sourceForecast = forecasts.get(edge.source);
      if (sourceForecast === null || sourceForecast === undefined) {
        unknown = true;
        continue;
      }
      const sourceDt = DateTime.fromISO(sourceForecast, { setZone: true });
      const finish = addBusinessDays(
        addBusinessDays(sourceDt, edge.lag, calendar),
        task.duration,
        calendar,
      );
      if (finish.toMillis() > candidate.toMillis()) candidate = finish;
    }
    // An unfinished task with no committed forecast and a passed baseline has no credible date.
    const overdueWithoutCommitment =
      !prior && task.status !== "COMPLETE" && candidate.toMillis() < Date.now();
    forecasts.set(
      task.id,
      prior && !unknown
        ? candidate.toUTC().toISO()!
        : unknown || overdueWithoutCommitment
          ? null
          : candidate.toUTC().toISO()!,
    );
  }
  return forecasts;
}
function directAndTransitive(
  run: WorkflowRun,
  rootId: string,
): { ids: string[]; direct: Set<string> } {
  const direct = new Set(
    runEdges(run, rootId, "out").map((edge) => edge.target),
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    ids.push(current);
    queue.push(...runEdges(run, current, "out").map((edge) => edge.target));
  }
  return { ids, direct };
}
export function getTaskImpact(
  state: AppState,
  runId: string,
  taskId: string,
): {
  runId: string;
  taskId: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedOwners: string[];
  tasks: ImpactRow[];
  unknownForecast: boolean;
} {
  const { run, task } = findRunTask(state, runId, taskId);
  const descendants = directAndTransitive(run, task.id);
  const forecasts = projectForecasts(state, run);
  const affected = descendants.ids.map((idValue) => {
    const target = taskById(run, idValue)!;
    const previousForecastAt = target.forecastAt ?? target.baselineDueAt;
    const currentForecastAt = forecasts.get(target.id) ?? null;
    const rootCauseIds = runEdges(run, target.id, "in")
      .filter(
        (edge) =>
          descendants.ids.includes(edge.source) || edge.source === task.id,
      )
      .map((edge) => edge.source);
    return {
      taskId: target.id,
      ownerId: target.ownerId,
      title: target.title,
      direct: descendants.direct.has(target.id),
      previousForecastAt,
      currentForecastAt,
      baselineDueAt: target.baselineDueAt,
      deadlineBreached:
        currentForecastAt === null ||
        DateTime.fromISO(currentForecastAt).toMillis() >
          DateTime.fromISO(target.baselineDueAt).toMillis(),
      unknownForecast: currentForecastAt === null,
      rootCauseIds,
    } satisfies ImpactRow;
  });
  return {
    runId: run.id,
    taskId: task.id,
    directDependents: descendants.ids.filter((idValue) =>
      descendants.direct.has(idValue),
    ),
    transitiveDependents: descendants.ids,
    affectedOwners: [...new Set(affected.map((item) => item.ownerId))],
    tasks: affected,
    unknownForecast: affected.some((item) => item.unknownForecast),
  };
}
function invalidateDescendants(
  state: AppState,
  actor: Principal,
  run: WorkflowRun,
  root: Task,
  reason: string,
): Task[] {
  const descendants = directAndTransitive(run, root.id).ids;
  const changed: Task[] = [];
  for (const idValue of descendants) {
    const task = taskById(run, idValue)!;
    const hadValidSignature = invalidateTaskSignatures(
      state,
      actor,
      task,
      reason,
    );
    if (hadValidSignature || task.status === "COMPLETE") {
      task.signatureId = undefined;
      task.invalidated = true;
      if (task.status === "COMPLETE") task.status = "SUBMITTED";
      task.revision += 1;
      changed.push(task);
      notify(
        state,
        "WORKFLOW_INVALIDATED",
        task.id,
        task.ownerId,
        `Workflow task ${task.title} requires re-attestation because ${root.title} was reopened.`,
      );
    }
  }
  return changed;
}
export function invalidateDocumentGates(
  state: AppState,
  actor: Principal,
  packageId: string,
  reason: string,
): string[] {
  const packageRecord = state.packages.find((item) => item.id === packageId);
  if (!packageRecord) return [];
  const invalidated: string[] = [];
  for (const run of state.runs) {
    for (const gate of run.tasks.filter(
      (task) => task.type === "document_gate" && task.packageId === packageId,
    )) {
      if (
        gate.documentVersionId === packageRecord.currentVersionId &&
        gateSatisfied(state, gate)
      )
        continue;
      if (gate.invalidated && !gate.signatureId) continue;
      invalidateTaskSignatures(state, actor, gate, reason);
      gate.signatureId = undefined;
      gate.invalidated = true;
      if (gate.status === "COMPLETE") gate.status = "SUBMITTED";
      gate.revision += 1;
      invalidated.push(gate.id);
      invalidateDescendants(state, actor, run, gate, reason);
      notify(
        state,
        "DOCUMENT_GATE_INVALIDATED",
        gate.id,
        gate.ownerId,
        `Document review gate ${gate.title} needs re-attestation after a document change.`,
      );
      audit(state, actor, "workflow.gate.invalidated", gate.id, reason);
    }
  }
  return invalidated;
}
function assertTaskActor(
  state: AppState,
  actor: Principal,
  task: Task,
  role: "owner" | "approver" | "process",
): Principal {
  if (role === "process") {
    requireRole(actor, "manager", "admin");
    requireEntity(actor, task.entity);
    return actor;
  }
  const expectedId = role === "owner" ? task.ownerId : task.approverId;
  if (!expectedId || actor.id !== expectedId)
    fail("Only the assigned task participant may perform this action.", 403);
  requireEntity(actor, task.entity);
  if (!actor.active) fail("Your account is inactive.", 403);
  return actor;
}
function checkExpectedTaskRevision(task: Task, command: Command): void {
  revision(task.revision, command.expectedRevision);
}
function makeTask(
  templateNode: WorkflowNode,
  taskId: string,
  run: WorkflowRun,
  periodEnd: DateTime,
): Task {
  return {
    ...clone(templateNode),
    id: taskId,
    status: "NOT_STARTED",
    revision: 1,
    baselineDueAt: resolveBusinessDay(
      periodEnd,
      templateNode.dueOffset,
      run.calendar,
    ),
    evidenceIds: [],
  };
}
function saveTemplate(
  state: AppState,
  actor: Principal,
  command: Command,
): WorkflowTemplate {
  requireRole(actor, "designer", "admin");
  const templateId =
    command.templateId === undefined
      ? undefined
      : asString(command.templateId, "templateId", 200);
  let existing = templateId
    ? state.templates.find((item) => item.id === templateId)
    : undefined;
  if (templateId && !existing) fail("Workflow template was not found.", 404);
  if (existing) {
    for (const existingNode of existing.nodes)
      requireEntity(actor, existingNode.entity);
    if (existing.status === "PUBLISHED")
      fail(
        "Published workflow templates are immutable; save a new draft.",
        409,
      );
  }
  let importedDefinition:
    | ReturnType<typeof validateWorkflowDefinition>
    | undefined;
  if (command.definition !== undefined) {
    try {
      importedDefinition = validateWorkflowDefinition(command.definition);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Invalid workflow definition.",
      );
    }
  }
  let rawNodes = command.nodes;
  let rawEdges = command.edges;
  if (importedDefinition) {
    rawNodes = importedDefinition.nodes;
    rawEdges = importedDefinition.edges;
  }
  const sourceTemplateId = asOptionalString(
    command.sourceTemplateId,
    "sourceTemplateId",
    200,
  );
  const source = sourceTemplateId
    ? findTemplate(state, sourceTemplateId)
    : undefined;
  if ((rawNodes === undefined || rawEdges === undefined) && source) {
    rawNodes ??= source.nodes;
    rawEdges ??= source.edges;
  }
  const nodes = asArray(rawNodes, "nodes");
  const edges =
    rawEdges === undefined ? fail("edges must be an array.") : rawEdges;
  const seen = new Set<string>();
  const normalizedNodes = nodes.map((value) =>
    validateNode(state, actor, value, seen),
  );
  const normalizedEdges = validateEdges(normalizedNodes, edges);
  if (existing) {
    revision(existing.revision, command.expectedRevision);
    existing.name = asString(
      importedDefinition?.name ?? command.name,
      "name",
      500,
    );
    existing.nodes = normalizedNodes;
    existing.edges = normalizedEdges;
    existing.revision += 1;
    if (sourceTemplateId) existing.sourceTemplateId = sourceTemplateId;
    audit(
      state,
      actor,
      "workflow.template.saved",
      existing.id,
      `revision=${existing.revision}`,
    );
    return existing;
  }
  const template: WorkflowTemplate = {
    id: id(),
    name: asString(importedDefinition?.name ?? command.name, "name", 500),
    revision: 1,
    status: "DRAFT",
    nodes: normalizedNodes,
    edges: normalizedEdges,
    ...(sourceTemplateId ? { sourceTemplateId } : {}),
  };
  state.templates.push(template);
  audit(state, actor, "workflow.template.saved", template.id, "revision=1");
  return template;
}
function publishTemplate(
  state: AppState,
  actor: Principal,
  command: Command,
): WorkflowTemplate {
  requireRole(actor, "designer", "admin");
  const template = findTemplate(state, command.templateId);
  revision(template.revision, command.expectedRevision);
  if (template.status !== "DRAFT")
    fail("Only a draft workflow template can be published.", 409);
  graphOrder(template.nodes, template.edges);
  for (const templateNode of template.nodes) {
    activeUser(state, templateNode.ownerId, `${templateNode.title} owner`);
    requireEntity(actor, templateNode.entity);
    if (templateNode.approverId)
      activeUser(
        state,
        templateNode.approverId,
        `${templateNode.title} approver`,
      );
  }
  template.status = "PUBLISHED";
  template.publishedAt = now();
  template.nodes = clone(template.nodes);
  template.edges = clone(template.edges);
  template.revision += 1;
  audit(
    state,
    actor,
    "workflow.template.published",
    template.id,
    `revision=${template.revision}`,
  );
  return template;
}
function createRun(
  state: AppState,
  actor: Principal,
  command: Command,
): WorkflowRun {
  requireRole(actor, "manager", "admin", "designer");
  const template = findTemplate(state, command.templateId);
  if (template.status !== "PUBLISHED")
    fail("Only a published workflow template can be instantiated.");
  const period = asString(command.period, "period", 100);
  const calendar = parseCalendar(command.calendar);
  const periodEnd = parsePeriodEnd(period, calendar.timezone);
  for (const node of template.nodes) {
    activeUser(state, node.ownerId, `${node.title} owner`);
    requireEntity(actor, node.entity);
    if (node.approverId)
      activeUser(state, node.approverId, `${node.title} approver`);
    if (node.type === "document_gate") {
      if (!node.packageId || !node.documentVersionId)
        fail(`Document gate ${node.title} is not bound.`);
      const version = state.versions.find(
        (item) => item.id === node.documentVersionId,
      );
      const pkg = state.packages.find((item) => item.id === node.packageId);
      if (
        !version ||
        !pkg ||
        version.packageId !== node.packageId ||
        version.status !== "PUBLISHED" ||
        pkg.currentVersionId !== version.id
      )
        fail(`Document gate ${node.title} has an invalid published binding.`);
    }
  }
  const run: WorkflowRun = {
    id: id(),
    name: asOptionalString(command.name, "name", 500) ?? template.name,
    templateId: template.id,
    period,
    revision: 1,
    calendar,
    tasks: [],
    edges: clone(template.edges),
    createdAt: now(),
  };
  const taskIds = new Map(template.nodes.map((node) => [node.id, id()]));
  run.tasks = template.nodes.map((node) =>
    makeTask(node, taskIds.get(node.id)!, run, periodEnd),
  );
  run.edges = template.edges.map((edge) => ({
    ...clone(edge),
    id: id(),
    source: taskIds.get(edge.source)!,
    target: taskIds.get(edge.target)!,
  }));
  state.runs.push(run);
  audit(
    state,
    actor,
    "workflow.run.created",
    run.id,
    `template=${template.id};period=${period}`,
  );
  return run;
}
function attachEvidence(
  state: AppState,
  actor: Principal,
  command: Command,
): Task {
  const { run, task } = findRunTask(state, command.runId, command.taskId);
  checkExpectedTaskRevision(task, command);
  assertTaskActor(state, actor, task, "owner");
  if (
    task.status === "COMPLETE" ||
    taskSignatureRows(state, task).some((signature) =>
      isValidSignature(state, signature.id),
    )
  ) {
    fail("Reopen this task before changing its evidence.", 409);
  }
  const evidenceId = asString(command.evidenceId, "evidenceId", 200);
  const evidence = state.evidence.find((item) => item.id === evidenceId);
  if (!evidence) fail("Evidence was not found.", 404);
  validEvidence(state, [evidenceId], task.entity);
  if (!task.evidenceIds.includes(evidenceId)) task.evidenceIds.push(evidenceId);
  task.revision += 1;
  audit(
    state,
    actor,
    "workflow.evidence.attached",
    task.id,
    `run=${run.id};evidence=${evidenceId}`,
  );
  return task;
}
function taskAction(state: AppState, actor: Principal, command: Command): Task {
  const { run, task } = findRunTask(state, command.runId, command.taskId);
  checkExpectedTaskRevision(task, command);
  if (!isAction(command.action)) fail("Invalid task action.");
  const action = command.action;
  if (action === "start") {
    assertTaskActor(state, actor, task, "owner");
    if (task.type === "document_gate")
      fail("A document-review gate cannot be started manually.");
    if (task.status !== "NOT_STARTED")
      fail("Only a not-started task can be started.", 409);
    if (taskBlocked(state, run, task))
      fail("A hard prerequisite is not currently satisfied.", 409);
    task.status = "IN_PROGRESS";
    task.revision += 1;
    audit(state, actor, "workflow.task.started", task.id, `run=${run.id}`);
    return task;
  }
  if (action === "submit") {
    assertTaskActor(state, actor, task, "owner");
    if (task.type === "document_gate")
      fail("A document-review gate cannot be submitted manually.");
    if (task.status !== "IN_PROGRESS")
      fail("Only an in-progress task can be submitted.", 409);
    if (task.evidenceRequired && task.evidenceIds.length === 0)
      fail("Required evidence must be attached before submission.");
    if (task.evidenceIds.length)
      validEvidence(state, task.evidenceIds, task.entity);
    task.status = "SUBMITTED";
    task.revision += 1;
    audit(state, actor, "workflow.task.submitted", task.id, `run=${run.id}`);
    return task;
  }
  if (action === "attest") {
    if (task.type === "document_gate") {
      assertTaskActor(state, actor, task, "owner");
      if (!gateSatisfied(state, task))
        fail("The bound document review is not currently fully signed.", 409);
    } else if (task.status !== "SUBMITTED" && task.status !== "IN_PROGRESS") {
      fail("Task must be submitted before attestation.", 409);
    }
    if (task.status === "COMPLETE" && validTaskSignature(state, task))
      fail("This task is already attested.", 409);
    if (taskBlocked(state, run, task))
      fail("A hard prerequisite is not currently satisfied.", 409);
    if (task.evidenceRequired && task.evidenceIds.length === 0)
      fail("Required evidence must be attached before attestation.");
    const evidence = validEvidence(state, task.evidenceIds, task.entity);
    const statement = requireText(
      task.statement,
      "Attestation statement",
      10000,
    );
    if (task.approverId && actor.id === task.approverId) {
      assertTaskActor(state, actor, task, "approver");
      const preparer = ownerSignature(state, task);
      if (!preparer) fail("The task owner must attest before its approver.");
      if (task.status !== "SUBMITTED")
        fail("The task must be submitted before approval.", 409);
      if (preparer.signerId === actor.id)
        fail("Independent approval requires a different signer.");
      const approval = addSignature(state, {
        subjectType: "task",
        subjectId: task.id,
        revision: task.revision,
        signerId: actor.id,
        signerName: actor.name,
        statement,
        contentHash: hash({
          runId: run.id,
          taskId: task.id,
          revision: task.revision,
          statement,
          evidence: evidence.map((item) => item.sha256),
          prerequisites: [
            ...gatePrerequisiteSignatureIds(state, task),
            ...runEdges(run, task.id, "in")
              .filter((edge) => edge.hard)
              .map((edge) => taskById(run, edge.source)?.signatureId),
          ],
        }),
        evidenceIds: evidence.map((item) => item.id),
        prerequisiteSignatureIds: [
          preparer.id,
          ...gatePrerequisiteSignatureIds(state, task),
          ...runEdges(run, task.id, "in")
            .filter((edge) => edge.hard)
            .map((edge) => taskById(run, edge.source)?.signatureId)
            .filter((item): item is string => !!item),
        ],
        snapshot: clone(task),
      });
      task.signatureId = approval.id;
      task.status = "COMPLETE";
      task.actualAt = now();
      task.invalidated = false;
      task.revision += 1;
      notifyReadySuccessors(state, run, task);
      audit(
        state,
        actor,
        "workflow.task.approved",
        task.id,
        `run=${run.id};signature=${approval.id}`,
      );
      return task;
    }
    assertTaskActor(state, actor, task, "owner");
    if (task.approverId) {
      if (ownerSignature(state, task))
        fail("The task owner has already attested; approval is required.", 409);
    }
    const signature = addSignature(state, {
      subjectType: "task",
      subjectId: task.id,
      revision: task.revision,
      signerId: actor.id,
      signerName: actor.name,
      statement,
      contentHash: hash({
        runId: run.id,
        taskId: task.id,
        revision: task.revision,
        statement,
        evidence: evidence.map((item) => item.sha256),
        prerequisites: [
          ...gatePrerequisiteSignatureIds(state, task),
          ...runEdges(run, task.id, "in")
            .filter((edge) => edge.hard)
            .map((edge) => taskById(run, edge.source)?.signatureId),
        ],
      }),
      evidenceIds: evidence.map((item) => item.id),
      prerequisiteSignatureIds: [
        ...gatePrerequisiteSignatureIds(state, task),
        ...runEdges(run, task.id, "in")
          .filter((edge) => edge.hard)
          .map((edge) => taskById(run, edge.source)?.signatureId)
          .filter((item): item is string => !!item),
      ],
      snapshot: clone(task),
    });
    task.signatureId = signature.id;
    task.invalidated = false;
    if (!task.approverId) {
      task.status = "COMPLETE";
      task.actualAt = now();
    } else task.status = "SUBMITTED";
    task.revision += 1;
    notifyReadySuccessors(state, run, task);
    audit(
      state,
      actor,
      "workflow.task.attested",
      task.id,
      `run=${run.id};signature=${signature.id}`,
    );
    return task;
  }
  if (action === "reopen") {
    assertTaskActor(state, actor, task, "process");
    const reason = requireText(command.reason, "reason", 2000);
    if (task.status === "NOT_STARTED" || task.status === "CANCELLED")
      fail("Only active or completed work can be reopened.", 409);
    invalidateTaskSignatures(state, actor, task, reason);
    task.signatureId = undefined;
    task.invalidated = true;
    task.status = "IN_PROGRESS";
    task.forecastAt = undefined;
    task.revision += 1;
    const descendants = invalidateDescendants(state, actor, run, task, reason);
    notify(
      state,
      "WORKFLOW_REOPENED",
      task.id,
      task.ownerId,
      `Workflow task ${task.title} was reopened and requires fresh attestation.`,
    );
    audit(
      state,
      actor,
      "workflow.task.reopened",
      task.id,
      `run=${run.id};${reason}`,
    );
    return task;
  }
  if (action === "forecast") {
    assertTaskActor(
      state,
      actor,
      task,
      actor.id === task.ownerId ? "owner" : "process",
    );
    const forecastAt = parseIso(command.forecastAt, "forecastAt").toUTC();
    const hardEdges = runEdges(run, task.id, "in").filter((edge) => edge.hard);
    for (const edge of hardEdges) {
      const source = taskById(run, edge.source)!;
      const sourceFinish =
        source.actualAt && validTaskSignature(state, source)
          ? source.actualAt
          : source.forecastAt;
      if (!sourceFinish)
        fail(
          "Forecast cannot be committed while a hard prerequisite has an unknown forecast.",
          409,
        );
      const earliest = addBusinessDays(
        DateTime.fromISO(sourceFinish, { setZone: true }),
        edge.lag,
        run.calendar,
      );
      if (forecastAt.toMillis() < earliest.toUTC().toMillis())
        fail("Forecast would violate a hard prerequisite.", 409);
    }
    task.forecastAt = forecastAt.toISO()!;
    task.revision += 1;
    audit(
      state,
      actor,
      "workflow.task.forecasted",
      task.id,
      `run=${run.id};forecastAt=${task.forecastAt}`,
    );
    const impact = getTaskImpact(state, run.id, task.id);
    for (const row of impact.tasks)
      if (row.deadlineBreached || row.unknownForecast)
        notify(
          state,
          "WORKFLOW_DELAY",
          row.taskId,
          row.ownerId,
          `Workflow forecast changed because ${task.title} changed.`,
        );
    return task;
  }
  if (action === "rebind") {
    assertTaskActor(state, actor, task, "process");
    if (task.type !== "document_gate")
      fail("Only document-review gates can be rebound.");
    const reason = requireText(command.reason, "reason", 2000);
    const versionId = asString(
      command.documentVersionId,
      "documentVersionId",
      200,
    );
    const version = state.versions.find((item) => item.id === versionId);
    if (
      !version ||
      version.status !== "PUBLISHED" ||
      version.packageId !== task.packageId
    )
      fail("Gate must bind to a published version in its package.");
    const pkg = state.packages.find((item) => item.id === task.packageId);
    if (!pkg || pkg.currentVersionId !== version.id)
      fail("Gate must bind to the current published package version.");
    invalidateTaskSignatures(state, actor, task, reason);
    task.signatureId = undefined;
    task.documentVersionId = version.id;
    task.invalidated = true;
    task.revision += 1;
    invalidateDescendants(state, actor, run, task, reason);
    audit(
      state,
      actor,
      "workflow.gate.rebound",
      task.id,
      `version=${version.id};${reason}`,
    );
    notify(
      state,
      "DOCUMENT_GATE_REBOUND",
      task.id,
      task.ownerId,
      `Document review gate ${task.title} was rebound and requires fresh attestation.`,
    );
    return task;
  }
  // The action union above is exhaustive; this protects runtime callers with untyped JSON.
  fail("Invalid task action.");
}

export function handleWorkflowCommand(
  state: AppState,
  actor: Principal,
  command: Command,
): unknown {
  const type = commandType(command);
  if (!type) return null;
  switch (type) {
    case "saveTemplate":
      return saveTemplate(state, actor, command);
    case "publishTemplate":
      return publishTemplate(state, actor, command);
    case "createRun":
      return createRun(state, actor, command);
    case "taskAction":
      return taskAction(state, actor, command);
    case "attachEvidence":
      return attachEvidence(state, actor, command);
    default:
      return null;
  }
}
