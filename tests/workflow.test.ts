import { describe, expect, it, vi } from "vitest";
import type { AppState, Principal, WorkflowNode } from "@/lib/types";
import { DomainError, isValidSignature } from "@/server/domain";
import {
  getTaskImpact,
  handleWorkflowCommand,
  taskBlocked,
} from "@/server/workflow";

const actor: Principal = {
  id: "designer",
  name: "Designer",
  email: "designer@example.test",
  roles: ["designer", "manager"],
  entities: ["*"],
  active: true,
};
const alice: Principal = {
  id: "alice",
  name: "Alice",
  email: "alice@example.test",
  roles: ["reviewer"],
  entities: ["BLR"],
  active: true,
};
const bob: Principal = {
  id: "bob",
  name: "Bob",
  email: "bob@example.test",
  roles: ["reviewer"],
  entities: ["BLR"],
  active: true,
};
const baseState = (): AppState => ({
  revision: 1,
  users: [actor, alice, bob],
  packages: [],
  versions: [],
  assignments: [],
  signatures: [],
  signatureEvents: [],
  comments: [],
  audit: [],
  outbox: [],
  templates: [],
  runs: [],
  evidence: [],
  idempotency: [],
});
function node(id: string, ownerId: string, dueOffset = 1): WorkflowNode {
  return {
    id,
    title: id,
    type: "task",
    ownerId,
    entity: "BLR",
    instructions: "",
    dueOffset,
    duration: 0,
    evidenceRequired: false,
    statement: `I attest ${id}`,
    position: { x: 0, y: 0 },
  };
}
function command(
  state: AppState,
  type: string,
  value: Record<string, unknown>,
  who: Principal = actor,
): any {
  return handleWorkflowCommand(state, who, { type, ...value } as any);
}
function makeRun(edges: unknown[] = []) {
  const state = baseState();
  const template = command(state, "saveTemplate", {
    name: "Fan in",
    nodes: [node("a", "alice"), node("b", "bob"), node("c", "alice")],
    edges,
  });
  command(state, "publishTemplate", {
    templateId: template.id,
    expectedRevision: template.revision,
  });
  const run = command(state, "createRun", {
    templateId: template.id,
    period: "2026-07",
  });
  return { state, run };
}
function completeTask(
  state: AppState,
  run: any,
  taskId: string,
  who: Principal,
) {
  let task = run.tasks.find((item: any) => item.id === taskId)!;
  task = command(
    state,
    "taskAction",
    { runId: run.id, taskId, action: "start", expectedRevision: task.revision },
    who,
  );
  task = command(
    state,
    "taskAction",
    {
      runId: run.id,
      taskId,
      action: "submit",
      expectedRevision: task.revision,
    },
    who,
  );
  return command(
    state,
    "taskAction",
    {
      runId: run.id,
      taskId,
      action: "attest",
      expectedRevision: task.revision,
    },
    who,
  );
}

function expectDomainError(fn: () => unknown, status = 422) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).status).toBe(status);
    return;
  }
  throw new Error("Expected DomainError");
}

describe("workflow domain", () => {
  it("requires every hard predecessor in a fan in graph", () => {
    const { state, run } = makeRun([
      { source: "a", target: "c", hard: true, lag: 0 },
      { source: "b", target: "c", hard: true, lag: 0 },
    ]);
    const target = run.tasks.find((task: any) => task.title === "c")!;
    expect(taskBlocked(state, run, target)).toBe(true);
    completeTask(
      state,
      run,
      run.tasks.find((task: any) => task.title === "a")!.id,
      alice,
    );
    expect(taskBlocked(state, run, target)).toBe(true);
    completeTask(
      state,
      run,
      run.tasks.find((task: any) => task.title === "b")!.id,
      bob,
    );
    expect(taskBlocked(state, run, target)).toBe(false);
    expect(
      state.outbox.some(
        (e) => e.type === "TASK_UNBLOCKED" && e.subjectId === target.id,
      ),
    ).toBe(true);
  });

  it("enforces nonzero business-day lag across a weekend", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-04T18:00:00Z"));
      const { state, run } = makeRun([
        { source: "a", target: "c", hard: true, lag: 1 },
      ]);
      const source = run.tasks.find((t: any) => t.title === "a");
      const target = run.tasks.find((t: any) => t.title === "c");
      completeTask(state, run, source.id, alice);
      expect(taskBlocked(state, run, target)).toBe(true);
      vi.setSystemTime(new Date("2026-09-07T17:59:00Z"));
      expect(taskBlocked(state, run, target)).toBe(true);
      vi.setSystemTime(new Date("2026-09-07T18:00:00Z"));
      expect(taskBlocked(state, run, target)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects self links, duplicate edges, and cycles on save", () => {
    const state = baseState();
    expectDomainError(() =>
      command(state, "saveTemplate", {
        name: "bad",
        nodes: [node("a", "alice")],
        edges: [{ source: "a", target: "a", hard: true, lag: 0 }],
      }),
    );
    expectDomainError(() =>
      command(state, "saveTemplate", {
        name: "bad",
        nodes: [node("a", "alice"), node("b", "bob")],
        edges: [
          { source: "a", target: "b", hard: true, lag: 0 },
          { source: "a", target: "b", hard: false, lag: 0 },
        ],
      }),
    );
    expectDomainError(() =>
      command(state, "saveTemplate", {
        name: "bad",
        nodes: [node("a", "alice"), node("b", "bob")],
        edges: [
          { source: "a", target: "b", hard: true, lag: 0 },
          { source: "b", target: "a", hard: true, lag: 0 },
        ],
      }),
    );
  });

  it("pins business day cutoff dates and preserves baseline dates", () => {
    const { run } = makeRun();
    const due = run.tasks.find(
      (task: any) => task.title === "a",
    )!.baselineDueAt;
    // July 2026 ends Friday. BD+1 is Monday, at the Chicago cutoff (22:00 UTC in summer).
    expect(due).toBe("2026-08-03T22:00:00.000Z");
    expect(run.calendar.timezone).toBe("America/Chicago");
    expect(
      run.tasks.find((task: any) => task.title === "a")!.baselineDueAt,
    ).toBe(due);
  });

  it("reopening invalidates descendant signatures while retaining history", () => {
    const { state, run } = makeRun([
      { source: "a", target: "c", hard: true, lag: 0 },
    ]);
    const sourceId = run.tasks.find((task: any) => task.title === "a")!.id;
    const childId = run.tasks.find((task: any) => task.title === "c")!.id;
    const completed = completeTask(state, run, sourceId, alice);
    completeTask(state, run, childId, alice);
    const child = run.tasks.find((task: any) => task.id === childId)!;
    expect(isValidSignature(state, completed.signatureId)).toBe(true);
    const reopened = command(state, "taskAction", {
      runId: run.id,
      taskId: sourceId,
      action: "reopen",
      expectedRevision: run.tasks.find((task: any) => task.id === sourceId)!
        .revision,
      reason: "Source changed",
    });
    expect(isValidSignature(state, completed.signatureId)).toBe(false);
    expect(state.signatures).toHaveLength(2);
    expect(reopened.invalidated).toBe(true);
    expect(child.invalidated).toBe(true);
    expect(taskBlocked(state, run, child)).toBe(true);
  });

  it("invalidates both preparer and approver signatures on reopen", () => {
    const state = baseState();
    const approvalNode = { ...node("a", "alice"), approverId: "bob" };
    const template = command(state, "saveTemplate", {
      name: "Approval",
      nodes: [approvalNode],
      edges: [],
    });
    command(state, "publishTemplate", {
      templateId: template.id,
      expectedRevision: template.revision,
    });
    const run = command(state, "createRun", {
      templateId: template.id,
      period: "2026-07",
    });
    let task = run.tasks[0];
    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "start",
        expectedRevision: task.revision,
      },
      alice,
    );
    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "submit",
        expectedRevision: task.revision,
      },
      alice,
    );
    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "attest",
        expectedRevision: task.revision,
      },
      alice,
    );
    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "attest",
        expectedRevision: task.revision,
      },
      bob,
    );
    expect(state.signatures).toHaveLength(2);
    task = command(state, "taskAction", {
      runId: run.id,
      taskId: task.id,
      action: "reopen",
      expectedRevision: task.revision,
      reason: "Source changed",
    });
    expect(state.signatureEvents).toHaveLength(2);
    expect(task.signatureId).toBeUndefined();
    expect(task.invalidated).toBe(true);

    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "attest",
        expectedRevision: task.revision,
      },
      alice,
    );
    expect(task.status).toBe("SUBMITTED");
    task = command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: task.id,
        action: "attest",
        expectedRevision: task.revision,
      },
      bob,
    );
    expect(task.status).toBe("COMPLETE");
  });

  it("uses unique task ids and remapped edges for every run", () => {
    const { state, run: first } = makeRun([
      { source: "a", target: "c", hard: true, lag: 0 },
    ]);
    const template = state.templates[0];
    const second = command(state, "createRun", {
      templateId: template.id,
      period: "2026-08",
    });
    const firstIds = new Set(first.tasks.map((task: any) => task.id));
    expect(second.tasks.every((task: any) => !firstIds.has(task.id))).toBe(
      true,
    );
    expect(
      second.edges.every(
        (edge: any) =>
          second.tasks.some((task: any) => task.id === edge.source) &&
          second.tasks.some((task: any) => task.id === edge.target),
      ),
    ).toBe(true);
    expect(first.edges[0].source).not.toBe(second.edges[0].source);
  });

  it("marks downstream forecasts unknown when an overdue root has no commitment", () => {
    const { state, run } = makeRun([
      { source: "a", target: "c", hard: true, lag: 0 },
    ]);
    const source = run.tasks.find((task: any) => task.title === "a")!;
    const impact = getTaskImpact(state, run.id, source.id);
    expect(impact.unknownForecast).toBe(true);
    expect(
      impact.tasks.find((row) => row.title === "c")?.currentForecastAt,
    ).toBeNull();
    expect(impact.tasks.find((row) => row.title === "c")?.unknownForecast).toBe(
      true,
    );
  });

  it("rejects a committed forecast that finishes before a hard predecessor", () => {
    const { state, run } = makeRun([
      { source: "a", target: "c", hard: true, lag: 0 },
    ]);
    const source = run.tasks.find((task: any) => task.title === "a")!;
    const target = run.tasks.find((task: any) => task.title === "c")!;
    command(
      state,
      "taskAction",
      {
        runId: run.id,
        taskId: source.id,
        action: "forecast",
        forecastAt: "2026-09-10T00:00:00.000Z",
        expectedRevision: source.revision,
      },
      alice,
    );
    expectDomainError(
      () =>
        command(
          state,
          "taskAction",
          {
            runId: run.id,
            taskId: target.id,
            action: "forecast",
            forecastAt: "2026-09-09T00:00:00.000Z",
            expectedRevision: target.revision,
          },
          alice,
        ),
      409,
    );
  });
});
