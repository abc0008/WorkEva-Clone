# Excel Checklist Migration & Adoption

Research dimension for the Pinnacle Financial Partners finance workflow/dependency tracker.
Scope: what the incumbent spreadsheets actually look like, how to bulk-import them, how many
templates to seed, and how an internal tool with no vendor CSM gets adopted. Deliberately does
**not** re-cover Workiva/BlackLine/FloQast feature comparisons, BD-scheduling math, react-flow
design, attestation control theory, or Azure architecture — those are separate dimensions.

---

## 1. The incumbent artifact: what a bank close checklist workbook actually is

### 1.1 The observed column set

Across published close-checklist templates the column vocabulary is remarkably stable. The
Excel University template ships eight columns — Task ID (e.g. `AR-01`), Category, Task
Description, Owner, Due Date, Status (data-validation dropdown: Not Started / In Progress /
Complete / Blocked), Completion Date, Notes — built as a native Excel Table with conditional
formatting `=AND([@[Due Date]]<TODAY(),[@Status]<>"Complete")` to redden overdue rows
([Excel University](https://www.excel-university.com/month-end-close-checklist-for-accountants-excel-template-workflow/)).
Jetpack's template adds stage-based grouping (10 sequential stages from "Prepare for closing"
to "Close the accounting period"), assigned team members, time tracking and notes
([Jetpack Workflow](https://jetpackworkflow.com/blog/month-end-close-checklist-template/)).
HighRadius's emphasizes **planned vs. actual completion date** comparison and a
monthly/quarterly/annual **frequency** flag
([HighRadius](https://www.highradius.com/resources/Templates/free-month-end-close-checklist-template/)).

A bank's real workbook will be a superset. Expect to find, in roughly this order of frequency:

| Spreadsheet column | Target model field | Notes / lossiness |
|---|---|---|
| Task ID / Ref (`AR-01`) | `task_template.external_ref` | **Preserve verbatim.** It is the join key for re-import, and it is what people say out loud in the close meeting. Do not replace it with a UUID in the UI. |
| Category / Cycle / Stage | `task_template.category` + used to seed sub-workflow grouping | Often doubles as both a functional area *and* a phase. Split into `category` (Treasury, AP, Loans, ALLL) and `phase` (Pre-close, Close, Reporting). |
| Task Description | `task_template.name` + `description` | Frequently one cell contains a name and 3 sentences of instruction. Split on first sentence/newline; keep full text in `description`. |
| Owner | `assignee_role` → resolved to Entra user | Store as **role** at template level, **user** at instance level. Owners churn; templates should not. |
| Backup / Alternate owner | `backup_assignee_role` | Present in bank checklists far more than in generic templates (audit expectation of segregation and coverage). Model it — it is the natural alert escalation target. |
| Entity / Legal Entity / Bank vs. Holdco | `instance.entity_id` (dimension), not a task attribute | See §1.3 — this is the single biggest structural mismatch. |
| BD offset ("BD+3", "WD-1") or a hard Due Date | `task_template.bd_offset` + `anchor` | Many rows carry a literal date typed for *last* month. Import must distinguish a true offset from a stale date. |
| Preparer / Reviewer / Approver (three name columns) | `preparer`, `reviewer`, `approver` roles + sign-off records | Maker-checker is already implicit in the sheet; make it explicit. |
| Status | `task.status` | Sheet vocabularies are 4–6 values. Map to canonical set; keep the source string in `import_raw`. |
| Comments / Notes | `task.comments[]` (first comment, author = importer, flagged "migrated") | Not a field — a thread. Do not create a permanently-editable free-text blob that becomes the new shadow record. |
| Tie-out reference / Recon ref / GL account | `task.tieout_ref` (+ optional `gl_account`) | Bank-specific. Keep searchable; it is how reviewers find the workpaper. |
| Control ID (SOX/FDICIA/COSO ref) | `task.control_id` | Must survive migration intact — this is the row that links close tasks to the control matrix and to the FDICIA/SOX testing population. |
| Dependency / Predecessor notes | `dependency_edge[]` | Almost never a structured column. See §1.2. |
| Evidence / Support link (path to a SharePoint folder) | `evidence` attachments | Migrate the *link* on first import; migrate files lazily on first use. |
| Sign-off initials / date cell | Historical `signoff` record, read-only | Import as historical, never as an active attestation — you cannot retroactively assert someone attested in your system. |

For regulatory-reporting trackers (Call Report / FR Y-9C / FR Y-14 / HMDA / CRA) the shape
shifts: rows become *schedules* and *deliverables*, and the anchor is a statutory external
deadline rather than BD+n. Call Reports are due 30 calendar days after quarter end (35 days for
Q1–Q3 for institutions with foreign offices), and a deadline landing on a weekend rolls to the
next business day while federal holidays do **not** shift it
([BankRegReports](https://www.bankregreports.com/call-report-filing-schedule/)). That asymmetry
is a real import/model requirement: the reg-reporting calendar needs a *statutory deadline*
anchor with its own roll convention, distinct from the internal BD calendar used for close tasks.

### 1.2 Where the mapping is lossy

Five failure classes, in descending order of pain:

1. **Dependencies buried in prose.** The dependency exists as "after Treasury posts the
   sweep," "once FTP file is received from Mosaic," "hold until ALLL model runs" inside the
   Notes or the task description. There is no predecessor column in any published template
   surveyed — Excel University's guidance is literally to "review blocked items daily during
   close week," i.e. manual coordination in place of modeled dependencies
   ([Excel University](https://www.excel-university.com/month-end-close-checklist-for-accountants-excel-template-workflow/)).
   Sequence is encoded *only* as row order and BD offset. Consequence: **the dependency graph
   does not exist yet and cannot be imported. It must be elicited.**
2. **One row = many real tasks.** "Reconcile all DDA suspense accounts" is one row and eleven
   people's work. Importing 1:1 produces tasks nobody can sign off atomically. Needs a
   post-import "split row" affordance.
3. **Merged cells and visual grouping.** Category headers are merged banner rows, not values;
   owner is written once and visually spans six rows. A naive parser drops the owner on rows
   2–6. Importer must forward-fill down a column when the source cell is part of a vertical
   merge, and must recognise banner rows (single populated cell spanning the table width) as
   category delimiters rather than tasks.
4. **Per-tab-per-entity duplication.** Twelve near-identical tabs (Bank, Holdco, subsidiaries,
   or one tab per region/market — highly likely for a bank that grew by acquisition, as
   Pinnacle did). The tabs drift: tab 7 has three extra rows nobody remembers adding. Importing
   tabs as separate templates cements the drift permanently. Correct move: import one tab as
   the canonical template, diff the others against it, and present the diff as a reconciliation
   UI ("these 3 tasks exist only in *Nashville*: entity-specific, or drift?").
5. **Formulas, macros, and hidden columns.** Status roll-up formulas, `#REF!` errors from last
   year's restructure, hidden helper columns with the real BD math, and a "% complete"
   COUNTIF that is the number leadership actually looks at. Read values not formulas, but
   surface hidden columns in the mapping UI rather than silently ignoring them.

### 1.3 The entity dimension

Do **not** model legal entity as a task column. Model it as a dimension on the *instance*:
`workflow_template` → `workflow_instance(period, entity)` → `task`. Sage Intacct's checklist
import does exactly this with a `TEMPLATETASK_IS_TOP_LEVEL` flag controlling whether a task
generates an assignment at top level only or fans out per entity
([Sage Intacct import docs](https://www.intacct.com/ia/docs/en_US/help_action/More/Uploading_Data/Close_Workspace/import-checklist-templates.htm)).
Adopt the same idea: a template task carries a `scope` of `per_entity` | `consolidated_only` |
`entity_list[]`. This alone collapses the twelve-tab problem.

---

## 2. Bulk import / onboarding spec

### 2.1 Prior art

- **Workiva**: builds a process either manually or via **"Process from file"** — CSV, TSV, TXT,
  XLS or XLSX. The required column set is Type, Title, Assigned to, Due date (YYYYMMDD),
  Approval by, Approval due date, File, Section, Instructions; where business days are
  configured in process settings, the due date can be entered as a business-day number rather
  than a date. The import includes an **AI-suggested data cleanup** step. Templates are
  discoverable ("Explore templates" → "Apply template"). Ordering is expressed only as start
  order (All at once / One at a time / Manual) — there is no predecessor graph in the import
  ([Workiva: Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process),
  [Workiva: Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)).
- **Sage Intacct Close Workspace**: template-header row plus task rows, task types constrained
  to Record / Review / Reconcile / Report, `TARGET_START_DAY` and `TARGET_COMPLETION_DAY` as
  signed integers in −365..365, exact-case ID matching, and reference-by-ID to a library of
  reusable task templates whose defaults the import overrides
  ([Sage Intacct](https://www.intacct.com/ia/docs/en_US/help_action/More/Uploading_Data/Close_Workspace/import-checklist-templates.htm)).
- **FloQast**: implementation is explicitly "checklist mapping plus reconciliation indexing,"
  2–8 weeks, "famously without IT dependency" — the work is mapping an existing close onto the
  platform, not inventing one ([CFO Shortlist benchmarks](https://www.cfoshortlist.com/reports/fpa-implementation-timeline-benchmarks)).

Two design lessons: (a) signed-integer day offsets, not dates, are the vendor-standard template
primitive — matching the BD+n model; (b) **none of them import dependencies.** That is
consistent with §1.2 and is permission to not try.

### 2.2 Concrete importer spec

Four-stage flow — **file → map → validate (dry-run) → commit** — matching established
spreadsheet-import UX practice: drag-and-drop plus file chooser, downloadable sample template,
CSV and XLSX, auto-suggested header mapping with manual override and **saveable mapping
presets**, real-time row-level validation with inline actionable errors and bulk fixes, a final
preview of transformed data, and success/failure reporting with a retry path — errors should be
*fixable, not fatal*, with an exportable error report for offline diagnosis
([CSVBox: spreadsheet import UX](https://blog.csvbox.io/spreadsheet-import-ux/),
[CSVBox: validate before DB](https://blog.csvbox.io/validate-csv-before-db/)).

Requirement-style statements:

- **IMP-1** The importer SHALL accept `.xlsx` and `.csv`, and for `.xlsx` SHALL present a
  sheet picker listing every visible and hidden worksheet with row counts.
- **IMP-2** The importer SHALL let the user select the header row and the data range, since
  bank workbooks routinely carry 1–6 rows of title/logo/period banner above the header.
- **IMP-3** The importer SHALL auto-suggest a source-column → target-field mapping, SHALL allow
  every suggestion to be overridden or set to "ignore," and SHALL persist the mapping as a named
  preset reusable for later tabs/entities.
- **IMP-4** The importer SHALL forward-fill values down vertically merged ranges and SHALL
  classify full-width single-value rows as category banners, not tasks, with the classification
  visible and overridable in the preview.
- **IMP-5** The importer SHALL run a **dry-run** producing a per-row disposition
  (`create` / `update` / `skip` / `error`) and a downloadable error report keyed by source row
  number, and SHALL write nothing to the database until the user commits.
- **IMP-6** Import SHALL be **idempotent** on `(template_id, external_ref)`. Re-importing a
  corrected workbook SHALL upsert by external ref, SHALL report adds/changes/removals as a diff,
  and SHALL require explicit confirmation before deleting or deactivating tasks absent from the
  new file. Rows without an external ref SHALL be assigned a deterministic surrogate
  (`slug(category)+slug(name)`) and flagged as weakly-keyed.
- **IMP-7** Commit SHALL be transactional per import batch, SHALL record an `import_batch`
  row (file hash, filename, user, timestamp, mapping preset, row dispositions) and SHALL
  support one-click rollback of an uncommitted-to-production template version.
- **IMP-8** Every imported task SHALL retain its source provenance (`source_file`,
  `source_sheet`, `source_row`, `import_batch_id`) — this is what makes the first parallel-run
  argument ("the tool is missing a task") resolvable in thirty seconds.
- **IMP-9** BD offsets SHALL be parsed from a permissive grammar (`BD+3`, `BD3`, `WD+3`,
  `Day 3`, `+3`, `BD-1`, `T+2`) into a signed integer plus anchor. Cells containing an absolute
  date SHALL be converted to an offset against that period's calendar **and shown to the user
  for confirmation**, never silently.
- **IMP-10** Free-text dependency prose SHALL NOT be auto-converted into graph edges. The
  importer SHALL instead flag rows whose text matches dependency cues (`after`, `once`,
  `following`, `depends`, `upon receipt`, `hold until`, `pending`, `when … completes`, or a
  reference matching another row's Task ID) into a **"Dependency candidates" review queue**,
  where each candidate is proposed as `A → B` for one-click accept/reject.

### 2.3 Is LLM-assisted mapping worth it?

**Yes for two narrowly scoped jobs; no as an autonomous importer.**

Worth it:
- **Header → field matching.** This is textbook schema matching. Research on LLM-assisted
  schema matching (Magneto) shows a retrieve-then-rerank design where a small model produces
  ranked candidates and an LLM reranks them, lifting MRR from 0.731 to 0.780 at k=5 and beating
  traditional baselines that top out around 0.45 MRR on messy real-world data — but the paper's
  own framing is that the output is a *ranked list to help users explore matches*, because
  "selecting the correct match is difficult even for subject matter experts"
  ([Magneto, PVLDB vol.18](https://www.vldb.org/pvldb/vol18/p2681-freire.pdf)). Workiva
  independently ships an "AI-suggested data cleanup" step inside its process import
  ([Workiva](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)).
  Ship it as suggestions with confidence, never as a silent decision.
- **Dependency-candidate extraction (§ IMP-10).** An LLM reading Notes + Description across all
  rows and proposing `A → B` edges against the known Task-ID vocabulary is a genuinely good use
  of the model: high recall, human adjudication, cheap to reject. This is the single highest-
  value AI step in the whole migration because the graph is the thing the spreadsheet cannot
  express.
- **Row-splitting suggestions** ("this row looks like 4 tasks").

Not worth it: LLM-parsed BD offsets (a regex is deterministic and auditable), LLM-generated task
descriptions (it will invent bank procedure), and any path where the model writes to the
template without a human commit. In a bank, the audit answer to "where did this control task
come from" cannot be "the model suggested it." Log every AI suggestion with accept/reject and
the accepting user.

Practical constraint: run mapping/extraction against **column headers and task text only**, and
confirm with the model-risk/InfoSec posture before sending any workbook content to a model
endpoint. If that clearance is slow, ship v1 with fuzzy string matching (Levenshtein + synonym
dictionary of the ~25 header names in §1.1) — it will hit the great majority of real headers —
and add the LLM reranker later behind a feature flag.

---

## 3. The "first template" problem

### 3.1 How many templates to seed

Seed **three to five**, not one and not thirty:

1. **Monthly close — one functional area** (the pilot; see §4).
2. **Full monthly close — one entity**, built incrementally during the pilot.
3. **Quarterly regulatory reporting — one report** (Call Report is the obvious candidate: hard
   statutory deadline, many upstream feeders, high visibility).
4. **A cross-team handoff pattern** (e.g. the ALLL / CECL package feeding both close and reg
   reporting) — this is the one that proves the *dependency* half of the product, which is
   Alex's differentiator versus a checklist.
5. Optional: **annual/audit request tracker**, only if it costs nothing.

Rationale: one template proves nothing about reuse; thirty means nobody validated any of them.

### 3.2 One giant workflow vs. many linked sub-workflows

**Many linked sub-workflows, joined by explicit cross-workflow dependency edges.** Reasons:

- **Ownership.** A team owns a sub-workflow and can edit it without change-controlling the
  whole close. One monolith means every edit is everyone's edit — the exact failure that makes
  the master spreadsheet a bottleneck today.
- **Legibility on canvas.** A full bank close is 200–500 tasks. A react-flow canvas of 400
  nodes is a hairball; 12 canvases of 20–40 nodes each, plus one program-level map showing only
  sub-workflow nodes and their inter-edges, is navigable.
- **Roll-forward cadence differs.** Monthly close, quarterly reg reporting and annual audit
  roll forward on different clocks. Coupling them into one instance forces an awkward period model.
- **Vendor precedent.** Workiva's model is many processes with tasks and approval chains rather
  than one mega-process; Intacct organizes template tasks under categories with a reusable task
  library ([Workiva](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes),
  [Sage Intacct](https://www.intacct.com/ia/docs/en_US/help_action/More/Uploading_Data/Close_Workspace/import-checklist-templates.htm)).

Implied model requirement: a first-class **cross-workflow dependency** (task in workflow A →
task in workflow B, within the same period/entity scope), plus a **program/period view** that
aggregates instances so the controller still sees "the close" as one thing. Also a **shared task
library**: the same recon task reused across entity templates, edited once — Intacct's
`TASKTEMPLATE_ID` pattern where the import can override library defaults per instantiation.

### 3.3 Vendor implementation playbooks — timelines and who does the work

- **FloQast**: 2–8 weeks; checklist mapping and reconciliation indexing; finance-led, minimal IT.
- **Workiva**: 6–12 weeks for a *first solution* scoped to a specific compliance need (SEC, SOX)
  and timed to a filing deadline; multi-solution programs phase across several quarters.
- **BlackLine**: 4–6 months for enterprise close, phased — reconciliations first, then matching,
  then journals.
- Common pattern: close-management tooling implements faster than FP&A suites because it *maps*
  an existing process rather than inventing one; finance can lead deployment.
  ([CFO Shortlist](https://www.cfoshortlist.com/reports/fpa-implementation-timeline-benchmarks))

Read-across for an internal build: **plan a 6–12 week first-solution window anchored to a
specific close/filing date**, staffed by a named finance owner (a controller-level "process
owner" doing the mapping) plus the dev team — not by IT alone. The vendor pattern of anchoring
scope to one deadline is the most transferable idea in this section.

---

## 4. Rollout and change management with no vendor CSM

### 4.1 Pilot scope

Pick **one functional area, one entity, one full close cycle** — not the whole close, not one
task, not one report. Criteria for the pilot area: (a) 20–50 tasks, (b) genuine downstream
dependents so the alerting feature is exercised, (c) a willing, senior-enough owner, (d) not
the single most deadline-critical path in the first month. A reg-reporting deliverable makes a
strong *second* pilot because the statutory deadline is externally verifiable.

### 4.2 Parallel run

Run the spreadsheet and the tool side by side for **exactly one close cycle** (two at the
absolute maximum). Parallel adoption is the standard low-risk changeover pattern precisely
because the old system remains the fallback, at the cost of doubled effort — and that cost is
why it must be time-boxed ([Parallel adoption, Wikipedia](https://en.wikipedia.org/wiki/Parallel_adoption)).
Rules that make it survivable:

- **The tool is the system of record for status from day 1 of the parallel run; the spreadsheet
  is read-only/reference.** Bidirectional dual-maintenance is the failure mode, not the safety net.
- Nominate one person to reconcile tool vs. sheet at end of the cycle and log every divergence
  with a cause code (missing task, wrong owner, wrong BD offset, missing dependency, tool defect,
  user error). That log *is* the backlog for cycle 2.
- Publish a daily 60-second close-status view generated **from the tool**, so the tool becomes
  the artifact leadership reads. Nothing kills a shadow spreadsheet faster than the boss quoting
  the new dashboard.

### 4.3 Cutover criteria (exit the parallel run only when all are true)

- ≥95% of pilot tasks in the tool have a correct owner, BD offset and category, verified by the
  owner (not by the importer).
- Every dependency edge asserted by the pilot team is either modeled or explicitly waived.
- Zero P1 defects open; sign-off + evidence upload exercised by every pilot user at least once.
- Business-day calendar validated against the actual period, including the bank's holiday set
  and the weekend-roll behaviour for statutory deadlines.
- Reconciliation log shows no divergence class that would have caused a missed deadline.
- Named owner signs a one-page "retire the spreadsheet" note; the workbook is moved to a
  read-only archive location on the same day. Sunsetting the old artifact on a fixed date is the
  operative mechanism — a workflow-retirement plan, not an aspiration
  ([CTO Input: retire shadow spreadsheets](https://blog.ctoinput.com/retire-shadow-spreadsheets/)).

### 4.4 Avoiding "a second place to update status"

The dominant failure mode. Countermeasures, in order of effectiveness:

1. **Delete the alternative.** Archive the workbook read-only; break the SharePoint link people
   have bookmarked; redirect it to the tool.
2. **Make the tool the source of the reports leadership reads** (close dashboard, on-time %,
   late list) so status entered anywhere else is invisible.
3. **Notifications go where work happens** — Teams and email deep-links into the task, so
   updating status is one click from the notification, not a context switch. (Alert fatigue is
   the counter-risk: digest by default, immediate only for blocking/late events.)
4. **Zero-typing status where possible** — a sign-off with evidence upload *is* the status change.
5. **Entra SSO with no separate login.** Any auth friction re-creates the spreadsheet.

### 4.5 Known failure modes of internal-build close trackers

- **Second-place-to-update** (above) — #1 killer.
- **Template drift with no governance**: everyone can edit the template mid-period; period
  instances become non-comparable and the audit trail is meaningless. Mitigation: versioned
  templates, changes apply to the *next* instantiation by default, in-period edits require a
  reason and land in the audit log.
- **Owner churn breaking the graph**: people leave, tasks orphan. Mitigation: role-based
  assignment, backup owner, and an orphaned-task report before each roll-forward.
- **Alert fatigue → alerts ignored → tool distrusted.** Tune thresholds during the pilot.
- **The bus factor of an internal build**: no CSM, no roadmap, one developer. Mitigation
  requires an explicit named product owner in finance, a support channel, a documented backlog,
  and — for a bank — registration with whatever EUC/end-user-computing or application inventory
  process applies, since a system holding attestation evidence for FDICIA/SOX controls will be
  in audit scope on day one. Treat "who supports this in year 3" as a design input, not an
  afterthought.
- **Migrating the mess**: importing 400 rows verbatim, including 60 obsolete ones. The
  migration is the only cheap moment to prune; budget an explicit rationalization pass.
- **Over-modeling the graph**: asserting dependencies that are conventions rather than true
  constraints produces false "blocked" states and teaches people to ignore the graph. Start with
  the ~20% of edges that are genuine hard handoffs.

### 4.6 Training artifacts (all of them small)

One-page role cards (Preparer / Reviewer / Approver / Admin); a 5-minute screen recording per
role; a 1-page "what changed vs. the spreadsheet" mapping sheet, literally column-by-column; an
in-app first-run tour on the task list and the sign-off dialog; a printable BD calendar for the
period showing BD+n → calendar date; office hours during BD1–BD5 of the first two closes; a
named superuser per team. Expect adoption to hinge on the first close-week experience — deep,
short, in-context support beats a comprehensive manual nobody opens.

---

## 5. Drop-in migration & rollout section for the requirements doc

### Phase 0 — Discovery & inventory (2 weeks)
*Do:* inventory every close checklist, reg-reporting tracker and handoff email thread; collect
the workbooks; identify entity/tab duplication; name the finance process owner and the pilot
team; capture the bank holiday calendar and statutory deadline set.
*Exit:* signed-off inventory listing every workbook, its owner, task count, entity scope and
whether it is in FDICIA/SOX scope.

### Phase 1 — Import & template build, pilot area (3 weeks)
*Do:* build/harden the importer to §2.2; import the pilot area's tab; run the dependency-candidate
review workshop (60–90 min with the pilot team — this is where the graph is actually created);
rationalize obsolete rows; publish template v1.
*Exit:* pilot template instantiated for the upcoming period with 100% of tasks owner-confirmed;
dependency-candidate queue fully adjudicated; import batch reproducible from the source file.

### Phase 2 — Parallel run, one close cycle (1 cycle)
*Do:* run tool + read-only spreadsheet; daily dashboard from the tool; log every divergence.
*Exit:* the §4.3 cutover criteria.

### Phase 3 — Cutover & expansion (2–3 cycles)
*Do:* archive the pilot workbook; onboard the next 2–3 areas per cycle using the saved import
mapping preset; add the reg-reporting template and its cross-workflow edges; enable delay
alerting to downstream owners once the graph is trusted.
*Exit:* ≥80% of close tasks live in the tool; all sign-offs for migrated areas occurring in-tool.

### Phase 4 — Steady state & hardening (ongoing)
*Do:* roll-forward each period from templates; quarterly template review; orphaned-owner report;
audit-evidence export walkthrough with Internal Audit; retire remaining trackers.
*Exit:* a full close and a full quarterly reg cycle completed with no spreadsheet fallback and
an audit-acceptable evidence trail.

### Success metrics (baseline them in Phase 0 — you cannot claim improvement without a before)

| Metric | Definition | Target |
|---|---|---|
| Close cycle time | Period end → books closed, calendar days | Hold flat through cutover; then trend toward APQC top-performer territory. APQC's benchmarking of ~2,300 organizations put the median at **6.4 calendar days**, top performers **4.8**, bottom **10** ([APQC via Numeric](https://www.numeric.io/blog/how-long-does-month-end-close-take)) |
| % tasks completed by due BD | on-time completions / total tasks | ≥90% by cycle 3 |
| % sign-offs executed in tool | in-tool sign-offs / total required | ≥95% by cutover; email sign-offs → 0 |
| Evidence attach rate | tasks requiring proof with an attachment at sign-off | ≥98% |
| Adoption rate | weekly active assignees / total assignees during close week | ≥90% |
| Shadow-artifact count | live spreadsheets/trackers still updated for in-scope areas | → 0 |
| Late-alert lead time | median hours between predicted breach and downstream owner notified | ≥8 business hours |
| Alert precision | alerts acted on / alerts sent | ≥70% (below this, retune) |
| Data-quality | tasks with missing owner / BD offset / category | <2% |
| Import fidelity | source rows reconciled to tasks in the first parallel run | 100% explained |

**Explicitly out of scope for v1:** automatic dependency inference committed without human
review; migrating historical closed periods (import the *current* template, not five years of
completed checklists — bring history in as read-only archive links if needed for audit).

---

## Sources

- [Excel University — Month-End Close Checklist for Accountants (Excel Template + Workflow)](https://www.excel-university.com/month-end-close-checklist-for-accountants-excel-template-workflow/)
- [Jetpack Workflow — Month-End Close Checklist Template](https://jetpackworkflow.com/blog/month-end-close-checklist-template/)
- [HighRadius — Month End Close Checklist Free Excel Template](https://www.highradius.com/resources/Templates/free-month-end-close-checklist-template/)
- [Workiva Support — Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [Workiva Support — Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Sage Intacct — CSV import: Add checklist templates for Close Workspace](https://www.intacct.com/ia/docs/en_US/help_action/More/Uploading_Data/Close_Workspace/import-checklist-templates.htm)
- [CFO Shortlist — FP&A & EPM Implementation Timeline Benchmarks](https://www.cfoshortlist.com/reports/fpa-implementation-timeline-benchmarks)
- [CSVBox — Best UX flow for spreadsheet imports](https://blog.csvbox.io/spreadsheet-import-ux/)
- [CSVBox — Validate CSV data before saving to DB](https://blog.csvbox.io/validate-csv-before-db/)
- [Magneto: Combining Small and Large Language Models for Schema Matching (PVLDB vol. 18)](https://www.vldb.org/pvldb/vol18/p2681-freire.pdf)
- [Numeric — How Long Does Month-End Close Take? Examining Benchmarks (APQC, Ventana figures)](https://www.numeric.io/blog/how-long-does-month-end-close-take)
- [BankRegReports — FFIEC Call Report Filing Schedule and Deadlines](https://www.bankregreports.com/call-report-filing-schedule/)
- [Wikipedia — Parallel adoption](https://en.wikipedia.org/wiki/Parallel_adoption)
- [CTO Input — Stop Shadow Spreadsheets With a Workflow Retirement Plan](https://blog.ctoinput.com/retire-shadow-spreadsheets/)
- [Whatfix — Accounting Software Modernization: Keys to Adoption](https://whatfix.com/blog/accounting-software-adoption/)
