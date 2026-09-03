# Workiva Processes & Integrated Workflow Management — Feature Teardown

Raw research for the Pinnacle finance workflow/dependency tracker. Sources cited inline; full list at bottom.

---

## 0. The single most important finding

**Workiva "Processes" is not a visual flowchart tool.** It is a structured, hierarchical **checklist + task-distribution engine** with a calendar, an approval chain, and reporting. There is no canvas, no nodes, no connectors, no swimlanes anywhere in the Processes file type. The `Build a process` documentation describes a toolbar with an "Add action" button and a settings panel with General / Calendar / Certifications tabs — no visual connectors or swimlanes are mentioned at all.

The flowchart blog Alex linked (`how-build-financial-close-process-flowchart`) is **marketing content about drawing a diagram**, not documentation of a product feature. It recommends including timing/time frames, roles and teams, systems/tools, and business scope (business units, regions, LOBs), and shows directional arrows with departments in circles and system icons — but it explicitly does not define swimlane conventions or symbology, and it pivots to "use collaborative tools with comments and revision tracking." So the diagram lives in a doc; the executable workflow lives in Processes; **the two are not the same object in Workiva.**

**Implication for Alex's build:** the react-flow canvas is the genuinely differentiated part of the internal tool. Workiva users draw the close flowchart in one place and execute it as a flat-ish checklist somewhere else. If the graph *is* the process definition — one artifact, drawn once, instantiated per period — that is strictly better than Workiva for this use case, and it is also where all the schema risk lives (see §7).

---

## 1. Object model

Workiva's hierarchy, as documented:

| Level | Workiva name | Notes |
|---|---|---|
| Template / definition | **Process** (a *file type*) | Behaves like any other Workiva file: permissions, copy, roll-forward, lives in folders. Requires the **Editor** workspace role to create. Can be created from `Create > Process` or **uploaded from CSV/TSV/TXT/XLS/XLSX**. |
| Grouping | **Group** (action group) | Subset of actions with its own independent **start order**. This is the only structural nesting. |
| Work item | **Action** | Four subtypes (below). |
| Delivery | **Task** | What the assignee actually receives/sees. An action *generates* a task. |
| Sign-off artifact | **Certification letter** | Reusable letter object, referenced by many certification actions. |

### Action subtypes (four, per `Build a process`)
1. **Task** — "notify users of an assignment to complete." Generic work item.
2. **Content request** — a task bound to a *specific section of a specific file*, with automatic permission grants (see §5).
3. **Certification** — "tasks specifically for sending out letters to be signed."
4. **Bulk certification** — sends an individual copy of one letter to every member of a group, with a single named approval contact.

### Fields on an action

**Required:** `Title`, `Assigned to`.

**Optional:**
- `Due date` — **supports business-day numbering** (i.e. BD+n), not just calendar dates
- `Assignee reminders` — default or customized
- `Approval by` + `Approval due date`
- `Approver reminders`
- `File` + `Section` references
- `Instructions`
- `Tags` — **category/value pairs**, not free-form labels

For a **certification action** specifically the fields are: `Title` (req), `Letter` (req), `Send to` (req), plus **multiple signer steps** (`Add signer step`) and **multiple approval steps** (`Add approval step`), each with an **everyone / someone** quorum toggle, `Due date`, `Approval due`, reminders, custom email notification text, instructions, and tags.

**Copy this:** the *quorum toggle* (everyone must sign vs. anyone may sign) and **multi-step approval chains** are cheap to model and finance teams genuinely need both (e.g. two preparers, one reviewer; or any one of three controllers).

**Copy this:** `Tags` as **category/value pairs** rather than flat strings. For Alex that maps directly onto dimensions finance actually filters by — Entity / LOB / Regulatory report (Call Report, FR Y-9C) / Risk rating / SOX-relevant. Flat tags degrade into a mess within two close cycles.

---

## 2. How dependencies are expressed — and the big gap

Workiva has **no dependency graph.** Sequencing is expressed only through **start order**, set at the process level and overridable per group:

- **All at once** — every action starts simultaneously
- **One at a time** — strictly sequential; the next action starts when the prior one finishes
- **Manual** — a human starts each action

That's it. There are no predecessor/successor links, no finish-to-start typing, no fan-out, no cross-process dependency, no critical path, no Gantt view. The 2026 IWM material describes structuring "related tasks through action groups and sequential ordering" — which confirms grouping + ordering *is* the dependency model.

**What this means for the requirements doc:**

1. Alex's stated need — "lay out downstream dependencies and trigger alerts to downstream owners when upstream tasks are delayed" — **Workiva cannot do.** The closest the platform gets is a dashboard that flags "tasks at risk of becoming overdue" (§6). It never notifies *the downstream owner* that *their* start is now in jeopardy. This is the tool's headline feature, not a nice-to-have.
2. The internal tool should model dependencies as a proper **DAG of typed edges** (`blocks` / `informs`), because the two behave differently: a `blocks` edge gates the downstream task's start and propagates slip into its projected dates; an `informs` edge only fires a notification. Workiva conflates these by having neither.
3. Because Workiva only supports linear ordering inside a group, a real close — where a single upstream (e.g. "GL subledger cutoff") fans out to 8 parallel downstream reconciliations — must be modeled in Workiva as either "all at once" (losing the gate) or a fake serial chain (losing parallelism). **Requirement: the graph must support fan-out and fan-in natively, and the UI must make a multi-predecessor join legible.**

**Overkill to avoid:** do not build BPMN. No gateways, no XOR/AND semantics, no compensating transactions, no sub-process invocation. Workiva succeeds commercially in this space with *ordering only*, which tells you the market's tolerance for complexity is low. A DAG with `blocks`/`informs` edges plus a group construct is roughly one notch above Workiva and is the right ceiling.

---

## 3. Business days and the calendar — the most directly reusable design

This is Workiva's best idea for Alex's use case and should be lifted nearly wholesale.

**Process settings → Calendar tab** contains:
- `Add existing calendars` — attach holiday/business calendars
- `Configure business days` — **set the first and last business day of the cycle**
- `Typical working days` — designate the standard operating weekdays
- `Add exceptions` — mark holidays / non-working dates, toggled on a calendar widget
- A **visual calendar review** where "unshaded dates indicate business days, while shaded dates indicate days off"

Calendars are imported as **.ics files (max 500 KB)** or via **URL subscription**; events need `DTSTART` and timezone info for non-all-day events. Events surface alongside task deadlines. There is also a **Calendar tab** on the running process to compare action due dates against calendar events.

**The critical mechanic:** because a due date is stored as *BD+n* rather than a hard date, **roll-forward recomputes it automatically** against the new period's calendar. IWM states this enables "automatic adjustments during process rollover cycles without manual reassignment," and the roll-forward doc confirms: "If business days have been configured in the original process, and you've already updated the Calendar settings… the action's due dates will have updated automatically."

**Requirements this generates:**
- Store the due date as a **`(anchor, offset, direction)` tuple** — e.g. `(period_end, +3, business_days_forward)` — and resolve to a concrete calendar date at instantiation time. Never store only the resolved date. Also support anchoring to *the end* of the cycle (BD-2 from last business day) since regulatory deadlines count backwards.
- A **first-class Calendar entity** per period: working weekdays + an exception list. Federal Reserve/bank holidays differ from generic US holidays, and a regional bank will need its own list — so this must be **editable and versioned**, not a hardcoded holiday library.
- Because Alex mentions regulatory reporting: support **multiple calendars per instance** (a Call Report deadline calendar layered on the close calendar) and let a task anchor to a named calendar event, not just to period start/end.
- Support the **visual shaded/unshaded month grid** for confirming a calendar before instantiating. It is a five-hour build and it prevents the entire class of "why is BD+3 a Saturday" support tickets.

Note the availability caveat, which is telling: "Workiva Calendars and Calendar-related features (such as using business days in processes) are currently only available in some of our Financial Reporting and Financial Services solutions." Business days are gated behind the expensive SKUs. Building it in-house is straightforwardly valuable.

---

## 4. Roll-forward (period instantiation)

Mechanically, Workiva's roll-forward is **a file copy**, not a template-instantiation model. Per `Roll forward a process`:

- You copy the entire process file; "you can copy a process at any time, even if it's already started."
- Restricted to **Workspace Owners, Content Managers, and Copy Managers**.
- On copy you must select **"Links and Process References"** to preserve file references — otherwise linked references break. (Sharp edge; an easy footgun.)
- **Auto-updated:** due dates, if business days were configured and the Calendar settings were updated first.
- **Manual review required:** process name, action titles, due dates and approval due dates (verify after auto-update), calendar settings/business-day parameters, assignees and approvers (**explicitly to replace suspended users**), and action tags.
- A **Process Copy Summary tile** shows metrics from the prior run: **late tasks, canceled tasks, added tasks.**

**Assessment.** Copy-the-file is the wrong architecture and the docs' own "manually review these six things" list is the evidence. Because there is no separate template object, every improvement made during period N lives only in period N's copy; there is no way to fix the template once and have it apply going forward, and no way to see how the process drifted across periods.

**Requirements:**
- Separate **`WorkflowTemplate`** (versioned) from **`WorkflowInstance`** (period-bound). Instantiate with `template_version_id`, `period`, `calendar_id`. Keep the version pointer so you can answer "which template version did the Q3 close run on."
- Roll-forward should be a **generated diff for review, not a blind copy**: show resolved dates, unassigned/departed owners, and tasks that were late or added last period. The Copy Summary tile is exactly the right instinct — **carry prior-period performance into the setup screen for the next period.** Copy that; it is the single best UX idea in the roll-forward flow.
- **Assignee resolution by role, not by person.** Workiva's "replace any suspended users" chore exists because assignees are hardcoded individuals. Assign to a **role/position** (e.g. "Reconciliation Lead — Treasury") resolved against Entra ID group membership at instantiation, with an explicit person override. This kills the largest recurring maintenance cost.
- In-flight editing must be legal: Workiva permits editing actions and groups **while the process is in progress** via the three-dot menu. Finance closes change mid-flight; do not lock the instance.

---

## 5. Evidence, attachments, and file binding

Workiva's approach is unusual and worth understanding before rejecting it.

Rather than "attach a PDF to a task," the primary pattern is the **content request**: a task bound to a **specific section of a specific file**, where the platform manages permissions automatically through the lifecycle:

- Assignee receives an email **linking directly to the assigned file section**
- Assignee is granted **Editor** on the file when the request starts
- On submission, assignee is **downgraded to Viewer**; the approver is granted **Viewer**
- If the approver returns it for rework, the assignee's **Editor access is automatically restored**
- On completion, both retain **Viewer**

Certification letters can carry **attachments**, and PDF exports can include **hyperlinks to download those attachments**.

Notably, the assignee-facing task docs (`Complete a task`, `View and complete tasks`) **do not mention attachments or comments on ordinary tasks at all.** Evidence attachment on a generic task appears to be weak-to-absent; the evidence story runs through content requests and certification letters.

**Requirements:**
- Alex explicitly needs **upload proof/evidence (PDF or Excel)** on items, so: **first-class attachments on the task**, in Azure Blob Storage, with SHA-256 hash, uploader identity, and UTC timestamp captured at upload. Do not follow Workiva into making evidence a side effect of file permissions — Pinnacle's evidence is external artifacts (bank statements, recon workbooks, Y-9C schedules), not sections of a Workiva doc.
- **Do copy the state-driven permission transition.** "Editable while assigned, read-only once submitted, re-opened to editable on return" is exactly the control an auditor wants, and it is cheap: a state machine gating a write check. Applied to attachments: **submitted evidence becomes immutable; a return-for-rework creates a new revision rather than overwriting.** Never allow silent replacement of attested evidence — that is the whole audit value.
- Support **required-evidence** as a task-level flag ("cannot submit without ≥1 attachment"), which Workiva does not appear to enforce.

---

## 6. Statuses, notifications, escalation, monitoring

### Status values (assembled from several docs; Workiva does not publish one canonical enum)

Action/task lifecycle: **Sent → Completed → Approved → Returned** (`Introduction to Processes`), with **Canceled** and **Deleted** as terminal admin states, plus **Restarted** as a transition.

Assignee-facing buckets (`View and complete tasks`): **To do**, **Overdue**, **Returned**, **Due this week**. These are a mix of true status and derived views — note that **Overdue is derived from the due date, not stored.**

Assignee action verb depends on config: **Submit** if an approver is assigned, **Complete** if not.

Signer-side overrides on certifications: process owners can **Mark as signed** (sole signer — auto-approves the letter) or **Skip** (multi-signer — lets the action proceed).

**Requirement:** Alex asked for **late / delayed / stopped**. These are three different things and Workiva only has the first:
- **Late** = derived, `now > resolved_due_date AND status NOT IN (complete, approved)`. Derived, never stored.
- **Delayed / At risk** = **projected** to finish late because an upstream `blocks` predecessor slipped. This is the propagation calculation and it is the tool's reason to exist. Store the *projected* date per task alongside the *planned* date; recompute on any upstream status/date change.
- **Stopped / Blocked** = an explicit human declaration with a reason code and (ideally) a named blocker — "waiting on Treasury confirm," "system outage." Must be an author-able state, not inferred, because it is the thing that gets escalated in the stand-up.

### Notifications

Everything is **email-based and deadline-anchored**:
- Email on task start / assignment, with a deep link
- **Assignee reminders** and **approver reminders**, either platform-default or per-action custom cadence
- Custom email notification text per certification action
- **Send reminders** on demand from the process three-dot menu
- **Restart** an action to re-notify assignees
- For a multi-assignee group task, when one person completes it, "an email will be sent to the group to inform everyone that someone has completed the task"
- Task creator is notified on completion when no approval step exists
- On a returned certification, signers are notified to review **the approver's notes**, revise, and re-sign

**What is missing, and is precisely Alex's ask:** there is **no upstream-slip → downstream-owner alert.** Reminders fire against your own due date only. Nothing tells the AP manager that the accrual close they depend on just slipped two days.

**Requirements:**
- **Cascade notification** as a distinct event type: when task X's projected completion moves past its planned date, notify the owners of all `blocks`/`informs` successors *within k hops* (configurable, default 1) with the new projected start.
- **Digest, don't spray.** One rolled-up "3 of your upstream dependencies moved" per owner per day plus immediate alerts for `blocks` edges only. Cascade alerts on a 200-task close will destroy trust in the tool within one period if sent individually.
- Reuse Workiva's **on-demand nudge** ("Send reminders" from the menu) — a controller wants a manual poke button, and it deflects the "the tool didn't remind them" argument.
- Deep-link every email straight to the task (Workiva's content-request emails link to the exact file section — that specificity is why people click).
- Notification channel: email via Graph/Exchange, plus Teams — Teams Adaptive Cards with an inline Complete/Submit action would exceed Workiva outright, since it is email-only. Worth flagging as a phase-2 item.

### Monitoring / dashboards

Per `Monitor a process` and the IWM overview:
- **Process tab** with an **Overview panel** (process details + insights), progress charts, and an action list with status and due date
- **Configurable columns** via the three-dot menu on a column header; **filters** on the action list
- **Calendar tab** comparing action due dates to calendar events
- **Real-time dashboards** showing completion rates and **"identification of tasks at risk of becoming overdue"**; managers can filter and drill in
- **Home → Processes list** across all processes: name, creator, start date, due date, close date, and **status percentages**; sortable by name/start date/due date; filterable by status; searchable by name
- **Home → Tasks** personal view with filters and search. Available columns include due date, status, file location, creator, date created, date last modified, assignee, approver. Filters: status, assignee, approver, file section, and — for admins — **user**, with operators `Is`, `Is any of`, **`Is currently`**, **`Is currently any of`**
- Process-level controls: **Close** (automatic on all-complete, or manual by owner), **Reopen** (to add/edit actions without restarting completed ones), update settings, manage permissions
- **Health check** — "Check for issues" flags missing data or expired dates *before* start

**Copy these four:**
1. **The pre-flight health check.** Running "Check for issues" before instantiating a period — unassigned tasks, dates resolving to non-business-days, owners who left, orphaned graph nodes, cycles in the DAG — is high value and low cost.
2. **Three views over one dataset**: portfolio (all processes, % complete), process (this close, all tasks), personal (my tasks). Alex will need a fourth: **the graph view** with status painted on the nodes. Do not make the canvas the only view — a 200-row filterable table is what a controller lives in during close week; the graph is for design, for the standup, and for tracing "what does this block."
3. **`Is currently` operators.** The distinction between "was ever assigned to X" and "is currently assigned to X" is real in a reassignment-heavy environment and most tools get it wrong.
4. **Reopen without restarting completed items.** Non-obvious and correct; a reopened close must not re-notify 80 people who already finished.

---

## 7. Audit trail

Two layers.

**Process-level.** Three CSV report types:
- **Process Actions Report** — all actions and their details; exported *before* start (i.e. the plan of record)
- **Process Status Report** — current status of each action, all or filtered; exported after launch
- **Process Activity Report** — from the **Activity log tab**, with these columns: **`Activity`** (summary), **`Action title`**, **`User`**, **`Date`** (UTC), **`Details`**

A **task activity report** separately records "when the task was created, assigned, updated, approved, and restarted, as well as each time a reminder was sent."

Retention semantics are documented and worth noting: **canceled** actions "remain visible in status reports"; **deleted** actions are removed from reports but "associated activities remain in the activity report." So the activity log is append-only and survives deletion of its subject.

**Workspace-level.** Columns: `Summary`, `Performed by` (name & username), `Applied to` (name & username), `Action`, `Time` (UTC) and `Local time`, **`IP Address`**, `Details`. Exportable to CSV with an option to exclude Details. Visible to **Workspace Owners only**. Paginated at 100 by default.

**Certification reporting.** Three exports: a **Certification Responses Report** (CSV — signer response and explanation per letter question, accept/reject status, approver feedback), **All Certification Letters** (PDF, zipped one file per letter), and an **individual letter** (PDF). A hyperlinks option makes letter attachments downloadable from the exported PDF. Large exports are **deferred** — "The export may take a while, so you can come back to the process later and click View exports."

**Requirements:**
- **Append-only `activity_log` table**, immutable, surviving deletion of the referenced entity. Columns modeled on Workiva's union: `event_type`, `entity_type`, `entity_id`, `entity_title_snapshot`, `actor_upn`, `actor_display_name`, `subject_upn` (the "applied to"), `occurred_at_utc`, `source_ip`, `details_json`. Snapshot the title — deleted-entity rows must still be readable.
- **UTC + local time both.** Workiva stores UTC and renders local. A bank spanning time zones with BD+n deadlines will have a dispute about whether something was late; store UTC, display local, label which is which.
- **Capture source IP on attestations.** Workiva does this at workspace level and it is a standard SOX/auditor expectation for e-sign-like events.
- **Attestation record must be self-contained and immutable**: attester identity, resolved role at time of signing, the exact attestation text version, the list of evidence attachments with hashes, and the UTC timestamp. If the attestation wording changes next quarter, prior sign-offs must still render the wording that was actually agreed to. Version the attestation text.
- **Deferred/async export with a "View exports" tray.** Copy this pattern — a synchronous CSV of a 12-month audit trail will time out on Azure Web Apps' request limits.

---

## 8. Sign-off / attestation model

Workiva separates two things Alex may be conflating:

1. **Approval** — a reviewer accepts a completed task or **returns** it for rework, with **notes**. Applies to any action type. Supports **multiple sequential approval steps**, each with an **everyone/someone** quorum.
2. **Certification** — a formal, letter-based attestation. A reusable **letter** object carrying text, **questions**, and attachments; sent to **signers**; signed by **typing your full name and clicking Submit** (or "Sign and submit"); then routed to **approvers** who accept or reject-with-notes. **Bulk certification** fans one letter out to every member of a group as individual copies with a single approval contact.

Signer overrides for unavailability: **Mark as signed** (sole signer, auto-approves) and **Skip** (multi-signer).

**Requirements:**
- Model **`Review`** (task-level accept/return, cheap, high volume) and **`Attestation`** (formal, questioned, evidenced, immutable, low volume) as **separate entities**. Alex said "sign-off / affirmation / attestation" in one breath; the requirements doc should force the distinction, because the audit, immutability, and reporting needs differ by an order of magnitude.
- **Return-with-notes is mandatory** on both. A rejection without a reason generates a phone call, which is a workflow leak.
- Typed-name signing is the right bar for an internal tool. It matches Workiva, it satisfies "who affirmed this," and it avoids the DocuSign/Part-11 rabbit hole. Bind it to the authenticated Entra ID session so the typed name is corroborated, not asserted.
- **Questions attached to an attestation** ("Are there any unrecorded liabilities? If yes, explain") with structured responses that export to CSV — this is a strong, cheap feature for a bank's sub-certification process and directly reusable for FDICIA/SOX 302 sub-certs. Worth calling out in the requirements doc as an early win.
- **Bulk certification** is likely in scope for Alex eventually (sub-certifications to N business unit controllers) — but it is a phase-2 item, not MVP.

---

## 9. Concurrency / multiple inputters

Workiva's model is **permission-mediated, not real-time-collaborative, at the process level.** The process file has permissions (owner, edit, view); a **Process manager** can be assigned by a Workspace Admin *after* the process starts. Content requests dynamically grant and revoke Editor/Viewer on the *target file* by lifecycle state. For a multi-assignee task, the first person to complete it satisfies it and the group is emailed.

The docs describe nothing about simultaneous editing of the process definition, and no conflict resolution — which is unsurprising for a checklist, but is a real problem for Alex's react-flow canvas.

**Requirements:**
- Alex's "multiple inputters collaborating on the same workflow concurrently" needs an explicit decision the requirements doc must force. Two viable levels:
  - **Level 1 (recommended MVP):** optimistic concurrency on the *instance* — per-task row versioning, so two people updating two different tasks never conflict, and two people updating the *same* task get a clean "this changed, reload" rather than a lost write. Plus presence indicators. This covers 95% of real usage: many inputters, different tasks.
  - **Level 2:** true CRDT/Yjs multiplayer on the *template canvas*. Expensive, and template editing is a low-concurrency activity done by one or two process owners. Defer it; use a **soft lock / checkout on the template** instead, which is honest and cheap.
- **Separate the permission model for template vs. instance.** Editing the template (adds/removes tasks for all future periods) is a governance act; updating a task status is daily work. Workiva blurs these because the template *is* the file. Do not inherit that.
- Copy the **`Process manager` assignable after start** idea — close ownership changes when someone is on vacation, and it should not require reassigning 80 tasks.
- Copy the **group-assignment "someone completed it" broadcast.** Cheap, prevents duplicated work.

---

## 10. Explicitly overkill for an internal tool

Do not build these; note them in the requirements doc as out of scope with a reason.

- **BPMN / gateway semantics.** Workiva ships nothing like it and dominates this segment anyway.
- **Content requests as the evidence mechanism.** This exists because Workiva owns the documents. Pinnacle's evidence lives in Excel and PDFs on a share; plain attachments are the right model.
- **Automatic file-permission choreography.** Elegant, but it presumes the platform is also the document repository. Skip; use task-state gating on attachment mutability instead.
- **Certification letter authoring as a rich document editor.** A versioned attestation-text template with typed questions is 10% of the effort and 90% of the value.
- **.ics subscription-URL ingestion.** Nice, but a hand-maintained holiday table plus a CSV import covers a US regional bank. Do support .ics *upload* if it's free; do not build subscription polling.
- **The dual old/new UI with a revert switch** (Workiva let users revert to the legacy Processes design until June 2026). A luxury of a vendor with 5,000 customers.
- **Per-action custom email templates.** Two or three system templates with variable substitution is enough. Per-action custom copy becomes an unmaintainable content-management problem.
- **Multi-workspace / org-level administration.** Single tenant, single workspace.
- **Real-time multiplayer canvas editing.** See §9.

---

## 11. UX patterns worth copying — ranked

1. **BD+n stored as an offset, resolved against a named calendar at instantiation.** The core primitive. Everything about roll-forward's low friction descends from this one decision.
2. **The shaded/unshaded calendar confirmation grid.** Cheap, prevents an entire error class, and builds trust that the tool understands holidays.
3. **Prior-period performance surfaced on the roll-forward screen** (late / canceled / added counts). Turns instantiation into a review moment instead of a rubber stamp.
4. **Pre-flight "Check for issues" health check** before a period goes live.
5. **State-gated editability**: assigned → editable; submitted → read-only; returned → editable again. One state machine, large audit payoff.
6. **Everyone/someone quorum on signer and approver steps**, with multiple sequential steps.
7. **Category/value tag pairs** as the filtering dimension model.
8. **Three (here: four) coordinated views** over one dataset — portfolio / process / personal / graph.
9. **`Is currently` vs. `is ever`** filter operators on assignee.
10. **Reopen a closed period without restarting completed tasks.**
11. **Async export with a "View exports" tray.**
12. **On-demand "Send reminders" nudge** alongside automated reminders.
13. **Return-with-notes** everywhere a rejection is possible.
14. **Deep links from email to the exact work item.**
15. **Create a process by uploading a spreadsheet.** Every finance team already has the close calendar in Excel. Bulk import is the single highest-leverage adoption feature and Workiva supports CSV/TSV/TXT/XLS/XLSX. For Alex this also solves the cold-start problem for the react-flow canvas: import rows, auto-layout the graph, then let the user drag it into shape.

---

## 12. Where the internal tool should exceed Workiva

These are the four differentiators; they should headline the intent.md.

1. **The graph *is* the process definition.** One artifact — drawn on a react-flow canvas, saved as a versioned template, instantiated per period. No divorce between the flowchart and the checklist.
2. **True DAG dependencies with typed edges** (`blocks` / `informs`), fan-out and fan-in, replacing "one at a time."
3. **Slip propagation and downstream alerting.** Compute a projected date per task from upstream actuals; when it moves past plan, alert downstream owners with the new projected start. Workiva flags *your* task at risk; this flags *the people you are about to make late.* Add a **projected vs. planned critical path** so the controller can see, at 4pm on BD+2, which chain now threatens the BD+8 filing.
4. **First-class evidence with immutability and hashing**, decoupled from document-repository permissions.

---

## 13. Open modeling questions the requirements doc must resolve

- Does a task's BD offset anchor to **period start (BD+3)**, **period end (BD-2)**, a **named calendar event** (Y-9C due date), or **the completion of a predecessor** (upstream + 2 BD)? Probably all four; that's four anchor types in the schema.
- On slip propagation: do downstream **planned** dates move, or only **projected** dates, with planned staying as the baseline? (Strongly recommend: planned is a frozen baseline; projected floats. Otherwise you lose the ability to report "were we late.")
- Is a **`blocks` edge hard-gating** (downstream cannot be marked complete/started until upstream completes) or **advisory**? Hard gates in a close are dangerous — reality routinely diverges. Recommend advisory-by-default with an optional hard gate per edge, and record an override reason when a gate is bypassed.
- Attestation scope: per-task, per-group, or per-period? Probably all three, which means the attestation entity needs a polymorphic subject.
- Does the template version pin at instantiation, and can an in-flight instance be **upgraded** to a newer template version? (Recommend: no auto-upgrade; support manual add/remove of tasks on the live instance instead.)

---

## Sources

- [Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [How to build a financial close process flowchart (blog)](https://www.workiva.com/blog/how-build-financial-close-process-flowchart)
- [Review process settings](https://support.workiva.com/hc/en-us/articles/45306517349012-Review-process-settings)
- [Build a process with content requests](https://support.workiva.com/hc/en-us/articles/22930832119956-Build-a-process-with-content-requests)
- [Build a process with certification actions](https://support.workiva.com/hc/en-us/articles/13887468169620-Build-a-process-with-certification-actions)
- [Roll forward a process](https://support.workiva.com/hc/en-us/articles/4401928366868-Roll-forward-a-process)
- [Monitor a process](https://support.workiva.com/hc/en-us/articles/360061603252-Monitor-a-process)
- [Monitor certification actions in a process](https://support.workiva.com/hc/en-us/articles/22937959108884-Monitor-certification-actions-in-a-process)
- [Complete a task](https://support.workiva.com/hc/en-us/articles/43750798138900-Complete-a-task)
- [View and complete tasks](https://support.workiva.com/hc/en-us/articles/360038322312-View-and-complete-tasks)
- [Introduction to Certifications](https://support.workiva.com/hc/en-us/articles/13949910788244-Introduction-to-Certifications)
- [Sign a certification letter](https://support.workiva.com/hc/en-us/articles/13949539675796-Sign-a-certification-letter)
- [View and export certification reports](https://support.workiva.com/hc/en-us/articles/13949764934804-View-and-export-certification-reports)
- [View and export process reports](https://support.workiva.com/hc/en-us/articles/4406116571668-View-and-export-process-reports)
- [View and export the task activity report](https://support.workiva.com/hc/en-us/articles/20564532519956-View-and-export-the-task-activity-report)
- [View workspace activities](https://support.workiva.com/hc/en-us/articles/360035642392-View-workspace-activities)
- [Calendar import requirements](https://support.workiva.com/hc/en-us/articles/45063432279700-Calendar-import-requirements)
- [What's New from Workiva: AI Extensions, Workflow Management, and more (Integrated Workflow Management)](https://www.workiva.com/resources/whats-new-workiva-ai-extensions-workflow-management-and-more)
- [Release Notes March 30, 2026](https://support.workiva.com/hc/en-us/articles/47950927989908-Release-Notes-March-30-2026-April-5-2026)
