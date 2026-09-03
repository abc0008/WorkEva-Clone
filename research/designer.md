# Dimension: Workflow-Pattern Designer (React Flow / @xyflow/react)

Research for the Pinnacle finance workflow + dependency tracker. Verified against npm registry and vendor docs on 2026-09-03.

---

## 1. Library selection, version, licensing

**Verified facts (npm registry, 2026-09-03):**

| Package | Latest | License | Last publish | Note |
|---|---|---|---|---|
| `@xyflow/react` | **12.11.6** | **MIT** | 2026-09-01 | current package |
| `reactflow` | 11.11.4 | MIT | 2024-06-20 | **legacy v11 name — do not use** |
| `@dagrejs/dagre` | **3.1.1** | MIT | 2026-08-08 | maintained fork |
| `dagre` | 0.8.5 | MIT | **2019-12-03** | abandoned — do not use |
| `elkjs` | 0.12.0 | **EPL-2.0 OR GPL-3.0-or-later** | 2026-07-17 | license review needed |
| `yjs` | 13.6.32 | MIT | 2026-08-04 | |
| `@hocuspocus/server` | 4.6.0 | MIT | 2026-08-10 | self-hostable Yjs server |
| `bpmn-js` | 18.27.1 | MIT **+ watermark clause** | 2026-09-03 | see §8 |

`@xyflow/react@12` peer deps: `react >=17`, `react-dom >=17`. Runtime deps: `zustand@^4`, `classcat`, `@xyflow/system`. Core is MIT and stays MIT — React Flow Pro ($169–$289/mo) buys *example code, templates and support*, not a license grant; the library itself is free for commercial use ([reactflow.dev/pro](https://reactflow.dev/pro)).

**DES-01 (MUST)** — Use `@xyflow/react` pinned to `^12.11.x`. Do not install the legacy `reactflow` package name.
**DES-02 (MUST)** — Use `@dagrejs/dagre@^3` for layout, never the abandoned `dagre@0.8.5`.
**DES-03 (SHOULD)** — Flag `elkjs`'s EPL-2.0/GPL-3.0 dual license to bank OSS review *before* adopting. EPL-2.0 is weak copyleft and generally acceptable for an internal, non-distributed web app, but "GPL-3.0-or-later" in the SPDX string reliably trips automated SCA scanners at banks. Dagre (MIT) avoids the conversation entirely.
**DES-04 (SHOULD)** — Budget zero for React Flow Pro at MVP; revisit only if the team wants the official Yjs collaborative example.

**Accelerator:** [React Flow UI](https://reactflow.dev/ui) is a shadcn registry (`npx shadcn@latest add https://ui.reactflow.dev/<component>`) shipping Base Node, Status Indicator, Labeled Handle, Button Handle, Labeled Group Node, Node Search, Zoom Slider, DevTools, plus a "Workflow Editor" template. Code is copied into your repo (MIT), so there is no runtime dependency. **Caveat: it requires React 19 + Tailwind CSS 4 + shadcn/ui.** If the Next.js app is on React 18, treat these as reference implementations to hand-port rather than installable components.

---

## 2. Next.js integration mechanics

**DES-05 (MUST)** — The canvas is a client component. Mark it `'use client'`, import `@xyflow/react/dist/style.css` once, and wrap in `<ReactFlowProvider>` — `useReactFlow`, `useStore`, `useNodesState` all throw outside the provider.
**DES-06 (MUST)** — The immediate parent of `<ReactFlow>` must have an explicit width and height (e.g. `h-[calc(100vh-8rem)] w-full`). A zero-height flex parent renders a blank canvas; this is the single most common "React Flow doesn't work" report.
**DES-07 (SHOULD)** — Load the designer route via `next/dynamic(..., { ssr: false })`. React Flow measures DOM nodes, so SSR gains nothing and costs hydration warnings. The *read-only runtime* view can SSR its data shell and hydrate the canvas.
**DES-08 (MUST)** — Declare `nodeTypes` and `edgeTypes` as module-scope constants (or `useMemo` with `[]`). Inline object literals recreate the map every render and force React Flow to remount every node — the classic silent perf killer.

---

## 3. Node and edge model

Design the domain model first, then map it to React Flow, not the reverse. React Flow's `node.data` is an opaque bag; put a versioned, validated shape in it.

**Node types to implement (custom React components):**

| Type | Purpose | Key `data` fields |
|---|---|---|
| `task` | Unit of work | `title, ownerTeamId, ownerUserId, dueOffset, evidenceRequired, estMinutes, systemOfRecord` |
| `signoff` | Attestation / certification gate | `attestationText, approverRoleId, requiresEvidence, segregationOfDutiesRule` |
| `milestone` | Zero-duration marker (e.g. "GL closed", "Call Report filed") | `label, dueOffset` |
| `input` | External data arrival (feed, upload) | `sourceSystem, fileType, slaOffset` |
| `subprocess` | Link to another template | `templateId, templateVersionId` |
| `lane` | Team swimlane container | `teamId, label, order` |

**Edge = dependency, and it must carry semantics.** A plain arrow is not enough for the alerting requirement.

```
edge.data = {
  depType: 'FS' | 'SS' | 'FF',      // finish-to-start (default), start-to-start, finish-to-finish
  lagBusinessDays: number,           // 0, or +1 etc.
  hard: boolean,                     // hard = blocks downstream start; soft = advisory only
  alertOnUpstreamSlip: boolean
}
```

**DES-09 (MUST)** — Model due dates on the node as an *offset expression*, not a date: `{ basis: 'BD'|'CD', anchor: 'PERIOD_END'|'PERIOD_START'|'PRED_FINISH', n: 3 }`. The node label renders both forms — `"BD+3"` in template mode, `"BD+3 · Mon 05 Oct"` in run mode. This is exactly Workiva's model: their process calendar lets due dates reference "the 10th business day" and auto-adjusts for holidays ([Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)).
**DES-10 (MUST)** — Edges carry `depType` and `lag`. Without them the downstream-slip alert engine cannot compute whether a delay actually threatens the successor.

**Typed handles.** React Flow does **not** enforce handle semantics — it only gives you `Handle` with an `id` and a `type` of `'source' | 'target'`. Encode the port meaning in the handle id (`out:approved`, `out:rejected`, `in:evidence`) and enforce compatibility yourself.

**DES-11 (MUST)** — Implement `isValidConnection` on `<ReactFlow>` to enforce (a) no self-loops, (b) no cycles, (c) handle-type compatibility, (d) no cross-lane connection where policy forbids it. Return `false` and React Flow refuses the drop and styles the connection line invalid.

---

## 4. Cycle prevention — and why client-side is not enough

React Flow ships an official [Preventing Cycles](https://reactflow.dev/examples/interaction/prevent-cycles) example using the `getOutgoers` helper and a DFS with a `visited` Set:

```js
const isValidConnection = useCallback((connection) => {
  const nodes = getNodes(), edges = getEdges();
  const target = nodes.find((n) => n.id === connection.target);
  const hasCycle = (node, visited = new Set()) => {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    for (const outgoer of getOutgoers(node, nodes, edges)) {
      if (outgoer.id === connection.source) return true;
      if (hasCycle(outgoer, visited)) return true;
    }
  };
  if (target.id === connection.source) return false;
  return !hasCycle(target);
}, [getNodes, getEdges]);
```

This is O(V+E) per drag and fine up to a few hundred nodes. But it is a UX affordance, not a control.

**DES-12 (MUST)** — Re-validate acyclicity **server-side** on every template save/publish using Kahn's topological sort. Reject with 422 and the offending cycle path. Reasons: the client check is trivially bypassable via the API; concurrent edits by two users can each be individually acyclic and jointly cyclic; and CSV/Excel bulk import of tasks (a feature Workiva has and Alex will ask for) never touches the canvas at all.
**DES-13 (SHOULD)** — Store the topological order produced at publish time as `template_node.topo_rank`. It makes the alert cascade and the critical-path calculation cheap at runtime.
**DES-14 (SHOULD)** — Also validate at publish: no orphan nodes (except explicit start/end), every task has an owner team, every lane has ≥1 node, every `signoff` has an approver distinct from the assignee (segregation of duties).

---

## 5. Auto-layout

React Flow's own [layouting guide](https://reactflow.dev/learn/layouting/layouting) compares four options. Summary of their guidance:

- **Dagre** — simple directed-graph layout, minimal config, fast, supports dynamic node sizes and sub-flows. Recommended for trees/DAGs. Known open issue: sub-flow layout is wrong when edges cross sub-flow boundaries.
- **ELK (elkjs)** — most configurable, the **only** option with real edge routing; but ~1.4 MB bundle and React Flow explicitly says "we don't often recommend elkjs because its complexity makes it difficult for us to support folks."
- **d3-hierarchy** — single-root trees only, uniform node dimensions. Not suitable here.
- **d3-force** — physics/organic. Wrong aesthetic for a close calendar.

**Precedent (verified from source):** Apache Airflow 3's web UI ships `@xyflow/react ^12.11.3` **and** `elkjs ^0.12.0` (from `airflow-core/src/airflow/ui/package.json`). n8n's editor ships `@vue-flow/core 1.48` **and** `@dagrejs/dagre ^1.1.4` for its "tidy up" action. Both are exactly this pattern: node-graph library + separate layout engine.

**DES-15 (SHOULD)** — Ship `@dagrejs/dagre` as the default "Auto-arrange" with `rankdir: 'LR'` and rank-per-business-day. Left-to-right reads as a timeline, which is what a close calendar wants.
**DES-16 (SHOULD)** — Auto-layout is an *explicit user action* ("Tidy up" button), not automatic on every change. Finance users hand-place nodes deliberately; silently relayouting destroys their mental map. Snapshot positions before, offer undo.
**DES-17 (MAY)** — If orthogonal edge routing becomes a hard requirement (dense cross-team dependency spaghetti), add elkjs behind a Web Worker and a dynamic `import()` so the 1.4 MB never lands in the main bundle. Subject to DES-03.
**DES-18 (MUST)** — Run layout after nodes have been measured. In v12, node dimensions live on `node.measured` and are `undefined` on first render; laying out before measurement produces overlapping nodes.

---

## 6. Swimlanes / grouping by team

There is no built-in swimlane. The maintainers' answer in [xyflow discussion #2359](https://github.com/xyflow/xyflow/discussions/2359) is "build a custom node"; the community points at sub-flows and at `liang-faan/reactflow-swimlane`.

Two viable approaches:

**(a) Group nodes (`type: 'group'` + `parentId` + `extent: 'parent'`).** Children move with the parent and can be clamped inside it. Documented in [Sub Flows](https://reactflow.dev/examples/grouping/sub-flows). **Critical pitfall: parent nodes must appear *before* their children in the `nodes` array**, or React Flow mispositions the children. Any server ordering (e.g. `ORDER BY created_at`) that violates this will break the canvas non-deterministically. Also note v12 renamed `parentNode` → `parentId`.

**(b) Lane bands.** Render full-width, non-interactive lane rectangles as a separate low-`zIndex` node layer (`draggable: false, selectable: false, connectable: false`), and derive lane membership from the node's Y position on drop, writing `data.laneId` into the model.

**DES-19 (SHOULD)** — Prefer **(b) lane bands** for the close calendar. Rationale: lanes here are horizontal team rows spanning the whole timeline; users need to drag a task freely across lanes to reassign it, and the `extent: 'parent'` clamping of approach (a) actively fights that. Approach (b) also sidesteps the parent-ordering pitfall and Dagre's known sub-flow bug.
**DES-20 (MUST)** — Lane membership must be **data, not geometry**. On `onNodeDragStop`, resolve the Y position to a `laneId` and persist it. Never infer ownership from coordinates at read time — a resized lane would silently reassign tasks, which is unacceptable for a SOX-relevant ownership record.
**DES-21 (MAY)** — Offer a second axis: vertical "BD columns" as background bands (BD+1, BD+2, …) so the canvas reads as a grid of team × business day. This is the visual most finance close teams actually draw on whiteboards, and matches the Workiva flowchart guidance of showing steps, the departments involved, and handoffs ([Workiva flowchart blog](https://www.workiva.com/blog/how-build-financial-close-process-flowchart)).

---

## 7. Persistence, versioning, and instantiation

React Flow gives you `rfInstance.toObject()` → `ReactFlowJsonObject { nodes, edges, viewport }` ([Save and Restore](https://reactflow.dev/examples/interaction/save-and-restore)). **Do not make that blob your source of truth.**

**DES-22 (MUST)** — Persist a **normalized relational model** in Azure SQL, not a graph JSON blob:

```
workflow_template          (id, name, owner_team_id, created_by, created_at)
workflow_template_version  (id, template_id, version_no, status, graph_hash,
                            published_by, published_at, change_note, rowversion)
template_node              (id, version_id, node_key, node_type, title, lane_id,
                            owner_team_id, owner_user_id, due_basis, due_anchor,
                            due_offset_n, evidence_required, topo_rank, layout_json)
template_edge              (id, version_id, source_node_key, source_handle,
                            target_node_key, target_handle, dep_type,
                            lag_bd, hard, alert_on_slip)
```

`layout_json` holds **only** `{x, y, width, height}`. Everything the alert engine, the roll-forward, and the reporting layer need must be queryable columns. A JSON blob makes "show me every task that depends on Treasury's FX rate load" a full-table scan and makes schema migration untestable.

**DES-23 (MUST)** — When serializing from the canvas, **strip** `selected`, `dragging`, `measured`, `resizing`, and the `viewport`. These are per-user, per-session UI state. Persisting `selected: true` means the next person opens the template with someone else's selection.

**DES-24 (MUST)** — Template versions are **immutable once published**. `status ∈ {draft, published, archived}`. Editing a published version forks a new draft. Store `graph_hash` (SHA-256 of a canonically-ordered node/edge projection excluding layout) to detect no-op saves and to prove a version was not tampered with. This is the change-control story that internal audit will ask for.

**DES-25 (MUST)** — Instantiation (roll-forward) is a **deep copy**, not a reference:

```
materialize(template_version_id, period, calendar_id) →
  run (id, template_version_id, period_key, calendar_id, status, created_at)
  run_task (id, run_id, template_node_id, planned_date, baseline_date,
            actual_date, status, assignee, ...)
  run_dependency (id, run_id, pred_run_task_id, succ_run_task_id, dep_type, lag_bd, hard)
```

The run gets its own copy of nodes and edges. If someone publishes template v7 mid-close, the October run pinned to v6 must not mutate. This is the Temporal model — an execution pins the workflow definition version it started with — and it is the right one. Workiva does the same thing with "roll forward" duplicating a checklist for reuse across periods ([Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)).

**DES-26 (MUST)** — Resolve business-day offsets to calendar dates **at instantiation**, writing both `planned_date` (mutable, reforecast) and `baseline_date` (frozen). Late/delayed/stopped status is `now vs planned_date`; slippage-vs-plan reporting is `planned_date vs baseline_date`.

**DES-27 (SHOULD)** — Append-only `audit_event` table (actor Entra object id, entity, action, before/after JSON, UTC timestamp) covering template publish, node change, run task status change, sign-off, and evidence upload. Non-negotiable for a bank.

---

## 8. Read-only runtime view with live status

Reuse the same `<ReactFlow>` component and the same custom node components, gated by a `mode: 'design' | 'run'` prop.

**DES-28 (MUST)** — In run mode set `nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}` and pass **no** mutation handlers (`onConnect`, `onNodesDelete`). Do not merely hide the toolbar. Keep `elementsSelectable` and pan/zoom on — users need to click a node to open the task drawer.
**DES-29 (MUST)** — **Do not push live status through `node.data`.** React Flow's [performance guide](https://reactflow.dev/learn/advanced-use/performance) is explicit that reading the whole `nodes`/`edges` array in a component re-renders everything on every update. Instead keep a separate Zustand status store keyed by `runTaskId`; the custom node subscribes to *its own* slice (`useStatusStore(s => s.byId[id])`). One task flipping to "complete" then repaints one node, not 200.
**DES-30 (SHOULD)** — Status palette must be colorblind-safe and not rely on hue alone: pair each colour with an icon/shape (✓ complete, ▲ at risk, ■ blocked, ⏱ late, ⊘ stopped). Add a text status in the node body. Banks have accessibility obligations; a red/green-only close board fails them.
**DES-31 (SHOULD)** — `<MiniMap pannable zoomable nodeColor={statusColor} />` gives a genuine "close cockpit" — the whole close as a colour field. This is the highest-value low-effort feature in the whole runtime view.
**DES-32 (SHOULD)** — Style edges by state: dashed grey (not yet relevant), solid (active dependency), red animated (upstream late and `hard: true`). The animated red edge is how the downstream-owner alert *looks* on the canvas.
**DES-33 (MUST)** — Ship a **list/grid view alongside the canvas** and make it the default landing view for doers. Worth noting: Workiva Processes itself is fundamentally a *list* of actions with calendars and business-day due dates — the flowchart is a separate design artifact in their blog, not the execution surface. The canvas is for designing, communicating and status-at-a-glance; the grid is for getting work done, filtering, and bulk-editing. Building canvas-only would be the single biggest product mistake available here.
**DES-34 (SHOULD)** — Export the canvas to PNG/PDF (`html-to-image` + `getNodesBounds`/`getViewportForBounds`). Auditors and the controller will want the flowchart in the close binder.

---

## 9. Collaborative editing — recommendation

Separate two different concurrency problems that are being conflated:

1. **Multiple inputters working the same *run*** — several people ticking off tasks, uploading evidence, signing off. **High value, high frequency, and this is what Alex actually described.**
2. **Multiple designers co-drawing the same *template canvas*** — low frequency, usually one process owner in a drafting session.

**DES-35 (MUST)** — Solve (1) first, with **server-authoritative state + realtime push**, not CRDT. Row-level optimistic concurrency using Azure SQL `rowversion` as an ETag on `run_task`; a stale update returns 409 with the current row so the UI can show "Dana completed this 8 seconds ago." Push changes to open clients over SignalR / Azure Web PubSub. Contention is naturally low because tasks are owned.
**DES-36 (SHOULD)** — Add lightweight **presence** everywhere (avatars on the canvas node and in the grid row showing who is viewing/editing). Presence solves ~80% of perceived collaboration pain at ~5% of CRDT's cost.
**DES-37 (SHOULD)** — For (2), start with an **advisory edit lease** on `workflow_template_version`: acquiring the draft takes a 15-minute renewable lease; others get read-only with "Marcus is editing — request control." Combined with the `rowversion` check on save, this is a few hundred lines and no new infrastructure.
**DES-38 (MAY)** — Only add **Yjs** if real-time co-drawing becomes a validated requirement. If so, per React Flow's [multiplayer guide](https://reactflow.dev/learn/advanced-use/multiplayer) and the Synergy Codes Yjs+React Flow work:
- Use **`Y.Map` keyed by node/edge id**, never `Y.Array` — maps give precise per-node merges; arrays produce duplicate/ordering conflicts on concurrent insert.
- Sync **durable** state only (id, type, data, position, dimensions). Keep `selected`, `dragging`, `measured` **local**.
- Put cursors and remote selection in **Yjs Awareness**, not the doc.
- Self-host **Hocuspocus 4.6 (MIT)** rather than Liveblocks — a bank will not send close-process metadata to a third-party SaaS realtime service.
- **Azure pitfall:** Yjs needs sticky WebSocket connections. Azure App Service scale-out requires ARR affinity, or room-affinity routing, or Hocuspocus's Redis extension; a naively load-balanced multi-instance deployment silently splits a document into two divergent rooms.
- **Keep Yjs as the *editing-session transport only*.** Snapshot to the normalized SQL model on publish. A Yjs binary update log is an excellent CRDT and a terrible system of record for a SOX-relevant process registry.

---

## 10. Open-source designers worth borrowing from

| Project | Stack (verified) | License | Borrow | Don't |
|---|---|---|---|---|
| **Apache Airflow 3 UI** | `@xyflow/react ^12.11.3` + `elkjs ^0.12.0` + Chakra | Apache-2.0 | Read-only DAG graph with per-task status colour; dual Graph/Grid views; task-instance detail drawer. Closest analogue to the runtime view. | Its scheduler semantics |
| **n8n** | `@vue-flow/core 1.48` + `@dagrejs/dagre ^1.1.4` | **Sustainable Use License (fair-code, not OSI)** | Node palette UX, drag-from-handle-to-create, "tidy up" button, node config side panel | **Do not vendor or copy code** — the SUL restricts commercial internal use in ways bank legal will not enjoy |
| **bpmn-js** | own canvas (diagram-js) | MIT **but the bpmn.io watermark "MUST NOT be removed or changed"** | BPMN pool/lane semantics as a *conceptual* model; XML interchange if they ever need to export to a BPM suite | As the UI — BPMN is too heavy for finance staff, and a permanent third-party watermark on internal close diagrams is an awkward conversation |
| **Windmill** | Svelte flow editor | **AGPL-3.0** (+ EE dir) | Branch/loop step UX ideas | Do not vendor. AGPL is a standing hard-no at most banks |
| **Temporal UI** | Svelte; engine-first, not a designer | MIT | The versioning discipline: an execution pins its definition version (see DES-25) | Not a design surface |
| **Camunda Modeler** | desktop, bpmn-js | MIT (bpmn-js terms) | "Element templates" — JSON schemas that constrain what properties a node type exposes. Directly applicable to constraining `task` vs `signoff` node forms | Desktop distribution model |
| **shadcn-next-workflows**, React Flow UI "Workflow Editor" template | Next.js + React Flow + shadcn | MIT | Ready-made node/palette/panel scaffolding to fork on day one | — |

---

## 11. Pitfall checklist

1. `nodeTypes` / `edgeTypes` defined inline → full remount every render. (DES-08)
2. Zero-height canvas parent → blank screen. (DES-06)
3. `useReactFlow` outside `<ReactFlowProvider>` → throws.
4. Forgetting `import '@xyflow/react/dist/style.css'` → unstyled, unusable canvas.
5. Parent group nodes not ordered before children in the array → mispositioned children. (§6)
6. v11→v12 renames: `parentNode`→`parentId`; node dimensions moved to `node.measured`.
7. Laying out before measurement → overlapping nodes. (DES-18)
8. Persisting `selected`/`dragging`/`viewport` into the template. (DES-23)
9. Storing the graph as an opaque JSON blob, then needing dependency queries. (DES-22)
10. Client-only cycle validation. (DES-12)
11. Live status in `node.data` → whole-canvas repaint on every tick. (DES-29)
12. Templates mutable after publish → October's close silently changes shape mid-month. (DES-24)
13. Lane membership inferred from Y coordinates at read time. (DES-20)
14. Yjs on multi-instance Azure App Service without sticky routing → split-brain documents. (DES-38)
15. **No undo/redo** — React Flow ships none. You must implement a command stack over `onNodesChange`/`onEdgesChange` (coalescing drag deltas into one entry). Finance users expect Ctrl+Z; its absence reads as "unfinished."
16. Building canvas-only and no grid. (DES-33)
17. Status by hue alone. (DES-30)
18. `dagre`@0.8.5 (2019, abandoned) instead of `@dagrejs/dagre`@3. (DES-02)
19. elkjs's 1.4 MB bundle loaded eagerly, and its EPL/GPL SPDX string failing the SCA gate. (DES-03, DES-17)
20. Not using `screenToFlowPosition()` when dropping from a palette → nodes land at the wrong coordinates once the viewport is panned or zoomed.

---

## Sources

- https://www.npmjs.com/package/@xyflow/react and `registry.npmjs.org` metadata (versions, licenses, publish dates, peer deps) — retrieved 2026-09-03
- https://reactflow.dev/pro
- https://reactflow.dev/ui
- https://reactflow.dev/examples/interaction/prevent-cycles
- https://reactflow.dev/examples/interaction/save-and-restore
- https://reactflow.dev/examples/grouping/sub-flows
- https://reactflow.dev/learn/layouting/layouting
- https://reactflow.dev/learn/advanced-use/performance
- https://reactflow.dev/learn/advanced-use/multiplayer
- https://reactflow.dev/learn/troubleshooting/migrate-to-v12
- https://github.com/xyflow/xyflow/discussions/2359
- https://github.com/liang-faan/reactflow-swimlane
- https://raw.githubusercontent.com/apache/airflow/main/airflow-core/src/airflow/ui/package.json
- https://raw.githubusercontent.com/n8n-io/n8n/master/packages/frontend/editor-ui/package.json
- https://docs.n8n.io/sustainable-use-license/
- https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE
- https://github.com/windmill-labs/windmill/blob/main/LICENSE-AGPL
- https://www.synergycodes.com/blog/real-time-collaboration-for-multiple-users-in-react-flow-projects-with-yjs-e-book
- https://liveblocks.io/blog/multiplayer-sdk-for-react-flow-realtime-collaboration-between-humans-and-agents
- https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes
- https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process
- https://www.workiva.com/blog/how-build-financial-close-process-flowchart
