# Competitor & Prior-Art Research — Close-Management and Finance-Workflow Tools

Research dimension: **competitors**. Purpose: extract feature patterns to feed `intent.md` and the process requirements document for an internal finance workflow + dependency tracker at Pinnacle Financial Partners.

Scope of vendors reviewed: Workiva Processes (the stated model), BlackLine Task Management, FloQast Close, Trintech Cadency + Adra Task Manager, Numeric, Vena, Redwood Finance Automation, HighRadius Financial Close, Oracle Hyperion/EPM Financial Close Management (Close Manager — useful as the most explicitly documented dependency/day-label model), and general work-management tools (Asana, monday.com, Smartsheet) for their dependency and calendar engines.

---

## 1. The reference model: Workiva Processes

Workiva is the product Alex named, so its model is the anchor. Key mechanics extracted from Workiva's own support docs:

- A **process is a file type** in the platform ("a Workiva file type that lets you design and automate workflows"), not a separate module. It sits alongside documents and spreadsheets, inherits the same permissions/copy/folder semantics, and can be **rolled forward** for reuse in a later period.
- The unit of work is an **action**, and there are four action types: **Task**, **Content request** (assigns a specific file/section and grants permissions automatically), **Certification** (a signature/attestation letter), and **Bulk certification** (many recipients at once). This is a materially richer taxonomy than "task" and is directly relevant to Alex's sign-off/affirmation requirement — Workiva treats attestation as its own first-class action type, not a checkbox on a task.
- Sequencing is expressed as **start order** on a group of actions: `all at once`, `one at a time`, or `manual`. Actions nest in **Groups**, each group having its own start order. This is a *coarser* dependency model than a DAG — it's nested serial/parallel blocks rather than arbitrary predecessor edges.
- Each action has an **assignee** plus an **optional approver with a separate due date** — i.e. preparer and reviewer deadlines are modeled independently.
- **Due dates support business-day calculation** — Workiva documents setting a due date as e.g. "the 10th business day," with a configurable business-day definition and **holiday exceptions**. This is the closest documented analogue to Alex's `BD+3` requirement.
- Automated email notification on assignment, plus **customizable reminder schedules**.
- Statuses observed per action: **sent / completed / approved / returned**; approvers can **return work for revision**, and owners can send reminders or reassign.
- Processes can auto-close on completion or be manually closed and **reopened**.

Workiva's own guidance on drawing a close flowchart ("How to build a financial close process flowchart") says the diagram should carry: steps with directional arrows, **the departments involved (circles or swimlanes)**, **the systems/applications used (icons)**, **time frames per task**, scope (entity/region/LOB), and explicit **handoffs of responsibility between departments**. That is a good spec for the react-flow canvas's node/edge metadata.

For banking specifically, Workiva's banking solution pitch is "data from source to sign-off," an **automated audit trail for every change from data entry to final sign-off**, internal controls management, and SOC 2 posture. Worth noting as the compliance vocabulary Alex's stakeholders (and internal audit) will expect.

**Implication:** Workiva's flowchart-plus-process split is instructive. The *visual* artifact and the *executable* workflow are related but not identical in Workiva. Alex explicitly wants them unified (a react-flow canvas that saves a reusable, instantiable template). That unification is the main differentiator of the internal build.

---

## 2. BlackLine Task Management

- **Parent/child (master/subordinate) task hierarchy** used as the dependency mechanism: a master task auto-completes when its subordinate child tasks complete. Documented in BlackLine's own customer story (Sensiba San Filippo, close cut from 10–12 days to 4).
- **Custom recurrence frequencies** beyond monthly: weekly, bi-weekly, semi-monthly, and **4-4-5 accounting periods**.
- Roles: **preparer, reviewer, approver** per activity, with explicit **segregation-of-duties** governance; workflow stages are visible as "being prepared / in review / approved."
- **Period calendar administration is a first-class admin task**: administrators load **period end-dates** for the year (flagging which are quarter-end/fiscal-year-end), map period end-dates to each **frequency**, and **upload the organization's holiday calendar so that due dates calculate correctly** — the cited example is not marking tasks overdue on Jan 1 when it's a company holiday. This is direct external confirmation that a holiday calendar is a hard prerequisite for the BD+n engine, not a nice-to-have.
- Each task links **supporting documentation**, comments, approvals, and completion records.
- Dependencies framed explicitly as **upstream/downstream**: "connects upstream and downstream activities so teams know what must be completed first," with the observation that a delayed reconciliation or intercompany confirmation propagates to reporting readiness.
- KPI set worth stealing wholesale for the dashboard: **task completion rate, overdue task count, average task aging, on-time approval rate, reopened task count, reviewer turnaround time, close cycle time**.

**Reported weaknesses (G2 user reviews)** — these are the gaps an internal tool can beat:
- Steep learning curve, complex setup, ~6-month implementations, dedicated admin resource required.
- **Task hierarchy is effectively "set for all time"** and costly to restructure later — a strong argument for a visual, re-editable, versioned template model.
- **Reporting/dashboards described as limited**, pushing users to external analytics.
- **Alert settings inflexible** — users want to turn off specific alert classes (e.g. end-date alerts, variance alerts). Notification granularity/subscription control is a real differentiator.
- Admin UI "clunky"; ERP integration often ends in manual entry.

---

## 3. FloQast Close

- **Intelligent checklists** categorized by functional area, with **automated task rollover between periods** (roll-forward is native and marketed) and AI-assisted mapping of an existing spreadsheet checklist into the tool.
- **"Checklist & Reconciliation Dependencies"** is a named feature; independent comparison rates FloQast dependencies as *basic* relative to BlackLine's *robust*.
- **Checklist sign-offs** as a governance control; collaborative **review notes**, "Ready for Review" state, follow/subscribe on items, in-line attachments.
- **Rollforward Documents** — supporting workpapers carry forward to the next period, and month-to-month **notes carry forward**.
- Dashboards explicitly bucket tasks as **early / on-time / at-risk**, plus milestone tracking across multiple entities and status by team member and business process. The tri-state "at-risk" bucket (distinct from "late") is the pattern Alex wants.
- **Retrospective / Close Trends**: exportable close data filterable by process, custom tags, checklist item, reconciliation status, review category — i.e. cycle-time analytics for process improvement.
- Integrations positioned around where accountants already live: Box, Dropbox, Google Drive, **Microsoft Teams**, OneDrive, **Slack**, SharePoint.
- FloQast's own "12 essential features of close management software" list, condensed: ease of use with **automatic rollforward of schedules and overdue alerts**; process flexibility (adapt to the existing process rather than force change); Excel-native working; ERP connectivity; fast implementation; reconciliation automation with **account locking**; **real-time status dashboard to replace status meetings**; centralized documentation with note carryforward; collaboration/review notes; **SOX compliance via differentiated permissions, complete audit trails, and locked files**.
- Known limitation: balance-level (not transaction-level) integration, and "limited reporting and flux analysis depth."

**Implication:** "the dashboard replaces the status meeting" is the sharpest articulation of the value prop for Alex's internal pitch.

---

## 4. Trintech — Cadency (enterprise) and Adra (mid-market)

Trintech's close task-management page is the most explicit vendor statement of the exact features Alex asked for:

- **Hard dependencies**: "define dependencies between tasks, so that certain activities cannot start until their prerequisite tasks are completed." Note the *blocking* semantic — a downstream task is not merely flagged, it cannot start.
- **Preparer + secondary review/approval before closure**, and **electronic sign-offs and certifications by managers**.
- **Attach workpapers, policies, and procedure documents directly to each task**, stored in organized folders, "creating a clear audit trail."
- **Proactive alerts** fire when tasks complete, when they **approach** a deadline, and when they **pass** the due date — three distinct trigger points.
- **AI-based delay prediction**: "predict delays, highlight dependencies, and flag high-risk tasks approaching or past due dates."
- Standardized shared-service-center **close calendars** centralized across entities.
- **Role-based dashboards** for controllers/CFOs, surfacing exceptions and bottlenecks.
- Cadency adds **escalation protocols** ("ensure tasks are addressed promptly and by the appropriate level of management") and **Action Plans** — pre-built sequences of steps delivered automatically to specific individuals with instructions and reference materials. Cadency Certification is a separate module.

Adra Task Manager (the lighter product) shows what the *minimum viable* version looks like: standardized task-list **templates and a task library**, segregation by **frequency**, **built-in approval workflow with segregation of duties**, **automatic audit trail documenting every task event**, **notifications that auto-trigger when a task is completed**, folder-based document organization by account area (AR, AP, accruals, cash), archived comments, and built-in dashboards. Notably, Adra does *not* document a real dependency engine — reinforcing that dependencies are the upmarket feature.

---

## 5. Numeric (modern challenger)

- Close checklist where you **tag items by entity or department, assign owners, map dependencies, and attach templates**; customizable dashboard; **full audit logging for every step**.
- **Multiple reviewers** per item.
- **Numeric Intelligence** analyzes activity across the checklist and reconciliations to surface **bottlenecks, overdue tasks, and recurring issues** and identify trends.
- Transaction-level (not just balance-level) ERP integration; materiality thresholds with auto-submission.
- Positioning: published pricing (~$30/user/month entry), implementation in **under a month** vs BlackLine ~6 months, FloQast ~2, Workiva ~4, Adra ~5, Vena ~5.

**Implication:** speed-to-value and transparent scope is how a newcomer wins. An internal tool inherits that advantage by default; the risk is inheriting enterprise-scale complexity instead.

---

## 6. Vena

Close management is secondary to FP&A. Relevant patterns:
- A **workflow builder** that automates "inputs, uploads, approvals, reminders and report distribution."
- **100% native Excel interface** — the strongest statement of "meet accountants where they are."
- **Version control** for auditability and data integrity; complete audit trail.
- Pre-built **Financial Close Management Dashboard** template; reconciliation checklists and JE tracking.
- No documented dependency engine or business-day scheduling.

**Implication:** if the internal tool cannot beat Excel on data entry, it should at least accept Excel as an input/output artifact (which aligns with Alex's Blob Storage / Excel-evidence requirement).

---

## 7. Redwood Finance Automation

Redwood's angle is **orchestration, not checklists** — the closest analogue to a true workflow engine:
- "Schedule close tasks using templates with granular time/date options **or trigger them based on workdays and dependencies**." Explicit workday-based triggering.
- Tasks are **automatically triggered** by completion of preceding activity rather than manually picked up — the difference between a tracker and an orchestrator.
- Centralized dashboard tracking period-close status by **company, region, area, and close milestone**.
- **Multiple levels of approvals and notifications**; detailed audit trails.
- Explicit framing: manual checklists rely on spreadsheets and human coordination; automation centralizes, auto-triggers, and gives real-time visibility.

HighRadius covers similar ground: pre-configured task lists, ownership with deadlines and **approval checkpoints**, **bottleneck alerts** that "instantly identify delays or incomplete tasks," standardized execution across entities, audit-ready trails capturing every action and approval, live dashboards, and automated "task creation, scheduling, approvals, dependencies, and recurring close activities using reusable templates."

---

## 8. Oracle Hyperion / EPM Close Manager — the clearest documented BD+n model

Oracle's docs are the most concrete prior art for the calendar mechanics Alex needs:

- **Templates** hold the predefined tasks for a close cycle (e.g. "Corporate Quarterly Close template"). A power user picks a template and **aligns it to calendar dates to create a Schedule** — the instantiation/roll-forward step, and exactly the template→instance split Alex described. Per-period one-off tasks can be added to a schedule without polluting the template.
- **Day labels** are business-day markers attached to a template that **propagate automatically to every schedule created from that template**. They mark milestone days and appear consistently in Calendar view, Task List, **Gantt view**, dashboards, My Worklist, and Report Binders. This is the mechanism by which "BD+3" style labels stay attached to concrete dates in every view.
- Task properties model: Task ID, Status, Schedule Name, **Priority**, **Organizational Unit**, Task Type, Start/End Date, Duration, and separately **Actual Start / Actual End / Actual Duration** (planned vs actual is modeled explicitly — essential for cycle-time analytics), **Owner and Assignee as distinct fields**, parameters, comments, a **Workflow** view, an **Alerts** tab, a **Related Tasks** tab, and a **History** tab as the per-task audit trail.
- Workflow: submit for approval, **multi-level approval chains**, approve / reject / forward to next approver, rejection reassigns to the original assignee, automatic status updates and email notifications with **deep links to the task action**.
- Tasks advance when "ready" — a readiness evaluation rather than manual pickup.

---

## 9. General work-management dependency engines (what to copy for the graph/calendar layer)

**Smartsheet** — the richest documented model:
- Four predecessor types: **Finish-to-Start, Finish-to-Finish, Start-to-Start, Start-to-Finish**.
- **Lag and lead**: positive lag (`1d`) delays, negative (`-1d`) leads; units from weeks down to milliseconds.
- **Duration excludes non-working days and holidays by default**, with an **elapsed-time escape hatch** (`e3d`, `e5h`) to ignore non-working time. Directly relevant: Alex needs BD arithmetic by default *and* an occasional calendar-day override.
- Project settings define **working days of the week, length of workday in hours, and specific holiday/non-working dates**; account admins can set org-wide defaults, but **existing sheets and template-derived sheets keep their own settings**.
- Rules: a task **can start on a non-working day but can never end on one**; if a start date lands on a non-working day, that day becomes working for that task only.
- Given two of {start, end, duration} the third is computed; **% complete rolls up to parent rows**, and parent rows become read-only because they derive from children.
- **Baselines and critical path** are separate features.
- Constraint to note: enabling dependencies **disallows formulas** in the managed columns.

**monday.com**:
- One **Dependency column per board**; three dependency modes — **Flexible** (adjust only to remove overlap), **Strict** (shift dependent dates by exactly the change made upstream), and **None** (show the link, don't move dates).
- **Dependencies shift existing dates only; they never create dates for blank items.**
- Weekend skipping is an **account-level** setting and applies to Timeline columns, not plain Date columns — a cautionary tale about putting calendar semantics in the wrong layer.

**Asana**: blocking / blocked-by, the same four dependency types, and **auto-shifting of dependent task dates**; users widely request relative-date project templates.

---

## 10. Consolidated feature matrix

Legend: ● native/strong · ◐ present but limited · ○ absent/undocumented

| Capability | Workiva | BlackLine | FloQast | Trintech Cadency | Adra | Numeric | Vena | Redwood | Smartsheet |
|---|---|---|---|---|---|---|---|---|---|
| Visual flow/diagram canvas as the authoring surface | ◐ (diagram separate from process) | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ Gantt |
| Reusable template → per-period instance | ● | ● | ● | ● | ● | ● | ◐ | ● | ◐ |
| Roll-forward of checklist + workpapers + notes | ● | ● | ● | ● | ◐ | ● | ◐ | ● | ○ |
| True task dependencies (blocking) | ◐ start-order groups | ◐ parent/child | ◐ basic | ● cannot-start-until | ○ | ● | ○ | ● trigger-on-dependency | ● FS/FF/SS/SF + lag |
| Business-day / BD+n relative due dates | ● "10th business day" | ● via period + holiday calendar | ◐ | ● | ○ | ◐ | ○ | ● workday triggers | ● working-day duration |
| Holiday calendar | ● exceptions | ● uploaded | ◐ | ● | ○ | ◐ | ○ | ● | ● |
| At-risk (pre-due) status distinct from late | ○ | ◐ | ● early/on-time/at-risk | ● + AI delay prediction | ◐ | ● overdue surfacing | ○ | ● bottleneck | ● critical path |
| Alerts on complete / approaching / overdue | ● reminders | ◐ inflexible | ● | ● all three | ● on completion | ● | ● reminders | ● | ◐ |
| Escalation to management level | ◐ | ◐ | ◐ | ● protocols | ○ | ◐ | ◐ | ● multi-level | ○ |
| Preparer / reviewer / approver roles | ● assignee + approver w/ own due date | ● 3 roles + SoD | ● signoffs | ● + certification | ● approval + SoD | ● multi-reviewer | ● approvals | ● multi-level | ○ |
| Certification / attestation as a first-class object | ● Certification + Bulk certification | ◐ account certification | ◐ | ● Certification module | ○ | ◐ | ◐ | ◐ | ○ |
| Evidence attachments per task | ● content requests w/ auto-permissions | ● | ● in-line + tie-outs | ● workpapers/policies in folders | ● folders by account | ● | ● | ● | ◐ |
| Return-for-revision / reopen | ● returned; reopen process | ● reopened-task KPI | ● review notes | ● reject | ◐ | ● | ● | ● reject | ○ |
| Real-time multi-user collaboration | ● platform-native | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ◐ | ● |
| Immutable audit trail of every action | ● source-to-sign-off | ● | ● SOX trail | ● audit-ready | ● every task event | ● full audit log | ● + version control | ● | ◐ |
| Dashboards / status visibility | ● | ◐ limited, needs external BI | ● multi-entity | ● role-based | ● | ● | ● template dashboard | ● by company/region/milestone | ● |
| Cycle-time / retrospective analytics | ◐ | ● KPI set | ● Close Trends export | ● | ◐ | ● Intelligence | ◐ | ● | ● baselines |
| Chat/collab tool integration (Teams/Slack) | ◐ | ○ | ● Teams, Slack, SharePoint | ◐ | ○ | ● | ◐ | ◐ | ● |
| Planned vs actual dates modeled separately | ◐ | ◐ | ◐ | ● | ○ | ◐ | ○ | ● | ● baselines |

(Oracle Close Manager, not shown for width, would score ● on template→schedule, day labels, multi-level approval, planned-vs-actual, and per-task history.)

---

## 11. Table stakes vs. differentiators for an internal bank finance tool

### Table stakes — if these are missing, the tool loses to the existing spreadsheet
1. **Template → per-period instance with roll-forward.** Every vendor has it. Instantiating a period must be one action, must carry forward owners, BD offsets, dependencies, instructions, and prior-period notes, and must not retroactively mutate closed periods.
2. **Task identity**: owner *and* assignee as separate fields, preparer/reviewer/approver roles, due date, instructions, entity/department/process tags, frequency, priority.
3. **BD+n relative due dates resolved against a maintained holiday + weekend calendar**, per legal entity if needed. BlackLine's admin guidance and Workiva's "10th business day" both confirm this is the expected primitive. Store the *offset* on the template and the *resolved date* on the instance; keep both visible ("BD+3 → Tue 2026-10-06").
4. **Dependency graph with blocking semantics** and, at minimum, finish-to-start with lag in business days. Trintech's "cannot start until prerequisite completes" is the reference behavior; Smartsheet's FS/FF/SS/SF + lag is the reference data model.
5. **Status model richer than done/not-done**: not started, in progress, ready for review, in review, returned, approved/signed off, blocked, plus derived risk states **at-risk / late / stopped**. "At-risk" must be pre-due (FloQast's early/on-time/at-risk bucketing).
6. **Evidence attachment per task** (PDF/Excel) with the file locked or versioned at sign-off.
7. **Electronic sign-off / attestation** with signer identity, timestamp, and what exactly was affirmed — and reviewer ability to **return for revision**.
8. **Immutable audit trail of every event** (created, reassigned, date changed, attached, signed, reopened). Non-negotiable in a bank; it's how internal audit and the regulators will judge the tool.
9. **Notifications on three triggers** — upstream completed, deadline approaching, deadline passed — delivered to email and Teams.
10. **Real-time status dashboard** that credibly replaces the status call, filterable by process, entity, owner, and BD.
11. **RBAC + segregation of duties**: a preparer cannot approve their own item. Entra ID groups mapped to roles.

### Differentiators — where an internal build genuinely wins
1. **One artifact for the diagram and the executable workflow.** Workiva keeps the flowchart (a drawing) and the process (an executable) apart; BlackLine has no canvas at all. A react-flow canvas that *is* the template — draggable nodes carrying owner, BD offset, evidence requirement, sign-off requirement, and edges that *are* the dependencies — is the single most differentiated thing Alex can build. Copy Workiva's flowchart guidance for node metadata: department swimlanes, system-of-record icons, time frames, explicit handoff markers.
2. **Downstream-impact alerting, not just overdue alerting.** No vendor documents "when upstream task X slips by 2 BD, notify every downstream owner with their newly implied date." Trintech gets closest with AI delay prediction; Redwood with dependency triggering. Implement forward propagation over the DAG: on slip, recompute projected dates for the transitive closure, flag which downstream tasks breach their commitment, and notify **those owners specifically** with the reason and the upstream culprit. This is Alex's stated requirement and it is genuinely under-served.
3. **Cross-team handoff as a modeled object.** Banks lose days at department boundaries (Treasury→Financial Reporting→Regulatory Reporting). Model the handoff edge itself, with an accept/acknowledge step and a handoff SLA, and report on handoff latency.
4. **Concurrent multi-inputter editing** of the same flow/instance with presence, per-field locking or CRDT-style merge, and comment threads. Workiva and Smartsheet do real-time; the close-specific vendors mostly don't.
5. **Notification granularity and subscription control** — the loudest BlackLine complaint. Let users mute alert classes, follow individual items, and get one digest instead of ten emails.
6. **Planned vs actual with critical-path and cycle-time analytics.** Store planned BD, committed date, and actual completion; compute the critical path per period; produce a per-period retrospective ("which node cost us the day"). BlackLine's KPI list is the target metric set: completion rate, overdue count, average aging, on-time approval rate, reopened count, reviewer turnaround, close cycle time.
7. **Reusable pattern library** — a library of sub-flows (a reconciliation pattern, a regulatory-schedule pattern) that can be dropped into a template and versioned centrally, avoiding BlackLine's "hierarchy is set for all time" trap. Version templates and record which template version produced each period instance.
8. **Regulatory-reporting fit**: multiple overlapping cycles (monthly close, quarterly Call Report / FR Y-9C, annual) sharing upstream dependencies, with per-cycle attestation packages exportable as a period binder.
9. **Excel/Blob as a first-class input and output** — accept the workpaper, keep the link, export the period binder. Vena's Excel-native stance and FloQast's rollforward documents show accountants will not abandon the spreadsheet.

### Explicit non-goals (scope discipline)
Reconciliation automation and transaction matching (BlackLine/Adra/Numeric territory), GL/ERP balance ingestion, flux/variance analysis engines, and XBRL/SEC filing. These are separate products with multi-month implementations; conflating them is how this project dies. The tool tracks *work about* the close, and links to the artifacts.

---

## 12. Direct design consequences for the requirements doc

- **Two-layer data model**: `workflow_template` (versioned, holds nodes/edges/BD offsets/role assignments) → `workflow_instance` (bound to a period, holds resolved dates, actuals, statuses, evidence, sign-offs). Oracle's template→schedule split and day-label propagation is the proven shape.
- **Calendar service** as its own component: business calendars per entity, weekend definition, holiday list, and functions `resolveBD(period, offset, calendar) → date` and `addBusinessDays(date, n, calendar)`. Smartsheet's rules are a good test suite: exclude non-working days from duration, support an elapsed/calendar-day override, and never let a task *end* on a non-working day.
- **Edge attributes**: dependency type (default FS), lag in business days, blocking vs advisory, and handoff flag. monday.com's Flexible/Strict/None modes are a useful precedent for whether a slip *moves* downstream dates or merely *flags* them — expose both (advisory flag by default for finance, hard block for control-critical steps).
- **Alert engine** driven by a scheduled evaluation (Azure Function / cron) computing risk state per task each business day plus event-driven propagation on status change, with a notification-preferences table.
- **Sign-off record** as an append-only table: task instance, signer, role, attestation text/version, timestamp, evidence file hashes.
- **Reopen** must be supported (Workiva reopens processes; BlackLine tracks reopened-task count as a KPI) but must always create a new audit event, never overwrite.

---

## Sources

- [Workiva — Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Workiva — Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [Workiva — How to build a financial close process flowchart](https://www.workiva.com/blog/how-build-financial-close-process-flowchart)
- [Workiva — Banking compliance & regulatory reporting](https://www.workiva.com/solutions/banking)
- [BlackLine — Shave 8 days off your month-end close with Task Management](https://www.blackline.com/blog/shave-8-days-off-month-end-close-task-management/)
- [Hyperbots glossary — What is BlackLine Task Management?](https://www.hyperbots.com/glossary/blackline-task-management)
- [Sensiba — Getting your BlackLine admins prepared for the new year](https://sensiba.com/resources/insights/getting-your-blackline-admins-prepared-for-the-new-year/)
- [G2 — BlackLine Financial Close Management pros and cons](https://www.g2.com/products/blackline-blackline-financial-close-management/reviews?qs=pros-and-cons)
- [FloQast — 12 essential features of close management software](https://www.floqast.com/blog/essential-features-of-close-management-software)
- [FloQast — Global month-end close](https://www.floqast.com/optimize-the-close/products/global-month-end-close)
- [FloQademy — FloQast Close](https://floqademy.floqast.com/page/floqast-close)
- [Numeric — FloQast: what it is & how it works](https://www.numeric.io/blog/floqast-what-it-is-how-it-works)
- [Numeric — Close management](https://www.numeric.io/product/close-management)
- [Numeric — Financial close software: 15 best tools for 2026](https://www.numeric.io/blog/financial-close-software)
- [Trintech — Financial close task management](https://www.trintech.com/financial-process/financial-close-task-management/)
- [Trintech — Cadency close management](https://www.trintech.com/cadency/close-management/)
- [Trintech — Adra Task Manager](https://www.trintech.com/adra/suite/adra-task-manager/)
- [Adra Task Manager brochure (PDF)](https://www.lorge.co.za/wp-content/uploads/2021/02/Adra-Task-Manager.pdf)
- [Vena — Financial close software](https://venasolutions.com/financial-close-management)
- [Redwood — Financial month-end close checklist software](https://redwood.com/financial-close-checklist)
- [HighRadius — Financial close software](https://www.highradius.com/product/financial-close-software/)
- [Oracle — Close Manager: day labels in schedules](https://docs.oracle.com/cd/E64585_01/FCLAD/cm_schedules_day_labels.htm)
- [Oracle — Close Manager: task flows](https://docs.oracle.com/cd/E64585_01/FCLAD/cm_task_flows.htm)
- [Oracle — Close Manager: tasks dialog box](https://docs.oracle.com/cd/E64585_01/FCLAD/cm_tasks_dialog_box.htm)
- [Smartsheet — Activate dependencies and use predecessors](https://help.smartsheet.com/articles/765727-enabling-dependencies-using-predecessors)
- [Smartsheet — Define working days, non-working days, and holidays](https://help.smartsheet.com/articles/516392-defining-working-non-working-holidays-on-a-project-sheet)
- [monday.com — Dependencies](https://support.monday.com/hc/en-us/articles/360007402599-Dependencies-on-monday-com)
- [Asana — How to use task dependencies](https://help.asana.com/s/article/how-to-use-task-dependencies)
