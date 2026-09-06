"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileCheck2,
  GitBranch,
  Link2,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  AppSnapshot,
  Dependency,
  Task,
  WorkflowNode,
  WorkflowRun,
  WorkflowTemplate,
} from "@/lib/types";
import { ImpactView } from "./ImpactView";
import { TaskDialog, type TaskAction } from "./TaskDialog";
import { FlowCanvas } from "./FlowCanvas";
import { api } from "@/lib/client";
import { EmptyState, ErrorNotice, fmtDate, Status } from "./ui";

type Props = {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  setToast: (message: string) => void;
  mode: "runs" | "designer" | "tasks";
};
function unwrap<T>(payload: T | { result?: T }): T {
  return payload && typeof payload === "object" && "result" in payload
    ? ((payload as { result?: T }).result as T)
    : (payload as T);
}

export function WorkflowPanel(props: Props) {
  return props.mode === "designer" ? (
    <Designer {...props} />
  ) : (
    <Runs {...props} onlyMine={props.mode === "tasks"} />
  );
}

function Runs({
  snapshot,
  onRefresh,
  setToast,
  onlyMine,
}: Props & { onlyMine: boolean }) {
  const [period, setPeriod] = useState(
    snapshot.packages[0]?.period.match(/^\d{4}-\d{2}$/)?.[0] ||
      new Date().toISOString().slice(0, 7),
  );
  const [selected, setSelected] = useState(snapshot.runs[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const run = snapshot.runs.find((r) => r.id === selected) || snapshot.runs[0];
  const tasks = run
    ? run.tasks.filter(
        (t) =>
          !onlyMine ||
          t.ownerId === snapshot.principal.id ||
          t.approverId === snapshot.principal.id,
      )
    : [];
  const [pending, setPending] = useState<{
    taskId: string;
    action: TaskAction;
  }>();
  const action = (task: Task, action: TaskAction) =>
    setPending({ taskId: task.id, action });
  const createRun = async (template: WorkflowTemplate) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/commands", {
        method: "POST",
        body: JSON.stringify({
          type: "createRun",
          templateId: template.id,
          period,
          name: `${template.name} · ${period}`,
        }),
      });
      await onRefresh();
      setToast("Workflow run created");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to create workflow run.",
      );
    } finally {
      setBusy(false);
    }
  };
  const showImpact = async (task: Task) => {
    if (!run) return;
    try {
      const data = await api<Record<string, unknown>>(
        `/api/impact?runId=${encodeURIComponent(run.id)}&taskId=${encodeURIComponent(task.id)}`,
      );
      setImpact(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load task impact.");
    }
  };
  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>{onlyMine ? "My tasks" : "Workflow runs"}</h1>
          <p>
            {onlyMine
              ? "Your assigned workflow attestations and evidence"
              : "Period execution, dependencies and completion attestations"}
          </p>
        </div>
        <div className="we-page-actions">
          {!onlyMine && (
            <input
              className="we-input"
              aria-label="Run period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ width: 160 }}
            />
          )}
          {!onlyMine &&
            snapshot.templates
              .filter((t) => t.status === "PUBLISHED")
              .map((t) => (
                <button
                  className="we-button primary"
                  key={t.id}
                  onClick={() => void createRun(t)}
                  disabled={busy}
                >
                  <Plus size={15} /> New run
                </button>
              ))}
        </div>
      </div>
      {error && <ErrorNotice message={error} />}
      {pending && run && run.tasks.find((t) => t.id === pending.taskId) && (
        <TaskDialog
          key={`${pending.taskId}-${pending.action}`}
          task={run.tasks.find((t) => t.id === pending.taskId)!}
          run={run}
          action={pending.action}
          snapshot={snapshot}
          onClose={() => setPending(undefined)}
          onDone={async () => {
            await onRefresh();
            setToast("Task updated");
          }}
        />
      )}
      {snapshot.runs.length === 0 ? (
        <div className="we-card">
          <EmptyState
            icon={<Play size={29} />}
            title="No workflow runs yet"
            detail="Publish a template, then start a period run."
          />
        </div>
      ) : (
        <>
          <div className="we-card" style={{ marginBottom: 16 }}>
            <div className="we-filterbar">
              <label className="we-label" style={{ margin: 0 }}>
                Run
              </label>
              <select
                className="we-select"
                value={run?.id || ""}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setImpact(null);
                }}
                aria-label="Workflow run"
              >
                {snapshot.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.period}
                  </option>
                ))}
              </select>
              <span
                style={{ marginLeft: "auto", color: "#73839a", fontSize: 12 }}
              >
                {run?.tasks.filter((t) => t.status === "COMPLETE").length || 0}{" "}
                / {run?.tasks.length || 0} complete
              </span>
            </div>
          </div>
          {run && (
            <div className="we-run-layout">
              <section className="we-card we-task-list">
                <div className="we-card-title">
                  <div>
                    <h2>Run tasks</h2>
                    <p>
                      Baseline dates are pinned to the run calendar ·{" "}
                      {run.calendar.timezone}
                    </p>
                  </div>
                  <Status
                    value={
                      run.tasks.every((t) => t.status === "COMPLETE")
                        ? "COMPLETE"
                        : "IN PROGRESS"
                    }
                  />
                </div>
                {tasks.length === 0 ? (
                  <EmptyState
                    icon={<UserRound size={28} />}
                    title="No tasks assigned to you"
                    detail="This run has no tasks in your current scope."
                  />
                ) : (
                  tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      canAct={
                        task.ownerId === snapshot.principal.id ||
                        task.approverId === snapshot.principal.id
                      }
                      busy={busy}
                      canReopen={snapshot.principal.roles.some(
                        (r) => r === "manager" || r === "admin",
                      )}
                      onImpact={() => void showImpact(task)}
                      onAction={action}
                    />
                  ))
                )}
              </section>
              <div>
                <RunSummary run={run} />
                <section className="we-card" style={{ marginTop: 14 }}>
                  <FlowCanvas nodes={run.tasks} edges={run.edges} readonly />
                </section>
                <section className="we-card we-impact-card">
                  <div className="we-card-title">
                    <div>
                      <h2>Impact preview</h2>
                      <p>Select a task to inspect dependents and risk.</p>
                    </div>
                    <GitBranch size={18} color="#168f70" />
                  </div>
                  {impact ? (
                    <ImpactView impact={impact} />
                  ) : (
                    <EmptyState
                      icon={<Link2 size={24} />}
                      title="No task selected"
                      detail="Impact uses each successor's own baseline and forecast."
                    />
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskRow({
  task,
  busy,
  canReopen,
  canAct,
  onAction,
  onImpact,
}: {
  task: Task;
  busy: boolean;
  canReopen: boolean;
  canAct: boolean;
  onAction: (task: Task, action: TaskAction) => void;
  onImpact: () => void;
}) {
  const blocked = !!task.blocked;
  const needsAttest = !!task.approverId;
  return (
    <div className="we-task-row">
      <div>
        <div className="we-task-title">{task.title}</div>
        <div className="we-task-detail">
          {task.type.replace("_", " ")} ·{" "}
          {task.evidenceRequired ? "Evidence required" : "No evidence required"}
          {task.invalidated ? " · Needs re-attestation" : ""}
        </div>
      </div>
      <div>
        <Status value={blocked ? "BLOCKED" : task.status} />
      </div>
      <div
        style={{
          fontSize: 11,
          color:
            new Date(task.baselineDueAt).getTime() < Date.now() &&
            task.status !== "COMPLETE"
              ? "#a72219"
              : "#64748b",
        }}
      >
        {new Date(task.baselineDueAt).getTime() < Date.now() &&
        task.status !== "COMPLETE"
          ? "Overdue"
          : "Due"}
        <br />
        {fmtDate(task.baselineDueAt)}
      </div>
      <div className="we-task-actions">
        <button className="we-button small" onClick={onImpact} disabled={busy}>
          Impact
        </button>
        {canAct &&
          task.type !== "document_gate" &&
          task.status === "NOT_STARTED" && (
            <button
              className="we-button small"
              onClick={() => onAction(task, "start")}
              disabled={busy || blocked}
            >
              Start
            </button>
          )}
        {canAct &&
          task.type !== "document_gate" &&
          task.status === "IN_PROGRESS" && (
            <button
              className="we-button small"
              onClick={() => onAction(task, "submit")}
              disabled={busy}
            >
              Submit
            </button>
          )}
        {canAct &&
          (task.status === "SUBMITTED" ||
            (task.type === "document_gate" && task.status !== "COMPLETE")) && (
            <button
              className="we-button primary small"
              onClick={() => onAction(task, "attest")}
              disabled={busy}
            >
              <ShieldCheck size={13} />{" "}
              {needsAttest ? "Attest / approve" : "Attest"}
            </button>
          )}
        {task.status === "COMPLETE" && canReopen && (
          <button
            className="we-button small"
            onClick={() => onAction(task, "reopen")}
            disabled={busy}
          >
            Reopen
          </button>
        )}
        {canAct && task.status !== "COMPLETE" && (
          <button
            className="we-button small"
            onClick={() => onAction(task, "forecast")}
            disabled={busy}
            title="Set expected completion"
          >
            Forecast
          </button>
        )}
        {canAct && ["NOT_STARTED", "IN_PROGRESS"].includes(task.status) && (
          <button
            className="we-button small"
            onClick={() => onAction(task, "evidence")}
          >
            Evidence
          </button>
        )}
        {canReopen && task.type === "document_gate" && (
          <button
            className="we-button small"
            onClick={() => onAction(task, "rebind")}
          >
            Rebind version
          </button>
        )}
      </div>
    </div>
  );
}
function RunSummary({ run }: { run: WorkflowRun }) {
  const complete = run.tasks.filter((t) => t.status === "COMPLETE").length;
  const overdue = run.tasks.filter(
    (t) =>
      t.status !== "COMPLETE" &&
      new Date(t.baselineDueAt).getTime() < Date.now(),
  ).length;
  return (
    <aside className="we-card">
      <div className="we-card-title">
        <div>
          <h2>Run summary</h2>
          <p>Attestation health</p>
        </div>
        <GitBranch size={18} color="#168f70" />
      </div>
      <div className="we-chart">
        <div className="we-kpi" style={{ marginBottom: 10 }}>
          <div className="we-kpi-label">Completion</div>
          <div className="we-kpi-value">
            {run.tasks.length
              ? Math.round((complete / run.tasks.length) * 100)
              : 0}
            %
          </div>
          <div className="we-kpi-foot">
            {complete} of {run.tasks.length} tasks complete
          </div>
        </div>
        <div className="we-assignment">
          <Check size={16} color="#0a916e" />
          <div className="we-assignment-name">
            <strong>Hard dependencies</strong>
            <span>All predecessors gate completion</span>
          </div>
          <Status value="Enforced" />
        </div>
        <div className="we-assignment">
          <AlertTriangle size={16} color="#ba710c" />
          <div className="we-assignment-name">
            <strong>Overdue</strong>
            <span>Baseline date has passed</span>
          </div>
          <strong style={{ color: overdue ? "#a85e00" : "#0a916e" }}>
            {overdue}
          </strong>
        </div>
      </div>
    </aside>
  );
}

function defaultNode(snapshot: AppSnapshot): WorkflowNode {
  return {
    id: `node-${Date.now()}`,
    title: "New task",
    type: "task",
    ownerId: snapshot.principal.id,
    entity: snapshot.principal.entities[0] || "AL",
    instructions: "Describe the work to complete.",
    dueOffset: 1,
    duration: 1,
    evidenceRequired: false,
    statement: "I attest that this work is complete.",
    position: { x: 60, y: 70 },
  };
}
function Designer({ snapshot, onRefresh, setToast }: Props) {
  const baseTemplate = snapshot.templates[0];
  const [templateId, setTemplateId] = useState(baseTemplate?.id || "");
  const [templateOverride, setTemplateOverride] = useState<WorkflowTemplate>();
  const template =
    templateOverride ||
    snapshot.templates.find((t) => t.id === templateId) ||
    baseTemplate;
  const [nodes, setNodes] = useState<WorkflowNode[]>(template?.nodes || []);
  const [edges, setEdges] = useState<Dependency[]>(template?.edges || []);
  const [selectedId, setSelectedId] = useState(template?.nodes[0]?.id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [link, setLink] = useState({
    source: "",
    target: "",
    hard: true,
    lag: 0,
  });
  const switchTemplate = (id: string) => {
    const t = snapshot.templates.find((x) => x.id === id);
    setTemplateOverride(undefined);
    setTemplateId(id);
    setNodes(t?.nodes || []);
    setEdges(t?.edges || []);
    setSelectedId(t?.nodes[0]?.id || "");
  };
  const selected = nodes.find((n) => n.id === selectedId);
  const patchNode = (patch: Partial<WorkflowNode>) =>
    setNodes((current) =>
      current.map((n) => (n.id === selectedId ? { ...n, ...patch } : n)),
    );
  const save = async (publish = false) => {
    if (!template) return;
    if (
      nodes.some(
        (n) =>
          !n.title.trim() ||
          n.dueOffset < 0 ||
          n.duration < 0 ||
          !n.statement.trim(),
      )
    ) {
      setError(
        "Each node needs a title, nonnegative timing values, and an attestation statement.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      let result = unwrap(
        await api<WorkflowTemplate | { result?: WorkflowTemplate }>(
          "/api/commands",
          {
            method: "POST",
            body: JSON.stringify({
              type: "saveTemplate",
              templateId: template.id,
              name: template.name,
              nodes,
              edges,
              expectedRevision: template.revision,
            }),
          },
        ),
      );
      if (publish)
        result = unwrap(
          await api<WorkflowTemplate | { result?: WorkflowTemplate }>(
            "/api/commands",
            {
              method: "POST",
              body: JSON.stringify({
                type: "publishTemplate",
                templateId: result.id,
                expectedRevision: result.revision,
              }),
            },
          ),
        );
      setTemplateOverride(result);
      setTemplateId(result.id);
      setNodes(result.nodes);
      setEdges(result.edges);
      await onRefresh();
      setToast(publish ? "Template published" : "Template saved");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save workflow template.",
      );
    } finally {
      setBusy(false);
    }
  };
  const createTemplate = async () => {
    const name = newName.trim();
    if (!name) {
      setError("Enter a template name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const node = defaultNode(snapshot);
      const result = unwrap(
        await api<WorkflowTemplate | { result?: WorkflowTemplate }>(
          "/api/commands",
          {
            method: "POST",
            body: JSON.stringify({
              type: "saveTemplate",
              name,
              nodes: [node],
              edges: [],
            }),
          },
        ),
      );
      setTemplateOverride(result);
      setTemplateId(result.id);
      setNodes(result.nodes);
      setEdges(result.edges);
      setSelectedId(result.nodes[0]?.id || "");
      setNewName("");
      setShowNew(false);
      await onRefresh();
      setToast("New workflow template created");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create template.");
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async () => {
    if (!template) return;
    setBusy(true);
    try {
      const result = unwrap(
        await api<WorkflowTemplate | { result?: WorkflowTemplate }>(
          "/api/commands",
          {
            method: "POST",
            body: JSON.stringify({
              type: "saveTemplate",
              sourceTemplateId: template.id,
              name: `${template.name} (copy)`,
            }),
          },
        ),
      );
      setTemplateOverride(result);
      setTemplateId(result.id);
      setNodes(result.nodes);
      setEdges(result.edges);
      setSelectedId(result.nodes[0]?.id || "");
      await onRefresh();
      setToast("Editable template copy created");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const autoLayout = () => {
    const levels = new Map<string, number>();
    let pending = [...nodes];
    for (let pass = 0; pass < nodes.length; pass++) {
      const ready = pending.filter((n) =>
        edges
          .filter((e) => e.target === n.id)
          .every((e) => levels.has(e.source)),
      );
      if (!ready.length) break;
      for (const n of ready) {
        levels.set(
          n.id,
          Math.max(
            0,
            ...edges
              .filter((e) => e.target === n.id)
              .map((e) => (levels.get(e.source) || 0) + 1),
          ),
        );
      }
      pending = pending.filter((n) => !levels.has(n.id));
    }
    if (pending.length) {
      setError("Remove dependency cycles before arranging nodes.");
      return;
    }
    const rows = new Map<number, number>();
    setNodes(
      nodes.map((n) => {
        const level = levels.get(n.id) || 0;
        const row = rows.get(level) || 0;
        rows.set(level, row + 1);
        return { ...n, position: { x: level * 260, y: row * 150 } };
      }),
    );
  };
  const addNode = () => {
    const node = defaultNode(snapshot);
    node.position = {
      x: 60 + (nodes.length % 3) * 245,
      y: 70 + Math.floor(nodes.length / 3) * 160,
    };
    setNodes((n) => [...n, node]);
    setSelectedId(node.id);
  };
  const addLink = () => {
    if (!link.source || !link.target || link.source === link.target) {
      setError("Choose two different nodes for a dependency.");
      return;
    }
    if (
      edges.some((e) => e.source === link.source && e.target === link.target)
    ) {
      setError("That dependency already exists.");
      return;
    }
    setEdges((current) => [
      ...current,
      {
        id: `edge-${Date.now()}`,
        source: link.source,
        target: link.target,
        hard: link.hard,
        lag: Math.max(0, Number(link.lag) || 0),
      },
    ]);
    setError("");
  };
  if (!template)
    return (
      <div className="we-content">
        <div className="we-page-head">
          <div>
            <h1>Workflow designer</h1>
            <p>Build reusable executable attestation templates</p>
          </div>
          <button
            className="we-button primary"
            onClick={() => setShowNew(true)}
          >
            <Plus size={15} /> New template
          </button>
        </div>
        {showNew && (
          <div className="we-card we-new-template">
            <input
              className="we-input"
              placeholder="Template name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="we-button primary"
              onClick={() => void createTemplate()}
            >
              Create
            </button>
          </div>
        )}
        <div className="we-card">
          <EmptyState
            icon={<GitBranch size={29} />}
            title="No workflow templates"
            detail="Create a template to begin defining executable work."
          />
        </div>
      </div>
    );
  return (
    <div className="we-content">
      <div className="we-page-head">
        <div>
          <h1>Workflow designer</h1>
          <p>Design dependencies, owners and attestation gates</p>
        </div>
        <div className="we-page-actions">
          <button className="we-button" onClick={() => setShowNew((v) => !v)}>
            <Plus size={15} /> New template
          </button>
          <select
            className="we-select"
            value={template.id}
            onChange={(e) => switchTemplate(e.target.value)}
            aria-label="Workflow template"
          >
            {snapshot.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.status}
              </option>
            ))}
            {templateOverride &&
              !snapshot.templates.some((t) => t.id === templateOverride.id) && (
                <option value={templateOverride.id}>
                  {templateOverride.name} · {templateOverride.status}
                </option>
              )}
          </select>
          <button
            className="we-button"
            onClick={() => void save()}
            disabled={busy}
          >
            <Save size={15} /> Save draft
          </button>
          <button
            className="we-button primary"
            onClick={() => void save(true)}
            disabled={busy || template.status === "PUBLISHED"}
          >
            <Check size={15} /> Publish
          </button>
        </div>
      </div>
      {showNew && (
        <div className="we-card we-new-template">
          <input
            className="we-input"
            placeholder="New template name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            className="we-button primary"
            onClick={() => void createTemplate()}
            disabled={busy}
          >
            Create template
          </button>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      <div className="we-workflow-grid">
        <section className="we-card we-canvas">
          <div
            className="we-card-title"
            style={{ position: "relative", zIndex: 2 }}
          >
            <div>
              <h2>{template.name}</h2>
              <p>
                {nodes.length} nodes · {edges.length} dependencies ·{" "}
                {template.status}
              </p>
            </div>
            <div className="we-toolbar">
              <button
                className="we-button small"
                onClick={() => void duplicate()}
                disabled={busy}
              >
                Duplicate
              </button>
              <button className="we-button small" onClick={autoLayout}>
                Arrange
              </button>
              <button className="we-button small" onClick={addNode}>
                <Plus size={14} /> Add node
              </button>
              <button className="we-button small" onClick={() => setEdges([])}>
                <Link2 size={14} /> Clear links
              </button>
            </div>
          </div>
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNodes={setNodes}
            onEdges={setEdges}
          />
        </section>
        <aside className="we-card we-inspector">
          <div className="we-card-title">
            <div>
              <h2>Properties</h2>
              <p>Selected node configuration</p>
            </div>
            <Settings2 size={18} color="#698096" />
          </div>
          {selected ? (
            <div className="we-inspector-body">
              <div className="we-field">
                <label className="we-label">Node title</label>
                <input
                  className="we-input"
                  required
                  value={selected.title}
                  onChange={(e) => patchNode({ title: e.target.value })}
                />
              </div>
              <div className="we-field">
                <label className="we-label">Entity scope</label>
                <input
                  className="we-input"
                  aria-label="Node entity"
                  value={selected.entity}
                  onChange={(e) => patchNode({ entity: e.target.value })}
                />
              </div>
              <div className="we-field">
                <label className="we-label">Node type</label>
                <select
                  className="we-select"
                  value={selected.type}
                  onChange={(e) =>
                    patchNode({ type: e.target.value as WorkflowNode["type"] })
                  }
                >
                  <option value="task">Task</option>
                  <option value="attestation">Attestation</option>
                  <option value="milestone">Milestone</option>
                  <option value="input">External input</option>
                  <option value="document_gate">Document review gate</option>
                </select>
              </div>
              <div className="we-field">
                <label className="we-label">Accountable owner</label>
                <select
                  className="we-select"
                  value={selected.ownerId}
                  onChange={(e) => patchNode({ ownerId: e.target.value })}
                >
                  {snapshot.users
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="we-field">
                <label className="we-label">
                  Independent approver (optional)
                </label>
                <select
                  className="we-select"
                  value={selected.approverId || ""}
                  onChange={(e) =>
                    patchNode({ approverId: e.target.value || undefined })
                  }
                >
                  <option value="">No approver</option>
                  {snapshot.users
                    .filter((u) => u.active && u.id !== selected.ownerId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 9,
                }}
              >
                <div className="we-field">
                  <label className="we-label">Due offset (BD)</label>
                  <input
                    className="we-input"
                    type="number"
                    min="0"
                    required
                    value={selected.dueOffset}
                    onChange={(e) =>
                      patchNode({
                        dueOffset: Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </div>
                <div className="we-field">
                  <label className="we-label">Duration (days)</label>
                  <input
                    className="we-input"
                    type="number"
                    min="0"
                    required
                    value={selected.duration}
                    onChange={(e) =>
                      patchNode({
                        duration: Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </div>
              </div>
              <div className="we-field">
                <label className="we-label">Instructions</label>
                <textarea
                  className="we-textarea"
                  value={selected.instructions}
                  onChange={(e) => patchNode({ instructions: e.target.value })}
                />
              </div>
              <div className="we-field">
                <label className="we-label">Attestation statement</label>
                <textarea
                  className="we-textarea"
                  required
                  value={selected.statement}
                  onChange={(e) => patchNode({ statement: e.target.value })}
                />
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#445770",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.evidenceRequired}
                  onChange={(e) =>
                    patchNode({ evidenceRequired: e.target.checked })
                  }
                />{" "}
                Required evidence
              </label>
              {selected.type === "document_gate" && (
                <div className="we-gate-fields">
                  <div className="we-field">
                    <label className="we-label">Package</label>
                    <select
                      className="we-select"
                      value={selected.packageId || ""}
                      onChange={(e) =>
                        patchNode({
                          packageId: e.target.value || undefined,
                          documentVersionId: undefined,
                        })
                      }
                    >
                      <option value="">Choose package</option>
                      {snapshot.packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} · {p.period}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="we-field">
                    <label className="we-label">Published version</label>
                    <select
                      className="we-select"
                      value={selected.documentVersionId || ""}
                      onChange={(e) =>
                        patchNode({
                          documentVersionId: e.target.value || undefined,
                        })
                      }
                    >
                      <option value="">Choose version</option>
                      {snapshot.versions
                        .filter(
                          (v) =>
                            v.packageId === selected.packageId &&
                            v.status === "PUBLISHED",
                        )
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            Version {v.number}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}
              <div className="we-node-connect">
                <strong
                  style={{
                    color: "#3f536d",
                    display: "block",
                    marginBottom: 5,
                  }}
                >
                  Dependencies
                </strong>
                {edges.filter((e) => e.target === selected.id).length}{" "}
                predecessors ·{" "}
                {edges.filter((e) => e.source === selected.id).length}{" "}
                successors
              </div>
              <div className="we-link-editor">
                <label className="we-label">Add dependency</label>
                <div className="we-link-grid">
                  <select
                    className="we-select"
                    value={link.source}
                    onChange={(e) =>
                      setLink({ ...link, source: e.target.value })
                    }
                  >
                    <option value="">Predecessor</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                  <select
                    className="we-select"
                    value={link.target}
                    onChange={(e) =>
                      setLink({ ...link, target: e.target.value })
                    }
                  >
                    <option value="">Successor</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="we-link-grid">
                  <label className="we-check-label">
                    <input
                      type="checkbox"
                      checked={link.hard}
                      onChange={(e) =>
                        setLink({ ...link, hard: e.target.checked })
                      }
                    />{" "}
                    Hard prerequisite
                  </label>
                  <input
                    className="we-input"
                    type="number"
                    min="0"
                    value={link.lag}
                    onChange={(e) =>
                      setLink({ ...link, lag: Number(e.target.value) })
                    }
                    placeholder="Lag (BD)"
                  />
                </div>
                <button className="we-button small" onClick={addLink}>
                  <Link2 size={14} /> Add link
                </button>
              </div>
              <div className="we-inspector-actions">
                <button
                  className="we-button small danger"
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
                    setEdges((es) =>
                      es.filter(
                        (e) =>
                          e.source !== selected.id && e.target !== selected.id,
                      ),
                    );
                    setSelectedId(
                      nodes.find((n) => n.id !== selected.id)?.id || "",
                    );
                  }}
                >
                  <Trash2 size={14} /> Delete
                </button>
                <button
                  className="we-button primary small"
                  onClick={() => void save()}
                  disabled={busy}
                >
                  <Save size={14} /> Save changes
                </button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<GitBranch size={27} />}
              title="Select a node"
              detail="Choose a node on the canvas to edit its properties."
            />
          )}
        </aside>
      </div>
    </div>
  );
}
function EdgeLine({
  edge,
  nodes,
}: {
  edge: Dependency;
  nodes: WorkflowNode[];
}) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  if (!source || !target) return null;
  const x = source.position.x + 190,
    y = source.position.y + 45,
    tx = target.position.x,
    ty = target.position.y + 45;
  const length = Math.sqrt((tx - x) ** 2 + (ty - y) ** 2);
  const angle = (Math.atan2(ty - y, tx - x) * 180) / Math.PI;
  return (
    <div
      className={`we-flow-edge ${edge.hard ? "hard" : ""}`}
      style={{
        left: x,
        top: y,
        width: length,
        transform: `rotate(${angle}deg)`,
      }}
      title={`${edge.hard ? "Hard" : "Advisory"} dependency · lag ${edge.lag} BD`}
    />
  );
}
