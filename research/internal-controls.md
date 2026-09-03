# Internal Controls Management (ICM) — Research for the Finance Workflow & Dependency Tracker

Scope: what Workiva actually ships in its **Processes** engine and **Internal Controls Management** solution, the standard SOX/FDICIA ICM object model as implemented by Workiva / AuditBoard / MetricStream / Diligent, and how to fuse controls into a workflow + dependency tracker without building a full GRC suite. Audience: internal build at a US regional commercial bank (Next.js/Node, Azure App Service, Azure SQL, Blob/Databricks).

---

## 1. Workiva Processes — concrete feature inventory

Workiva's `Process` is a **file type**, not a separate app: "A process is a Workiva file type that lets you design and automate workflows" ([Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)). It inherits generic file behavior — permissions, folders, copy, roll forward. That framing matters: Workiva got a lot of mileage by making the workflow object a first-class document living in the same permission/versioning substrate as the content it governs.

### 1.1 Object model (observed)

| Object | Key fields |
|---|---|
| **Process** | Name; **start order** (All at once / One at a time / Manual); **close method** (Automatic / Manual); permissions; Calendar config; certification settings |
| **Calendar** (on process) | First and last business day; typical working days; **exception dates** (holidays) |
| **Group** | Ordered container of actions with its own start order (all-at-once / one-at-a-time / manual) |
| **Action** (task) | *Required:* Title, Assigned to. *Optional:* Due date (**expressible as a business-day number**), assignee reminders, **Approval by**, approval due date, approver reminders, **File**, **Section within file**, Instructions, **Tags (category + value pairs)** |
| **Content request** | An action subtype: Title, Assignee, **target file + target section**; due date, approver, reminders, instructions, tags |
| **Certification action** | An action subtype pointing at a **certification letter** (text + questions + attachments), with signer and approver |
| **Certification letter / template** | Reusable letter; free text, questions, attachments; reused as template across cycles |

Source: [Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process), [Build a process with content requests](https://support.workiva.com/hc/en-us/articles/22930832119956-Build-a-process-with-content-requests), [Introduction to Certifications](https://support.workiva.com/hc/en-us/articles/13949910788244-Introduction-to-Certifications), [Build a process with certification actions](https://support.workiva.com/hc/en-us/articles/13887468169620-Build-a-process-with-certification-actions).

### 1.2 Dependency model — the important finding

Workiva does **not** implement a general DAG. Sequencing is expressed by **start order** at the process and group level: all-at-once (parallel), one-at-a-time (serial within the container), or manual (a human releases each action). Dependencies are therefore *structural* (nesting + ordering), not edge-based. Cross-process coupling is achieved indirectly through **Process References** — links between files that must be preserved on copy ("select Links and Process References to maintain all references to files in your process," [Roll forward a process](https://support.workiva.com/hc/en-us/articles/4401928366868-Roll-forward-a-process)).

Implication for Alex: a react-flow edge-based DAG is **more** expressive than the market leader here. Group + serial/parallel ordering is a proven-sufficient fallback and a good simplification target if DAG semantics get hairy; but true downstream dependency alerting (the stated must-have) is a genuine differentiator, not table stakes.

### 1.3 Statuses and lifecycle

Actions move through: not started → **sent** → in progress → **submitted** → **approved** or **returned** (rework) → complete; plus **canceled** and **deleted** (deleted actions are removed from status reports; canceled ones are retained). Processes are open → closed → reopenable. Approve/return is a two-party loop with email notification on each transition ([Approve or return a process task](https://support.workiva.com/hc/en-us/articles/22941262743444-Approve-or-return-a-process-task), [Monitor a process](https://support.workiva.com/hc/en-us/articles/360061603252-Monitor-a-process)).

Notably **"late" is a derived flag, not a status** — the roll-forward summary reports "late tasks, canceled tasks, and newly added tasks." Alex's scoped late/delayed/stopped statuses go beyond Workiva; keep them as *derived* attributes over a canonical lifecycle state rather than as members of the lifecycle enum, or the state machine explodes.

### 1.4 Permission choreography (worth copying)

Content requests do **just-in-time permission granting**: on start, the assignee gets edit rights to the target file *section*; on submit, rights drop to view-only; the approver gets viewer rights; on return, edit rights are restored. This is elegant and directly reusable for evidence upload: uploader can attach/replace until submitted, then the evidence freezes for the reviewer.

### 1.5 Roll forward

Roll forward = **copy the process file**. Settings and all actions come along; business-day-relative due dates **re-derive automatically** when the new calendar's first/last business day are set (which is why business days must be configured *before* the copy). A **Process copy summary** surfaces prior-run insights. Copying is allowed even while the source process is running, and is gated on Workspace Owner / Content Manager / Copy Manager roles.

Two design lessons: (a) store due dates as *relative business-day offsets against a named calendar*, never as absolute dates, so roll-forward is arithmetic rather than manual re-entry; (b) roll-forward should produce a **diff/insight report**, not just a clone.

### 1.6 Notifications

Email-driven, per-transition: assignment sent, edited (assignees and approvers notified; changing assignee or location **restarts** the action), submitted, returned, resubmitted, approved. Plus configurable **assignee reminders and approver reminders** per action. Work lands in a personal **Home > Tasks > To do** queue. Workiva's own community threads show notification granularity is a recurring pain point ([Processes and Certifications - notifications](https://support.workiva.com/hc/en-us/community/posts/30140416935572-Processes-and-Certifications-notifications)) — budget for per-user digest/mute preferences from day one.

### 1.7 Dashboards / reporting

Process tab: overview panel, at-a-glance progress charts, action list with status and due date. Cross-process: a Processes list filterable by status, sortable, searchable. Certifications get **real-time status reports, exportable separately** ([View and export certification reports](https://support.workiva.com/hc/en-us/articles/13949764934804-View-and-export-certification-reports)). Action **tags (category/value)** are the pivot dimension for reporting — this is how Workiva avoids hard-coding entity/process/region into the schema. Adopt tags; they are cheap and they are how you later slice by legal entity, FR Y-9C line, or business process.

### 1.8 The ICM solution layer

The [Internal Controls Management](https://www.workiva.com/solutions/internal-controls-management) product adds, on top of Processes: a **risk and control library** (importable or template-seeded), a **Risk Control Matrix (RCM) with linked narratives and flowcharts**, **narratives that auto-update when a control description changes** (single-source linking — Workiva's core trick), **one-click random sampling via single or bulk tasks**, automated evidence collection with O365 integration, **role-based permissioning for external auditor access**, dynamic dashboards, and built-in sign-off/certification. Regulatory framings called out: SOX, UK SOX, J-SOX, SCIIF, L262/05.

The two features to steal: **linked narrative ↔ control description** (kills the classic "walkthrough doc says one thing, RCM says another" audit finding) and **auditor-scoped read-only roles**.

---

## 2. The standard ICM object model

Synthesized across Workiva, AuditBoard, MetricStream, Diligent and standard SOX practice.

**Controls library (the master record).** One row per control, versioned. Attributes:
- Identity: control ID, title, description, control objective
- Placement: **entity/legal entity**, **process / subprocess** (e.g. Financial Close → Journal Entries), cycle, location, system
- Classification: **key / non-key**; **preventive / detective**; **manual / automated / IT-dependent manual**; **ITGC vs business process control vs entity-level control**; **frequency** (per-occurrence, daily, weekly, monthly, quarterly, annual, ad hoc)
- Assertions covered: existence/occurrence, completeness, accuracy/valuation, cutoff, presentation & disclosure, rights & obligations
- People: **control owner**, performer, reviewer, **tester**, executive owner
- Evidence expectation: what artifact proves performance, retention period
- Framework mapping: COSO component/principle, COBIT for ITGCs
- Reliance: **SOC 1 report reliance** flag + service org, report period, **CUECs** (complementary user entity controls) the bank must itself perform
- Lifecycle: effective from/to, status (active/retired/proposed), last-reviewed date

**Risk–Control Matrix (RCM).** Not a table so much as the join: `Risk` ⟷ `Control` many-to-many, scoped by process, carrying risk rating (inherent/residual, likelihood × impact) and a coverage judgment. Add `Account/FSLI` ⟷ `Risk` (or ⟷ Control) for materiality scoping — a bank will scope by significant accounts (ALLL, loans, deposits, investment securities, OREO) and by FR Y-9C / call report line where relevant. The RCM is the canonical *report*, generated from these joins, not a stored spreadsheet.

**Control performance instances.** One row per occurrence of a control in a period: control ID + period + due date + performer + reviewer + status + attached evidence. This is the object that overlaps Alex's task table (see §3).

**Control testing.** `TestPlan` (per control per cycle: test steps, TOD attributes, TOE attributes, population definition, sampling method, sample size) → `TestExecution` (tester, period, dates, workpaper refs) → `SampleItem` (n rows, each pass/fail with evidence) → conclusion. TOD precedes TOE; a control failing design makes TOE moot. Conventional sample sizes by frequency: annual 1, quarterly 2, monthly 5 (often 2–5), weekly 15–25, daily/high-frequency 25–60 ([finrep walkthrough](https://www.finrep.ai/blog/design-vs-operating-effectiveness-testing-under-sox-2026-practitioner-walkthroug)). Roles must separate **preparer / reviewer / tester** — an owner cannot test their own control.

**Deficiencies / issues / remediation.** `Issue` (source: test failure, self-identified, internal audit, external audit, regulatory exam), severity ladder **control deficiency → significant deficiency → material weakness**, aggregation logic (deficiencies are evaluated in combination, not in isolation), root cause, compensating controls, **remediation plan** with owner and target date, retest date and retest result, closure approval. For a bank, add MRA/MRIA linkage from exams.

**Certifications / sub-certifications (302-style cascade).** A quarterly cascade: process/subsidiary owners sign sub-certification letters (typically a questionnaire: any known errors, any control changes, any fraud, any override), those roll up to controller / division heads, which support the CFO/CEO 302 certification and the 404 management assertion. Objects: `CertificationCampaign` (period, framework), `CertificationTemplate` (statements + questions), `CertificationAssignment` (certifier, due date, status), `CertificationResponse` (answers, exceptions, attestation timestamp, e-signature evidence), plus an escalation edge: an exception answer should auto-create an `Issue`.

**FDICIA context.** For a regional bank the driver is FDIC Part 363, not (only) SOX. Note the November 2025 final rule: the ICFR **audit** threshold rose from $1B to **$5B** in total assets, effective Jan 1 2026, with thresholds now **indexed to inflation** and measured at the beginning of the fiscal year ([Crowe](https://www.crowe.com/insights/take-into-account/fdic-final-rule-adjusts-and-indexes-regulatory-thresholds), [CLA](https://www.claconnect.com/en/resources/blogs/financial-services/fdic-proposes-major-revisions-to-part-363-explore-the-impacts)). Consequence: many regional banks now need **management's ICFR report and a defensible controls program** without an external auditor attestation — exactly the band where an internal tool is rational instead of a Workiva license. Also: thresholds are dynamic, so the tool should not hard-code a compliance regime; make the framework a data attribute.

---

## 3. Fusing ICM into a workflow + dependency tracker

The central insight: **a control performance is a task**. Do not build a parallel scheduler. Build one task engine and give tasks a *type* with a type-specific payload.

### 3.1 Task typing

- `PLAIN` — a scheduling/dependency step with no assertion weight (e.g. "load trial balance," "refresh ALLL model inputs").
- `CONTROL_PERFORMANCE` — carries `control_id`, `period`, expected evidence spec, performer + **required reviewer sign-off**. Completing it creates the immutable `ControlPerformance` record. Evidence is mandatory (configurable per control) and cannot be swapped after submit.
- `CONTROL_TEST` — carries `control_id`, `test_plan_id`, sample rows; assigned to a tester who must not be the owner/performer.
- `CERTIFICATION` — carries `certification_template_id`; completion is an attestation event, not a file upload; produces a signed, tamper-evident record.
- `EVIDENCE_REQUEST` — Workiva's "content request": ask a named person for a PDF/XLSX into a defined slot, with JIT upload permission that freezes on submit.
- `REMEDIATION` — linked to an `Issue`, closes on retest.

All types share: assignee, approver, business-day-relative due date, dependencies (DAG edges), status, comments, audit trail. Type-specific behavior is a payload + a completion validator. This keeps the react-flow designer, the scheduler, the alerting and the dashboard **single-implementation**.

### 3.2 Template vs instance separation

`WorkflowTemplate` (the react-flow graph, versioned) → `WorkflowInstance` (period-bound, calendar-bound) → `TaskInstance`. Roll forward = instantiate the template for the next period against the next calendar, re-deriving business-day offsets, and carrying forward open issues. Template node → control mapping lives on the template; the instance inherits it. Never let a period's edits silently mutate the template — fork with a version bump and record who/when (this is itself an auditable change control, and an examiner will ask).

### 3.3 Evidence linkage

`Evidence` is a first-class object, not a blob column: Blob storage URI, SHA-256 hash, uploader, upload timestamp, MIME, size, source system, retention class, and **many-to-many links** to task instances, control performances, test samples and certification responses. Hash-on-upload plus append-only versioning is what makes evidence defensible; a mutable file path is not. Deletion should be a retention-policy operation, never a user action.

### 3.4 RCM and coverage views

The RCM is a generated view over Control × Risk × Process × Account joined to the current period's performance and testing state. The valuable derived views:
- **Coverage heat map**: significant account → risks → controls → this period's performance status. Gaps are visible as blanks.
- **Control calendar**: all control performances due in the next N business days, by owner.
- **Dependency impact**: given a late upstream task, which downstream *control performances* and *certifications* are at risk — this is where the DAG earns its keep and where Workiva has nothing comparable.
- **Certification readiness**: for a period, which sub-certifications are outstanding and which have open exceptions.
- **Issue aging**: open deficiencies by severity, past target remediation date.

### 3.5 Segregation of duties

Enforce in the domain layer, not the UI: performer ≠ reviewer; owner ≠ tester; certifier cannot approve their own subordinate response chain when the cascade rolls to them. Every violation attempt should log. Role model: Admin, Program Owner, Control Owner, Performer, Reviewer, Tester, Certifier, **External Auditor (read-only, scoped)** — the last one is a Workiva feature worth copying early because it removes the "email the auditor a zip" ritual.

---

## 4. Requirement statements

**Functional**

- FR-IC-01 The system shall maintain a versioned controls library with the attributes in §2, with effective-dated records and no destructive edits.
- FR-IC-02 The system shall support many-to-many `Risk ⟷ Control` and `Control ⟷ Process/Subprocess` and `Risk ⟷ Significant Account` associations, and generate an RCM report from them.
- FR-IC-03 The system shall support task types PLAIN, CONTROL_PERFORMANCE, CONTROL_TEST, CERTIFICATION, EVIDENCE_REQUEST, REMEDIATION over a single scheduling and dependency engine.
- FR-IC-04 A CONTROL_PERFORMANCE task shall require configured evidence and a distinct reviewer sign-off before reaching Complete; the reviewer shall not be the performer.
- FR-IC-05 Task due dates shall be stored as relative business-day offsets against a named calendar with holiday exception dates, and shall re-derive on roll forward.
- FR-IC-06 Roll forward shall clone a template to a new period, re-derive dates, carry forward open issues, and produce a prior-period summary (late, canceled, added, failed tasks).
- FR-IC-07 On submission of a task, uploader edit rights to its evidence shall drop to read-only; on return for rework, edit rights shall be restored.
- FR-IC-08 The system shall record derived flags (on-time, late, delayed, stopped, at-risk) separately from canonical lifecycle status.
- FR-IC-09 When a task becomes late, the system shall notify owners of downstream dependent tasks whose float is consumed, and flag downstream control performances and certifications at risk.
- FR-IC-10 The system shall support test plans with TOD and TOE steps, population definition, sampling method, and frequency-derived default sample sizes (annual 1 / quarterly 2 / monthly 5 / weekly 15–25 / daily 25–60), overridable with a documented rationale.
- FR-IC-11 A failed test sample shall be able to generate an Issue with severity (deficiency / significant deficiency / material weakness), root cause, remediation owner, target date, and retest.
- FR-IC-12 The system shall run certification campaigns with templated letters containing statements, questions and attachments; assignments with due dates; and a configurable roll-up cascade.
- FR-IC-13 An exception answer on a certification response shall optionally auto-create a linked Issue.
- FR-IC-14 The system shall support a scoped read-only external auditor / examiner role, per-engagement, time-boxed.
- FR-IC-15 The system shall support category/value tags on tasks and controls as the reporting pivot dimension (entity, region, cycle, FSLI).
- FR-IC-16 Controls flagged as SOC 1 reliance shall record the service organization, report period, opinion, and CUECs, and CUECs shall be instantiable as controls in the library.
- FR-IC-17 Per-user notification preferences shall include immediate, daily digest, and mute-by-workflow.
- FR-IC-18 Narrative documents shall reference control records by ID so that a control description change propagates to (or flags) every narrative citing it.

**Data**

- DR-IC-01 All evidence artifacts shall be stored in Blob storage with SHA-256 content hash, immutable versioning, and an append-only link table to consuming objects.
- DR-IC-02 Every state transition on tasks, controls, issues, certifications and templates shall append an immutable audit record (actor, timestamp UTC, before/after, source IP, reason where required).
- DR-IC-03 Attestation records shall be immutable and independently exportable with their evidence set as a period package.
- DR-IC-04 Controls, risks and templates shall be effective-dated and versioned; historical periods shall always render against the control version in force at the time.
- DR-IC-05 Calendars shall be first-class entities (business days, working days, exception dates) referenced by workflow instances.
- DR-IC-06 Retention shall be policy-driven per evidence class (7 years default for ICFR evidence); deletion shall be a policy operation, not a user action.
- DR-IC-07 The RCM shall be a derived view, never a stored spreadsheet of record.

---

## 5. Table stakes vs overkill

**Table stakes for an internal bank tool**
- Controls library with key/non-key, frequency, manual/automated, preventive/detective, owner, process, assertion.
- Control-to-process/task mapping so a workflow node can *be* a control.
- Control performance instances with mandatory evidence + independent reviewer sign-off.
- Business-day calendar with holidays; relative due dates; roll forward.
- Issue/deficiency log with severity, owner, target date, retest.
- Certification campaign with sub-certification roll-up (this is the FDICIA/302 deliverable).
- Immutable audit trail and evidence hashing. Without this the tool has no audit value at all.
- Dashboards: control calendar, coverage gaps, issue aging, certification readiness.
- Scoped read-only auditor/examiner access.

**Defer**
- Full test-plan/sampling engine — many regional banks have internal audit or a co-source firm testing in their own workpapers. Start with a *placeholder* `TestResult` per control per cycle (conclusion + workpaper link) and only build sampling if testing moves in-house.
- Narrative auto-propagation. High value, high effort. Start with "control X is cited by narratives A, B" and a stale-flag on change.
- SOC 1 module beyond a reliance flag + CUEC list.

**Overkill**
- Enterprise risk quantification (Monte Carlo, risk appetite dashboards), multi-framework mapping engines (J-SOX/UK SOX/SCIIF), policy management, vendor risk, continuous-controls monitoring with rules engines over transaction data, AI risk identification, and a general-purpose report/document authoring layer. These are the parts of Workiva/MetricStream you're deliberately not paying for.

The strategic read: Workiva's moat is the *linked document* layer (narratives, SEC filings, RCM all sharing one data source). Alex's moat should be the *dependency graph* layer — nobody in the ICM market does credible downstream-impact alerting off a close calendar. Build the graph well, keep the ICM object model honest but minimal, and skip the document platform entirely.

---

## 6. Open questions

1. Is the bank above or below the (now inflation-indexed) $5B Part 363 ICFR audit threshold? Above → external auditor read-only access and testing rigor become P0; below → management assertion only, and the testing module can stay thin.
2. Is control **testing** performed by internal audit in a separate system? If yes, does this tool need to ingest test results, or only link to them?
3. Where does the authoritative controls library live today — an Excel RCM, an internal audit tool, or nothing? Migration shape depends entirely on this.
4. Does the certification cascade need legally meaningful e-signature (21 CFR-style / ESIGN intent-to-sign ceremony) or is authenticated click-through + immutable log sufficient? Materially changes effort.
5. Scope of "controls": ICFR only, or also regulatory reporting (call report / FR Y-9C), BSA/AML, and model risk (SR 11-7)? Each adds attributes and different owners.
6. Does the react-flow designer need to express *conditional* branching, or is ordered/parallel/manual (Workival semantics) plus DAG edges enough?
7. Evidence volume and retention: how many artifacts per period, what sizes? Drives Blob tiering and whether Databricks is in the path at all for this dimension.
8. Segregation-of-duties enforcement: hard block or warn-and-log? Small finance teams often cannot satisfy strict performer ≠ reviewer, and need a documented compensating-control override path.
9. Is there an existing entity/process/account master (from the GL or consolidation system) to sync from, or does the tool own that hierarchy?

---

## Sources

- [Workiva — Internal Controls Management](https://www.workiva.com/solutions/internal-controls-management)
- [Workiva Support — Processes section](https://support.workiva.com/hc/en-us/sections/360009876152-Processes)
- [Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [Monitor a process](https://support.workiva.com/hc/en-us/articles/360061603252-Monitor-a-process)
- [Complete a process task](https://support.workiva.com/hc/en-us/articles/360061608632-Complete-a-process-task)
- [Approve or return a process task](https://support.workiva.com/hc/en-us/articles/22941262743444-Approve-or-return-a-process-task)
- [Roll forward a process](https://support.workiva.com/hc/en-us/articles/4401928366868-Roll-forward-a-process)
- [Build a process with content requests](https://support.workiva.com/hc/en-us/articles/22930832119956-Build-a-process-with-content-requests)
- [Content requests section](https://support.workiva.com/hc/en-us/sections/22930467872788-Content-requests)
- [Monitor content requests in a process](https://support.workiva.com/hc/en-us/articles/22931397132308-Monitor-content-requests-in-a-process)
- [Introduction to Certifications](https://support.workiva.com/hc/en-us/articles/13949910788244-Introduction-to-Certifications)
- [Build a process with certification actions](https://support.workiva.com/hc/en-us/articles/13887468169620-Build-a-process-with-certification-actions)
- [Monitor certification actions in a process](https://support.workiva.com/hc/en-us/articles/22937959108884-Monitor-certification-actions-in-a-process)
- [View and export certification reports](https://support.workiva.com/hc/en-us/articles/13949764934804-View-and-export-certification-reports)
- [Workiva community — Processes and Certifications notifications](https://support.workiva.com/hc/en-us/community/posts/30140416935572-Processes-and-Certifications-notifications)
- [AuditBoard — SOX program assessment checklist](https://auditboard.com/blog/checklist-assess-your-sox-program)
- [finrep — Design vs Operating Effectiveness Testing Under SOX](https://www.finrep.ai/blog/design-vs-operating-effectiveness-testing-under-sox-2026-practitioner-walkthroug)
- [SCH Group — Risk and Control Matrix](https://www.schgroup.com/insights/blog/risk/risk-and-control-matrix-a-powerful-tool-to-understand-and-optimize-your-organizations-risk-profile/)
- [Umbrex — SOX Internal Control Framework (COSO-based)](https://umbrex.com/resources/frameworks/organization-frameworks/sox-internal-control-framework-coso-based/)
- [Crowe — FDIC final rule adjusts and indexes regulatory thresholds](https://www.crowe.com/insights/take-into-account/fdic-final-rule-adjusts-and-indexes-regulatory-thresholds)
- [CLA — FDICIA requirements revisions: impacts on Part 363](https://www.claconnect.com/en/resources/blogs/financial-services/fdic-proposes-major-revisions-to-part-363-explore-the-impacts)
- [RSM — FDICIA readiness](https://rsmus.com/content/dam/rsm/insights/industries/financial-services/1pdf/fdicia-readiness-what-you-need-to-know-and-next-steps.pdf)
- [Schellman — Understanding FDICIA & bank internal controls](https://www.schellman.com/blog/soc-examinations/understanding-fdicia-and-bank-internal-controls)
