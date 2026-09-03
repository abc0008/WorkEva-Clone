# Process Requirements: Finance Workflow & Dependency Tracker

**Version:** 0.2 draft — 2026-09-03
**Companion:** `intent.md` (the "why"). This document is the "what".
**Conventions:** `FR-` functional, `NFR-` non-functional, `DR-` data; `FR-IC-` / `DR-IC-` are the internal-controls-management requirements (section 12A). Priority uses MoSCoW: **M** must (MVP), **S** should (v1), **C** could (later), **W** won't (out of scope). Acceptance criteria (AC) are given where they sharpen the requirement. Shall/must = mandatory when the requirement is in scope for the phase.

The product has two pillars over one engine: **dependency planning** (sections 3-8) and **internal controls management** (section 12A, with hooks in sections 2, 5, 10, 11, 13). A control performance is a task; there is no second scheduler.

---

## 1. Glossary and domain model

| Term | Definition |
|---|---|
| **Workflow template** | A versioned, reusable process definition drawn on the react-flow canvas: nodes (tasks, sign-offs, milestones, inputs, sub-process links) and typed dependency edges, with owner *roles* (not people) and *relative* due-date offsets. |
| **Template version** | An immutable snapshot of a template once published (`draft -> published -> archived`). Runs pin a version. |
| **Run** (workflow instance) | A template version instantiated for a specific **period** and **entity** against a specific **calendar version**. Holds resolved dates, actuals, statuses, evidence and sign-offs. |
| **Task** (task instance) | A unit of work inside a run, generated from a template node. Has exactly one owner, 0..n preparers/reviewers/approvers/watchers, 0..n checklist items. |
| **Checklist item** | A sub-item of a task with its own single owner and done flag; the mechanism for several inputters on one task. |
| **Dependency** | A directed edge predecessor -> successor with type (FS/SS/FF/SF), lag in business days, and hardness (`hard` gates the successor; `soft` re-forecasts and informs only). |
| **Period** | An accounting period (month, quarter, year) with a period-end date; regulatory cycles may be ad hoc periods with statutory anchors. |
| **Calendar** | A named business-day calendar: timezone, working-weekday mask, holiday exceptions. Versioned. Seeded with the Federal Reserve schedule plus bank-specific closures. |
| **BD+n / BD-n** | Business-day offset from an anchor. `BD+1` = first business day strictly after period end; `BD+0` = last business day on or before period end; `BD-1` = business day before BD+0. |
| **Baseline date** | The due date resolved at instantiation and frozen for on-time reporting. |
| **Planned / projected date** | The current forecast, recomputed from upstream actuals via the forward pass. |
| **Review** | A task-level accept / return-with-notes by a reviewer or approver. High volume. |
| **Attestation** | A formal, immutable sign-off record binding the signer's identity, the verbatim statement text version, and the hashes of the evidence present at signing. Low volume, audit-grade. |
| **Evidence** | An uploaded file (PDF, XLSX, etc.) stored in Blob with SHA-256, scan result, uploader and version. Linked many-to-many to tasks, checklist items and attestations. |
| **Escalation ladder** | Time-based (in business days) routing of an unresolved late task to owner -> backup -> close manager -> controller. |
| **Roll-forward** | Instantiating a template version for the next period with prior-period review data and open issues carried forward. |
| **Task type** | `PLAIN`, `CONTROL_PERFORMANCE`, `CONTROL_TEST`, `CERTIFICATION`, `EVIDENCE_REQUEST`, `REMEDIATION`. All share the scheduling, dependency, alerting, evidence and audit machinery; the type adds a payload and a completion validator. |
| **Control** | A versioned, effective-dated master record in the controls library (ID, objective, placement, classification, assertions, people, evidence expectation, framework mapping, reliance). A template node may reference a control; the run's task is then a control performance. |
| **Control performance** | The immutable record created when a `CONTROL_PERFORMANCE` task completes: control version + period + performer + reviewer attestation + evidence hashes. |
| **Risk / significant account / process** | Reference entities associated many-to-many with controls. Together with the current period's performance and test state they generate the **RCM** (risk-control matrix), which is a derived view, never a stored spreadsheet. |
| **Test result** | Per control per test cycle: conclusion (effective / exception / not tested), tester, date, workpaper reference; optional test plan and sample rows in a later phase. |
| **Issue** | A deficiency or finding with source, severity ladder (`DEFICIENCY -> SIGNIFICANT_DEFICIENCY -> MATERIAL_WEAKNESS`), root cause, remediation owner and target date, retest and closure approval. Remediation work is a `REMEDIATION` task. |
| **Certification campaign** | A period-bound cascade of sub-certification letters (statements + questions) from process/subsidiary owners rolling up to the 302 signers. Each assignment is a `CERTIFICATION` task; completion is an attestation with responses. |
| **CUEC** | Complementary user entity control listed in a SOC 1 report that the bank must itself perform; instantiable as a control in the library. |

Object hierarchy: `WorkflowTemplate -> TemplateVersion -> {TemplateNode, TemplateEdge}` and `Period x Entity x TemplateVersion -> Run -> {Task, Dependency, Evidence, Attestation, Comment, Event}`. Controls side: `Control (versioned) <-> {Risk, Process, Account}`; `Control x Period -> ControlPerformance`, `Control x TestCycle -> TestResult`; `Issue -> RemediationTask`; `CertificationCampaign -> CertificationAssignment (task) -> Attestation + Responses`.

---

## 2. Roles and permissions

Authorization is three layers evaluated in order: (1) app role (which verbs), (2) scope `(legal_entity, department, workflow)` with hierarchy and wildcards, (3) object-level grant from being named on a task. Layers 1-2 are Entra-group driven; layer 3 is in-app assignment.

Controls-management roles are **not** new app roles. `ControlOwner`, `Performer`, `Reviewer`, `Tester`, `Certifier` and `ProgramOwner` are object-level roles on a control, a control performance, a test result or a certification assignment (layer 3), carried by the same `task_role_assignment` mechanism plus a `control_role_assignment` for library-level ownership. `ProgramOwner` (the SOX/FDICIA program lead) maps to `ProcessAdmin` scoped to the controls workspace. The external auditor / examiner is the existing `Auditor` app role provisioned per FR-012 and FR-IC-14.

| ID | Requirement | Pri |
|---|---|---|
| FR-001 | App roles shall be `Viewer, Contributor, Reviewer, Approver, ProcessDesigner, ProcessAdmin, Auditor, AppAdmin`, declared as Entra app roles with Entra security groups assigned to them. The app shall not depend on a raw `groups` claim. | M |
| FR-002 | Every authenticated user shall receive a baseline `Viewer` role so no user is unauthorized-by-accident or over-privileged-by-default. | M |
| FR-003 | Task roles shall be `owner` (exactly 1), `preparer` (0..n), `reviewer` (0..n), `approver` (0..n), `watcher` (0..n), stored in a task-role assignment table keyed by (task, principal, role). The system shall reject any state with zero or more than one owner. | M |
| FR-004 | A role holder may be a user or an Entra group / in-app team; group-assigned tasks appear in every member's queue until claimed, after which the claimant is effective owner and the group remains a watcher. | S |
| FR-005 | Being named on a task grants the verbs of that role on that task irrespective of base scope (allows a Loan Ops analyst with `Viewer` base to complete their one task). | M |
| FR-006 | `AppAdmin` shall not be able to sign off, attest or upload evidence. `Auditor` shall be read-everything, write-nothing, excluding draft templates. Only `ProcessAdmin`/`AppAdmin` may reopen a signed task, reassign, or change a due date in-period, each with a mandatory reason code. | M |
| FR-007 | Segregation of duties: the same principal shall not hold two of {preparer, reviewer, approver} on the same task, checked at sign time not only at assignment time. Overrides require a per-task-type configuration, a compensating-control justification, approval by a designated control owner, and appear on a standing SoD-exceptions report. | S |
| FR-008 | Time-boxed delegation (B acts as themselves on A's tasks, attributed "B as delegate for A"). Attestation is excluded from delegation by default and requires ProcessAdmin enablement, flagged in audit exports. | S |
| FR-009 | Backup owner per task and per workflow role, receiving notifications and able to claim. | S |
| FR-010 | Bulk reassignment of all open tasks of a user within a scope and period, preserving checklist completions, comments and evidence. Reassigning a signed task is reopen + reassign, both logged. | S |
| FR-011 | On directory disable/delete, immediately revoke sign-in, flag the user's open tasks `owner_inactive`, route to a reassignment queue with an SLA; historical attributions preserved, user record tombstoned never deleted. Effective scope recomputed from group membership on each authentication. | S |
| FR-012 | External auditors/examiners: Entra B2B guests via entitlement-management access packages with expiration, approval and auto-removal; scope bounded by entity, workflow **and period range**. This is the provisioning mechanism for the scoped auditor/examiner role in FR-IC-14 and carries the same priority. | S |
| FR-013 | Quarterly user-access-review export: user, app roles, scopes, last login, sign-off counts, active delegations, plus extraction parameters and record counts (IPE-ready). Review results retained immutably. | S |
| NFR-001 | Every capability check shall be enforced server-side on every API route; UI gating is a convenience only. | M |

Permission matrix (V = view; check = allowed; circle = only when named on the object; dash = denied):

| Capability | Viewer | Contributor | Reviewer | Approver | ProcessDesigner | ProcessAdmin | Auditor | AppAdmin |
|---|---|---|---|---|---|---|---|---|
| View workflows/tasks in scope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ scope | ✓ |
| View evidence | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit template draft | — | — | — | — | ✓ | ✓ | — | ✓ |
| Publish template version | — | — | — | — | ○ own | ✓ | — | ✓ |
| Instantiate / roll forward | — | — | — | — | — | ✓ | — | ✓ |
| Edit task fields, complete items, upload evidence, submit | — | ○ | ○ | ○ | — | ✓ | — | — |
| Review / return | — | — | ○ | ○ | — | ✓ | — | — |
| Sign off / attest | — | — | ○ assigned review | ○ | — | — | — | — |
| Reopen signed task, reassign, change due date | — | — | — | — | — | ✓ reason | — | ✓ reason |
| Manage calendars/holidays | — | — | — | — | — | ✓ | — | ✓ |
| Manage users/groups/scopes | — | — | — | — | — | — | — | ✓ |
| Export audit trail | — | — | — | — | — | ✓ scope | ✓ scope | ✓ |
| View controls library, RCM, issues, certification status | ✓ scope | ✓ scope | ✓ scope | ✓ scope | ✓ | ✓ | ✓ scope | ✓ |
| Create/edit/retire control, risk, account association | — | — | — | — | ○ control owner | ✓ | — | — |
| Record test result / open issue | — | — | ○ tester | ○ | — | ✓ | — | — |
| Sign sub-certification | — | — | — | ○ certifier | — | — | — | — |
| Run certification campaign, close issue | — | — | — | — | — | ✓ | — | — |

Note: control review attestation (the independent reviewer's sign-off on a `CONTROL_PERFORMANCE`, FR-IC-04 / FR-124) is a Reviewer act on the items they are assigned to review; Approver sign-off covers the general approval chain.

---

## 3. Workflow template designer (react-flow)

| ID | Requirement | Pri |
|---|---|---|
| FR-020 | The designer shall be built on `@xyflow/react` ^12.11 (MIT) with `@dagrejs/dagre` ^3 for auto-layout; the legacy `reactflow` and `dagre@0.8` packages shall not be used. `elkjs` requires OSS review before adoption. | M |
| FR-021 | Node types: `task`, `signoff`, `milestone` (zero duration), `input` (external data arrival with SLA), `subprocess` (link to another template), and lane bands for team swimlanes. Each type has a validated, versioned `data` schema. | M (task, signoff, milestone); S (input, subprocess) |
| FR-022 | A task node shall carry: title, description/instructions, owner role, optional default assignee, category and tags (category/value pairs), due-offset expression, estimated duration (BD), `evidence_required`, `requires_approval`, review policy (`any_one`/`all`/`n_of_m`), control ID (optional), period-type applicability (`MONTHLY / QUARTER_END / YEAR_END / AD_HOC`), entity scope (`per_entity / consolidated_only / entity_list`), system of record, external ref. | M |
| FR-023 | Due offsets shall be stored as an expression, never a date: `{ kind: BUSINESS_DAYS \| CALENDAR_DAYS_ROLL_FORWARD, anchor: PERIOD_END \| PERIOD_START \| NAMED_DEADLINE \| PREDECESSOR_FINISH, n: int, calendar_id, time_of_day }`. The node label renders `BD+3` in design mode and `BD+3 · Mon 05 Oct` in run mode. | M |
| FR-024 | Edges shall carry `dep_type (FS default, SS, FF; SF stored but hidden)`, `lag_bd` (signed integer, business days), `hard` (boolean), `alert_on_slip` (boolean), and `handoff` (boolean, marks a cross-team handoff). | M |
| FR-025 | `isValidConnection` shall reject self-loops, cycles, incompatible handles and policy-forbidden cross-lane connections client-side; the server shall re-validate acyclicity (Kahn's sort) on every save and publish, returning HTTP 422 with the offending path `A -> B -> C -> A` so the canvas can highlight it. | M |
| FR-026 | Lane membership shall be data (`lane_id` written on drag-stop), never inferred from coordinates at read time. | M |
| FR-027 | Auto-arrange ("Tidy up", left-to-right, rank by BD) shall be an explicit user action with undo; layout shall run after node measurement. | S |
| FR-028 | Undo/redo command stack over node/edge changes, coalescing drag deltas. | S |
| FR-029 | A palette with drag-to-create using `screenToFlowPosition`; a node properties side panel; a node search. | M |
| FR-030 | Optional BD-column background bands (BD+1, BD+2, ...) so the canvas reads as team x business day. | C |
| FR-031 | Export the canvas to PNG/PDF for the close binder. | S |
| FR-032 | Template editing concurrency: an advisory 15-minute renewable edit lease per draft version; others see read-only with "X is editing — request control." Combined with `rowversion` check on save. | M |
| FR-033 | Real-time multiplayer canvas (Yjs over Azure Web PubSub, self-hosted Hocuspocus, Y.Map keyed by id, awareness for cursors, snapshot to SQL on publish) only if validated after MVP. | C |
| FR-034 | Publish-time validation: no orphan nodes (except explicit start/end), every task has an owner role, every lane has >= 1 node, every `signoff` approver role differs from the assignee role. | M |
| NFR-010 | `nodeTypes`/`edgeTypes` declared at module scope; canvas loaded client-only; live run status kept in a separate store keyed by task id so one status change repaints one node. | M |

---

## 4. Template versioning, roll-forward and instantiation

| ID | Requirement | Pri |
|---|---|---|
| FR-040 | Template versions are immutable once published (`draft -> published -> archived`). Editing a published version forks a new draft. A `graph_hash` (SHA-256 of canonical nodes/edges excluding layout) is stored per version. | M |
| FR-041 | Publishing shall require approval by a designated control owner (ProcessAdmin) with a change note; a version diff view (nodes/edges/owners/offsets added, removed, changed) shall be available. | S (approval), M (diff) |
| FR-042 | Instantiation = `materialize(template_version_id, period_id, entity_id, calendar_version_id)` producing a deep copy (run, tasks, dependencies). Runs pin `template_version_id` and `calendar_version_id`; later template or calendar edits never mutate an open or closed run. | M |
| FR-043 | Instantiation shall resolve offsets to `baseline_due_at` and `planned_due_at`, and roles to users via the role-assignment map, with an explicit "unresolved role" blocker. Per-entity task scope fans out one task per entity. | M |
| FR-044 | Pre-flight "Check for issues" before a run goes live: acyclic, every task has a resolvable owner, no due date in the past, no dates on non-business days, no orphan hard-blocked task, calendar covers the full span (>= 12 months forward coverage warning), owners who have left. All findings reported at once. | M |
| FR-045 | Roll-forward is a reviewed diff, not a blind copy: the setup screen shows resolved dates, unassigned/departed owners, and prior-period late / cancelled / added / reopened counts; prior-period notes carry forward. | M |
| FR-046 | One template shall roll forward into month-end and quarter-end instances with the correct task subset via `period_type` applicability. Year-end is a distinct template variant. | M |
| FR-047 | In-flight edits to a run (add/remove/reassign tasks, change dates) are permitted with a reason code and audit event; no auto-upgrade of an open run to a newer template version. An explicit "apply template v(n) changes to this run" action with diff preview may be offered later. | M (edits), C (apply) |
| FR-048 | Reopen a closed run without restarting or re-notifying completed tasks. | M |
| FR-049 | A shared task library (reusable task definitions referenced by templates, edited once). Single-node counterpart of the pattern library in FR-049a. | S |
| FR-049a | Versioned, reusable sub-flow pattern library: a template designer can save any selected subgraph as a named pattern (e.g. reconciliation pattern, regulatory-schedule pattern), patterns are versioned centrally, droppable into any template, and instances record which pattern version they came from. Satisfies the explicit user requirement for "a flexible way to create and save defined workflow patterns"; see FR-049 for single-task reuse and intent §8. | M |
| FR-049b | Seeded starter templates for month-end close, Call Report and ALLL/CECL, built from FR-049a patterns, matching intent §8. | S |
| FR-050 | Cross-workflow dependencies (task in run A -> task in run B within the same period/entity) and a program-level map showing sub-workflows as nodes with inter-edges. | S |

AC (FR-042): publishing template v7 while the October run (v6) is open leaves every October task, date and edge byte-identical.

---

## 5. Runs and tasks lifecycle — status state machine

Two orthogonal axes. Collapsing them into one enum is the most common design error. Workiva itself treats "late" as a derived flag on the roll-forward summary, not a status; we go further and derive every timeliness state. The lifecycle enum below is shared by all six task types; a task type may add guards to a transition (e.g. `CONTROL_PERFORMANCE` cannot reach `COMPLETE` without a reviewer attestation), never new states.

**Axis A — lifecycle (explicit, human-driven):**

| From | Event | To | Guard / side effect |
|---|---|---|---|
| `NOT_STARTED` | Start (owner/preparer) or first item completed | `IN_PROGRESS` | If any hard predecessor is not terminal and gate is enforced: rejected unless override with reason (logged) |
| `IN_PROGRESS` | Submit (owner or any preparer) | `SUBMITTED` | All required checklist items done; if `evidence_required`, >= 1 scanned-clean evidence; actor recorded; evidence becomes read-only |
| `SUBMITTED` | Reviewer claims | `IN_REVIEW` | Reviewer != preparer |
| `IN_REVIEW` / `SUBMITTED` | Return with notes | `RETURNED` | Comment mandatory; attestation `rejected` record; preparer and downstream owners notified; evidence editable again |
| `RETURNED` | Rework / resubmit | `IN_PROGRESS` -> `SUBMITTED` | New evidence revision, never overwrite |
| `IN_REVIEW` | Approve (quorum met) | `COMPLETE` | Attestation record written; if no approver configured, Submit goes straight to `COMPLETE` |
| any non-terminal | Owner declares blocked | `BLOCKED` | Reason code + optional named blocker; suppresses own escalation; escalates blocker's owner |
| `BLOCKED` | Unblock | prior state | |
| any non-terminal | Process owner stops | `STOPPED` | Reason mandatory; suppresses timeliness derivation and alerts; downstream owners notified |
| any | Mark not applicable | `NOT_APPLICABLE` | Reason mandatory; excluded from on-time denominators; waiver count reported |
| any non-terminal | Admin force-close | `FORCE_CLOSED` | Unblocks successors; distinct flag for audit; reason mandatory |
| `COMPLETE` / `FORCE_CLOSED` | Reopen (ProcessAdmin) | `IN_PROGRESS` | Reason + approval at or above highest voided sign-off; prior attestations marked `superseded`; downstream signed tasks flagged `dependency_invalidated` and owners notified |

**Axis B — timeliness (derived, never hand-set; persisted with `status_computed_at`):**

| Derived status | Rule (D = due, F = forecast finish, now in task tz) |
|---|---|
| `ON_TRACK` | not terminal and none of the below |
| `DUE_SOON` | not terminal, `now <= D`, `D - now <= warn_window` (default 1 BD) |
| `AT_RISK` | not terminal, `now <= D`, and (`F > D` or `total_float < 0`) — the math says it will miss |
| `DELAYED` | not terminal, `now <= D`, forecast start pushed out by an upstream slip exceeding free float — someone else moved your date |
| `LATE` | not terminal and `now > D` |
| `BLOCKED_UPSTREAM` | any hard predecessor not terminal (attributed upstream in every view) |
| `COMPLETE_ON_TIME` / `COMPLETE_LATE` | terminal and `actual_finish <= D` / `> D`, measured against **baseline** |
| suppressed | lifecycle `STOPPED` or `NOT_APPLICABLE` |

The predicates above are evaluated with precedence STOPPED > BLOCKED_UPSTREAM > LATE > DELAYED > AT_RISK > ON_TRACK to produce the single displayed `timeliness_status` (DUE_SOON sits between AT_RISK and ON_TRACK; the terminal COMPLETE_* states are exclusive by construction). The underlying predicates are also exposed as non-exclusive boolean flags (`is_late`, `is_delayed`, `is_at_risk`, `is_blocked_upstream`, ...) for reporting, so a task can be counted as both late and blocked upstream.

**Type-specific derived flags** (also computed, persisted alongside timeliness): `control_at_risk` on a `CONTROL_PERFORMANCE` or `CERTIFICATION` task whose forecast finish exceeds its due date because of an upstream slip (FR-IC-09); `evidence_incomplete` when the control's evidence spec is not satisfied; `sod_conflict` when the current assignment would violate FR-IC-05 at sign time.

Type-specific completion validators (evaluated on Submit / Approve, server-side):

| Task type | Additional guard to reach `COMPLETE` | Side effect on `COMPLETE` |
|---|---|---|
| `PLAIN` | none beyond the table above | — |
| `CONTROL_PERFORMANCE` | evidence spec satisfied with clean evidence; reviewer attestation by a principal ≠ performer | immutable `control_performance` row bound to control version, period, evidence hashes |
| `CONTROL_TEST` | conclusion recorded; tester ≠ control owner/performer; workpaper reference or sample rows present | `test_result` row; `exception` conclusion prompts issue creation (FR-IC-11) |
| `CERTIFICATION` | every required question answered; certifier attestation with session freshness | `attestation` of type `certified` + `attestation_response` rows; exception answers may auto-create an issue (FR-IC-13) |
| `EVIDENCE_REQUEST` | >= 1 clean evidence item in the named slot | evidence link written; uploader rights drop to read-only (FR-IC-07) |
| `REMEDIATION` | linked issue has a passing retest or documented closure approval | issue status -> `CLOSED` |

| ID | Requirement | Pri |
|---|---|---|
| FR-060 | The system shall implement the lifecycle state machine above; illegal transitions are rejected server-side with a reason. | M |
| FR-061 | Timeliness shall be recomputed on: task status change, actual start/finish write, edge/duration/offset edit, calendar edit on an open run, and a start-of-business-day sweep; persisted with `status_computed_at`. | M |
| FR-062 | Checklist items: 0..n per task, each with one owner, done flag, timestamp, optional evidence; task progress = required items done / required items. | M |
| FR-063 | Every task shall display BD label, resolved date and time-of-day cutoff together (`BD+3 · Tue 06 Oct 17:00 ET`). | M |
| FR-064 | Period lock: `soft_close` (no new tasks; edits require approval) and `hard_close` (read-only; reopen requires Controller-designated approval and lands on an exceptions report). | S |
| FR-065 | Task types beyond `PLAIN`: `CONTROL_PERFORMANCE` (control ID, mandatory evidence, distinct reviewer), `CONTROL_TEST`, `CERTIFICATION` (completion is an attestation with questions), `EVIDENCE_REQUEST` (ask a named person for a file into a slot), `REMEDIATION` (linked to an issue). All share one scheduling engine; detailed behaviour in section 12A (FR-IC-03, FR-IC-04). | M (`CONTROL_PERFORMANCE`, `EVIDENCE_REQUEST`); S (`CERTIFICATION`, `REMEDIATION`, `CONTROL_TEST` thin) |

---

## 6. Dependencies and delay propagation

| ID | Requirement | Pri |
|---|---|---|
| FR-070 | Dependencies form a general DAG (fan-out and fan-in native) persisted as a plain adjacency table; SQL Server graph tables shall not be used. | M |
| FR-071 | Cycle rejection shall be enforced in three layers: application (`graphology-dag` or Kahn's algorithm on every edge write), database (recursive CTE reachability check inside the insert transaction with `MAXRECURSION`), and a nightly integrity sweep. The cycle check spans cross-workflow edges within a period. | M |
| FR-072 | Hard edges gate the successor's start and completion (advisory-by-default is configurable per edge; a bypass records an override reason). Soft edges re-forecast and inform only. | M |
| FR-073 | A CPM engine (owned code, ~150 lines over topological order) shall compute ES/EF/LS/LF, total float and free float in business days on the task's calendar, clamping LF to the task's own deadline so total float goes negative when the plan cannot meet it. Results are stored on the task row. | M |
| FR-074 | Every task carries `baseline_due_at` (frozen) and `forecast_finish_at` (forward pass from actuals + template durations). `slip_bd = forecast - baseline`. | M |
| FR-075 | Slip absorbed by the predecessor's free float shall not propagate and shall not alert. Only slip exceeding free float pushes successors and triggers `DOWNSTREAM_DELAY`. | M |
| FR-076 | Re-forecast shall be presented as a diff naming the **root-cause** task and owner (walk the critical path back to the earliest negative-float task), not only the immediate predecessor. | M |
| FR-077 | An "impact preview" service: given a task and a hypothetical finish, return the transitive downstream set, BD shift per task and owners. This one service powers the view and the alert. | M |
| FR-078 | Recompute scope is the affected run subgraph plus the downstream cross-workflow reachable set, never the whole database; synchronous inside the mutating request plus an Azure Functions timer sweep every 15 minutes. | M |
| FR-079 | Critical path highlighted on canvas and Gantt; `is_critical` persisted. | M |

AC (FR-075): with A -> B (FS, lag 0), B free float 2 BD, A finishing 1 BD late produces no alert; A finishing 3 BD late produces exactly one `DOWNSTREAM_DELAY` to B's owner citing A and its owner.

---

## 7. Business-day scheduling and holiday calendars

| ID | Requirement | Pri |
|---|---|---|
| FR-080 | `Calendar` entity: id, name, timezone (IANA), working-weekday mask, holiday exceptions, versioned. Seeded with the Federal Reserve schedule (11 holidays; Saturday holiday -> open Friday; Sunday holiday -> closed Monday) plus a bank corporate calendar. Editable in-app, importable via CSV/.ics upload (no subscription polling). | M |
| FR-081 | A materialized `business_day` table per calendar for ~10 years: `is_business_day`, BD index from month start, from month end, from quarter end, month-end and quarter-end dates. `BD+3` is one indexed lookup; the table is joinable from reporting and Databricks. `date-fns addBusinessDays` shall not be used (weekend-only). | M |
| FR-082 | Offset convention pinned in tests: `BD+1` = first business day strictly after period end; `BD+0` = last business day on or before period end; `BD-1` = business day before `BD+0`. | M |
| FR-083 | Two offset kinds: `BUSINESS_DAYS` (internal close) and `CALENDAR_DAYS_ROLL_FORWARD` (regulatory: e.g. Call Report 30 calendar days after quarter end, 35 for Q1-Q3 with foreign offices; weekend rolls forward, federal holidays do not shift). Anchors: period start, period end, named deadline event, predecessor finish. | M |
| FR-084 | Deadlines resolve as `(BD date) @ (task cutoff time, default 17:00 workspace-configurable) @ (task timezone) -> UTC instant`; DST handled by the zone library (luxon or date-fns v4 + `@date-fns/tz`; pick one). | M |
| FR-085 | A shaded/unshaded month-grid calendar preview for confirming a calendar before instantiation. | M |
| FR-086 | Admin warning when a calendar has < 12 months forward coverage. | M |
| FR-087 | Multiple calendars per run (e.g. Call Report deadline calendar layered on the close calendar); a task anchors to a named calendar. | S |
| NFR-020 | Golden test suite over the business-day engine: Jul 4 2026 (Sat), Jul 4 2027 (Sun), month-ends on weekends, leap years, DST boundaries, fiscal vs calendar month-end. | M |

---

## 8. Alerts, notifications and escalation

Event catalogue (primary recipient in parentheses): `TASK_ASSIGNED` (assignee), `TASK_UNBLOCKED` (assignee), `DUE_SOON` (assignee), `TASK_LATE` (assignee; process owner), `TASK_LATE_ESCALATION` (manager, close owner), `DOWNSTREAM_DELAY` (each affected downstream owner; upstream owner cc-visible), `DEADLINE_BREACH_FORECAST` (close owner, controller), `CRITICAL_PATH_CHANGED` (close owner), `AWAITING_APPROVAL` (approver), `RETURNED` (assignee), `EVIDENCE_MISSING` (assignee, in-app blocking), `WORKFLOW_STOPPED` / `FORCE_CLOSED` (downstream owners), `MENTION` (mentioned user), `DEPENDENCY_INVALIDATED` (downstream signer), `CONTROL_AT_RISK` (control owner; program owner), `CERTIFICATION_OVERDUE` (certifier; parent certifier), `ISSUE_PAST_TARGET` (remediation owner; program owner), `SOD_CONFLICT` (assigner; control owner).

| ID | Requirement | Pri |
|---|---|---|
| FR-090 | Notifications are four distinct types — assignment, alert, mention, digest — each with independent per-user, per-channel preferences (`immediate / digest / off`, digest schedule, quiet hours, close-week override, min severity). | M (basic page), S (per-process overrides) |
| FR-091 | Every alert carries a dedup key `(event_type, task_id, period_id, materiality_bucket)`; a re-fire inside the debounce window updates the existing notification. `DOWNSTREAM_DELAY` is held for a 15-minute quiet window. | M |
| FR-092 | Digest by default (08:30 and 16:00 local during an open period); immediate only for `DOWNSTREAM_DELAY`, `DEADLINE_BREACH_FORECAST`, `RETURNED`, `MENTION`, `TASK_LATE_ESCALATION`. Digests cap items by risk with "and N more". | M |
| FR-093 | At most one `DOWNSTREAM_DELAY` per (task, cause) unless the projection moves >= 1 BD or the cause resolves. Never alert an owner whose float absorbs the slip. Never alert the whole team. | M |
| FR-094 | Downstream-delay alert content: affected task, old vs new projected BD, named upstream cause and owner, BD slip, whether it breaches the recipient's due date, count of tasks downstream of the recipient, projection assumption, one primary CTA (Open task) plus Acknowledge & re-plan and Message upstream owner. | M |
| FR-095 | Quiet hours: no alerts outside 07:00-19:00 local or on non-business days, except `DEADLINE_BREACH_FORECAST` on a regulatory deadline within 2 BD; queued and released at window open. | S |
| FR-096 | Escalation ladder in business days: due -> owner; +1 BD -> owner + backup + downstream owners; +2 BD (or immediately if critical path / regulatory) -> close manager exceptions queue; +3 BD or projected slip to close date -> line manager + controller with quantified impact. Stops on any transition out of the stuck state; suppressed for `BLOCKED_UPSTREAM` tasks (escalate the blocker's owner instead). Owner acknowledgement with a new committed date pauses escalation once. | S |
| FR-097 | Escalation copy is framed as assistance ("this item needs help to stay on plan"); escalation counts reported per process, never as an individual performance metric. | S |
| FR-098 | Channels: in-app inbox (durable record, tabs All/Mentions/Alerts/Assignments, unread, snooze, inline actions), email via Microsoft Graph `sendMail` from a single shared mailbox restricted by application access policy, Teams Adaptive Card via a Power Automate Workflows HTTP trigger (Office 365 connectors are retired). SMTP relay only as fallback behind an `INotificationChannel` interface. | M |
| FR-099 | Card actions limited to acknowledge, complete, comment, request extension, reassign-to-me; attestation is never executable from a card. Card actions write an event with channel, verified Entra object id, correlation id and card version; idempotent with expiring action tokens (7 days). | S |
| FR-100 | On-demand "Send reminders" nudge from a task or a selection (bulk nudge). | M |
| FR-101 | Cross-channel dedup: a Teams card acted on within 10 minutes cancels the queued email. | S |
| FR-102 | Delivery, open and click-through instrumented per event type and channel; admin view of notification effectiveness; prune alert types with CTR < 5% for two periods. | C |
| NFR-030 | Every notification persisted (`notification`: dedup_key, recipient, channel, event, payload, sent_at, suppressed_reason) as SOX evidence that the control notification fired. Notification bodies contain no financial figures or evidence content — link only. | M |
| NFR-031 | Alert sweep is idempotent and safe under concurrent runs (unique index on dedup key; `rowversion` guards). No `node-cron` inside the web tier. | M |

---

## 9. Collaboration: multi-user, comments, presence

| ID | Requirement | Pri |
|---|---|---|
| FR-110 | Concurrent writes to a task or checklist item use optimistic concurrency (`rowversion` as ETag); a stale write returns HTTP 409 with current server state for a field-level merge prompt. Every accepted write increments `task_version` and emits an audit event. Never silent last-write-wins. | M |
| FR-111 | Free-text collaboration is append-only comments, not a shared mutable field. Comments attach to a task, optionally to an evidence item or attestation; edits create a revision with prior text retained; deletes are soft with reason. | M |
| FR-112 | `@user` and `@group` mentions resolve against Entra, create a notification and a mention event; mentioning does not grant access (offer request-access instead). | M |
| FR-113 | Presence: avatars on canvas nodes and grid rows showing who is viewing/editing; live refresh of run views over SSE at MVP (mutations fanned out via a Service Bus topic across App Service instances), Azure Web PubSub later. | M (SSE + presence), C (Web PubSub) |
| FR-114 | Group-task broadcast: when one member of a group-assigned task completes it, the group is informed. | S |
| FR-115 | A `Process manager` for a run may be assigned or changed after start without reassigning tasks. | S |

---

## 10. Sign-off and attestation

Distinguish **Review** (task-level accept/return, high volume) from **Attestation** (formal, immutable, evidenced). Both require return-with-notes.

| ID | Requirement | Pri |
|---|---|---|
| FR-120 | An attestation record shall persist immutably: id, task id + task version, run, period, template version, signer Entra oid / UPN / display name at signing, role at signing, `delegated_from` if any, type (`prepared, reviewed, approved, certified, rejected, reopened, waived`), statement id + **verbatim statement text** + version, server UTC timestamp and local tz, source IP, user agent, session id, auth method / `amr` / `acrs`, SHA-256 content hash over canonical task state + evidence hashes, comment (required on reject), evidence ids bound at signing. | M |
| FR-121 | The UI shall display the exact statement adjacent to the signing control. Statements are versioned; editing creates a new version and never mutates prior records. Seed statements for preparer, reviewer, SOX 302 sub-certifier and FR Y-14-style. | M |
| FR-122 | Signing requires proof of identity at the moment of signing: MVP = typed full name bound to the authenticated Entra session with a session-freshness check (re-prompt via MSAL `prompt=login` if `auth_time` older than N minutes); later = Conditional Access authentication context step-up (`acrs` claims challenge). Shared/service accounts are blocked from signing. | M (freshness), C (CA step-up) |
| FR-123 | Multi-step review/approval chains with per-step quorum (`any_one / all / n_of_m`), sequential or parallel. | S |
| FR-124 | Rejection creates a `rejected` record, supersedes (never deletes) the prior preparer sign-off, notifies preparer and downstream dependents. A reviewer cannot edit task content in review state without returning it (which voids the preparer sign-off). | M |
| FR-125 | Reopening a signed task requires reason + approval, marks prior attestations `superseded`, and flags downstream signed tasks `dependency_invalidated` with owner notification (cascading invalidation). | S |
| FR-126 | Management review controls: template may define review procedures, threshold/tolerance (e.g. "investigate > $250k or > 5%") and required disposition; the reviewer's record captures items over threshold and actions taken. | C |
| FR-127 | Attestation questions with structured responses ("Any unrecorded liabilities? If yes, explain") exportable to CSV; bulk certification fanning one letter to every member of a group with one approval contact. | S (questions), C (bulk) |
| FR-128 | Signer overrides for unavailability: Mark-as-signed (sole signer) and Skip (multi-signer), both logged with reason. | C |

---

## 11. Evidence uploads

| ID | Requirement | Pri |
|---|---|---|
| FR-130 | Upload directly to Azure Blob via a short-lived (<= 15 min), single-blob, write-only **user-delegation SAS** minted after the API authorizes the user against the task; account keys disabled. If private endpoints block browser-direct upload, proxy chunked uploads through the app (confirm with networking in week 1). | M |
| FR-131 | Server computes and stores SHA-256 of the stored blob; verified on every download. Original bytes preserved; previews are separate derived artifacts. Excel files are never re-saved server-side. | M |
| FR-132 | Malware scanning via Microsoft Defender for Storage on-upload; evidence has `scan_status (PENDING / CLEAN / QUARANTINED)`; the UI shows a scanning state and attestation against unscanned evidence is blocked; quarantine container -> evidence container on clean verdict. | M |
| FR-133 | Allowlist by extension and sniffed content type: PDF, XLSX/XLSM (macros flagged), XLS, CSV, DOCX, PNG/JPG, MSG/EML; executables and archives rejected; per-file cap 250 MB and per-task total configurable. | M |
| FR-134 | Evidence binds to a specific task version; submitted evidence becomes read-only; replacement creates version N+1 with prior versions retrievable and still bound to the attestations that referenced them. Changes after sign-off either blocked or flag `evidence_changed_after_signing` requiring re-attestation. | M |
| FR-135 | `evidence_required` flag: a task cannot be submitted without >= 1 clean evidence item. | M |
| FR-136 | IPE metadata on the upload form for control-relevant tasks: source system, report/query name, parameters, run time, run by, format, completeness/accuracy validation; `ipe_risk_tier` required, C&A fields required for high tier. | S |
| FR-137 | Migrate SharePoint links on import; files lazily on first use. | S |
| NFR-040 | Evidence containers use a **locked** time-based immutability policy >= 7 years (version-level preferred, one container per fiscal year); legal hold action restricted to Legal/Compliance roles; blob versioning on; soft delete not relied upon for retention. Every evidence view/download is logged (who, when, IP, version) and Storage diagnostic logs go to Log Analytics. | M (policy, logging), C (legal-hold UI) |

---

## 12. Audit trail

| ID | Requirement | Pri |
|---|---|---|
| FR-140 | An append-only `audit_event` table shall capture: auth events and permission denials; role/delegation/SoD changes; template CRUD including every node/edge change; run lifecycle, task create/edit/reassign/status/date changes (offset and resolved date); all attestation events; evidence upload/view/download/void/scan/retention; comments and mentions; alerts fired and delivery status; exports; config changes (calendars, alert rules, thresholds, statements). | M |
| FR-141 | Event shape: event id, `occurred_at_utc` (server), `recorded_at_utc`, actor oid/UPN/display name, `on_behalf_of`, source IP, user agent, session id, correlation id, entity type/id, entity title snapshot, entity version before/after, action, before/after JSON, reason code, comment, app version, schema version. Actor is never null: automated jobs log a named service principal and trigger. | M |
| FR-142 | Activity survives deletion of its subject (title snapshot). Nothing user-facing is hard-deleted; only void/archive with actor, timestamp, reason; physical deletion only via the retention job. | M |
| FR-143 | Process-level exports equivalent to Workiva's Actions (plan of record), Status and Activity reports; task activity report; async export with a "View exports" tray for large ranges. | M |
| FR-144 | Ledger verification job (`sp_verify_database_ledger`) at least monthly and on demand, result logged and exposed as an auditor-visible report. | S (manual monthly), C (automated report) |
| NFR-050 | `audit_event` and `attestation` are Azure SQL **append-only ledger tables**; task/run state tables are updatable ledger or system-versioned temporal tables. Automatic digests written to an immutable blob container. If any audit data lands in Postgres/Lakebase, replicate with an HMAC hash chain (Key Vault HSM keys, versioned rotation). | M |
| NFR-051 | The app's SQL identity has no `UPDATE`/`DELETE` on audit/attestation tables; elevated access via PIM/JIT logged to Azure SQL Auditing -> Log Analytics. Client-supplied timestamps rejected. | M |
| NFR-052 | Audit and attestation records retained >= 7 years (SOX 802 / SEC 17a-4 posture; confirm against the bank's schedule) and queryable for current + 3 prior fiscal years. | M |

---

## 12A. Internal controls management

The controls pillar reuses everything above: tasks, dependencies, calendars, attestations, evidence, audit trail. What it adds is a small master-data layer (controls, risks, accounts, processes), typed tasks with completion validators, an issue log, and certification campaigns. The regulatory driver is FDICIA Part 363 (management's annual ICFR report; the ICFR *audit* threshold is $5B total assets from 1 January 2026 and inflation-indexed thereafter, so the applicable regime is stored as a data attribute, never hard-coded) together with SOX 302/404 for the holding company. Scope at MVP is ICFR; regulatory-reporting, BSA/AML and model-risk controls are a data question (framework tag), not a new module.

**MVP vs deferred, stated once.** MVP: controls library, control-to-node mapping, `CONTROL_PERFORMANCE` with evidence + independent reviewer, SoD performer ≠ reviewer, control calendar, tags. v1: associations and derived RCM, coverage heat map, issue log and `REMEDIATION`, thin `CONTROL_TEST` (result + workpaper link), certification campaigns and roll-up, SOC 1 reliance flag + CUECs, scoped auditor access, readiness and aging views. Later / deferred: full test-plan and sampling engine; narrative auto-propagation (stale flag only); SOC 1 beyond flag + CUEC list; MRA/MRIA linkage. Won't: risk quantification, multi-framework mapping engines, policy management, vendor risk, continuous-controls monitoring.

### 12A.1 Controls library and associations

| ID | Requirement | Pri |
|---|---|---|
| FR-IC-01 | The system shall maintain a versioned, effective-dated controls library with no destructive edits (`PROPOSED -> ACTIVE -> RETIRED`; editing an active control creates a new version with `effective_from`). Attributes: control ID, title, description, control objective; placement (legal entity, process/subprocess, cycle, location, system); classification (key / non-key; preventive / detective; manual / automated / IT-dependent manual; ITGC / business-process / entity-level; frequency `PER_OCCURRENCE / DAILY / WEEKLY / MONTHLY / QUARTERLY / ANNUAL / AD_HOC`); assertions covered (existence/occurrence, completeness, accuracy/valuation, cutoff, presentation & disclosure, rights & obligations); people (control owner, default performer, default reviewer, tester, executive owner); evidence expectation (artifact description, retention class); framework mapping (COSO component/principle; COBIT for ITGCs; applicable regime tags e.g. `SOX_404`, `FDICIA_363`); last-reviewed date. | M (core identity, placement, classification, people, evidence expectation); S (assertions, framework mapping) |
| FR-IC-02 | Many-to-many associations `Risk ⟷ Control`, `Control ⟷ Process/Subprocess`, `Risk ⟷ Significant Account (FSLI)`, and optionally `Control ⟷ Account`, each carrying a coverage judgment; `Risk` carries inherent/residual rating (likelihood × impact). The RCM shall be generated from these joins plus the selected period's performance and test state, filterable by entity, process, account, framework and key/non-key, and exportable to XLSX with an IPE header. | S |
| FR-IC-15 | Category/value tags (FR-022, `tag` table) shall apply to controls, risks, issues and certification assignments as well as tasks, and be the reporting pivot dimension (entity, region, cycle, FSLI, FR Y-9C line, framework). | M |
| FR-IC-16 | A control flagged `soc1_reliance` shall record service organisation, report type and period, opinion, bridge-letter date and the CUECs relied on; each CUEC shall be instantiable as a control in the library linked back to the SOC 1 record. No further SOC 1 workflow. | S (flag, CUEC list); C (bridge-letter tracking) |
| FR-IC-18 | Narratives and walkthrough documents are external files (Blob evidence or SharePoint link) that cite controls by ID. The system shall show "cited by" on a control and raise a `narrative_stale` flag on each citing document when the control's description or objective changes. Auto-propagation of text into narratives is out of scope. | C |
| FR-IC-19 | Controls library import shall reuse the checklist importer (FR-170): sheet/column mapping, dry run, per-row disposition, idempotent upsert on control ID, provenance. Migration of the existing Excel RCM is a Phase 1 deliverable for the pilot area. | M |

### 12A.2 Control performance, testing and segregation of duties

| ID | Requirement | Pri |
|---|---|---|
| FR-IC-03 | Task types `PLAIN, CONTROL_PERFORMANCE, CONTROL_TEST, CERTIFICATION, EVIDENCE_REQUEST, REMEDIATION` run on the single scheduling, dependency, alerting and evidence engine. A type is a payload schema (Zod-validated JSON) plus a server-side completion validator (table in section 5); the react-flow designer, CPM engine, alert sweep and dashboards contain no type-specific branches beyond rendering. | M |
| FR-IC-04 | A `CONTROL_PERFORMANCE` task shall carry `control_id` (resolved to the control version in force at instantiation), the control's evidence spec, a performer and a required reviewer. It shall not reach `COMPLETE` without (a) the evidence spec satisfied by scan-clean evidence, (b) a reviewer attestation by a principal other than the performer. Completion writes an immutable `control_performance` record binding control version, period, performer, reviewer attestation id and evidence hashes. Evidence cannot be swapped after submit (FR-134). Per-control frequency drives how many performance instances a period generates (daily/weekly controls fan out; annual controls appear only in the year-end variant). | M |
| FR-IC-05 | Segregation of duties, enforced in the domain layer and checked at sign time as well as assignment time: performer ≠ reviewer on a control performance; tester ≠ control owner and ≠ performer; a certifier shall not approve a response in their own upstream cascade chain; extends FR-007's preparer/reviewer/approver rule. Every violation attempt is logged. Overrides require a compensating-control justification, approval by the control owner (or program owner when the control owner is the conflicted party), and appear on the standing SoD-exceptions report. | M (performer ≠ reviewer, hard); S (tester and certifier rules, override path) |
| FR-IC-06 | Roll-forward (FR-045) shall additionally regenerate control performance instances for the new period from the control versions effective on the period end date, carry forward open issues and their `REMEDIATION` tasks, and include in the prior-period summary: control performances late, completed without on-time review, waived, and tests with exceptions. | M (regenerate); S (issue carry-forward, extended summary) |
| FR-IC-07 | Just-in-time evidence rights (Workiva content-request pattern): the assignee of an `EVIDENCE_REQUEST` or `CONTROL_PERFORMANCE` task may attach/replace evidence until Submit; on Submit the uploader's rights drop to read-only and the reviewer gains view; on Return, edit rights are restored and a new evidence version is required. | M |
| FR-IC-08 | Derived flags (on-time, late, delayed, at-risk, blocked upstream, `control_at_risk`, `evidence_incomplete`, `sod_conflict`) shall be persisted separately from canonical lifecycle status and never hand-set (restates FR-061 for control objects; also applies to issues and certification assignments). | M |
| FR-IC-09 | When an upstream slip exceeds free float (FR-075), the impact preview (FR-077) shall additionally return the downstream `CONTROL_PERFORMANCE` and `CERTIFICATION` tasks now forecast to miss their due date, set `control_at_risk` on them, and raise `CONTROL_AT_RISK` to the control owner and the program owner (added to the section 8 event catalogue; immediate for key controls, digest otherwise). | M (flag); S (alert) |
| FR-IC-10 | `CONTROL_TEST`, MVP-thin: one `test_result` per control per test cycle with test type (`TOD / TOE / WALKTHROUGH`), conclusion (`EFFECTIVE / EXCEPTION / NOT_TESTED / DESIGN_INEFFECTIVE`), tester, dates, workpaper reference (link or evidence), and notes. **Deferred:** `test_plan` (steps, population definition, sampling method), frequency-derived default sample sizes (annual 1 / quarterly 2 / monthly 5 / weekly 15-25 / daily 25-60, overridable with rationale), and per-sample pass/fail rows; build only if testing moves in-house from Internal Audit or the co-source firm. A `DESIGN_INEFFECTIVE` conclusion marks TOE moot for the cycle. | S (thin result); C (plan and sampling) |

### 12A.3 Issues, deficiencies and remediation

| ID | Requirement | Pri |
|---|---|---|
| FR-IC-11 | Issue log: source (`TEST_EXCEPTION / SELF_IDENTIFIED / INTERNAL_AUDIT / EXTERNAL_AUDIT / EXAM / CERTIFICATION_EXCEPTION`), linked control(s) and account(s), description, root cause, severity ladder `DEFICIENCY -> SIGNIFICANT_DEFICIENCY -> MATERIAL_WEAKNESS` with severity-change history and rationale, compensating controls, remediation owner, target date (business-day offset or absolute, calendar-resolved), status (`OPEN / IN_REMEDIATION / AWAITING_RETEST / CLOSED / ACCEPTED_RISK`), retest result, closure approver. A failed test or an exception answer creates an issue in one click with the linkage prefilled. Severity changes and closure require program-owner approval. Aggregation (deficiencies evaluated in combination by account/assertion) is a report, not an automatic classification. | S |
| FR-IC-11a | Remediation work is a `REMEDIATION` task linked to the issue: it schedules like any task (owner, due date, dependencies, evidence), and its completion validator requires either a passing retest recorded on the issue or a documented closure approval. Issues past target date appear on the issue-aging view and escalate via the section 8 ladder to the program owner. | S |
| FR-IC-11b | Examiner findings (MRA/MRIA) may be recorded as issues with `source = EXAM` and an external reference; no separate exam-management workflow. | C |

### 12A.4 Certifications

| ID | Requirement | Pri |
|---|---|---|
| FR-IC-12 | Certification campaigns: `CertificationCampaign` (period, framework, opens/closes on BD offsets, owner) instantiates one `CERTIFICATION` task per assignment from a versioned `certification_template` (statements, structured questions with expected answers, attachments, e.g. SOX 302 sub-certification, FDICIA management representation). A configurable roll-up cascade (assignment -> parent certifier -> ... -> 302 signers) is a set of dependency edges generated from the org/entity hierarchy, so a parent certification is `BLOCKED_UPSTREAM` until its children are signed. Completion is an attestation (FR-120 type `certified`) with `attestation_response` rows; bulk fan-out to a group with one approval contact reuses FR-127. | S (campaign, template, cascade); C (bulk fan-out) |
| FR-IC-13 | An exception answer (answer ≠ expected) on a certification response shall, per template configuration, auto-create a linked issue (`source = CERTIFICATION_EXCEPTION`) assigned to the program owner, and surface on the certification readiness view. | S |
| FR-IC-12a | Certification status report: per campaign, assignments by status (not started / in progress / signed / returned / overdue), exceptions, signers, timestamps; exportable and included in the period package (DR-IC-03). | S |

### 12A.5 Auditor and examiner access

| ID | Requirement | Pri |
|---|---|---|
| FR-IC-14 | A scoped, time-boxed read-only auditor / examiner role: the `Auditor` app role provisioned to Entra B2B guests via entitlement-management access packages (FR-012), scope bounded by entity, process/workflow set and **period range**; read access to controls, RCM, control performances, test results, issues, certifications, evidence and audit trail within scope; no visibility of draft templates, other entities, or in-flight future periods; every evidence view/download logged (NFR-040). A request list (auditor asks, control owner responds with a link to the object) may be added later. | S (role and scope); C (request list) |
| FR-IC-17 | Per-user notification preferences (FR-090) shall include mute-by-workflow and mute-by-campaign; `CONTROL_AT_RISK` and certification overdue events follow the same digest/immediate rules as section 8. | S |

### 12A.6 Data requirements

| ID | Requirement | Pri |
|---|---|---|
| DR-IC-01 | Evidence for control performances, test results and certification responses uses the same `evidence` and `evidence_link` tables (FR-130-FR-134): SHA-256, immutable versioning, append-only links. No control object stores a file path. | M |
| DR-IC-02 | Every state transition on controls, risks, associations, control performances, test results, issues, certification campaigns/assignments and templates appends an `audit_event` (FR-140/141) with before/after and reason where required. | M |
| DR-IC-03 | Attestations and control performances shall be exportable per period and per control as a package (PDF binder + manifest + evidence ZIP, FR-160) that is independently verifiable against the ledger digest. | S |
| DR-IC-04 | Controls, risks, associations, certification templates and statements are effective-dated and versioned; a run resolves each control reference to the version in force on the period end date and stores that version id; historical periods always render against it (extends DR-003). | M |
| DR-IC-05 | Calendars are first-class entities referenced by runs, certification campaigns and issue target dates (restates FR-080 for control objects). | M |
| DR-IC-06 | Retention is policy-driven per record class (7 years default for ICFR evidence and control performances; confirm against the bank's schedule); deletion is a retention job, never a user action (extends DR-004). | S |
| DR-IC-07 | The RCM, coverage heat map and certification roll-up are derived views (SQL views or reporting queries) over the association and performance tables; no stored matrix of record. | S |

---

## 13. Dashboards and reporting

One task table, many saved lenses: a single server-side query/filter/column engine; only the canvas, critical-path view and executive rollup need bespoke rendering.

| ID | Requirement | Pri |
|---|---|---|
| FR-150 | **My Tasks**: grouped Overdue / Due today / Due this period / Awaiting my review / Blocked (not my fault) / Upcoming with inline Start, Complete, Attach, Sign off. Default landing view for Contributors. A blocked task shows the upstream task, owner, due date, lateness and a one-click nudge. | M |
| FR-151 | **Close Status Board**: BD-column board or team x BD matrix with KPI header (% complete, due today, late, at-risk, blocked, awaiting sign-off, projected close date vs target); filters by entity, team, process, owner, tag, risk; bulk nudge. | M |
| FR-152 | **Dependency view** in two synchronised renderings: the canvas with live status colouring and highlighted critical path, and a Gantt/timeline with BD gridlines, holiday shading and dependency arrows. Impact preview on any node. | M (canvas), M (Gantt-lite), S (full Gantt) |
| FR-153 | **Sign-off completeness** and **evidence completeness** views (evidence completeness % = tasks with all required evidence / tasks requiring evidence). | S |
| FR-154 | **Aging / bottleneck**: BD-past-due buckets, time-in-status distributions, handoff latency (`submitted -> review claimed`, `upstream complete -> downstream started`), downstream fan-out. | S |
| FR-155 | **Executive / portfolio** (Power BI): days-to-close trend, on-time % per period, % late by team split into self-late vs blocked-late, burnup by BD across periods, reopen rate, first-pass sign-off rate, escalations, evidence completeness. | C |
| FR-156 | Metric definitions: days to close = **business days** from BD0 to the timestamp of one versioned gating task (the APQC ~4.8-calendar-day benchmark cited in intent §6 is a conversion reference only, not the unit of measure); on-time measured against **baseline** due date with current due shown separately; completion = terminal state of the task type; waived tasks excluded from denominators with waiver count reported; median + p90 for cycle times, never mean. Each metric has exactly one implementation shared by app and BI plus a user-visible data dictionary. | M (definitions), S (dictionary) |
| FR-157 | Live status colouring is colourblind-safe: colour paired with icon/shape and text status. MiniMap with status colours. | M |
| FR-158 | Saved and shared named views; `Is currently` vs `is ever` assignee filter operators. | S |
| FR-159 | Operational views read live from Azure SQL; cross-period/entity analytics served from Databricks (Lakeflow Connect CDC of Azure SQL -> Delta; nightly `fact_task_daily` snapshot) with Power BI embedded via Entra pass-through, RLS by entity/team, and an explicit "data as of" stamp. Enable CDC/Change Tracking on Azure SQL from day one. MVP fallback: Power BI over read-only reporting views. | C (embed), M (CDC enabled) |
| FR-160 | Control evidence package per task (PDF binder: identity, procedures, BD and resolved dates, sign-off chain, comments, evidence manifest with hashes, audit timeline; footered with generation hash) and sample-based export (population + sample, CSV/XLSX + ZIP of evidence + manifest) with IPE header (query parameters, row count, timestamp, extracting user). Exam package per process and period. | S (per-task binder), C (sample portal) |
| FR-161 | Standing control reports: sign-off status by period; on-time vs BD; items completed after close; reopened items and justifications; SoD overrides; delegate signings; evidence missing; evidence changed after sign-off; signing-authority population changes; dependency invalidations; control performances completed without independent review; controls with no performance instance in a period where frequency required one. | S |
| FR-162 | **Control calendar**: all control performances, tests and certification assignments due in the next N business days by owner, entity and key/non-key, with the same inline actions as My Tasks. | M |
| FR-163 | **Coverage heat map**: significant account -> risks -> controls -> this period's performance and test status; blanks are gaps; filter by entity, process, framework; drill to the control and its task. | S |
| FR-164 | **Dependency impact on controls and certifications**: from any task or the canvas, the transitive downstream set restricted to `CONTROL_PERFORMANCE` and `CERTIFICATION` tasks with projected BD shift, control key/non-key, and owners; the same impact-preview service as FR-077. | S |
| FR-165 | **Certification readiness**: per campaign, roll-up tree with signed / outstanding / returned / overdue per node, open exceptions, and the blocking children of each unsigned parent. | S |
| FR-166 | **Issue aging**: open issues by severity, source and owner; days past target remediation date; retest backlog; severity-change history. | S |

---

## 14. Integrations

| ID | Requirement | Pri |
|---|---|---|
| FR-170 | **Excel/CSV checklist importer**: file -> map -> validate (dry run) -> commit. Sheet picker (visible and hidden sheets with row counts), header row and range selection, auto-suggested column mapping with override and saved presets, forward-fill of vertically merged cells, banner-row detection, per-row disposition (`create/update/skip/error`) with downloadable error report, idempotent upsert on `(template_id, external_ref)` with diff and explicit confirmation before deactivation, transactional `import_batch` with rollback, provenance (`source_file, source_sheet, source_row, import_batch_id`) on every task. | M |
| FR-171 | BD offsets parsed from a permissive grammar (`BD+3, BD3, WD+3, Day 3, +3, BD-1, T+2`); absolute dates converted to offsets against that period's calendar and shown for confirmation, never silently. | M |
| FR-172 | Dependency prose is never auto-converted. Rows matching cues (`after, once, following, depends, upon receipt, hold until, pending, when ... completes`, or another row's Task ID) go to a **Dependency candidates** review queue proposing `A -> B` for one-click accept/reject. Optional LLM reranking of header mapping and candidate extraction as suggestions with confidence, logged with accept/reject, only after model-risk/InfoSec clearance; fuzzy matching ships first. | M (queue), C (LLM) |
| FR-173 | Multi-tab/entity import: import one tab as canonical, diff the others, present a reconciliation UI ("3 tasks exist only in Nashville: entity-specific or drift?"). Post-import "split row" affordance. | S |
| FR-174 | Entra ID: Auth.js v5 with the Microsoft Entra ID provider for sign-in; MSAL / `@azure/identity` client-credentials in the Functions app for Graph (mail, manager lookup, user photos). | M |
| FR-175 | Microsoft Graph `Mail.Send` scoped by application access policy to one shared mailbox; Teams via Power Automate Workflows; Teams notification bot with proactive 1:1 actionable cards later. | M (mail, Workflows), C (bot) |
| FR-176 | Deep links: every email, card and inbox item links to the exact task; a token-scoped task page for outside-finance contributors that needs no navigation through the wider app. | M |
| FR-177 | Holiday sync from a maintained source (`@18f/us-federal-holidays` preferred to avoid CC BY-SA data; `date-holidays` requires legal review) with in-app override. | S |
| FR-178 | Inbound API for upstream systems (GL, reg-reporting tools) to auto-complete `input` tasks. | C |
| FR-179 | Won't: reconciliation automation, ERP balance ingestion, flux analysis, XBRL/SEC filing, BPMN gateways, document authoring, .ics subscription polling. | W |

---

## 15. Proposed data model

Azure SQL; PKs `UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID()`; text as `NVARCHAR`; JSON in `NVARCHAR(MAX)` with `CHECK (ISJSON(col)=1)` and Zod validation (Prisma has no `Json` type on SQL Server); instants as `DATETIMEOFFSET` UTC, dates as `DATE`. Business tables system-versioned temporal unless noted; `audit_event` and `attestation` are append-only ledger tables.

| Table | Key columns | Notes |
|---|---|---|
| `workflow_template` | id, name, description, category, owner_group_id, status, current_version_id, created_by, created_at | |
| `template_version` | id, template_id, version_no, status (DRAFT/PUBLISHED/ARCHIVED), graph_hash, change_note, published_by, published_at, approved_by, edit_lease_holder, edit_lease_expires_at, rowversion | Immutable once published |
| `template_node` | id, version_id, node_key, node_type, title, description, lane_id, owner_role_id, default_assignee_user_id, category, external_ref, control_id, offset_kind, offset_anchor, offset_n, calendar_id, due_time, duration_bd, evidence_required, requires_approval, review_policy, period_types, entity_scope, system_of_record, criticality, topo_rank, layout_json | `layout_json` holds only x/y/w/h |
| `template_edge` | id, version_id, source_node_key, source_handle, target_node_key, target_handle, dep_type, lag_bd, hard, alert_on_slip, handoff | |
| `template_lane` | id, version_id, team_id, label, sort_order | |
| `tag` / `entity_tag` | category, value; (entity_type, entity_id, tag_id) | Category/value pairs |
| `calendar` | id, code, name, timezone, workweek_mask, version_no | Versioned |
| `holiday` | calendar_id, date, name, source | |
| `business_day` | calendar_id, date (clustered), is_business_day, bd_from_month_start, bd_from_month_end, bd_from_quarter_end, month_end_date, quarter_end_date | Materialized ~10 years |
| `period` | id, period_type, period_start, period_end, label, fiscal_year | |
| `legal_entity` | id, code, name, parent_id, is_active | Post-merger dual entities |
| `run` | id, template_version_id, period_id, entity_id, calendar_version_id, name, status (OPEN/SOFT_CLOSED/HARD_CLOSED/CANCELLED), process_manager_user_id, opened_at, opened_by, closed_at, target_completion_date, rowversion | |
| `task` | id, run_id, template_node_id, external_ref, title, description, entity_id, control_id, control_version_id, task_type, type_payload_json, lifecycle_status, timeliness_status, status_computed_at, baseline_due_at, planned_due_at, forecast_start_at, forecast_finish_at, actual_start_at, actual_finish_at, duration_bd, es, ef, ls, lf, total_float_bd, free_float_bd, is_critical, slip_bd, blocked_reason, stop_reason, evidence_required, review_policy, control_at_risk (bit), evidence_incomplete (bit), sod_conflict (bit), owner_inactive (bit), source_file, source_sheet, source_row, import_batch_id (nullable provenance, FR-011 / section 5 derived flags / importer), task_version, rowversion | Indexes: (run_id, lifecycle_status), (assignee, timeliness_status) |
| `task_role_assignment` | id, task_id, principal_type (USER/GROUP), principal_id, role (OWNER/PREPARER/REVIEWER/APPROVER/WATCHER), is_backup, claimed_by, assigned_at, assigned_by, reason_code | Exactly one OWNER enforced |
| `checklist_item` | id, task_id, title, owner_user_id, is_required, is_done, done_at, done_by, evidence_id, rowversion | |
| `dependency` | id, run_id, predecessor_task_id, successor_task_id, dep_type, lag_bd, hard, alert_on_slip, is_satisfied, override_reason | Indexes both directions; cross-run allowed |
| `attestation` | id, task_id, task_version, run_id, period_id, template_version_id, signer_oid, signer_upn, signer_display_name, role_at_signing, delegated_from_oid, attestation_type, statement_id, statement_version, statement_text_snapshot, signed_at_utc, signed_at_local, tz, source_ip, user_agent, session_id, auth_method, amr, acrs, auth_time, content_hash, comment, superseded_by_id | Append-only ledger |
| `attestation_statement` | id, code, version, text, effective_from, created_by | Versioned; never mutated |
| `attestation_evidence` | attestation_id, evidence_id, sha256_at_signing | |
| `attestation_response` | attestation_id, question_id, answer, explanation | Certification questions |
| `evidence` | id, uploaded_by, original_filename, content_type, size_bytes, blob_container, blob_path, blob_version_id, sha256, scan_status, scanned_at, version_no, superseded_by_id, ipe_source_system, ipe_report_name, ipe_parameters, ipe_run_at, ipe_run_by, ipe_risk_tier, ipe_ca_check, legal_hold_case_id, retention_class, uploaded_at | Never hard-deleted |
| `evidence_link` | evidence_id, entity_type, entity_id, task_version, linked_at, linked_by | Many-to-many, append-only |
| `comment` | id, task_id, evidence_id, attestation_id, author_id, body, parent_id, revision_of_id, mentions_json, created_at, deleted_at, delete_reason | Append-only revisions |
| `alert` | id, run_id, task_id, alert_type, severity, dedup_key (unique filtered), triggered_at, upstream_task_id, root_cause_task_id, projected_impact_bd, status (PENDING/SENT/SUPPRESSED/FAILED), suppressed_reason, acknowledged_at, committed_date | |
| `notification` | id, alert_id, recipient_user_id, channel, event_type, payload_json, sent_at, provider_message_id, delivery_status, opened_at, clicked_at, error | |
| `notification_preference` | user_id, event_type, channel, mode, digest_schedule, quiet_start, quiet_end, timezone, close_week_override, min_severity, process_id | |
| `escalation` | id, task_id, tier, fired_at, recipients_json, resolved_at, paused_until | |
| `delegation` | id, delegator_oid, delegate_oid, scope_json, includes_attestation, effective_from, effective_to, granted_by | |
| `app_user` | id, entra_oid, upn, display_name, email, department, manager_user_id, is_active, deactivated_at | Tombstoned, never deleted |
| `role_assignment` | user_or_group_id, app_role, scope_entity_id, scope_department_id, scope_workflow_id, period_from, period_to | Period bounds for external auditors |
| `audit_event` | id, occurred_at_utc, recorded_at_utc, actor_oid, actor_upn, actor_display_name, on_behalf_of_oid, source_ip, user_agent, session_id, correlation_id, entity_type, entity_id, entity_title_snapshot, entity_version_before, entity_version_after, action, before_json, after_json, reason_code, comment, app_version, schema_version | Append-only ledger |
| `import_batch` / `import_row` | file_hash, filename, sheet, user, mapping_preset_id, committed_at; row_no, disposition, task_id, raw_json | Provenance |
| `export_job` | id, requested_by, params_json, row_count, status, blob_path, created_at | "View exports" tray |
| `saved_view` | id, owner_user_id, name, scope_json, filter_json, shared_with_json, created_at, updated_at | Backs FR-158 saved and shared named views |

Internal controls tables (all system-versioned temporal; `control_performance` and `test_result` are append-only ledger):

| Table | Key columns | Notes |
|---|---|---|
| `control` | id, control_code, version_no, status (PROPOSED/ACTIVE/RETIRED), title, description, objective, entity_id, process_id, subprocess_id, cycle, location, system, is_key, nature (PREVENTIVE/DETECTIVE), mode (MANUAL/AUTOMATED/IT_DEPENDENT_MANUAL), category (ITGC/BUSINESS_PROCESS/ENTITY_LEVEL), frequency, assertions_json, evidence_expectation, retention_class, framework_json, regime_tags_json, soc1_reliance, soc1_report_id, effective_from, effective_to, last_reviewed_at, created_by, rowversion | Versioned; never mutated once superseded |
| `control_role_assignment` | control_id, principal_type, principal_id, role (OWNER/PERFORMER/REVIEWER/TESTER/EXECUTIVE_OWNER), assigned_at, assigned_by | Exactly one OWNER |
| `risk` | id, code, title, description, process_id, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact, effective_from, effective_to | |
| `process` | id, code, name, parent_id, owner_group_id | Process / subprocess hierarchy |
| `significant_account` | id, code, name, fsli, fr_y9c_line, entity_id, is_significant, materiality_basis | |
| `risk_control` / `control_process` / `risk_account` / `control_account` | (risk_id, control_id, coverage) / (control_id, process_id) / (risk_id, account_id) / (control_id, account_id) | Association tables; RCM is a view over them |
| `control_performance` | id, control_id, control_version_id, task_id, run_id, period_id, entity_id, performer_oid, reviewer_attestation_id, evidence_manifest_json, completed_at, outcome (PERFORMED/EXCEPTION/WAIVED), waiver_reason | Append-only ledger |
| `test_result` | id, control_id, control_version_id, test_cycle, test_type (TOD/TOE/WALKTHROUGH), conclusion, tester_oid, tested_at, workpaper_ref, evidence_id, notes, task_id | Append-only; `test_plan` / `sample_item` deferred |
| `soc1_report` | id, service_org, report_type, period_start, period_end, opinion, bridge_letter_date, evidence_id | |
| `cuec` | id, soc1_report_id, description, control_id | CUEC instantiated as a control |
| `issue` | id, source, external_ref, title, description, root_cause, severity, severity_history_json, compensating_controls, remediation_owner_id, target_date, status, retest_result, retest_at, closed_by, closed_at, closure_reason, opened_from_test_result_id, opened_from_attestation_response_id, rowversion | |
| `issue_control` / `issue_account` | (issue_id, control_id) / (issue_id, account_id) | |
| `certification_template` | id, code, version, framework, statement_id, questions_json, attachments_json, effective_from | Versioned |
| `certification_campaign` | id, period_id, framework, template_id, name, opens_offset, closes_offset, calendar_id, owner_id, status | |
| `certification_assignment` | id, campaign_id, task_id, certifier_principal_id, parent_assignment_id, entity_id, process_id, status | Roll-up tree; edges also materialised as `dependency` rows |
| `narrative_citation` | narrative_evidence_id, control_id, cited_version_id, is_stale | For FR-IC-18 |

| ID | Requirement | Pri |
|---|---|---|
| DR-001 | The normalized relational model above is the source of truth; the react-flow JSON blob is never the system of record. Serialization strips `selected`, `dragging`, `measured`, `resizing` and viewport. | M |
| DR-002 | Business-critical fields (due dates, owners, status, thresholds, edges, statements) store before/after values on change. | M |
| DR-003 | Calendars, templates, statements and controls are effective-dated and versioned; historical periods always render against the versions in force at the time. | M |
| DR-004 | Retention schedule per record class (default 7 years from period close), disposition as a reviewed, logged job that skips legal holds. | S |
| DR-005 | CDC/Change Tracking enabled on Azure SQL from day one for Lakeflow replication. | M |

---

## 16. Architecture summary (Azure)

- **Frontend/app tier:** Single Next.js (App Router) app, `output: 'standalone'`, Node 20/22 LTS, deployed as Linux Azure App Service Premium v3 (min 2 instances) with VNet integration and private endpoints to SQL and Storage; route handlers and server actions for the interactive API. Azure Container Apps is an acceptable substitute if the Mosaic AI hub is container-centric. Azure Static Web Apps is not suitable.
- **Background tier:** Separate Azure Functions (Node, Flex Consumption) app: `recalcSchedules` (timer 15 min + queue), `evaluateAlerts` (hourly business hours), `dispatchNotification` (Service Bus queue), `rollForward` (queue), `syncHolidays` (monthly). No scheduled work in the web tier. App Service WebJobs not used.
- **Messaging:** Azure Service Bus (Standard; Premium if private endpoints mandated) for duplicate detection, sessions, scheduled messages, dead-lettering and topics for channel fan-out.
- **Data:** Azure SQL Database as system of record (ledger + temporal tables, Entra-only auth, TDE, auditing to Log Analytics, failover group). Prisma with `@prisma/adapter-mssql` for MVP, managed identity validated in a week-1 spike (fallback Drizzle or AAD token injection); graph traversal and schedule recalculation in raw parameterized SQL / stored procedures. Databricks downstream via Lakeflow Connect CDC to Delta, serving Power BI. Lakebase revisited only if lakehouse data must participate in dependency conditions.
- **Evidence:** Azure Blob, user-delegation SAS, versioning, locked immutability, Defender for Storage scanning, private endpoint, path `runs/{runId}/tasks/{taskId}/{evidenceId}/{filename}`.
- **Auth:** Auth.js v5 + Microsoft Entra ID provider; Entra app roles; MSAL/`@azure/identity` client credentials for Graph in Functions; user-assigned managed identities for all Azure-to-Azure calls; Key Vault for HMAC keys and any residual secrets.
- **Real-time:** SSE from Next.js with Service Bus topic fan-out across instances at MVP; Azure Web PubSub (+ Yjs) later.
- **Observability:** `@azure/monitor-opentelemetry` in both apps; custom metrics (late tasks by process, alert dispatch latency, recalc duration, sign-offs per period, upload failures); Azure Monitor alert on "schedule recalculation has not succeeded in 60 minutes"; `runId`/`taskId` as span attributes.

| ID | Requirement | Pri |
|---|---|---|
| NFR-060 | Interactive views for the current period load in < 2 s at p95 with 500 open tasks per run and 20 concurrent close-week users; run subgraph recompute < 1 s for 500 nodes. | M |
| NFR-061 | Availability target 99.5% during business hours; RPO 15 min, RTO 4 h; backup/restore tested annually; DR documented. | S |
| NFR-062 | Job outcomes for roll-forward, recalculation, alerting and malware-scan pipelines logged and monitored; a silently failed alert job is treated as a control failure. | M |
| NFR-063 | Async export for anything larger than a single period; no synchronous CSV over 12 months of audit trail. | M |

---

## 17. Security and compliance

| ID | Requirement | Pri |
|---|---|---|
| NFR-070 | Entra SSO + MFA + Conditional Access; server-side RBAC on every endpoint; no shared accounts; PIM/JIT for admin; automated deprovisioning via group membership. | M |
| NFR-071 | Change management: source control, PR review with second approver, separated dev/test/prod, no developer write access to prod data, release approvals recorded, `app_version` stamped on every audit event. | M |
| NFR-072 | Config that changes control operation (calendars, offsets, alert thresholds, statements) is approver-gated, versioned, effective-dated and logged with before/after. | S |
| NFR-073 | Encryption at rest (customer-managed keys if bank standard requires), TLS 1.2+, blob public access disabled, evidence access always brokered by the app via short-lived SAS. | M |
| NFR-074 | Register the application with the bank's application inventory / EUC process; it is in SOX/FDICIA ITGC scope from day one. | M |
| NFR-075 | OSS licence review: MIT/Apache only by default; `elkjs` (EPL/GPL dual), n8n (Sustainable Use), Windmill (AGPL), bpmn-js (watermark clause) not vendored; `date-holidays` data (CC BY-SA) needs attribution review. | M |
| NFR-076 | Accessibility: WCAG 2.1 AA; status never conveyed by hue alone. | M |
| NFR-077 | No workbook content sent to any model endpoint until model-risk/InfoSec clearance; every AI suggestion logged with accept/reject and the accepting user. | M |

---

## 18. Rollout plan (summary)

Phase 0 discovery and inventory (2 weeks; baseline metrics, name the finance product owner and the SOX/FDICIA program owner, collect workbooks, the Excel RCM, the holiday/statutory deadline set, and the current sub-certification letters; settle the Part 363 / 302 scope questions in section 19) -> Phase 1 import and template build for the pilot area (3 weeks; dependency-candidate workshop creates the graph; control-to-node mapping workshop imports the pilot area's controls and marks the nodes that *are* controls) -> Phase 2 parallel run for exactly one close cycle with the tool as system of record, the spreadsheet read-only, and the pilot area's key controls performed as `CONTROL_PERFORMANCE` tasks with independent review -> Phase 3 cutover and expansion (archive the workbook and the pilot area's RCM tab the day the owner signs the retire note; onboard 2-3 areas per cycle; add the Call Report template and cross-workflow edges; enable downstream alerting once the graph is trusted; stand up associations, the derived RCM, the issue log and the first quarterly certification campaign in the tool, run in parallel with the existing letter process for one quarter) -> Phase 4 steady state (quarterly template and controls-library review, orphaned-owner report, audit walkthrough, auditor access package issued for the year-end audit). Seed three to five templates, not one and not thirty. Cutover criteria: >= 95% of pilot tasks owner-verified, every asserted dependency modeled or waived, every in-scope key control for the pilot area mapped to a node or explicitly out of scope, zero P1 defects, calendar validated for the actual period, sign-off and evidence exercised by every pilot user, Internal Audit has reviewed the SoD rule set.

---

## 19. Open questions for Alex

1. **BD convention and cutoff.** Confirm `BD+1` = first business day after period end, and the default cutoff time (17:00?) and timezone (Eastern? any Central teams?).
2. **Hard vs advisory gates, and branching.** Should a `hard` edge physically prevent starting/completing the downstream task, or warn and require an override reason? Recommendation: advisory by default, hard per edge for control-critical steps. Does the designer need *conditional* branching, or is DAG edges plus group ordering (Workiva's all-at-once / one-at-a-time / manual) enough? Recommendation: no conditionals; use period-type applicability and `NOT_APPLICABLE`.
3. **Segregation of duties.** Hard block or warn-and-log for performer = reviewer, and for owner = tester? Are there one-person teams at subsidiaries needing a documented compensating-control override path? Who approves an override when the control owner is the conflicted party?
4. **Attestation and certification strength.** Is typed name bound to the Entra session with a freshness check sufficient for control sign-off, or does Internal Audit expect Conditional Access step-up (Entra P1)? Does the 302 sub-certification cascade need a legally meaningful e-signature ceremony (ESIGN intent-to-sign) or is authenticated click-through plus immutable log acceptable? Which letter and questions does the cascade use today, and who are the roll-up nodes?
5. **Regulatory scope.** Which reports are in scope for v1 (Call Report, FR Y-9C, FR Y-14, HMDA, CRA)? Does the bank have foreign offices (35-day Call Report rule)? Who owns the statutory deadline list?
6. **Entity, process and account master.** How many legal entities / ledgers are live post-merger? Is there an entity/process/significant-account master (GL, consolidation system, or the audit tool) to sync from, or does the tool own that hierarchy? This decides whether `process` and `significant_account` are synced or authored.
7. **Controls library and testing.** Where does the authoritative RCM live today (Excel, an internal audit tool, nothing)? Is control testing performed by Internal Audit or a co-source firm in a separate system, and if so does the tool ingest test results or only link to workpapers? Migration shape and whether `CONTROL_TEST` stays thin depend entirely on this.
8. **Evidence volume and retention.** Approximate artifacts per period and sizes (drives Blob tiering, the 250 MB cap, and whether Databricks is in the path for this dimension).
9. **Networking.** Will private endpoints prevent browser-direct SAS uploads from the corporate network? Who can confirm private DNS resolution for clients?
10. **Graph `Mail.Send` and Teams.** Who approves the application permission and the shared mailbox? Is Power Automate available to the finance team, and is a Teams bot registration feasible later?
11. **Hosting.** Is the Mosaic AI hub App Service or Container Apps? Node version available? Entra P1/P2 licensing?
12. **Databricks.** Is Lakeflow Connect for SQL Server licensed and is CDC on Azure SQL acceptable to the DBA team? Is Power BI embed licensed?
13. **AI assistance.** Is there model-risk/InfoSec clearance to send column headers and task text to a model endpoint for mapping and dependency-candidate suggestions?
14. **Pilot selection.** Which functional area, entity and close cycle is the pilot (20-50 tasks, real downstream dependents, willing senior owner, not the most deadline-critical path)?
15. **Retention.** Confirm the bank's records-retention schedule for close and ICFR evidence (7 years assumed) and whether legal hold must be self-service in v1.
16. **Support model.** Who is the named finance product owner and who supports the app in year 3?
17. **Part 363 / 404 posture.** Confirm the bank is above the (now inflation-indexed) $5B Part 363 ICFR audit threshold and a SOX 404(b) large accelerated filer post-merger. Above: external auditor read-only access and control-performance rigor are P0 for the year-end audit. Which fiscal year is the first combined-entity ICFR assertion, and does the integration period change the significant-account scope?
18. **Scope of "controls."** ICFR only at MVP, or also regulatory-reporting controls (Call Report / FR Y-9C), BSA/AML, and model risk (SR 11-7)? Each adds attributes and different owners; the framework is a tag, but the owners are people who need onboarding.
19. **Program ownership.** Who is the SOX/FDICIA program owner who approves SoD overrides, severity changes and issue closure, and is that the same person who owns the certification cascade?

---

## Sources consulted

All under `/home/claude/tracker-plan/research/`:

- `workiva.md` — Workiva Processes / IWM teardown: object model, start-order sequencing gap, business-day calendar, roll-forward, evidence, statuses, notifications, audit trail, attestation, concurrency, UX patterns to copy.
- `competitors.md` — BlackLine, FloQast, Trintech, Numeric, Vena, Redwood, HighRadius, Oracle Close Manager, Smartsheet/monday/Asana; feature matrix; table stakes vs differentiators.
- `scheduling.md` — BD offset grammar and convention, Fed holiday rules, regulatory calendar-day anchors, materialized business-day table, DAG persistence and cycle detection, CPM with negative float, status axes, alert catalogue and noise control, roll-forward pre-flight.
- `designer.md` — @xyflow/react v12 selection and licensing, node/edge model, cycle prevention, auto-layout, swimlanes, normalized persistence, run-mode canvas, collaboration options, OSS designers to borrow from, pitfalls.
- `controls.md` — SOX/FDICIA/FR Y-14 posture, attestation record fields, step-up auth, SoD, reopen/reject flows, ledger tables and HMAC chains, evidence ingest/scan/WORM/IPE, comments as records, auditor exports, ITGC.
- `internal-controls.md` — Workiva Processes and ICM solution inventory (object model, start-order sequencing, JIT permission choreography, roll-forward, tags as pivot), the standard SOX/FDICIA ICM object model (controls library attributes, RCM as a join, performance instances, testing, deficiencies, certification cascade), FDIC Part 363 $5B inflation-indexed threshold, task typing over one engine, coverage/calendar/impact/readiness/aging views, SoD rules, FR-IC / DR-IC requirement statements, table stakes vs deferred vs overkill, and the nine controls open questions merged into section 19.
- `architecture.md` — Next.js + Functions topology, Azure SQL vs Lakebase, Prisma vs Drizzle, Blob SAS, Auth.js vs MSAL, Service Bus, Graph mail and Teams Workflows, SSE vs Web PubSub/Yjs, observability, data model, phasing, risks.
- `excel-checklist-migration-and-adoption.md` — incumbent workbook anatomy, lossy mappings, importer spec, LLM-assisted mapping limits, template seeding, sub-workflow decomposition, pilot/parallel-run/cutover plan, success metrics.
- `personas-roles-and-permission-model.md` — persona inventory, RACI task-role model, concurrent-inputter mechanics, permission layers and matrix, Entra app roles, delegation, JML, access reviews.
- `dashboards-reporting-and-notification-ux.md` — view inventory, metric definitions and vanity metrics, in-app vs Power BI split, notification types/inbox/preferences, downstream-delay alert anatomy, actionable cards, escalation design.
